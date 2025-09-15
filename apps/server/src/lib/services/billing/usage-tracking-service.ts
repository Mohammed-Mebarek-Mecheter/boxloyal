// lib/services/billing/usage-tracking-service.ts
import { db } from "@/db";
import {
    boxes,
    boxMemberships,
    subscriptionPlans,
    subscriptions,
    usageEvents,
    gracePeriods
} from "@/db/schema";
import { eq, and, gte, lte, count, desc } from "drizzle-orm";
import type { UsageEventType, SubscriptionUsage, GracePeriodReason } from "./types";
// Import the BillingNotificationService
import {BillingNotificationService} from "@/lib/services/notifications/billing";

export class UsageTrackingService {
    // Instantiate the BillingNotificationService
    private static billingNotificationService = new BillingNotificationService();

    /**
     * Calculate current usage for a box
     */
    static async calculateUsage(
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

        // Get plan data if not provided
        if (!plan && box?.subscriptionTier) {
            plan = await db.query.subscriptionPlans.findFirst({
                where: and(
                    eq(subscriptionPlans.tier, box.subscriptionTier),
                    eq(subscriptionPlans.isCurrentVersion, true)
                ),
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

        // Get overage rates
        const athleteOverageRate = plan?.athleteOveragePrice ?? 100;
        const coachOverageRate = plan?.coachOveragePrice ?? 100;
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
     * Track usage events
     */
    static async trackEvents(
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

        // Get billing period dates
        const box = await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
        });

        const billingPeriodStart = box?.nextBillingDate ? new Date(box.nextBillingDate) : new Date();
        billingPeriodStart.setMonth(billingPeriodStart.getMonth() - 1);

        const billingPeriodEnd = box?.nextBillingDate ? new Date(box.nextBillingDate) : new Date();

        // Insert events
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
     * Update box current usage counts
     */
    static async updateBoxUsageCounts(boxId: string) {
        const usage = await this.calculateUsage(boxId);

        await db.update(boxes)
            .set({
                currentAthleteCount: usage.athletes,
                currentCoachCount: usage.coaches,
                currentAthleteOverage: usage.athleteOverage,
                currentCoachOverage: usage.coachOverage,
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        return usage;
    }

    /**
     * Check if limits are exceeded and trigger appropriate actions
     */
    static async checkLimitsAndTriggerActions(
        boxId: string,
        eventTypes: Array<{ eventType: string }>
    ) {
        const box = await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
        });

        if (!box) return;

        const plan = await db.query.subscriptionPlans.findFirst({
            where: and(
                eq(subscriptionPlans.tier, box.subscriptionTier),
                eq(subscriptionPlans.isCurrentVersion, true)
            )
        });

        if (!plan) return;

        // Update usage counts
        const usage = await this.updateBoxUsageCounts(boxId);

        let limitApproachingNotificationSent = false;
        let limitExceededNotificationSent = false;

        // Check if we need to trigger grace periods (only if overage is not enabled)
        if (!box.isOverageEnabled) {
            const checks = [
                {
                    condition: eventTypes.some(e => e.eventType === "athlete_added"),
                    isOverLimit: usage.isAthleteOverLimit,
                    isApproachingLimit: usage.athletesPercentage >= 90,
                    reason: "athlete_limit_exceeded" as GracePeriodReason,
                    limitType: "athlete" as const,
                    currentCount: usage.athletes,
                    limit: usage.athleteLimit,
                    percentage: usage.athletesPercentage
                },
                {
                    condition: eventTypes.some(e => e.eventType === "coach_added"),
                    isOverLimit: usage.isCoachOverLimit,
                    isApproachingLimit: usage.coachesPercentage >= 90,
                    reason: "coach_limit_exceeded" as GracePeriodReason,
                    limitType: "coach" as const,
                    currentCount: usage.coaches,
                    limit: usage.coachLimit,
                    percentage: usage.coachesPercentage
                }
            ];

            for (const check of checks) {
                if (check.condition) {
                    if (check.isOverLimit) {
                        // Import GracePeriodService to avoid circular dependency issues at module level
                        // It's imported dynamically here within the method to prevent circular dependency issues
                        const { GracePeriodService } = await import("./grace-period-service");
                        await GracePeriodService.createGracePeriod(boxId, check.reason, {
                            contextSnapshot: {
                                usage,
                                planTier: box.subscriptionTier,
                                isOverageEnabled: box.isOverageEnabled
                            }
                        });

                        // --- INTEGRATION: Send Limit Exceeded Notification ---
                        if (!limitExceededNotificationSent) { // Avoid sending multiple similar notifications
                            try {
                                await this.billingNotificationService.sendLimitExceededNotification(
                                    boxId,
                                    check.limitType,
                                    check.currentCount,
                                    check.limit
                                );
                                console.log(`Limit exceeded notification sent for box ${boxId} (${check.limitType})`);
                                limitExceededNotificationSent = true; // Set flag to prevent duplicates
                            } catch (error) {
                                console.error(`Failed to send limit exceeded notification for box ${boxId} (${check.limitType}):`, error);
                            }
                        }
                        // --- END INTEGRATION ---
                    } else if (check.isApproachingLimit) {
                        // --- INTEGRATION: Send Limit Approaching Notification ---
                        if (!limitApproachingNotificationSent) { // Avoid sending multiple similar notifications
                            try {
                                await this.billingNotificationService.sendLimitApproachingNotification(
                                    boxId,
                                    check.limitType,
                                    check.currentCount,
                                    check.limit,
                                    check.percentage
                                );
                                console.log(`Limit approaching notification sent for box ${boxId} (${check.limitType})`);
                                limitApproachingNotificationSent = true; // Set flag to prevent duplicates
                            } catch (error) {
                                console.error(`Failed to send limit approaching notification for box ${boxId} (${check.limitType}):`, error);
                            }
                        }
                        // --- END INTEGRATION ---
                    }
                }
            }
        }

        return usage;
    }

    /**
     * Get usage trends for a specific period
     */
    static async getUsageTrends(
        boxId: string,
        memberType: "athlete" | "coach",
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [recentAdditions, currentCount] = await Promise.all([
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, memberType),
                    eq(boxMemberships.isActive, true),
                    gte(boxMemberships.createdAt, startDate)
                )),
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, memberType),
                    eq(boxMemberships.isActive, true)
                ))
        ]);

        const recentCount = recentAdditions[0]?.count ?? 0;
        const totalCount = currentCount[0]?.count ?? 0;
        const previousCount = totalCount - recentCount;

        const growthRate = previousCount > 0 ? (recentCount / previousCount) * 100 : 0;
        const projectedMonthly = Math.round(recentCount * (30 / days));

        return {
            recentAdditions: recentCount,
            currentCount: totalCount,
            previousCount,
            growthRate: Math.round(growthRate * 100) / 100,
            projectedMonthly,
            period: { days, startDate, endDate: new Date() }
        };
    }
}
