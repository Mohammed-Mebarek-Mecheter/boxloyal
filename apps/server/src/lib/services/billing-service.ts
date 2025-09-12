// lib/services/billing-service.ts
import {db} from "@/db";
import {
    billingEvents,
    boxes,
    boxMemberships,
    customerProfiles,
    gracePeriods,
    orders,
    overageBilling,
    paymentMethods,
    planChangeRequests,
    subscriptionChanges,
    subscriptionPlans,
    subscriptions,
    usageEvents
} from "@/db/schema";
import {and, asc, count, desc, eq, gte, lte, ne, or, sql } from "drizzle-orm";

export type UsageEventType =
    | "athlete_added" | "athlete_removed" | "checkin_logged" | "pr_logged"
    | "wod_completed" | "coach_added" | "coach_removed" | "subscription_created"
    | "subscription_canceled" | "subscription_reactivated" | "grace_period_triggered"
    | "plan_upgraded" | "plan_downgraded" | "overage_billed" | "payment_failed"
    | "payment_received" | "grace_period_resolved";

export type GracePeriodReason =
    | "athlete_limit_exceeded" | "coach_limit_exceeded" | "trial_ending"
    | "payment_failed" | "subscription_canceled" | "billing_issue";

export type PlanChangeType = "upgrade" | "downgrade" | "lateral";
export interface SubscriptionUsage {
    athletes: number;
    coaches: number;
    athletesPercentage: number;
    coachesPercentage: number;
    isAthleteOverLimit: boolean;
    isCoachOverLimit: boolean;
    athleteLimit: number;
    coachLimit: number;
    athleteOverage: number;
    coachOverage: number;
    hasOverageEnabled: boolean;
    nextBillingDate?: Date;
    estimatedOverageAmount: number; // In cents
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
    growthRate: number;
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
    overage: number;
    estimatedOverageCost: number; // In cents
}

export interface BillingDashboard {
    subscription: any;
    usage: SubscriptionUsage;
    upcomingBilling: {
        nextBillingDate?: Date;
        estimatedAmount: number;
        baseAmount: number;
        overageAmount: number;
        daysUntilBilling: number;
    };
    recentActivity: any[];
    gracePeriods: any[];
    planChangeRequests: any[];
}

export class BillingService {
    /**
     * Enhanced usage calculation with overage support
     */
    static async calculateEnhancedUsage(
        boxId: string,
        plan?: any,
        box?: any
    ): Promise<SubscriptionUsage> {
        // Get box data if not provided
        if (!box) {
            box = await db.query.boxes.findFirst({
                where: eq(boxes.id, boxId),
            });
        }

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

        const athleteLimit = plan?.athleteLimit ?? box?.currentAthleteLimit ?? 75;
        const coachLimit = plan?.coachLimit ?? box?.currentCoachLimit ?? 3;
        const athleteCount = athleteCountResult[0]?.count ?? 0;
        const coachCount = coachCountResult[0]?.count ?? 0;

        // Calculate overages
        const athleteOverage = Math.max(0, athleteCount - athleteLimit);
        const coachOverage = Math.max(0, coachCount - coachLimit);

        // Get overage rates from plan
        const athleteOverageRate = plan?.athleteOveragePrice ?? 100; // $1.00 in cents
        const coachOverageRate = plan?.coachOveragePrice ?? 100; // $1.00 in cents

        const estimatedOverageAmount = (athleteOverage * athleteOverageRate) + (coachOverage * coachOverageRate);

        return {
            athletes: athleteCount,
            coaches: coachCount,
            athletesPercentage: athleteLimit > 0 ? Math.round((athleteCount / athleteLimit) * 100) : 0,
            coachesPercentage: coachLimit > 0 ? Math.round((coachCount / coachLimit) * 100) : 0,
            isAthleteOverLimit: athleteCount > athleteLimit,
            isCoachOverLimit: coachCount > coachLimit,
            athleteLimit,
            coachLimit,
            athleteOverage,
            coachOverage,
            hasOverageEnabled: box?.isOverageEnabled ?? false,
            nextBillingDate: box?.nextBillingDate,
            estimatedOverageAmount
        };
    }

