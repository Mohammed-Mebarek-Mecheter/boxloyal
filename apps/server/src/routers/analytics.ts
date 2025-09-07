// routers/analytics.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { db } from "@/db";
import {
    boxMemberships, usageEvents,
    user
} from "@/db/schema";
import {
    requireCoachOrAbove,
    requireBoxOwner
} from "@/lib/permissions";
import {eq, and, gte, lt, or, SQL, sql, desc} from "drizzle-orm";
import { AnalyticsService } from "@/lib/services/analytics-service";
import { BillingService } from "@/lib/services/billing-service";

export const analyticsRouter = router({
    // Get at-risk athletes (coaches and above only)
    getAtRiskAthletes: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
            limit: z.number().min(1).max(100).default(20),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.getAtRiskAthletes(
                input.boxId,
                input.riskLevel,
                input.limit
            );
        }),

    // Get active alerts
    getActiveAlerts: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            severity: z.enum(["low", "medium", "high", "critical"]).optional(),
            limit: z.number().min(1).max(100).default(20),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.getActiveAlerts(
                input.boxId,
                input.severity,
                input.limit
            );
        }),

    // Get athlete risk score history
    getAthleteRiskHistory: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            membershipId: z.string(),
            days: z.number().min(1).max(365).default(30),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.getAthleteRiskHistory(
                input.boxId,
                input.membershipId,
                input.days
            );
        }),

    // Get intervention history for an athlete
    getAthleteInterventions: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            membershipId: z.string(),
            limit: z.number().min(1).max(50).default(10),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.getAthleteInterventions(
                input.boxId,
                input.membershipId,
                input.limit
            );
        }),

    // Log a coach intervention
    logIntervention: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            membershipId: z.string(),
            alertId: z.string().optional(),
            interventionType: z.string(),
            title: z.string(),
            description: z.string(),
            outcome: z.string().optional(),
            athleteResponse: z.string().optional(),
            coachNotes: z.string().optional(),
            followUpRequired: z.boolean().default(false),
            followUpAt: z.date().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            const membership = await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.logIntervention({
                ...input,
                coachId: membership.id,
            });
        }),

    // Get box analytics snapshots
    getBoxAnalytics: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            period: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
            limit: z.number().min(1).max(100).default(12),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.getBoxAnalytics(
                input.boxId,
                input.period,
                input.limit
            );
        }),

    // Get athlete milestones and celebrations
    getAthleteMilestones: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            membershipId: z.string().optional(),
            milestoneType: z.string().optional(),
            limit: z.number().min(1).max(50).default(10),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.getAthleteMilestones(
                input.boxId,
                input.membershipId,
                input.milestoneType,
                input.limit
            );
        }),

    // Get comprehensive box health dashboard
    getBoxHealthDashboard: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            days: z.number().min(1).max(365).default(30),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.getBoxHealthDashboard(
                input.boxId,
                input.days
            );
        }),

    // Get retention analytics
    getRetentionAnalytics: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            timeframe: z.enum(["7d", "30d", "90d", "365d"]).default("30d"),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            return BillingService.getRetentionAnalytics(
                input.boxId,
                input.timeframe
            );
        }),

    // Get coach performance metrics - Updated to use materialized view
    getCoachPerformance: protectedProcedure
        .input(z.object({
            boxId: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            return AnalyticsService.getCoachPerformance(input.boxId);
        }),

    // Get athlete engagement score
    getAthleteEngagementScore: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            membershipId: z.string(),
            days: z.number().min(1).max(90).default(30),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.calculateAthleteEngagementScore(
                input.boxId,
                input.membershipId,
                input.days
            );
        }),

    // Get engagement leaderboard - New endpoint using materialized view
    getEngagementLeaderboard: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            days: z.number().min(1).max(365).default(30),
            limit: z.number().min(1).max(100).default(20),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.getEngagementLeaderboard(
                input.boxId,
                input.days,
                input.limit
            );
        }),

    // Get correlation between wellness and performance
    getWellnessPerformanceCorrelation: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            days: z.number().min(7).max(90).default(30),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AnalyticsService.getWellnessPerformanceCorrelation(
                input.boxId,
                input.days
            );
        }),

    // Refresh analytics views - New endpoint for admin
    refreshAnalyticsViews: protectedProcedure
        .input(z.object({
            boxId: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                // Refresh each materialized view individually
                await db.execute(sql`REFRESH MATERIALIZED VIEW mv_box_health_dashboard`);
                await db.execute(sql`REFRESH MATERIALIZED VIEW mv_athlete_engagement_scores`);
                await db.execute(sql`REFRESH MATERIALIZED VIEW mv_coach_performance`);

                return {
                    success: true,
                    message: "Analytics views refreshed successfully"
                };
            } catch (error) {
                console.error("Failed to refresh materialized views", error);
                throw new Error("Failed to refresh analytics views");
            }
        }),

    // Enhanced usage analytics with trend analysis
    getUsageAnalytics: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            startDate: z.date().optional(),
            endDate: z.date().optional(),
            eventTypes: z.array(z.string()).optional(),
            groupBy: z.enum(["day", "week", "month"]).default("day"),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            // This implementation remains the same as it's not yet optimized with materialized views
            const startDate =
                input.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
            const endDate = input.endDate || new Date();

            // Build where conditions
            const whereConditions: SQL<unknown>[] = [
                eq(usageEvents.boxId, input.boxId),
                gte(usageEvents.createdAt, startDate),
                lt(usageEvents.createdAt, endDate),
            ];

            if (input.eventTypes && input.eventTypes.length > 0) {
                const eventTypeConditions = input.eventTypes.map((et) =>
                    eq(usageEvents.eventType, et)
                );

                const eventTypeFilter =
                    eventTypeConditions.length === 1
                        ? eventTypeConditions[0]
                        : or(...eventTypeConditions);

                whereConditions.push(eventTypeFilter as SQL<unknown>);
            }

            const usageData = await db.query.usageEvents.findMany({
                where: and(...whereConditions),
                orderBy: desc(usageEvents.createdAt),
            });

            // Aggregate by event type
            const aggregated: Record<string, number> = usageData.reduce(
                (acc, event) => {
                    acc[event.eventType] = (acc[event.eventType] || 0) + event.quantity;
                    return acc;
                },
                {} as Record<string, number>
            );

            // Group by time period for trend analysis
            const timeGrouped: Record<string, Record<string, number>> = usageData.reduce(
                (acc, event) => {
                    let key: string;
                    const date = new Date(event.createdAt);

                    switch (input.groupBy) {
                        case "week": {
                            const weekStart = new Date(date);
                            weekStart.setDate(date.getDate() - date.getDay()); // Sunday start
                            key = weekStart.toISOString().split("T")[0];
                            break;
                        }
                        case "month":
                            key = `${date.getFullYear()}-${String(
                                date.getMonth() + 1
                            ).padStart(2, "0")}`;
                            break;
                        default:
                            key = date.toISOString().split("T")[0];
                    }

                    if (!acc[key]) acc[key] = {};
                    acc[key][event.eventType] =
                        (acc[key][event.eventType] || 0) + event.quantity;

                    return acc;
                },
                {} as Record<string, Record<string, number>>
            );

            // Calculate trends and growth rates
            const eventTypes = Object.keys(aggregated);
            const trends = eventTypes.map((eventType) => {
                const eventData = usageData.filter((e) => e.eventType === eventType);
                if (eventData.length === 0) {
                    return { eventType, total: 0, growthRate: 0, trend: "stable" };
                }

                const midPoint = Math.floor(eventData.length / 2);
                const firstHalf = eventData.slice(0, midPoint);
                const secondHalf = eventData.slice(midPoint);

                const firstHalfSum = firstHalf.reduce((sum, e) => sum + e.quantity, 0);
                const secondHalfSum = secondHalf.reduce((sum, e) => sum + e.quantity, 0);

                const growthRate =
                    firstHalfSum > 0
                        ? ((secondHalfSum - firstHalfSum) / firstHalfSum) * 100
                        : 0;

                return {
                    eventType,
                    total: aggregated[eventType],
                    growthRate: Math.round(growthRate * 100) / 100,
                    trend:
                        growthRate > 0
                            ? "increasing"
                            : growthRate < 0
                                ? "decreasing"
                                : "stable",
                };
            });

            return {
                events: usageData,
                aggregated,
                timeGrouped,
                trends,
                totalEvents: usageData.length,
                dateRange: { startDate, endDate },
                summary: {
                    mostActiveEventType:
                        eventTypes.length > 0
                            ? eventTypes.reduce((a, b) =>
                                aggregated[a] > aggregated[b] ? a : b
                            )
                            : "",
                    averageEventsPerDay:
                        usageData.length > 0
                            ? Math.round(
                                usageData.length /
                                Math.ceil(
                                    (endDate.getTime() - startDate.getTime()) /
                                    (1000 * 60 * 60 * 24)
                                )
                            )
                            : 0,
                },
            };
        }),
});
