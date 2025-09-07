// routers/analytics.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { db } from "@/db";
import {
    athleteRiskScores,
    athleteAlerts,
    athleteInterventions,
    boxAnalytics,
    athleteMilestones,
    athletePrs,
    athleteWellnessCheckins,
    boxMemberships,
    athleteBenchmarks,
    wodAttendance,
    user
} from "@/db/schema";
import {
    requireCoachOrAbove,
    requireBoxOwner
} from "@/lib/permissions";
import { eq, desc, and, gte, lte, count, avg, sql } from "drizzle-orm";

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

            const conditions = [eq(athleteRiskScores.boxId, input.boxId)];

            if (input.riskLevel) {
                conditions.push(eq(athleteRiskScores.riskLevel, input.riskLevel));
            }

            return db
                .select()
                .from(athleteRiskScores)
                .where(and(...conditions))
                .orderBy(desc(athleteRiskScores.overallRiskScore))
                .limit(input.limit);
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

            let whereConditions = and(
                eq(athleteAlerts.boxId, input.boxId),
                eq(athleteAlerts.status, "active")
            );

            if (input.severity) {
                whereConditions = and(whereConditions, eq(athleteAlerts.severity, input.severity));
            }

            return db
                .select()
                .from(athleteAlerts)
                .where(whereConditions)
                .orderBy(desc(athleteAlerts.createdAt))
                .limit(input.limit);
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

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - input.days);

            return db
                .select()
                .from(athleteRiskScores)
                .where(and(
                    eq(athleteRiskScores.boxId, input.boxId),
                    eq(athleteRiskScores.membershipId, input.membershipId),
                    gte(athleteRiskScores.calculatedAt, startDate)
                ))
                .orderBy(desc(athleteRiskScores.calculatedAt));
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

            return db
                .select()
                .from(athleteInterventions)
                .where(and(
                    eq(athleteInterventions.boxId, input.boxId),
                    eq(athleteInterventions.membershipId, input.membershipId)
                ))
                .orderBy(desc(athleteInterventions.interventionDate))
                .limit(input.limit);
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

            const [intervention] = await db
                .insert(athleteInterventions)
                .values({
                    boxId: input.boxId,
                    membershipId: input.membershipId,
                    coachId: membership.id,
                    alertId: input.alertId,
                    interventionType: input.interventionType,
                    title: input.title,
                    description: input.description,
                    outcome: input.outcome,
                    athleteResponse: input.athleteResponse,
                    coachNotes: input.coachNotes,
                    followUpRequired: input.followUpRequired,
                    followUpAt: input.followUpAt,
                    interventionDate: new Date(),
                })
                .returning();

            // If there's an associated alert, mark it as resolved
            if (input.alertId) {
                await db
                    .update(athleteAlerts)
                    .set({
                        status: "resolved",
                        resolvedAt: new Date(),
                        resolvedById: membership.id,
                        resolutionNotes: `Resolved via intervention: ${input.interventionType}`,
                    })
                    .where(eq(athleteAlerts.id, input.alertId));
            }

            return intervention;
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

            return db
                .select()
                .from(boxAnalytics)
                .where(and(
                    eq(boxAnalytics.boxId, input.boxId),
                    eq(boxAnalytics.period, input.period)
                ))
                .orderBy(desc(boxAnalytics.periodStart))
                .limit(input.limit);
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

            const conditions = [eq(athleteMilestones.boxId, input.boxId)];

            if (input.membershipId) {
                conditions.push(eq(athleteMilestones.membershipId, input.membershipId));
            }

            if (input.milestoneType) {
                conditions.push(eq(athleteMilestones.milestoneType, input.milestoneType));
            }

            return db
                .select()
                .from(athleteMilestones)
                .where(and(...conditions))
                .orderBy(desc(athleteMilestones.achievedAt))
                .limit(input.limit);
        }),

    // Get comprehensive box health dashboard
    getBoxHealthDashboard: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            days: z.number().min(1).max(365).default(30),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - input.days);

            // Get various metrics in parallel
            const [
                riskDistribution,
                alertStats,
                interventionStats,
                wellnessTrends,
                attendanceTrends,
                performanceTrends
            ] = await Promise.all([
                // Risk distribution
                db
                    .select({
                        riskLevel: athleteRiskScores.riskLevel,
                        count: count()
                    })
                    .from(athleteRiskScores)
                    .where(and(
                        eq(athleteRiskScores.boxId, input.boxId),
                        gte(athleteRiskScores.calculatedAt, startDate)
                    ))
                    .groupBy(athleteRiskScores.riskLevel),

                // Alert statistics
                db
                    .select({
                        alertType: athleteAlerts.alertType,
                        status: athleteAlerts.status,
                        count: count()
                    })
                    .from(athleteAlerts)
                    .where(and(
                        eq(athleteAlerts.boxId, input.boxId),
                        gte(athleteAlerts.createdAt, startDate)
                    ))
                    .groupBy(athleteAlerts.alertType, athleteAlerts.status),

                // Intervention statistics
                db
                    .select({
                        interventionType: athleteInterventions.interventionType,
                        outcome: athleteInterventions.outcome,
                        count: count()
                    })
                    .from(athleteInterventions)
                    .where(and(
                        eq(athleteInterventions.boxId, input.boxId),
                        gte(athleteInterventions.interventionDate, startDate)
                    ))
                    .groupBy(athleteInterventions.interventionType, athleteInterventions.outcome),

                // Wellness trends
                db
                    .select({
                        avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                        avgSleep: avg(athleteWellnessCheckins.sleepQuality),
                        avgStress: avg(athleteWellnessCheckins.stressLevel),
                    })
                    .from(athleteWellnessCheckins)
                    .where(and(
                        eq(athleteWellnessCheckins.boxId, input.boxId),
                        gte(athleteWellnessCheckins.checkinDate, startDate)
                    )),

                // Attendance trends - using wodTime instead of attendanceDate
                db
                    .select({
                        totalCheckins: count(),
                        uniqueAthletes: count(athleteWellnessCheckins.membershipId),
                    })
                    .from(athleteWellnessCheckins)
                    .where(and(
                        eq(athleteWellnessCheckins.boxId, input.boxId),
                        gte(athleteWellnessCheckins.checkinDate, startDate)
                    )),

                // Performance trends
                db
                    .select({
                        totalPrs: count(),
                        avgImprovement: avg(sql`CAST(${athletePrs.value} AS NUMERIC)`),
                    })
                    .from(athletePrs)
                    .where(and(
                        eq(athletePrs.boxId, input.boxId),
                        gte(athletePrs.achievedAt, startDate)
                    ))
            ]);

            return {
                riskDistribution,
                alertStats,
                interventionStats,
                wellnessTrends: wellnessTrends[0],
                attendanceTrends: attendanceTrends[0],
                performanceTrends: performanceTrends[0],
                dateRange: {
                    start: startDate,
                    end: new Date(),
                }
            };
        }),

    // Get retention analytics
    getRetentionAnalytics: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            timeframe: z.enum(["7d", "30d", "90d", "365d"]).default("30d"),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            // Calculate timeframe
            const endDate = new Date();
            const startDate = new Date();

            switch (input.timeframe) {
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
                    eq(boxMemberships.boxId, input.boxId),
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
                    eq(boxMemberships.boxId, input.boxId),
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
                    eq(boxMemberships.boxId, input.boxId),
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
                timeframe: input.timeframe,
                period: {
                    start: startDate,
                    end: endDate
                }
            };
        }),

    // Get coach performance metrics
    getCoachPerformance: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            days: z.number().min(1).max(365).default(30),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - input.days);

            // Get interventions by coach
            const interventionsByCoach = await db
                .select({
                    coachId: athleteInterventions.coachId,
                    count: count(),
                    positiveOutcomes: sql<number>`SUM(CASE WHEN ${athleteInterventions.outcome} = 'positive' THEN 1 ELSE 0 END)`,
                })
                .from(athleteInterventions)
                .where(and(
                    eq(athleteInterventions.boxId, input.boxId),
                    gte(athleteInterventions.interventionDate, startDate)
                ))
                .groupBy(athleteInterventions.coachId);

            // Get coach details with user information
            const coachDetails = await db
                .select({
                    id: boxMemberships.id,
                    userId: boxMemberships.userId,
                    role: boxMemberships.role,
                })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, input.boxId),
                    eq(boxMemberships.isActive, true),
                    sql`${boxMemberships.role} IN ('coach', 'head_coach')`
                ));

            // Get user names for coaches
            const coachUsers = await db
                .select({
                    id: user.id,
                    name: user.name,
                })
                .from(user)
                .where(sql`${user.id} IN (${coachDetails.map(c => c.userId)})`);

            // Combine data
            const coachPerformance = coachDetails.map(coach => {
                const coachStats = interventionsByCoach.find(stats => stats.coachId === coach.id);
                const userInfo = coachUsers.find(u => u.id === coach.userId);

                return {
                    id: coach.id,
                    name: userInfo?.name || "Unknown Coach",
                    role: coach.role,
                    interventions: coachStats?.count || 0,
                    successRate: coachStats ?
                        Math.round((coachStats.positiveOutcomes / coachStats.count) * 100) : 0
                };
            });

            return coachPerformance;
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

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - input.days);

            // Get various engagement metrics
            const [
                checkinCount,
                prCount,
                attendanceCount,
                benchmarkCount
            ] = await Promise.all([
                // Wellness check-ins
                db
                    .select({ count: count() })
                    .from(athleteWellnessCheckins)
                    .where(and(
                        eq(athleteWellnessCheckins.boxId, input.boxId),
                        eq(athleteWellnessCheckins.membershipId, input.membershipId),
                        gte(athleteWellnessCheckins.checkinDate, startDate)
                    )),

                // Personal records
                db
                    .select({ count: count() })
                    .from(athletePrs)
                    .where(and(
                        eq(athletePrs.boxId, input.boxId),
                        eq(athletePrs.membershipId, input.membershipId),
                        gte(athletePrs.achievedAt, startDate)
                    )),

                // Class attendance - using wodTime instead of attendanceDate
                db
                    .select({ count: count() })
                    .from(wodAttendance)
                    .where(and(
                        eq(wodAttendance.boxId, input.boxId),
                        eq(wodAttendance.membershipId, input.membershipId),
                        gte(wodAttendance.wodTime, startDate)
                    )),

                // Benchmark workouts
                db
                    .select({ count: count() })
                    .from(athleteBenchmarks)
                    .where(and(
                        eq(athleteBenchmarks.boxId, input.boxId),
                        eq(athleteBenchmarks.membershipId, input.membershipId),
                        gte(athleteBenchmarks.completedAt, startDate)
                    ))
            ]);

            // Calculate engagement score (weighted average)
            const maxPossibleDays = input.days;
            const checkinScore = (checkinCount[0].count / maxPossibleDays) * 30; // 30% weight
            const prScore = Math.min(prCount[0].count / 5, 1) * 25; // 25% weight (max 5 PRs)
            const attendanceScore = (attendanceCount[0].count / maxPossibleDays) * 35; // 35% weight
            const benchmarkScore = Math.min(benchmarkCount[0].count / 3, 1) * 10; // 10% weight (max 3 benchmarks)

            const engagementScore = Math.round(
                checkinScore + prScore + attendanceScore + benchmarkScore
            );

            return {
                score: engagementScore,
                metrics: {
                    checkins: checkinCount[0].count,
                    prs: prCount[0].count,
                    attendance: attendanceCount[0].count,
                    benchmarks: benchmarkCount[0].count,
                },
                breakdown: {
                    checkinScore: Math.round(checkinScore),
                    prScore: Math.round(prScore),
                    attendanceScore: Math.round(attendanceScore),
                    benchmarkScore: Math.round(benchmarkScore),
                },
                period: {
                    days: input.days,
                    start: startDate,
                    end: new Date(),
                }
            };
        }),

    // Get correlation between wellness and performance
    getWellnessPerformanceCorrelation: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            days: z.number().min(7).max(90).default(30),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - input.days);

            // Get wellness and performance data
            const correlationData = await db
                .select({
                    energyLevel: athleteWellnessCheckins.energyLevel,
                    sleepQuality: athleteWellnessCheckins.sleepQuality,
                    stressLevel: athleteWellnessCheckins.stressLevel,
                    prValue: sql<number>`CAST(${athletePrs.value} AS NUMERIC)`,
                })
                .from(athleteWellnessCheckins)
                .innerJoin(
                    athletePrs,
                    and(
                        eq(athleteWellnessCheckins.membershipId, athletePrs.membershipId),
                        eq(athleteWellnessCheckins.boxId, athletePrs.boxId),
                        sql`DATE(${athleteWellnessCheckins.checkinDate}) = DATE(${athletePrs.achievedAt})`
                    )
                )
                .where(and(
                    eq(athleteWellnessCheckins.boxId, input.boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                ))
                .limit(1000); // Limit to prevent excessive data

            // Calculate simple correlations (this would be enhanced with proper statistical analysis)
            const energyValues = correlationData.map(d => d.energyLevel);
            const sleepValues = correlationData.map(d => d.sleepQuality);
            const stressValues = correlationData.map(d => d.stressLevel);
            const prValues = correlationData.map(d => d.prValue);

            // Simple correlation calculation (Pearson would be better but this is simplified)
            const calculateSimpleCorrelation = (x: number[], y: number[]) => {
                if (x.length !== y.length || x.length === 0) return 0;

                const xMean = x.reduce((a, b) => a + b, 0) / x.length;
                const yMean = y.reduce((a, b) => a + b, 0) / y.length;

                let numerator = 0;
                let denominatorX = 0;
                let denominatorY = 0;

                for (let i = 0; i < x.length; i++) {
                    numerator += (x[i] - xMean) * (y[i] - yMean);
                    denominatorX += Math.pow(x[i] - xMean, 2);
                    denominatorY += Math.pow(y[i] - yMean, 2);
                }

                return numerator / Math.sqrt(denominatorX * denominatorY);
            };

            return {
                energyCorrelation: calculateSimpleCorrelation(energyValues, prValues),
                sleepCorrelation: calculateSimpleCorrelation(sleepValues, prValues),
                stressCorrelation: calculateSimpleCorrelation(stressValues, prValues),
                sampleSize: correlationData.length,
                period: {
                    days: input.days,
                    start: startDate,
                    end: new Date(),
                }
            };
        }),
});