    /**
     * Enhanced usage limit checking with overage support
     */
    static async checkUsageLimits(
        boxId: string,
        type: "athlete" | "coach"
    ): Promise<UsageLimit> {
        const [box, currentCountResult] = await Promise.all([
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

        if (!box) {
            throw new Error("Box not found");
        }

        const plan = await db.query.subscriptionPlans.findFirst({
            where: and(
                eq(subscriptionPlans.tier, box.subscriptionTier),
                eq(subscriptionPlans.isCurrentVersion, true)
            ),
        });

        if (!plan) {
            throw new Error("Subscription plan not found");
        }

        const limit = type === "athlete" ? plan.athleteLimit : plan.coachLimit;
        const current = currentCountResult[0]?.count ?? 0;
        const isOverLimit = current >= limit;
        const overage = Math.max(0, current - limit);

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

        const [recentAdditionsResult, previousCountResult] = await Promise.all([
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, type === "athlete" ? "athlete" : "coach"),
                    eq(boxMemberships.isActive, true),
                    gte(boxMemberships.createdAt, thirtyDaysAgo)
                )),
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, type === "athlete" ? "athlete" : "coach"),
                    eq(boxMemberships.isActive, true),
                    lte(boxMemberships.createdAt, thirtyDaysAgo)
                ))
        ]);

        const recentAdditions = recentAdditionsResult[0]?.count ?? 0;
        const previousCount = previousCountResult[0]?.count ?? 0;
        const growthRate = previousCount > 0 ? (recentAdditions / previousCount) * 100 : 0;

        const trend: UsageTrend = {
            recentAdditions,
            projectedMonthly: Math.round(recentAdditions * (30 / 30)),
            willExceedSoon: !isOverLimit && ((current + recentAdditions) >= limit),
            growthRate: Math.round(growthRate * 100) / 100
        };

        // Calculate estimated overage cost
        const overageRate = type === "athlete" ? plan.athleteOveragePrice : plan.coachOveragePrice;
        const estimatedOverageCost = overage * (overageRate ?? 100);

        return {
            current,
            limit,
            available: Math.max(0, limit - current),
            utilizationPercentage: Math.round((current / limit) * 100),
            isOverLimit,
            canAdd: !isOverLimit || box.isOverageEnabled || !!existingGracePeriod,
            gracePeriod: existingGracePeriod,
            upgradeRequired: isOverLimit && !box.isOverageEnabled && !existingGracePeriod,
            trend,
            overage,
            estimatedOverageCost
        };
    }

    /**
     * Get recent billing activity with enhanced details
     */
    static async getRecentBillingActivity(boxId: string, limit: number = 10) {
        // Fetch data concurrently
        const [ordersResult, usageEventsList, subscriptionChangesList] = await Promise.all([
            db.query.orders.findMany({
                where: eq(orders.boxId, boxId),
                orderBy: desc(orders.createdAt),
                limit: Math.floor(limit / 3),
                with: {
                    subscription: true,
                    customerProfile: true,
                }
            }),
            db.query.usageEvents.findMany({
                where: and(
                    eq(usageEvents.boxId, boxId),
                    eq(usageEvents.billable, true)
                ),
                orderBy: desc(usageEvents.createdAt),
                limit: Math.floor(limit / 3),
            }),
            db.query.subscriptionChanges.findMany({
                where: eq(subscriptionChanges.boxId, boxId),
                orderBy: desc(subscriptionChanges.createdAt),
                limit: Math.floor(limit / 3),
                with: {
                    fromPlan: true,
                    toPlan: true
                }
            })
        ]);

        // Combine and sort all activities
        const activities = [
            ...ordersResult.map(order => ({
                type: 'order' as const,
                id: order.id,
                timestamp: order.createdAt,
                description: `${order.orderType} - ${order.status}`,
                amount: order.amount,
                data: order
            })),
            ...usageEventsList.map(event => ({
                type: 'usage' as const,
                id: event.id,
                timestamp: event.createdAt,
                description: `${event.eventType} x${event.quantity}`,
                amount: null,
                data: event
            })),
            ...subscriptionChangesList.map(change => ({
                type: 'subscription_change' as const,
                id: change.id,
                timestamp: change.createdAt,
                description: `${change.changeType}${change.fromPlan ? ` from ${change.fromPlan.name}` : ''}${change.toPlan ? ` to ${change.toPlan.name}` : ''}`,
                amount: change.proratedAmount,
                data: change
            }))
        ];

        return activities
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit);
    }

    /**
     * Calculate upcoming billing amount including overages
     */
    static async calculateUpcomingBilling(boxId: string, usage: SubscriptionUsage, subscription?: any) {
        const nextBillingDate = usage.nextBillingDate || subscription?.currentPeriodEnd;
        const daysUntilBilling = nextBillingDate
            ? Math.ceil((new Date(nextBillingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : 0;

        const baseAmount = subscription?.amount ?? 0;
        const overageAmount = usage.hasOverageEnabled ? usage.estimatedOverageAmount : 0;

        return {
            nextBillingDate,
            estimatedAmount: baseAmount + overageAmount,
            baseAmount,
            overageAmount,
            daysUntilBilling: Math.max(0, daysUntilBilling)
        };
    }

    /**
     * Get comprehensive subscription info for a box with enhanced billing data
     */
    static async getSubscriptionInfo(boxId: string): Promise<BillingDashboard> {
        const box = await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
        });

        if (!box) {
            throw new Error("Box not found");
        }

        // Get active subscription with all related data
        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            ),
            with: {
                customerProfile: true,
                plan: true,
                orders: {
                    limit: 3,
                    orderBy: desc(orders.createdAt)
                },
                changes: {
                    limit: 5,
                    orderBy: desc(subscriptionChanges.createdAt)
                }
            },
            orderBy: desc(subscriptions.createdAt),
        });

        // Get current plan (fallback to tier-based lookup if no active subscription)
        const currentPlan = activeSubscription?.plan || await db.query.subscriptionPlans.findFirst({
            where: and(
                eq(subscriptionPlans.tier, box.subscriptionTier),
                eq(subscriptionPlans.isCurrentVersion, true)
            ),
        });

        // Calculate comprehensive usage
        const usage = await this.calculateEnhancedUsage(boxId, currentPlan, box);

        // Get active grace periods
        const activeGracePeriods = await db.query.gracePeriods.findMany({
            where: and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date())
            ),
            orderBy: desc(gracePeriods.createdAt)
        });

        // Get pending plan change requests
        const pendingPlanChanges = await db.query.planChangeRequests.findMany({
            where: and(
                eq(planChangeRequests.boxId, boxId),
                eq(planChangeRequests.status, "pending")
            ),
            with: {
                fromPlan: true,
                toPlan: true
            },
            orderBy: desc(planChangeRequests.createdAt)
        });

        // Get recent billing activity
        const recentActivity = await this.getRecentBillingActivity(boxId, 10);

        // Calculate upcoming billing
        const upcomingBilling = await this.calculateUpcomingBilling(boxId, usage, activeSubscription);

        return {
            subscription: activeSubscription,
            usage,
            upcomingBilling,
            recentActivity,
            gracePeriods: activeGracePeriods,
            planChangeRequests: pendingPlanChanges
        };
    }

    /**
     * Enhanced grace period creation with better categorization
     */
    static async triggerGracePeriod(
        boxId: string,
        reason: GracePeriodReason,
        options: {
            customMessage?: string;
            severity?: "info" | "warning" | "critical" | "blocking";
            autoResolve?: boolean;
            contextSnapshot?: Record<string, any>;
        } = {}
    ) {
        // Check if there's already an active grace period for this reason
        const existingGracePeriod = await db.query.gracePeriods.findFirst({
            where: and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date()),
                eq(gracePeriods.reason, reason)
            ),
        });

        if (existingGracePeriod) {
            return { gracePeriod: existingGracePeriod, wasExisting: true };
        }

        // Create new grace period with enhanced configuration
        const gracePeriodDaysMap: Record<GracePeriodReason, number> = {
            "athlete_limit_exceeded": 14,
            "coach_limit_exceeded": 14,
            "trial_ending": 7,
            "payment_failed": 3,
            "subscription_canceled": 0,
            "billing_issue": 7,
        };

        const severityMap: Record<GracePeriodReason, "info" | "warning" | "critical" | "blocking"> = {
            "athlete_limit_exceeded": "warning",
            "coach_limit_exceeded": "warning",
            "trial_ending": "critical",
            "payment_failed": "critical",
            "subscription_canceled": "blocking",
            "billing_issue": "warning",
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
                severity: options.severity ?? severityMap[reason] ?? "warning",
                autoResolve: options.autoResolve ?? false,
                contextSnapshot: options.contextSnapshot ?? {},
            })
            .returning();

        // Track usage event for grace period creation
        await this.trackUsage(boxId, [{
            eventType: "grace_period_triggered",
            quantity: 1,
            metadata: {
                reason,
                gracePeriodId: gracePeriod?.id,
                endsAt: endsAt.toISOString(),
                severity: options.severity,
                customMessage: options.customMessage,
            },
        }]);

        return { gracePeriod, wasExisting: false };
    }

    /**
     * Enhanced usage tracking with billing context
     */
    static async trackUsage(
        boxId: string,
        events: Array<{
            eventType: UsageEventType;
            quantity?: number;
            metadata?: Record<string, any>;
            entityId?: string;
            entityType?: string;
            userId?: string;
            billable?: boolean;
        }>
    ) {
        if (events.length === 0) {
            throw new Error("No events to track");
        }

        // Get current billing period for accurate tracking
        const box = await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
        });

        const billingPeriodStart = box?.nextBillingDate ? new Date(box.nextBillingDate) : new Date();
        billingPeriodStart.setMonth(billingPeriodStart.getMonth() - 1);

        const billingPeriodEnd = box?.nextBillingDate ? new Date(box.nextBillingDate) : new Date();

        // Insert events in batch with enhanced data
        const eventsData = events.map(event => ({
            boxId,
            eventType: event.eventType,
            quantity: event.quantity || 1,
            metadata: event.metadata || {},
            entityId: event.entityId,
            entityType: event.entityType,
            userId: event.userId,
            billable: event.billable ?? false,
            billingPeriodStart,
            billingPeriodEnd,
        }));

        await db.insert(usageEvents).values(eventsData);

        // Check if any limit-related events should trigger grace periods or overage calculations
        const limitEvents = events.filter(e =>
            e.eventType === "athlete_added" || e.eventType === "coach_added"
        );

        if (limitEvents.length > 0) {
            await this.checkAndTriggerGracePeriods(boxId, limitEvents);

            // If overage is enabled, calculate potential overage billing
            if (box?.isOverageEnabled) {
                await this.calculateOverageBilling(boxId);
            }
        }

        return {
            success: true,
            eventsTracked: events.length,
            timestamp: new Date().toISOString(),
            billingPeriod: {
                start: billingPeriodStart,
                end: billingPeriodEnd
            }
        };
    }

    /**
     * Calculate overage billing for current period
     */
    static async calculateOverageBilling(boxId: string) {
        const box = await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
        });

        if (!box || !box.isOverageEnabled) {
            return { overage: 0, amount: 0 };
        }

        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            ),
            with: {
                plan: true
            }
        });

        if (!activeSubscription) {
            return { overage: 0, amount: 0 };
        }

        const usage = await this.calculateEnhancedUsage(boxId, activeSubscription.plan, box);

        // Check if we already have an overage billing record for current period
        const billingPeriodStart = new Date(activeSubscription.currentPeriodStart);
        const billingPeriodEnd = new Date(activeSubscription.currentPeriodEnd);

        const existingOverageBilling = await db.query.overageBilling.findFirst({
            where: and(
                eq(overageBilling.boxId, boxId),
                eq(overageBilling.billingPeriodStart, billingPeriodStart),
                eq(overageBilling.billingPeriodEnd, billingPeriodEnd)
            )
        });

        if (existingOverageBilling) {
            return existingOverageBilling;
        }

        // Create overage billing record if there are overages
        if (usage.athleteOverage > 0 || usage.coachOverage > 0) {
            const [overageBillingRecord] = await db
                .insert(overageBilling)
                .values({
                    boxId,
                    subscriptionId: activeSubscription.id,
                    billingPeriodStart,
                    billingPeriodEnd,
                    athleteLimit: usage.athleteLimit,
                    coachLimit: usage.coachLimit,
                    athleteCount: usage.athletes,
                    coachCount: usage.coaches,
                    athleteOverage: usage.athleteOverage,
                    coachOverage: usage.coachOverage,
                    athleteOverageRate: activeSubscription.plan?.athleteOveragePrice ?? 100,
                    coachOverageRate: activeSubscription.plan?.coachOveragePrice ?? 100,
                    athleteOverageAmount: usage.athleteOverage * (activeSubscription.plan?.athleteOveragePrice ?? 100),
                    coachOverageAmount: usage.coachOverage * (activeSubscription.plan?.coachOveragePrice ?? 100),
                    totalOverageAmount: usage.estimatedOverageAmount,
                    status: "calculated"
                })
                .returning();

            return overageBillingRecord;
        }

        return { overage: 0, amount: 0 };
    }

    /**
     * Enhanced plan change request creation
     */
    static async requestPlanChange(
        boxId: string,
        toPlanId: string,
        options: {
            requestedByUserId: string;
            effectiveDate?: Date;
            prorationType?: "immediate" | "next_billing_cycle" | "end_of_period";
            metadata?: Record<string, any>;
        }
    ) {
        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            ),
            with: {
                plan: true
            }
        });

        if (!activeSubscription) {
            throw new Error("No active subscription found");
        }

        const toPlan = await db.query.subscriptionPlans.findFirst({
            where: eq(subscriptionPlans.id, toPlanId)
        });

        if (!toPlan) {
            throw new Error("Target plan not found");
        }

        // Determine change type
        let changeType: PlanChangeType = "lateral";
        if (toPlan.monthlyPrice > activeSubscription.plan!.monthlyPrice) {
            changeType = "upgrade";
        } else if (toPlan.monthlyPrice < activeSubscription.plan!.monthlyPrice) {
            changeType = "downgrade";
        }

        // Create plan change request
        const [planChangeRequest] = await db
            .insert(planChangeRequests)
            .values({
                boxId,
                subscriptionId: activeSubscription.id,
                fromPlanId: activeSubscription.planId,
                toPlanId,
                changeType,
                requestedEffectiveDate: options.effectiveDate || new Date(),
                requestedByUserId: options.requestedByUserId,
                prorationType: options.prorationType || "immediate",
                metadata: options.metadata || {}
            })
            .returning();

        // Track the request
        await this.trackUsage(boxId, [{
            eventType: changeType === "upgrade" ? "plan_upgraded" : "plan_downgraded",
            quantity: 1,
            userId: options.requestedByUserId,
            metadata: {
                planChangeRequestId: planChangeRequest?.id,
                fromPlanId: activeSubscription.planId,
                toPlanId,
                changeType
            }
        }]);

        return planChangeRequest;
    }

    /**
     * Enable overage billing for a box
     */
    static async enableOverageBilling(boxId: string, userId: string) {
        await db.update(boxes)
            .set({
                isOverageEnabled: true,
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        // Track the change
        await this.trackUsage(boxId, [{
            eventType: "overage_billed",
            quantity: 1,
            userId,
            metadata: {
                action: "overage_enabled"
            }
        }]);

        return { success: true, overageEnabled: true };
    }

    /**
     * Enhanced grace period and limit checking
     */
    private static async checkAndTriggerGracePeriods(
        boxId: string,
        limitEvents: Array<{ eventType: string }>
    ) {
        try {
            const [box, plan] = await Promise.all([
                db.query.boxes.findFirst({
                    where: eq(boxes.id, boxId),
                }),
                db.query.subscriptionPlans.findFirst({
                    where: and(
                        eq(subscriptionPlans.tier,
                            sql`(SELECT subscription_tier FROM boxes WHERE id = ${boxId})`
                        ),
                        eq(subscriptionPlans.isCurrentVersion, true)
                    )
                })
            ]);

            if (!box || !plan) {
                console.warn(`Box or plan not found for grace period check: ${boxId}`);
                return;
            }

            // Enhanced limit checks with current usage data
            const checks = [
                {
                    type: "athlete",
                    condition: limitEvents.some(e => e.eventType === "athlete_added"),
                    getCount: async () => {
                        const [result] = await db.select({ count: count() }).from(boxMemberships)
                            .where(and(
                                eq(boxMemberships.boxId, boxId),
                                eq(boxMemberships.role, "athlete"),
                                eq(boxMemberships.isActive, true)
                            ));
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
                            .where(and(
                                eq(boxMemberships.boxId, boxId),
                                eq(boxMemberships.role, "coach"),
                                eq(boxMemberships.isActive, true)
                            ));
                        return result?.count ?? 0;
                    },
                    limit: plan.coachLimit,
                    reason: "coach_limit_exceeded" as GracePeriodReason
                }
            ];

            // Update box current counts for consistency
            const [athleteCount, coachCount] = await Promise.all([
                checks[0].getCount(),
                checks[1].getCount()
            ]);

            // Update box current usage and overage tracking
            const athleteOverage = Math.max(0, athleteCount - plan.athleteLimit);
            const coachOverage = Math.max(0, coachCount - plan.coachLimit);

            await db.update(boxes)
                .set({
                    currentAthleteCount: athleteCount,
                    currentCoachCount: coachCount,
                    currentAthleteOverage: athleteOverage,
                    currentCoachOverage: coachOverage,
                    updatedAt: new Date()
                })
                .where(eq(boxes.id, boxId));

            // Check each limit type
            for (const check of checks) {
                if (check.condition) {
                    const currentCount = await check.getCount();
                    console.log(`Checking ${check.type} limit for box ${boxId}: ${currentCount}/${check.limit}`);

                    if (currentCount > check.limit && !box.isOverageEnabled) {
                        // Only trigger grace period if overage is not enabled
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
                            await this.triggerGracePeriod(boxId, reason, {
                                contextSnapshot: {
                                    currentCount,
                                    limit: check.limit,
                                    overage: currentCount - check.limit,
                                    planTier: box.subscriptionTier,
                                    isOverageEnabled: box.isOverageEnabled
                                }
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error in checkAndTriggerGracePeriods:", error);
        }
    }

    /**
     * Get retention analytics with enhanced churn prediction
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

        // Get enhanced churn data with better categorization
        const [churnedAthletes, newAthletes, activeAthletes] = await Promise.all([
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, false),
                    gte(boxMemberships.leftAt, startDate),
                    lte(boxMemberships.leftAt, endDate)
                )),
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    gte(boxMemberships.joinedAt, startDate),
                    lte(boxMemberships.joinedAt, endDate)
                )),
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                ))
        ]);

        // Calculate enhanced retention rate
        const totalActive = activeAthletes[0].count;
        const totalChurned = churnedAthletes[0].count;
        const retentionRate = totalActive > 0
            ? ((totalActive - totalChurned) / totalActive) * 100
            : 0;

        return {
            churned: totalChurned,
            new: newAthletes[0].count,
            active: totalActive,
            retentionRate: Math.round(retentionRate * 100) / 100,
            timeframe,
            period: {
                start: startDate,
                end: endDate
            }
        };
    }

    /**
     * Enhanced subscription cancellation with better tracking
     */
    static async cancelSubscription(
        boxId: string,
        options: {
            cancelAtPeriodEnd?: boolean;
            reason?: string;
            canceledByUserId?: string;
            metadata?: Record<string, any>;
        } = {}
    ) {
        const { cancelAtPeriodEnd = true, reason, canceledByUserId, metadata } = options;

        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            ),
            with: {
                plan: true
            }
        });

        if (!activeSubscription) {
            throw new Error("No active subscription found");
        }

        // Update subscription with enhanced tracking
        const canceledAt = cancelAtPeriodEnd ? null : new Date();
        const newStatus = cancelAtPeriodEnd ? "active" : "canceled";

        await db.update(subscriptions)
            .set({
                cancelAtPeriodEnd,
                canceledAt,
                cancelReason: reason,
                canceledByUserId,
                status: newStatus,
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, activeSubscription.id));

        // Create subscription change record
        await db.insert(subscriptionChanges).values({
            subscriptionId: activeSubscription.id,
            boxId,
            changeType: "canceled",
            fromPlanId: activeSubscription.planId,
            effectiveDate: cancelAtPeriodEnd ? activeSubscription.currentPeriodEnd : new Date(),
            reason: reason || "customer_request",
            triggeredByUserId: canceledByUserId,
            metadata: metadata || {}
        });

        // Track cancellation event
        await this.trackUsage(boxId, [{
            eventType: "subscription_canceled",
            quantity: 1,
            userId: canceledByUserId,
            metadata: {
                subscriptionId: activeSubscription.id,
                planId: activeSubscription.planId,
                planName: activeSubscription.plan?.name,
                cancelAtPeriodEnd,
                reason,
                polarSubscriptionId: activeSubscription.polarSubscriptionId,
                ...metadata
            },
        }]);

        // Trigger grace period if immediate cancellation
        if (!cancelAtPeriodEnd) {
            await this.triggerGracePeriod(boxId, "subscription_canceled", {
                severity: "blocking",
                contextSnapshot: {
                    canceledAt: canceledAt?.toISOString(),
                    reason,
                    subscriptionId: activeSubscription.id,
                    accessEndsAt: activeSubscription.currentPeriodEnd
                }
            });
        }

        return {
            success: true,
            cancelAtPeriodEnd,
            accessEndsAt: cancelAtPeriodEnd
                ? activeSubscription.currentPeriodEnd
                : new Date(),
            subscription: activeSubscription
        };
    }

    /**
     * Enhanced subscription reactivation
     */
    static async reactivateSubscription(
        boxId: string,
        reactivatedByUserId?: string,
        metadata?: Record<string, any>
    ) {
        const canceledSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                or(
                    eq(subscriptions.cancelAtPeriodEnd, true),
                    eq(subscriptions.status, "canceled")
                )
            ),
            with: {
                plan: true
            }
        });

        if (!canceledSubscription) {
            throw new Error("No subscription found to reactivate");
        }

        // Update subscription to remove cancellation
        await db.update(subscriptions)
            .set({
                cancelAtPeriodEnd: false,
                canceledAt: null,
                status: "active",
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, canceledSubscription.id));

        // Create subscription change record
        await db.insert(subscriptionChanges).values({
            subscriptionId: canceledSubscription.id,
            boxId,
            changeType: "reactivated",
            toPlanId: canceledSubscription.planId,
            effectiveDate: new Date(),
            reason: "customer_request",
            triggeredByUserId: reactivatedByUserId,
            metadata: metadata || {}
        });

        // Track reactivation event
        await this.trackUsage(boxId, [{
            eventType: "subscription_reactivated",
            quantity: 1,
            userId: reactivatedByUserId,
            metadata: {
                subscriptionId: canceledSubscription.id,
                planId: canceledSubscription.planId,
                planName: canceledSubscription.plan?.name,
                polarSubscriptionId: canceledSubscription.polarSubscriptionId,
                ...metadata
            },
        }]);

        // Resolve any active grace periods related to cancellation
        const gracePeriodsToResolve = await db
            .select()
            .from(gracePeriods)
            .where(and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date()),
                or(
                    eq(gracePeriods.reason, "subscription_canceled"),
                    eq(gracePeriods.reason, "billing_issue")
                )
            ));

        for (const gp of gracePeriodsToResolve) {
            await db.update(gracePeriods)
                .set({
                    resolved: true,
                    resolvedAt: new Date(),
                    resolution: "subscription_reactivated",
                    autoResolved: false
                })
                .where(eq(gracePeriods.id, gp.id));
        }

        return {
            success: true,
            subscription: canceledSubscription,
            gracePeriodsResolved: gracePeriodsToResolve.length
        };
    }

    /**
     * Process billing events (for webhook handling)
     */
    static async processBillingEvent(
        boxId: string,
        eventType: string,
        polarEventId: string,
        eventData: Record<string, any>
    ) {
        // Create billing event record
        const [billingEvent] = await db
            .insert(billingEvents)
            .values({
                boxId,
                eventType,
                polarEventId,
                data: eventData,
                status: "pending"
            })
            .returning();

        try {
            // Update status to processing
            await db.update(billingEvents)
                .set({
                    status: "processing",
                    lastAttemptAt: new Date()
                })
                .where(eq(billingEvents.id, billingEvent.id));

            // Process based on event type
            switch (eventType) {
                case "subscription.created":
                    await this.handleSubscriptionCreated(boxId, eventData);
                    break;
                case "subscription.updated":
                    await this.handleSubscriptionUpdated(boxId, eventData);
                    break;
                case "subscription.canceled":
                    await this.handleSubscriptionCanceled(boxId, eventData);
                    break;
                case "invoice.paid":
                    await this.handleInvoicePaid(boxId, eventData);
                    break;
                case "invoice.payment_failed":
                    await this.handlePaymentFailed(boxId, eventData);
                    break;
                default:
                    console.warn(`Unknown billing event type: ${eventType}`);
            }

            // Mark as processed
            await db.update(billingEvents)
                .set({
                    status: "processed",
                    processedAt: new Date(),
                    processed: true
                })
                .where(eq(billingEvents.id, billingEvent.id));

        } catch (error) {
            console.error(`Error processing billing event ${billingEvent.id}:`, error);

            // Update retry count and set next retry
            const nextRetryAt = new Date();
            nextRetryAt.setMinutes(nextRetryAt.getMinutes() + Math.pow(2, billingEvent.retryCount) * 5);

            await db.update(billingEvents)
                .set({
                    status: "failed",
                    processingError: error instanceof Error ? error.message : String(error),
                    processingStackTrace: error instanceof Error ? error.stack : null,
                    retryCount: billingEvent.retryCount + 1,
                    nextRetryAt: billingEvent.retryCount < billingEvent.maxRetries ? nextRetryAt : null
                })
                .where(eq(billingEvents.id, billingEvent.id));
        }

        return billingEvent;
    }

    /**
     * Handle subscription created event
     */
    private static async handleSubscriptionCreated(boxId: string, eventData: any) {
        // Update box subscription status
        await db.update(boxes)
            .set({
                subscriptionStatus: "active",
                polarSubscriptionId: eventData.id,
                subscriptionStartsAt: new Date(eventData.current_period_start),
                subscriptionEndsAt: new Date(eventData.current_period_end),
                nextBillingDate: new Date(eventData.current_period_end),
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        // Track usage event
        await this.trackUsage(boxId, [{
            eventType: "subscription_created",
            metadata: {
                polarSubscriptionId: eventData.id,
                planId: eventData.plan?.id,
                amount: eventData.amount,
                currency: eventData.currency
            }
        }]);
    }

    /**
     * Handle subscription updated event
     */
    private static async handleSubscriptionUpdated(boxId: string, eventData: any) {
        const subscription = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.polarSubscriptionId, eventData.id)
        });

        if (subscription) {
            await db.update(subscriptions)
                .set({
                    status: eventData.status,
                    currentPeriodStart: new Date(eventData.current_period_start),
                    currentPeriodEnd: new Date(eventData.current_period_end),
                    nextBillingDate: new Date(eventData.current_period_end),
                    amount: eventData.amount,
                    lastSyncedAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(subscriptions.id, subscription.id));
        }

        // Update box billing date
        await db.update(boxes)
            .set({
                nextBillingDate: new Date(eventData.current_period_end),
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));
    }

    /**
     * Handle subscription canceled event
     */
    private static async handleSubscriptionCanceled(boxId: string, eventData: any) {
        const subscription = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.polarSubscriptionId, eventData.id)
        });

        if (subscription) {
            await db.update(subscriptions)
                .set({
                    status: "canceled",
                    canceledAt: new Date(),
                    cancelReason: "polar_cancellation",
                    updatedAt: new Date()
                })
                .where(eq(subscriptions.id, subscription.id));
        }

        // Update box status
        await db.update(boxes)
            .set({
                subscriptionStatus: "canceled",
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        // Trigger grace period
        await this.triggerGracePeriod(boxId, "subscription_canceled", {
            severity: "blocking",
            contextSnapshot: { polarEvent: eventData }
        });
    }

    /**
     * Handle invoice paid event
     */
    private static async handleInvoicePaid(boxId: string, eventData: any) {
        // Create order record
        await db.insert(orders).values({
            boxId,
            polarOrderId: eventData.id,
            polarProductId: eventData.product?.id || "unknown",
            orderType: "subscription",
            description: `Payment for ${eventData.product?.name || "subscription"}`,
            status: "paid",
            amount: eventData.amount,
            currency: eventData.currency,
            paidAt: new Date(eventData.paid_at || eventData.created_at)
        });

        // Track payment event
        await this.trackUsage(boxId, [{
            eventType: "payment_received",
            metadata: {
                orderId: eventData.id,
                amount: eventData.amount,
                currency: eventData.currency
            }
        }]);
    }

    /**
     * Handle payment failed event
     */
    private static async handlePaymentFailed(boxId: string, eventData: any) {
        // Update subscription status if applicable
        const subscription = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.boxId, boxId),
            orderBy: desc(subscriptions.createdAt)
        });

        if (subscription) {
            await db.update(subscriptions)
                .set({
                    status: "past_due",
                    updatedAt: new Date()
                })
                .where(eq(subscriptions.id, subscription.id));
        }

        // Update box status
        await db.update(boxes)
            .set({
                subscriptionStatus: "past_due",
                status: "payment_failed",
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        // Trigger grace period for payment failure
        await this.triggerGracePeriod(boxId, "payment_failed", {
            severity: "critical",
            contextSnapshot: { polarEvent: eventData }
        });

        // Track failed payment event
        await this.trackUsage(boxId, [{
            eventType: "payment_failed",
            metadata: {
                failureReason: eventData.failure_reason,
                amount: eventData.amount,
                currency: eventData.currency
            }
        }]);
    }

    /**
     * Get overage billing summary for a specific period
     */
    static async getOverageBillingSummary(
        boxId: string,
        billingPeriodStart: Date,
        billingPeriodEnd: Date
    ) {
        const overageBillingRecord = await db.query.overageBilling.findFirst({
            where: and(
                eq(overageBilling.boxId, boxId),
                eq(overageBilling.billingPeriodStart, billingPeriodStart),
                eq(overageBilling.billingPeriodEnd, billingPeriodEnd)
            )
        });

        if (!overageBillingRecord) {
            return await this.calculateOverageBilling(boxId);
        }

        return {
            ...overageBillingRecord,
            formattedAmounts: {
                athleteOverage: `${(overageBillingRecord.athleteOverageAmount / 100).toFixed(2)}`,
                coachOverage: `${(overageBillingRecord.coachOverageAmount / 100).toFixed(2)}`,
                total: `${(overageBillingRecord.totalOverageAmount / 100).toFixed(2)}`
            }
        };
    }

    /**
     * Get upcoming grace period expirations
     */
    static async getUpcomingGracePeriodExpirations(daysAhead: number = 7) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysAhead);

        return await db.query.gracePeriods.findMany({
            where: and(
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date()),
                lte(gracePeriods.endsAt, futureDate)
            ),
            with: {
                box: {
                    columns: {
                        id: true,
                        name: true,
                        email: true,
                        subscriptionTier: true,
                        subscriptionStatus: true
                    }
                }
            },
            orderBy: asc(gracePeriods.endsAt)
        });
    }

    /**
     * Resolve grace period with tracking
     */
    static async resolveGracePeriod(
        gracePeriodId: string,
        resolution: string,
        resolvedByUserId?: string,
        autoResolved: boolean = false
    ) {
        const gracePeriod = await db.query.gracePeriods.findFirst({
            where: eq(gracePeriods.id, gracePeriodId)
        });

        if (!gracePeriod) {
            throw new Error("Grace period not found");
        }

        await db.update(gracePeriods)
            .set({
                resolved: true,
                resolvedAt: new Date(),
                resolution,
                resolvedByUserId,
                autoResolved,
                updatedAt: new Date()
            })
            .where(eq(gracePeriods.id, gracePeriodId));

        // Track resolution event
        await this.trackUsage(gracePeriod.boxId, [{
            eventType: "grace_period_resolved",
            userId: resolvedByUserId,
            metadata: {
                gracePeriodId,
                reason: gracePeriod.reason,
                resolution,
                autoResolved,
                duration: new Date().getTime() - new Date(gracePeriod.createdAt).getTime()
            }
        }]);

        return { success: true, gracePeriod };
    }
}
