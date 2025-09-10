// lib/services/usage-tracking-service.ts
import { db } from "@/db";
import { usageEvents, boxes, boxMemberships } from "@/db/schema";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";
import { PolarService } from "./polar-service";
import { NotificationService } from "./notification-service";
import type { UsageEventType } from "./billing-service";

export interface UsageTrackingEvent {
    eventType: UsageEventType;
    boxId: string;
    entityId?: string;
    entityType?: string;
    userId?: string;
    quantity?: number;
    metadata?: Record<string, any>;
    billable?: boolean;
    shouldSyncToPolar?: boolean;
}

export interface UsageThreshold {
    type: "athlete" | "coach";
    warningPercentage: number; // e.g., 80 for 80%
    criticalPercentage: number; // e.g., 95 for 95%
}

export interface UsageAnalytics {
    period: {
        start: Date;
        end: Date;
    };
    events: {
        total: number;
        billable: number;
        byType: Record<UsageEventType, number>;
    };
    trends: {
        athleteGrowth: number;
        coachGrowth: number;
        activityLevel: "low" | "moderate" | "high" | "very_high";
    };
    predictions: {
        willExceedAthleteLimit: boolean;
        willExceedCoachLimit: boolean;
        estimatedDaysToLimit: number;
        recommendedAction?: string;
    };
}

/**
 * Service for tracking usage events and syncing with Polar
 * Handles athlete/coach additions, workout completions, and other billable events
 */
export class UsageTrackingService {
    private static readonly DEFAULT_THRESHOLDS: UsageThreshold[] = [
        { type: "athlete", warningPercentage: 80, criticalPercentage: 95 },
        { type: "coach", warningPercentage: 90, criticalPercentage: 98 }
    ];

