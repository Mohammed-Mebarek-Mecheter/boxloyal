// lib/services/billing-service.ts
import { db } from "@/db";
import {
    subscriptions,
    subscriptionPlans,
    gracePeriods,
    boxes,
    boxMemberships,
    usageEvents,
    orders,
    customerProfiles
} from "@/db/schema";
import {eq, and, desc, gte, count, lte} from "drizzle-orm";

export type SubscriptionTier = "starter" | "performance" | "elite";
export type UsageEventType = "athlete_added" | "athlete_removed" | "checkin_logged" | "pr_logged" | "wod_completed" | "coach_added" | "coach_removed";
export type GracePeriodReason = "athlete_limit_exceeded" | "coach_limit_exceeded" | "trial_ending" | "payment_failed" | "subscription_canceled";

export interface SubscriptionUsage {
    athletes: number;
    coaches: number;
    athletesPercentage: number;
    coachesPercentage: number;
    isAthleteOverLimit: boolean;
    isCoachOverLimit: boolean;
    athleteLimit: number;
    coachLimit: number;
}

export interface RetentionMetrics {
    churned: number;
    new: number;
    active: number;
    retentionRate: number;
    timeframe: string;
    period: {
        start: Date;
        end: Date;
    };
}

export interface UsageTrend {
    recentAdditions: number;
    projectedMonthly: number;
    willExceedSoon: boolean;
}

export interface UsageLimit {
    current: number;
    limit: number;
    available: number;
    utilizationPercentage: number;
    isOverLimit: boolean;
    canAdd: boolean;
    gracePeriod?: any;
    upgradeRequired: boolean;
    trend: UsageTrend;
}

