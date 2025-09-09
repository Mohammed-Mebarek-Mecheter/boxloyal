// routers/athlete/profile.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { AthleteService } from "@/lib/services/athlete-service";
import {
    requireBoxMembership,
    canAccessAthleteData,
    requireCoachOrAbove
} from "@/lib/permissions";
import { TRPCError } from "@trpc/server";
import { AnalyticsService } from "@/lib/services/analytics-service";

export const athleteProfileRouter = router({
    // Get comprehensive athlete profile with all associated data
    getAthleteProfile: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            includePrs: z.boolean().default(true),
            includeRecentActivity: z.boolean().default(true),
            includeBenchmarks: z.boolean().default(true),
            includeBadges: z.boolean().default(true),
            includeStats: z.boolean().default(true),
            includeRiskData: z.boolean().default(false),
            days: z.number().min(1).max(365).default(30),
            limit: z.number().min(1).max(50).default(10),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' profiles"
                    });
                }
            }

            // Get profile data in parallel for better performance
            const [
                profile,
                stats,
                riskData
            ] = await Promise.all([
                AthleteService.getAthleteProfile(
                    input.boxId,
                    targetAthleteId,
                    {
                        includePrs: input.includePrs,
                        includeRecentActivity: input.includeRecentActivity,
                        includeBenchmarks: input.includeBenchmarks,
                        includeBadges: input.includeBadges,
                        includeStats: input.includeStats,
                        days: input.days,
                        limit: input.limit,
                    }
                ),
                input.includeStats ?
                    AthleteService.getAthleteStats(input.boxId, targetAthleteId, input.days)
                    : Promise.resolve(null),
                input.includeRiskData ?
                    AnalyticsService.calculateRetentionRisk(input.boxId, targetAthleteId, {
                        lookbackDays: input.days,
                        includeRecommendations: true
                    })
                    : Promise.resolve(null)
            ]);

            if (!profile) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Athlete profile not found"
                });
            }

            return {
                ...profile,
                stats: stats || undefined,
                riskData: riskData || undefined
            };
        }),

    // Get athlete badges with enhanced filtering
    getBadges: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            badgeType: z.enum([
                "checkin_streak",
                "pr_achievement",
                "benchmark_completion",
                "attendance",
                "consistency",
                "community"
            ]).optional(),
            includeHidden: z.boolean().default(false),
            limit: z.number().min(1).max(100).default(50),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' badges"
                    });
                }
            }

            return AthleteService.getAthleteBadges(
                input.boxId,
                targetAthleteId,
                {
                    includeHidden: input.includeHidden,
                    badgeType: input.badgeType,
                    limit: input.limit,
                }
            );
        }),

    // Get athlete performance summary with enhanced analytics
    getPerformanceSummary: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            period: z.enum(["week", "month", "quarter", "year"]).default("month"),
            includeTrends: z.boolean().default(true),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' performance summary"
                    });
                }
            }

            const days = {
                week: 7,
                month: 30,
                quarter: 90,
                year: 365
            }[input.period];

            const [stats, engagement, wellnessTrends] = await Promise.all([
                AthleteService.getAthleteStats(input.boxId, targetAthleteId, days),
                AnalyticsService.calculateAthleteEngagementScore(input.boxId, targetAthleteId, days),
                AnalyticsService.getWellnessTrends(input.boxId, targetAthleteId, Math.ceil(days / 7))
            ]);

            return {
                stats,
                engagement,
                wellnessTrends,
                period: input.period,
                generatedAt: new Date()
            };
        }),

    // Get athlete activity timeline with enhanced filtering
    getActivityTimeline: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            days: z.number().min(1).max(90).default(30),
            activityTypes: z.array(z.enum([
                "pr", "benchmark", "checkin", "wod_feedback", "badge_earned", "attendance", "intervention"
            ])).optional(),
            includeCoachNotes: z.boolean().default(false),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' activity timeline"
                    });
                }
            }

            // Get various activity types in parallel
            const [
                prs,
                benchmarks,
                checkins,
                badges,
                interventions
            ] = await Promise.all([
                input.activityTypes?.includes("pr") !== false
                    ? AthleteService.getRecentPRs(input.boxId, targetAthleteId, input.days, 50)
                    : Promise.resolve([]),
                input.activityTypes?.includes("benchmark") !== false
                    ? AthleteService.getRecentBenchmarks(input.boxId, targetAthleteId, input.days, 50)
                    : Promise.resolve([]),
                input.activityTypes?.includes("checkin") !== false
                    ? AthleteService.getWellnessCheckins(input.boxId, targetAthleteId, input.days, 50)
                    : Promise.resolve([]),
                input.activityTypes?.includes("badge_earned") !== false
                    ? AthleteService.getAthleteBadges(input.boxId, targetAthleteId, { limit: 50 })
                    : Promise.resolve([]),
                input.activityTypes?.includes("intervention") !== false
                    ? AnalyticsService.getAthleteInterventions(input.boxId, targetAthleteId, 20)
                    : Promise.resolve([])
            ]);

            // Combine and sort activities by date
            const activities: Array<{
                type: string;
                date: Date;
                title: string;
                description?: string;
                metadata?: any;
                data: any;
            }> = [];

            // Add PRs
            prs.forEach(({ pr, movement }) => {
                activities.push({
                    type: "pr",
                    date: pr.achievedAt,
                    title: `New PR: ${movement.name}`,
                    description: `${pr.value} ${pr.unit}${pr.reps ? ` x ${pr.reps}` : ""}`,
                    metadata: {
                        movement: movement.name,
                        value: pr.value,
                        unit: pr.unit,
                        verified: pr.verifiedByCoach
                    },
                    data: { pr, movement }
                });
            });

            // Add benchmarks
            benchmarks.forEach(({ benchmark, benchmarkWod }) => {
                activities.push({
                    type: "benchmark",
                    date: benchmark.achievedAt,
                    title: `Benchmark: ${benchmarkWod.name}`,
                    description: `${benchmark.value} ${benchmark.valueType}${benchmark.scaled ? " (Scaled)" : ""}`,
                    metadata: {
                        benchmark: benchmarkWod.name,
                        value: benchmark.value,
                        valueType: benchmark.valueType,
                        scaled: benchmark.scaled
                    },
                    data: { benchmark, benchmarkWod }
                });
            });

            // Add checkins
            checkins.forEach(checkin => {
                const wellnessScore = (checkin.energyLevel + checkin.sleepQuality +
                    (10 - checkin.stressLevel) + checkin.motivationLevel +
                    checkin.workoutReadiness) / 5;

                activities.push({
                    type: "checkin",
                    date: checkin.checkinDate,
                    title: "Wellness Check-in",
                    description: `Wellness Score: ${Math.round(wellnessScore * 10) / 10}/10`,
                    metadata: {
                        energy: checkin.energyLevel,
                        sleep: checkin.sleepQuality,
                        stress: checkin.stressLevel,
                        readiness: checkin.workoutReadiness
                    },
                    data: checkin
                });
            });

            // Add badges (filter by date range)
            const dateFrom = new Date();
            dateFrom.setDate(dateFrom.getDate() - input.days);

            badges
                .filter(badge => badge.awardedAt >= dateFrom)
                .forEach(badge => {
                    activities.push({
                        type: "badge_earned",
                        date: badge.awardedAt,
                        title: `Badge Earned: ${badge.title}`,
                        description: badge.description || undefined,
                        metadata: {
                            badgeType: badge.badgeType,
                            tier: badge.tier
                        },
                        data: badge
                    });
                });

            // Add interventions
            interventions.forEach(intervention => {
                activities.push({
                    type: "intervention",
                    date: intervention.interventionDate,
                    title: `Coach Intervention: ${intervention.title}`,
                    description: intervention.description,
                    metadata: {
                        interventionType: intervention.interventionType,
                        outcome: intervention.outcome,
                        coachId: intervention.coachId
                    },
                    data: intervention
                });
            });

            // Sort by date (most recent first)
            activities.sort((a, b) => b.date.getTime() - a.date.getTime());

            return {
                activities: activities.slice(0, input.days),
                summary: {
                    totalActivities: activities.length,
                    prCount: activities.filter(a => a.type === "pr").length,
                    benchmarkCount: activities.filter(a => a.type === "benchmark").length,
                    checkinCount: activities.filter(a => a.type === "checkin").length,
                    badgeCount: activities.filter(a => a.type === "badge_earned").length,
                    interventionCount: activities.filter(a => a.type === "intervention").length,
                }
            };
        }),

    // Get athlete comparison data (for coaches to compare athletes)
    getAthleteComparison: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteIds: z.array(z.uuid()).min(2).max(10),
            period: z.enum(["week", "month", "quarter"]).default("month"),
            metrics: z.array(z.enum([
                "checkin_rate",
                "wellness_score",
                "pr_count",
                "benchmark_count",
                "attendance_rate",
                "engagement_score",
                "risk_score"
            ])).optional(),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);

            // Only coaches and above can compare athletes
            if (!["owner", "head_coach", "coach"].includes(membership.role)) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Insufficient permissions to compare athletes"
                });
            }

            const days = {
                week: 7,
                month: 30,
                quarter: 90
            }[input.period];

            // Get stats for all athletes
            const athleteStats = await Promise.all(
                input.athleteIds.map(async (athleteId) => {
                    const [stats, profile, engagement, riskData] = await Promise.all([
                        AthleteService.getAthleteStats(input.boxId, athleteId, days),
                        AthleteService.getAthleteProfile(
                            input.boxId,
                            athleteId,
                            { includeStats: false, days, limit: 1 }
                        ),
                        AnalyticsService.calculateAthleteEngagementScore(input.boxId, athleteId, days),
                        AnalyticsService.calculateRetentionRisk(input.boxId, athleteId, {
                            lookbackDays: days,
                            includeRecommendations: false
                        })
                    ]);

                    return {
                        athleteId,
                        profile: profile?.profile,
                        stats,
                        engagement: engagement.score,
                        riskScore: riskData.riskScore
                    };
                })
            );

            return {
                comparison: athleteStats,
                period: input.period,
                metrics: input.metrics || [
                    "checkin_rate",
                    "wellness_score",
                    "pr_count",
                    "attendance_rate",
                    "engagement_score",
                    "risk_score"
                ],
                summary: {
                    totalAthletes: athleteStats.length,
                    avgCheckinRate: Math.round(
                        athleteStats.reduce((sum, a) => sum + (a.stats.attendanceRate || 0), 0) /
                        athleteStats.length
                    ),
                    avgWellnessScore: Math.round(
                        athleteStats.reduce((sum, a) => sum + (a.stats.avgWellnessScore || 0), 0) /
                        athleteStats.length * 10
                    ) / 10,
                    avgEngagementScore: Math.round(
                        athleteStats.reduce((sum, a) => sum + (a.engagement || 0), 0) /
                        athleteStats.length
                    ),
                    avgRiskScore: Math.round(
                        athleteStats.reduce((sum, a) => sum + (a.riskScore || 0), 0) /
                        athleteStats.length
                    )
                }
            };
        }),

    // Get athlete risk history
    getRiskHistory: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            days: z.number().min(1).max(365).default(30),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check - only coaches can view risk history of others
            if (input.athleteId && input.athleteId !== membership.id) {
                await requireCoachOrAbove(ctx, input.boxId);
            }

            return AnalyticsService.getAthleteRiskHistory(
                input.boxId,
                targetAthleteId,
                input.days
            );
        }),

    // Get athlete wellness trends
    getWellnessTrends: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            weeks: z.number().min(1).max(52).default(12),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' wellness trends"
                    });
                }
            }

            return AnalyticsService.getWellnessTrends(
                input.boxId,
                targetAthleteId,
                input.weeks
            );
        })
});