    /**
     * Track a single usage event
     */
    static async trackEvent(event: UsageTrackingEvent): Promise<{ success: boolean; eventId?: string; error?: string }> {
        try {
            console.log(`Tracking usage event: ${event.eventType} for box ${event.boxId}`);

            // Get current billing period
            const box = await db.query.boxes.findFirst({
                where: eq(boxes.id, event.boxId)
            });

            if (!box) {
                throw new Error(`Box not found: ${event.boxId}`);
            }

            const billingPeriodStart = box.nextBillingDate ? new Date(box.nextBillingDate) : new Date();
            billingPeriodStart.setMonth(billingPeriodStart.getMonth() - 1);
            const billingPeriodEnd = box.nextBillingDate ? new Date(box.nextBillingDate) : new Date();

            // Insert usage event
            const [usageEvent] = await db.insert(usageEvents).values({
                boxId: event.boxId,
                eventType: event.eventType,
                quantity: event.quantity || 1,
                entityId: event.entityId,
                entityType: event.entityType,
                userId: event.userId,
                metadata: event.metadata || {},
                billable: event.billable ?? false,
                billingPeriodStart,
                billingPeriodEnd,
            }).returning();

            // Sync to Polar if requested and billable
            if (event.shouldSyncToPolar && event.billable && box.polarCustomerId) {
                await this.syncEventToPolar(usageEvent, box);
            }

            // Check for threshold violations on limit-related events
            if (this.isLimitRelatedEvent(event.eventType)) {
                await this.checkThresholds(event.boxId, event.eventType);
            }

            console.log(`Successfully tracked usage event: ${usageEvent.id}`);
            return { success: true, eventId: usageEvent.id };

        } catch (error) {
            console.error(`Failed to track usage event:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Track multiple usage events in batch
     */
    static async trackEvents(events: UsageTrackingEvent[]): Promise<{
        success: number;
        failed: number;
        results: Array<{ success: boolean; eventId?: string; error?: string }>;
    }> {
        const results = [];
        let success = 0;
        let failed = 0;

        for (const event of events) {
            const result = await this.trackEvent(event);
            results.push(result);

            if (result.success) {
                success++;
            } else {
                failed++;
            }
        }

        return { success, failed, results };
    }

    /**
     * Track athlete addition with automatic threshold checking
     */
    static async trackAthleteAdded(
        boxId: string,
        athleteId: string,
        userId?: string,
        metadata?: Record<string, any>
    ): Promise<void> {
        await this.trackEvent({
            eventType: "athlete_added",
            boxId,
            entityId: athleteId,
            entityType: "athlete",
            userId,
            quantity: 1,
            metadata: {
                ...metadata,
                timestamp: new Date().toISOString()
            },
            billable: true,
            shouldSyncToPolar: true
        });
    }

    /**
     * Track coach addition with automatic threshold checking
     */
    static async trackCoachAdded(
        boxId: string,
        coachId: string,
        userId?: string,
        metadata?: Record<string, any>
    ): Promise<void> {
        await this.trackEvent({
            eventType: "coach_added",
            boxId,
            entityId: coachId,
            entityType: "coach",
            userId,
            quantity: 1,
            metadata: {
                ...metadata,
                timestamp: new Date().toISOString()
            },
            billable: true,
            shouldSyncToPolar: true
        });
    }

    /**
     * Track workout completion (for engagement metrics)
     */
    static async trackWorkoutCompleted(
        boxId: string,
        athleteId: string,
        workoutId: string,
        metadata?: Record<string, any>
    ): Promise<void> {
        await this.trackEvent({
            eventType: "wod_completed",
            boxId,
            entityId: workoutId,
            entityType: "workout",
            userId: athleteId,
            quantity: 1,
            metadata: {
                ...metadata,
                athleteId,
                completedAt: new Date().toISOString()
            },
            billable: false,
            shouldSyncToPolar: false
        });
    }

    /**
     * Track PR logged (for engagement metrics)
     */
    static async trackPRLogged(
        boxId: string,
        athleteId: string,
        prData: Record<string, any>
    ): Promise<void> {
        await this.trackEvent({
            eventType: "pr_logged",
            boxId,
            entityId: prData.id,
            entityType: "pr",
            userId: athleteId,
            quantity: 1,
            metadata: {
                ...prData,
                athleteId,
                loggedAt: new Date().toISOString()
            },
            billable: false,
            shouldSyncToPolar: false
        });
    }

    /**
     * Check usage thresholds and send notifications
     */
    private static async checkThresholds(boxId: string, eventType: UsageEventType): Promise<void> {
        try {
            const box = await db.query.boxes.findFirst({
                where: eq(boxes.id, boxId)
            });

            if (!box) return;

            // Determine which type to check based on event
            const checkType = eventType === "athlete_added" ? "athlete" : "coach";
            const threshold = this.DEFAULT_THRESHOLDS.find(t => t.type === checkType);

            if (!threshold) return;

            // Get current count
            const [countResult] = await db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, checkType),
                    eq(boxMemberships.isActive, true)
                ));

            const currentCount = countResult?.count || 0;
            const limit = checkType === "athlete" ? box.athleteLimit : box.coachLimit;
            const percentage = (currentCount / limit) * 100;

            // Check thresholds
            if (percentage >= threshold.criticalPercentage) {
                await NotificationService.sendUsageLimitWarning(
                    boxId,
                    box.name,
                    box.email,
                    checkType,
                    currentCount,
                    limit
                );

                console.log(`Critical threshold reached for ${checkType}s in box ${boxId}: ${percentage}%`);
            } else if (percentage >= threshold.warningPercentage) {
                await NotificationService.sendUsageLimitWarning(
                    boxId,
                    box.name,
                    box.email,
                    checkType,
                    currentCount,
                    limit
                );

                console.log(`Warning threshold reached for ${checkType}s in box ${boxId}: ${percentage}%`);
            }

        } catch (error) {
            console.error(`Failed to check thresholds for box ${boxId}:`, error);
        }
    }

    /**
     * Sync usage event to Polar for metering
     */
    private static async syncEventToPolar(usageEvent: any, box: any): Promise<void> {
        try {
            const eventName = `boxloyal.${usageEvent.eventType}`;

            await PolarService.ingestUsageEvent({
                externalCustomerId: box.polarCustomerId,
                name: eventName,
                organizationId: box.id, // Use box ID as organization reference
                metadata: {
                    ...usageEvent.metadata,
                    boxId: usageEvent.boxId,
                    eventId: usageEvent.id,
                    quantity: usageEvent.quantity
                },
                timestamp: new Date(usageEvent.createdAt)
            });

            // Update usage event to mark as synced
            await db.update(usageEvents)
                .set({
                    sentToPolarAt: new Date(),
                    processed: true
                })
                .where(eq(usageEvents.id, usageEvent.id));

            console.log(`Synced usage event ${usageEvent.id} to Polar`);

        } catch (error) {
            console.error(`Failed to sync usage event ${usageEvent.id} to Polar:`, error);

            // Update with error info
            await db.update(usageEvents)
                .set({
                    polarError: error instanceof Error ? error.message : String(error)
                })
                .where(eq(usageEvents.id, usageEvent.id));
        }
    }

    /**
     * Get usage analytics for a box
     */
    static async getUsageAnalytics(
        boxId: string,
        startDate: Date,
        endDate: Date
    ): Promise<UsageAnalytics> {
        try {
            // Get all events in period
            const events = await db.query.usageEvents.findMany({
                where: and(
                    eq(usageEvents.boxId, boxId),
                    gte(usageEvents.createdAt, startDate),
                    lte(usageEvents.createdAt, endDate)
                ),
                orderBy: desc(usageEvents.createdAt)
            });

            // Count events by type
            const eventsByType: Record<string, number> = {};
            let totalEvents = 0;
            let billableEvents = 0;

            events.forEach(event => {
                eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + event.quantity;
                totalEvents += event.quantity;
                if (event.billable) billableEvents += event.quantity;
            });

            // Calculate growth trends
            const athleteAdditions = eventsByType["athlete_added"] || 0;
            const coachAdditions = eventsByType["coach_added"] || 0;
            const workoutCompletions = eventsByType["wod_completed"] || 0;
            const prLogs = eventsByType["pr_logged"] || 0;

            // Determine activity level
            const daysInPeriod = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
            const dailyActivity = totalEvents / daysInPeriod;

            let activityLevel: "low" | "moderate" | "high" | "very_high";
            if (dailyActivity < 5) activityLevel = "low";
            else if (dailyActivity < 15) activityLevel = "moderate";
            else if (dailyActivity < 30) activityLevel = "high";
            else activityLevel = "very_high";

            // Get current box state for predictions
            const box = await db.query.boxes.findFirst({
                where: eq(boxes.id, boxId)
            });

            const predictions = await this.generateUsagePredictions(boxId, box, athleteAdditions, coachAdditions);

            return {
                period: { start: startDate, end: endDate },
                events: {
                    total: totalEvents,
                    billable: billableEvents,
                    byType: eventsByType as Record<UsageEventType, number>
                },
                trends: {
                    athleteGrowth: athleteAdditions,
                    coachGrowth: coachAdditions,
                    activityLevel
                },
                predictions
            };

        } catch (error) {
            console.error(`Failed to get usage analytics for box ${boxId}:`, error);

            // Return empty analytics on error
            return {
                period: { start: startDate, end: endDate },
                events: { total: 0, billable: 0, byType: {} },
                trends: { athleteGrowth: 0, coachGrowth: 0, activityLevel: "low" },
                predictions: {
                    willExceedAthleteLimit: false,
                    willExceedCoachLimit: false,
                    estimatedDaysToLimit: 365
                }
            };
        }
    }

    /**
     * Generate predictions about usage limits
     */
    private static async generateUsagePredictions(
        boxId: string,
        box: any,
        recentAthleteAdditions: number,
        recentCoachAdditions: number
    ): Promise<UsageAnalytics["predictions"]> {
        try {
            // Get current counts
            const [athleteCountResult, coachCountResult] = await Promise.all([
                db.select({ count: count() }).from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, boxId),
                        eq(boxMemberships.role, "athlete"),
                        eq(boxMemberships.isActive, true)
                    )),
                db.select({ count: count() }).from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, boxId),
                        eq(boxMemberships.role, "coach"),
                        eq(boxMemberships.isActive, true)
                    ))
            ]);

            const currentAthletes = athleteCountResult[0]?.count || 0;
            const currentCoaches = coachCountResult[0]?.count || 0;

            const athleteLimit = box?.athleteLimit || 75;
            const coachLimit = box?.coachLimit || 3;

            // Simple linear prediction based on recent additions
            // This could be enhanced with more sophisticated forecasting
            const monthlyAthleteGrowth = recentAthleteAdditions * 2; // Assume recent period is 2 weeks, project to month
            const monthlyCoachGrowth = recentCoachAdditions * 2;

            const athletesUntilLimit = Math.max(0, athleteLimit - currentAthletes);
            const coachesUntilLimit = Math.max(0, coachLimit - currentCoaches);

            // Estimate days to reach limit
            const daysToAthleteLimit = monthlyAthleteGrowth > 0
                ? Math.ceil((athletesUntilLimit / monthlyAthleteGrowth) * 30)
                : 365;
            const daysToCoachLimit = monthlyCoachGrowth > 0
                ? Math.ceil((coachesUntilLimit / monthlyCoachGrowth) * 30)
                : 365;

            const estimatedDaysToLimit = Math.min(daysToAthleteLimit, daysToCoachLimit);

            // Determine recommended action
            let recommendedAction: string | undefined;
            if (estimatedDaysToLimit <= 30) {
                recommendedAction = "Consider upgrading your plan or enabling overage billing";
            } else if (estimatedDaysToLimit <= 90) {
                recommendedAction = "Monitor usage closely and plan for potential upgrade";
            }

            return {
                willExceedAthleteLimit: daysToAthleteLimit <= 90,
                willExceedCoachLimit: daysToCoachLimit <= 90,
                estimatedDaysToLimit,
                recommendedAction
            };

        } catch (error) {
            console.error("Failed to generate usage predictions:", error);
            return {
                willExceedAthleteLimit: false,
                willExceedCoachLimit: false,
                estimatedDaysToLimit: 365
            };
        }
    }

    /**
     * Retry failed Polar syncs
     */
    static async retryFailedPolarSyncs(limit: number = 50): Promise<{
        processed: number;
        succeeded: number;
        failed: number;
    }> {
        try {
            const failedEvents = await db.query.usageEvents.findMany({
                where: and(
                    eq(usageEvents.billable, true),
                    eq(usageEvents.processed, false),
                    eq(usageEvents.sentToPolarAt, null)
                ),
                limit,
                orderBy: desc(usageEvents.createdAt)
            });

            let succeeded = 0;
            let failed = 0;

            for (const event of failedEvents) {
                try {
                    const box = await db.query.boxes.findFirst({
                        where: eq(boxes.id, event.boxId)
                    });

                    if (box && box.polarCustomerId) {
                        await this.syncEventToPolar(event, box);
                        succeeded++;
                    } else {
                        failed++;
                    }
                } catch (error) {
                    console.log(`Polar sync retry completed: ${succeeded} succeeded, ${failed} failed out of ${failedEvents.length} processed`);

                    return {
                        processed: failedEvents.length,
                        succeeded,
                        failed
                    };

                } catch (error) {
                    console.error("Failed to retry Polar syncs:", error);
                    return { processed: 0, succeeded: 0, failed: 0 };
                }
            }

            /**
             * Get usage summary for a specific billing period
             */
        static async getBillingPeriodUsage(
                boxId: string,
                billingPeriodStart: Date,
                billingPeriodEnd: Date
        ): Promise<{
                athleteAdditions: number;
                coachAdditions: number;
                workoutCompletions: number;
                totalBillableEvents: number;
                eventBreakdown: Record<string, number>;
            }> {
                try {
                    const events = await db.query.usageEvents.findMany({
                        where: and(
                            eq(usageEvents.boxId, boxId),
                            gte(usageEvents.billingPeriodStart, billingPeriodStart),
                            lte(usageEvents.billingPeriodEnd, billingPeriodEnd)
                        )
                    });

                    const eventBreakdown: Record<string, number> = {};
            let totalBillableEvents = 0;

            events.forEach(event => {
                eventBreakdown[event.eventType] = (eventBreakdown[event.eventType] || 0) + event.quantity;
                if (event.billable) {
                    totalBillableEvents += event.quantity;
                }
            });

            return {
                athleteAdditions: eventBreakdown["athlete_added"] || 0,
                coachAdditions: eventBreakdown["coach_added"] || 0,
                workoutCompletions: eventBreakdown["wod_completed"] || 0,
                totalBillableEvents,
                eventBreakdown
            };

        } catch (error) {
                console.error(`Failed to get billing period usage for box ${boxId}:`, error);
                return {
                    athleteAdditions: 0,
                    coachAdditions: 0,
                    workoutCompletions: 0,
                    totalBillableEvents: 0,
                    eventBreakdown: {}
                };
            }
        }

            /**
             * Clean up old usage events (for maintenance)
             */
        static async cleanupOldEvents(
                retentionDays: number = 365,
                batchSize: number = 1000
        ): Promise<{ deletedCount: number }> {
                try {
                    const cutoffDate = new Date();
                    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

                    // Delete in batches to avoid timeout
                    let totalDeleted = 0;
                    let batchDeleted = 0;

                    do {
                        const result = await db.delete(usageEvents)
                            .where(and(
                                lte(usageEvents.createdAt, cutoffDate),
                                eq(usageEvents.processed, true)
                            ));
                        // Note: This is a simplified batch delete
                        // In practice, you might need a different approach for batch operations

                        batchDeleted = 0; // This would be the actual count from the delete operation
                        totalDeleted += batchDeleted;

                        // Small delay between batches
                        if (batchDeleted > 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } while (batchDeleted === batchSize);

            console.log(`Cleaned up ${totalDeleted} old usage events older than ${retentionDays} days`);
            return { deletedCount: totalDeleted };

        } catch (error) {
                console.error("Failed to clean up old usage events:", error);
                return { deletedCount: 0 };
            }
        }

            /**
             * Check if an event type is related to usage limits
             */
        private static isLimitRelatedEvent(eventType: UsageEventType): boolean {
                return ["athlete_added", "coach_added"].includes(eventType);
            }

            /**
             * Get top performing athletes by activity
             */
        static async getTopPerformers(
                boxId: string,
                period: { start: Date; end: Date },
            limit: number = 10
        ): Promise<Array<{
                athleteId: string;
                workouts: number;
                prs: number;
                checkins: number;
                totalActivity: number;
            }>> {
                try {
                    const events = await db.query.usageEvents.findMany({
                        where: and(
                            eq(usageEvents.boxId, boxId),
                            gte(usageEvents.createdAt, period.start),
                            lte(usageEvents.createdAt, period.end),
                            eq(usageEvents.entityType, "athlete")
                        )
                    });

                    const performerStats: Record<string, {
                workouts: number;
                prs: number;
                checkins: number;
                totalActivity: number;
            }> = {};

            events.forEach(event => {
                if (!event.userId) return;

                if (!performerStats[event.userId]) {
                    performerStats[event.userId] = {
                        workouts: 0,
                        prs: 0,
                        checkins: 0,
                        totalActivity: 0
                    };
                }

                const stats = performerStats[event.userId];

                switch (event.eventType) {
                    case "wod_completed":
                        stats.workouts += event.quantity;
                        stats.totalActivity += event.quantity;
                        break;
                    case "pr_logged":
                        stats.prs += event.quantity;
                        stats.totalActivity += event.quantity;
                        break;
                    case "checkin_logged":
                        stats.checkins += event.quantity;
                        stats.totalActivity += event.quantity;
                        break;
                }
            });

            // Sort by total activity and return top performers
            return Object.entries(performerStats)
                .map(([athleteId, stats]) => ({
                    athleteId,
                    ...stats
                }))
                .sort((a, b) => b.totalActivity - a.totalActivity)
                .slice(0, limit);

        } catch (error) {
                console.error(`Failed to get top performers for box ${boxId}:`, error);
                return [];
            }
        }

            /**
             * Generate usage report for box owners
             */
        static async generateUsageReport(
                boxId: string,
                period: { start: Date; end: Date }
        ): Promise<{
                summary: {
                    totalEvents: number;
                    athleteActivity: number;
                    coachActivity: number;
                    engagementScore: number;
                };
                growth: {
                    newAthletes: number;
                    newCoaches: number;
                    retainedAthletes: number;
                };
                topPerformers: Array<{
                    athleteId: string;
                    workouts: number;
                    prs: number;
                    totalActivity: number;
                }>;
                recommendations: string[];
            }> {
                try {
                    const analytics = await this.getUsageAnalytics(boxId, period.start, period.end);
                    const topPerformers = await this.getTopPerformers(boxId, period, 5);

                    // Calculate engagement score (0-100)
                    const totalActivity = analytics.events.total;
                    const daysInPeriod = Math.ceil((period.end.getTime() - period.start.getTime()) / (1000 * 60 * 60 * 24));
                    const avgDailyActivity = totalActivity / daysInPeriod;

                    // Simple scoring: 1 point per daily event, capped at 100
                    const engagementScore = Math.min(100, Math.round(avgDailyActivity * 2));

                    // Generate recommendations
                    const recommendations: string[] = [];

            if (analytics.predictions.willExceedAthleteLimit) {
                recommendations.push("Consider upgrading your plan - you're approaching the athlete limit");
            }

            if (analytics.trends.activityLevel === "low") {
                recommendations.push("Engagement seems low - consider running member challenges or events");
            }

            if (analytics.events.byType["pr_logged"] < analytics.events.byType["wod_completed"] * 0.1) {
                recommendations.push("PR logging is low - encourage athletes to track personal records");
            }

            return {
                summary: {
                    totalEvents: analytics.events.total,
                    athleteActivity: analytics.events.byType["wod_completed"] || 0,
                    coachActivity: analytics.events.byType["coach_added"] || 0,
                    engagementScore
                },
                growth: {
                    newAthletes: analytics.trends.athleteGrowth,
                    newCoaches: analytics.trends.coachGrowth,
                    retainedAthletes: 0 // Would need additional logic to calculate retention
                },
                topPerformers,
                recommendations
            };

        } catch (error) {
                console.error(`Failed to generate usage report for box ${boxId}:`, error);
                return {
                    summary: { totalEvents: 0, athleteActivity: 0, coachActivity: 0, engagementScore: 0 },
                    growth: { newAthletes: 0, newCoaches: 0, retainedAthletes: 0 },
                    topPerformers: [],
                    recommendations: ["Unable to generate report - please contact support"]
                };
            }
        }

            /**
             * Health check for usage tracking system
             */
        static async healthCheck(): Promise<{
                status: 'healthy' | 'degraded' | 'unhealthy';
                metrics: {
                    unprocessedEvents: number;
                    failedSyncs: number;
                    recentActivity: number;
                };
                message: string;
            }> {
                try {
                    const now = new Date();
                    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

                    // Check for unprocessed events
                    const [unprocessedResult] = await db
                        .select({ count: count() })
                        .from(usageEvents)
                        .where(and(
                            eq(usageEvents.billable, true),
                            eq(usageEvents.processed, false)
                        ));

                    // Check for failed syncs
                    const [failedSyncsResult] = await db
                        .select({ count: count() })
                        .from(usageEvents)
                        .where(and(
                            eq(usageEvents.billable, true),
                            eq(usageEvents.polarError, null)
                        ));

                    // Check recent activity
                    const [recentActivityResult] = await db
                        .select({ count: count() })
                        .from(usageEvents)
                        .where(gte(usageEvents.createdAt, oneHourAgo));

                    const metrics = {
                        unprocessedEvents: unprocessedResult?.count || 0,
                        failedSyncs: failedSyncsResult?.count || 0,
                        recentActivity: recentActivityResult?.count || 0
                    };

                    // Determine health status
                    let status: 'healthy' | 'degraded' | 'unhealthy';
            let message: string;

            if (metrics.unprocessedEvents > 100 || metrics.failedSyncs > 50) {
                status = 'unhealthy';
                message = `High backlog detected: ${metrics.unprocessedEvents} unprocessed, ${metrics.failedSyncs} failed syncs`;
            } else if (metrics.unprocessedEvents > 20 || metrics.failedSyncs > 10) {
                status = 'degraded';
                message = `Some processing delays: ${metrics.unprocessedEvents} unprocessed, ${metrics.failedSyncs} failed syncs`;
            } else {
                status = 'healthy';
                message = 'Usage tracking system operating normally';
            }

            return { status, metrics, message };

        } catch (error) {
                console.error("Usage tracking health check failed:", error);
                return {
                    status: 'unhealthy',
                    metrics: { unprocessedEvents: -1, failedSyncs: -1, recentActivity: -1 },
                    message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
        }