export class BillingService {
    /**
     * Get comprehensive subscription info for a box
     */
    static async getSubscriptionInfo(boxId: string) {
        const box = await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
        });

        if (!box) {
            throw new Error("Box not found");
        }

        // Get active subscription with customer profile
        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            ),
            with: {
                customerProfile: true
            },
            orderBy: desc(subscriptions.createdAt),
        });

        // Get current plan based on box tier
        const currentPlan = await db.query.subscriptionPlans.findFirst({
            where: eq(subscriptionPlans.tier, box.subscriptionTier),
        });

        // Get all available plans for upgrade options
        const availablePlans = await db.query.subscriptionPlans.findMany({
            where: eq(subscriptionPlans.isActive, true),
            orderBy: subscriptionPlans.monthlyPrice,
        });

        // Calculate usage
        const usage = await this.calculateUsage(boxId, currentPlan);

        // Get active grace period
        const activeGracePeriod = await db.query.gracePeriods.findFirst({
            where: and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date())
            ),
        });

        // Get recent billing activity
        const recentOrders = await db.query.orders.findMany({
            where: eq(orders.boxId, boxId),
            orderBy: desc(orders.createdAt),
            limit: 5,
        });

        // Calculate next billing date
        const nextBillingDate = activeSubscription?.currentPeriodEnd || box.subscriptionEndsAt;
        const daysUntilBilling = nextBillingDate
            ? Math.ceil((new Date(nextBillingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : null;

        return {
            box: {
                id: box.id,
                subscriptionStatus: box.subscriptionStatus,
                subscriptionTier: box.subscriptionTier,
                trialEndsAt: box.trialEndsAt,
                subscriptionEndsAt: box.subscriptionEndsAt,
                status: box.status,
                nextBillingDate,
                daysUntilBilling,
            },
            subscription: activeSubscription,
            currentPlan,
            availablePlans,
            usage,
            gracePeriod: activeGracePeriod,
            recentOrders,
            billing: {
                canAddAthletes: !usage.isAthleteOverLimit || !!activeGracePeriod,
                canAddCoaches: !usage.isCoachOverLimit || !!activeGracePeriod,
                needsUpgrade: (usage.isAthleteOverLimit || usage.isCoachOverLimit) && !activeGracePeriod,
                isTrialActive: box.trialEndsAt && new Date(box.trialEndsAt) > new Date(),
                trialDaysLeft: box.trialEndsAt
                    ? Math.max(0, Math.ceil((new Date(box.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                    : null,
            },
        };
    }

    /**
     * Calculate current usage against subscription limits
     */
    static async calculateUsage(boxId: string, plan?: any): Promise<SubscriptionUsage> {
        // Count active members by role
        const [athleteCountResult, coachCountResult] = await Promise.all([
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, "athlete"),
                    eq(boxMemberships.isActive, true)
                )),
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, "coach"),
                    eq(boxMemberships.isActive, true)
                ))
        ]);

        const athleteLimit = plan?.athleteLimit ?? 0;
        const coachLimit = plan?.coachLimit ?? 0;

        return {
            athletes: athleteCountResult[0]?.count ?? 0,
            coaches: coachCountResult[0]?.count ?? 0,
            athletesPercentage: athleteLimit > 0 ? Math.round(((athleteCountResult[0]?.count ?? 0) / athleteLimit) * 100) : 0,
            coachesPercentage: coachLimit > 0 ? Math.round(((coachCountResult[0]?.count ?? 0) / coachLimit) * 100) : 0,
            isAthleteOverLimit: (athleteCountResult[0]?.count ?? 0) > athleteLimit,
            isCoachOverLimit: (coachCountResult[0]?.count ?? 0) > coachLimit,
            athleteLimit,
            coachLimit,
        };
    }

    /**
     * Check usage limits for specific type
     */
    static async checkUsageLimits(
        boxId: string,
        type: "athlete" | "coach"
    ): Promise<UsageLimit> {
        const [boxResult, currentCountResult] = await Promise.all([
            db.query.boxes.findFirst({
                where: eq(boxes.id, boxId),
            }),
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, type === "athlete" ? "athlete" : "coach"),
                    eq(boxMemberships.isActive, true)
                ))
        ]);

        if (!boxResult) {
            throw new Error("Box not found");
        }

        const plan = await db.query.subscriptionPlans.findFirst({
            where: eq(subscriptionPlans.tier, boxResult.subscriptionTier),
        });

        if (!plan) {
            throw new Error("Subscription plan not found");
        }

        const limit = type === "athlete" ? plan.athleteLimit : plan.coachLimit;
        const current = currentCountResult[0]?.count ?? 0;
        const isOverLimit = current >= limit;

        // Check for existing grace period
        const existingGracePeriod = await db.query.gracePeriods.findFirst({
            where: and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date())
            ),
        });

        // Get usage trend (members added in last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const [recentAdditionsResult] = await db
            .select({ count: count() })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.role, type === "athlete" ? "athlete" : "coach"),
                eq(boxMemberships.isActive, true),
                gte(boxMemberships.createdAt, thirtyDaysAgo)
            ));

        const trend: UsageTrend = {
            recentAdditions: recentAdditionsResult?.count ?? 0,
            projectedMonthly: Math.round((recentAdditionsResult?.count ?? 0) * (30 / 30)),
            willExceedSoon: !isOverLimit && ((current + (recentAdditionsResult?.count ?? 0)) >= limit),
        };

        return {
            current,
            limit,
            available: Math.max(0, limit - current),
            utilizationPercentage: Math.round((current / limit) * 100),
            isOverLimit,
            canAdd: !isOverLimit || !!existingGracePeriod,
            gracePeriod: existingGracePeriod,
            upgradeRequired: isOverLimit && !existingGracePeriod,
            trend,
        };
    }

    /**
     * Create a grace period for a box
     */
    static async triggerGracePeriod(
        boxId: string,
        reason: GracePeriodReason,
        customMessage?: string
    ) {
        // Check if there's already an active grace period
        const existingGracePeriod = await db.query.gracePeriods.findFirst({
            where: and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date())
            ),
        });

        if (existingGracePeriod) {
            return { gracePeriod: existingGracePeriod, wasExisting: true };
        }

        // Create new grace period with dynamic duration
        const gracePeriodDaysMap: Record<GracePeriodReason, number> = {
            "athlete_limit_exceeded": 14,
            "coach_limit_exceeded": 14,
            "trial_ending": 7,
            "payment_failed": 3,
            "subscription_canceled": 0,
        };

        const daysToAdd = gracePeriodDaysMap[reason] ?? 7;
        const endsAt = new Date();
        endsAt.setDate(endsAt.getDate() + daysToAdd);

        const [gracePeriod] = await db
            .insert(gracePeriods)
            .values({
                boxId,
                reason,
                endsAt,
            })
            .returning();

        // Track usage event for grace period creation
        await db.insert(usageEvents).values({
            boxId,
            eventType: "grace_period_triggered",
            quantity: 1,
            metadata: {
                reason,
                gracePeriodId: gracePeriod?.id,
                endsAt: endsAt.toISOString(),
                customMessage,
            },
        });

        return { gracePeriod, wasExisting: false };
    }

    /**
     * Track usage events
     */
    static async trackUsage(
        boxId: string,
        events: Array<{
            eventType: UsageEventType;
            quantity?: number;
            metadata?: Record<string, any>;
        }>
    ) {
        if (events.length === 0) {
            throw new Error("No events to track");
        }

        // Insert events in batch
        const eventsData = events.map(event => ({
            boxId,
            eventType: event.eventType,
            quantity: event.quantity || 1,
            metadata: event.metadata || {},
        }));

        await db.insert(usageEvents).values(eventsData);

        // Check if any limit-related events should trigger grace periods
        const limitEvents = events.filter(e =>
            e.eventType === "athlete_added" || e.eventType === "coach_added"
        );

        if (limitEvents.length > 0) {
            await this.checkAndTriggerGracePeriods(boxId, limitEvents);
        }

        return {
            success: true,
            eventsTracked: events.length,
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Get retention analytics
     */
    static async getRetentionAnalytics(
        boxId: string,
        timeframe: "7d" | "30d" | "90d" | "365d" = "30d"
    ): Promise<RetentionMetrics> {
        const endDate = new Date();
        const startDate = new Date();

        switch (timeframe) {
            case "7d":
                startDate.setDate(endDate.getDate() - 7);
                break;
            case "30d":
                startDate.setDate(endDate.getDate() - 30);
                break;
            case "90d":
                startDate.setDate(endDate.getDate() - 90);
                break;
            case "365d":
                startDate.setDate(endDate.getDate() - 365);
                break;
        }

        // Get churn data
        const churnedAthletes = await db
            .select({
                count: count()
            })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, false),
                gte(boxMemberships.leftAt, startDate),
                lte(boxMemberships.leftAt, endDate)
            ));

        // Get new athletes
        const newAthletes = await db
            .select({
                count: count()
            })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                gte(boxMemberships.joinedAt, startDate),
                lte(boxMemberships.joinedAt, endDate)
            ));

        // Get total active athletes
        const activeAthletes = await db
            .select({
                count: count()
            })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true)
            ));

        // Calculate retention rate
        const retentionRate = activeAthletes[0].count > 0
            ? (1 - (churnedAthletes[0].count / activeAthletes[0].count)) * 100
            : 0;

        return {
            churned: churnedAthletes[0].count,
            new: newAthletes[0].count,
            active: activeAthletes[0].count,
            retentionRate: Math.round(retentionRate * 100) / 100,
            timeframe,
            period: {
                start: startDate,
                end: endDate
            }
        };
    }

    /**
     * Get billing history
     */
    static async getBillingHistory(
        boxId: string,
        limit: number = 20,
        offset: number = 0
    ) {
        const [ordersData, totalCountResult] = await Promise.all([
            db.query.orders.findMany({
                where: eq(orders.boxId, boxId),
                orderBy: desc(orders.createdAt),
                limit,
                offset,
                with: {
                    subscription: true,
                    customerProfile: true,
                },
            }),
            db
                .select({ count: count() })
                .from(orders)
                .where(eq(orders.boxId, boxId))
        ]);

        const totalCount = totalCountResult[0]?.count ?? 0;

        // Calculate totals and statistics
        const totalSpent = ordersData
            .filter(order => order.status === "paid")
            .reduce((sum, order) => sum + (order.amount ?? 0), 0);

        const monthlySpend = ordersData
            .filter(order => {
                const orderDate = new Date(order.createdAt);
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                return orderDate >= thirtyDaysAgo && order.status === "paid";
            })
            .reduce((sum, order) => sum + (order.amount ?? 0), 0);

        return {
            orders: ordersData.map(order => ({
                ...order,
                amountFormatted: `$${((order.amount ?? 0) / 100).toFixed(2)}`,
            })),
            pagination: {
                total: totalCount,
                limit,
                offset,
                hasMore: (offset + limit) < totalCount,
            },
            summary: {
                totalSpent,
                totalSpentFormatted: `$${(totalSpent / 100).toFixed(2)}`,
                monthlySpend,
                monthlySpendFormatted: `$${(monthlySpend / 100).toFixed(2)}`,
                averageOrderValue: ordersData.length > 0
                    ? Math.round(totalSpent / ordersData.length)
                    : 0,
            },
        };
    }

    /**
     * Cancel subscription
     */
    static async cancelSubscription(
        boxId: string,
        cancelAtPeriodEnd: boolean = true,
        reason?: string
    ) {
        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            ),
        });

        if (!activeSubscription) {
            throw new Error("No active subscription found");
        }

        // Update subscription in database
        await db.update(subscriptions)
            .set({
                cancelAtPeriodEnd,
                canceledAt: cancelAtPeriodEnd ? null : new Date(),
                status: cancelAtPeriodEnd ? "active" : "canceled",
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, activeSubscription.id));

        // Track cancellation event
        await db.insert(usageEvents).values({
            boxId,
            eventType: "subscription_canceled",
            quantity: 1,
            metadata: {
                subscriptionId: activeSubscription.id,
                cancelAtPeriodEnd,
                reason,
                polarSubscriptionId: activeSubscription.polarSubscriptionId,
            },
        });

        return {
            success: true,
            cancelAtPeriodEnd,
            accessEndsAt: cancelAtPeriodEnd
                ? activeSubscription.currentPeriodEnd
                : new Date(),
        };
    }

    /**
     * Reactivate canceled subscription
     */
    static async reactivateSubscription(boxId: string) {
        const canceledSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.cancelAtPeriodEnd, true)
            ),
        });

        if (!canceledSubscription) {
            throw new Error("No subscription scheduled for cancellation found to reactivate");
        }

        // Update subscription to cancel the scheduled cancellation
        await db.update(subscriptions)
            .set({
                cancelAtPeriodEnd: false,
                canceledAt: null,
                status: "active",
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, canceledSubscription.id));

        // Track reactivation event
        await db.insert(usageEvents).values({
            boxId,
            eventType: "subscription_reactivated",
            quantity: 1,
            metadata: {
                subscriptionId: canceledSubscription.id,
                polarSubscriptionId: canceledSubscription.polarSubscriptionId,
            },
        });

        // Resolve any active grace periods related to cancellation
        const gracePeriodsToResolve = await db
            .select()
            .from(gracePeriods)
            .where(and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date()),
                eq(gracePeriods.reason, "subscription_canceled")
            ));

        for (const gp of gracePeriodsToResolve) {
            await db.update(gracePeriods)
                .set({
                    resolved: true,
                    resolvedAt: new Date(),
                    resolution: "subscription_reactivated"
                })
                .where(eq(gracePeriods.id, gp.id));
        }

        return {
            success: true,
            subscription: canceledSubscription,
        };
    }

    /**
     * Check and trigger grace periods when limits are exceeded
     */
    private static async checkAndTriggerGracePeriods(
        boxId: string,
        limitEvents: Array<{ eventType: string }>
    ) {
        try {
            const box = await db.query.boxes.findFirst({
                where: eq(boxes.id, boxId),
            });

            if (!box) {
                console.warn(`Box not found for grace period check: ${boxId}`);
                return;
            }

            const plan = await db.query.subscriptionPlans.findFirst({
                where: eq(subscriptionPlans.tier, box.subscriptionTier),
            });

            if (!plan) {
                console.warn(`Subscription plan not found for box tier ${box.subscriptionTier} during grace period check.`);
                return;
            }

            // Check athlete and coach limits
            const checks = [
                {
                    type: "athlete",
                    condition: limitEvents.some(e => e.eventType === "athlete_added"),
                    getCount: async () => {
                        const [result] = await db.select({ count: count() }).from(boxMemberships)
                            .where(and(eq(boxMemberships.boxId, boxId), eq(boxMemberships.role, "athlete"), eq(boxMemberships.isActive, true)));
                        return result?.count ?? 0;
                    },
                    limit: plan.athleteLimit,
                    reason: "athlete_limit_exceeded" as GracePeriodReason
                },
                {
                    type: "coach",
                    condition: limitEvents.some(e => e.eventType === "coach_added"),
                    getCount: async () => {
                        const [result] = await db.select({ count: count() }).from(boxMemberships)
                            .where(and(eq(boxMemberships.boxId, boxId), eq(boxMemberships.role, "coach"), eq(boxMemberships.isActive, true)));
                        return result?.count ?? 0;
                    },
                    limit: plan.coachLimit,
                    reason: "coach_limit_exceeded" as GracePeriodReason
                }
            ];

            for (const check of checks) {
                if (check.condition) {
                    const currentCount = await check.getCount();
                    console.log(`Checking ${check.type} limit for box ${boxId}: ${currentCount}/${check.limit}`);

                    if (currentCount > check.limit) {
                        const reason = check.reason;
                        console.log(`Triggering grace period for box ${boxId} due to ${reason}`);

                        // Check if there's already an active grace period for this specific reason
                        const existingGracePeriod = await db.query.gracePeriods.findFirst({
                            where: and(
                                eq(gracePeriods.boxId, boxId),
                                eq(gracePeriods.resolved, false),
                                gte(gracePeriods.endsAt, new Date()),
                                eq(gracePeriods.reason, reason)
                            ),
                        });

                        if (!existingGracePeriod) {
                            await this.triggerGracePeriod(boxId, reason);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error in checkAndTriggerGracePeriods:", error);
        }
    }
}