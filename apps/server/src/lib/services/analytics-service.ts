// lib/services/analytics-service.ts
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
    user, userProfiles
} from "@/db/schema";
import {eq, desc, and, gte, lte, count, avg, sql, inArray} from "drizzle-orm";

// Types for better type safety
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AnalyticsPeriod = "daily" | "weekly" | "monthly";

export interface AthleteEngagementMetrics {
    checkins: number;
    prs: number;
    attendance: number;
    benchmarks: number;
}

export interface EngagementBreakdown {
    checkinScore: number;
    prScore: number;
    attendanceScore: number;
    benchmarkScore: number;
}

export interface BoxHealthMetrics {
    riskDistribution: Array<{ riskLevel: string; count: number }>;
    alertStats: Array<{ alertType: string; status: string; count: number }>;
    interventionStats: Array<{ interventionType: string; outcome: string | null; count: number }>;
    wellnessTrends: {
        avgEnergy: number | null;
        avgSleep: number | null;
        avgStress: number | null;
    };
    attendanceTrends: {
        totalCheckins: number;
        uniqueAthletes: number;
    };
    performanceTrends: {
        totalPrs: number;
        avgImprovement: number | null;
    };
}

export class AnalyticsService {
    /**
     * Get at-risk athletes for a box
     */
    static async getAtRiskAthletes(
        boxId: string,
        riskLevel?: RiskLevel,
        limit: number = 20
    ) {
        const conditions = [eq(athleteRiskScores.boxId, boxId)];

        if (riskLevel) {
            conditions.push(eq(athleteRiskScores.riskLevel, riskLevel));
        }

        return db
            .select()
            .from(athleteRiskScores)
            .where(and(...conditions))
            .orderBy(desc(athleteRiskScores.overallRiskScore))
            .limit(limit);
    }

    /**
     * Get active alerts for a box
     */
    static async getActiveAlerts(
        boxId: string,
        severity?: AlertSeverity,
        limit: number = 20
    ) {
        let whereConditions = and(
            eq(athleteAlerts.boxId, boxId),
            eq(athleteAlerts.status, "active")
        );

        if (severity) {
            whereConditions = and(whereConditions, eq(athleteAlerts.severity, severity));
        }

        return db
            .select()
            .from(athleteAlerts)
            .where(whereConditions)
            .orderBy(desc(athleteAlerts.createdAt))
            .limit(limit);
    }

    /**
     * Get athlete risk score history
     */
    static async getAthleteRiskHistory(
        boxId: string,
        membershipId: string,
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return db
            .select()
            .from(athleteRiskScores)
            .where(and(
                eq(athleteRiskScores.boxId, boxId),
                eq(athleteRiskScores.membershipId, membershipId),
                gte(athleteRiskScores.calculatedAt, startDate)
            ))
            .orderBy(desc(athleteRiskScores.calculatedAt));
    }

    /**
     * Get intervention history for an athlete
     */
    static async getAthleteInterventions(
        boxId: string,
        membershipId: string,
        limit: number = 10
    ) {
        return db
            .select()
            .from(athleteInterventions)
            .where(and(
                eq(athleteInterventions.boxId, boxId),
                eq(athleteInterventions.membershipId, membershipId)
            ))
            .orderBy(desc(athleteInterventions.interventionDate))
            .limit(limit);
    }

    /**
     * Get detailed athlete information with risk scores
     */
    static async getAthletesWithRiskScores(
        boxId: string,
        riskLevel?: RiskLevel,
        limit: number = 50
    ) {
        const riskConditions = [eq(athleteRiskScores.boxId, boxId)];

        if (riskLevel) {
            riskConditions.push(eq(athleteRiskScores.riskLevel, riskLevel));
        }

        // Get at-risk athletes first
        const atRiskAthletes = await db
            .select()
            .from(athleteRiskScores)
            .where(and(...riskConditions))
            .orderBy(desc(athleteRiskScores.overallRiskScore))
            .limit(limit);

        // Extract membership IDs to get detailed info
        const membershipIds = atRiskAthletes.map(athlete => athlete.membershipId);

        if (membershipIds.length === 0) {
            return [];
        }

        // Get detailed membership and user info
        return db
            .select({
                riskScore: athleteRiskScores,
                membership: boxMemberships,
                user: user,
                profile: userProfiles,
            })
            .from(athleteRiskScores)
            .innerJoin(boxMemberships, eq(athleteRiskScores.membershipId, boxMemberships.id))
            .innerJoin(user, eq(boxMemberships.userId, user.id))
            .leftJoin(userProfiles, eq(user.id, userProfiles.userId))
            .where(and(
                eq(athleteRiskScores.boxId, boxId),
                inArray(athleteRiskScores.membershipId, membershipIds)
            ))
            .orderBy(desc(athleteRiskScores.overallRiskScore));
    }

    /**
     * Get athlete engagement leaderboard for a box
     */
    static async getEngagementLeaderboard(
        boxId: string,
        days: number = 30,
        limit: number = 20
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get all active athletes in the box
        const athletes = await db
            .select({
                id: boxMemberships.id,
                userId: boxMemberships.userId,
                publicId: boxMemberships.publicId,
            })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                eq(boxMemberships.role, 'athlete')
            ));

        const athleteIds = athletes.map(a => a.id);

        if (athleteIds.length === 0) {
            return [];
        }

        // Calculate engagement scores for all athletes
        const engagementScores = await Promise.all(
            athleteIds.map(membershipId =>
                this.calculateAthleteEngagementScore(boxId, membershipId, days)
            )
        );

        // Combine with user information
        return Promise.all(
            engagementScores.map(async (score, index) => {
                const athlete = athletes[index];
                const userInfo = await db
                    .select()
                    .from(user)
                    .where(eq(user.id, athlete.userId))
                    .then(rows => rows[0]);

                return {
                    score: score.score,
                    metrics: score.metrics,
                    membershipId: athlete.id,
                    publicId: athlete.publicId,
                    user: userInfo,
                    period: score.period,
                };
            })
        ).then(results =>
            results.sort((a, b) => b.score - a.score).slice(0, limit)
        );
    }

    /**
     * Get coach information for a box
     */
    static async getBoxCoaches(boxId: string) {
        return db
            .select({
                membership: boxMemberships,
                user: user,
                profile: userProfiles,
            })
            .from(boxMemberships)
            .innerJoin(user, eq(boxMemberships.userId, user.id))
            .leftJoin(userProfiles, eq(user.id, userProfiles.userId))
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                inArray(boxMemberships.role, ['head_coach', 'coach'])
            ));
    }

    /**
     * Log a coach intervention
     */
    static async logIntervention(params: {
        boxId: string;
        membershipId: string;
        coachId: string;
        alertId?: string;
        interventionType: string;
        title: string;
        description: string;
        outcome?: string;
        athleteResponse?: string;
        coachNotes?: string;
        followUpRequired?: boolean;
        followUpAt?: Date;
    }) {
        const [intervention] = await db
            .insert(athleteInterventions)
            .values({
                ...params,
                interventionDate: new Date(),
            })
            .returning();

        // If there's an associated alert, mark it as resolved
        if (params.alertId) {
            await db
                .update(athleteAlerts)
                .set({
                    status: "resolved",
                    resolvedAt: new Date(),
                    resolvedById: params.coachId,
                    resolutionNotes: `Resolved via intervention: ${params.interventionType}`,
                })
                .where(eq(athleteAlerts.id, params.alertId));
        }

        return intervention;
    }

    /**
     * Get box analytics snapshots
     */
    static async getBoxAnalytics(
        boxId: string,
        period: AnalyticsPeriod = "weekly",
        limit: number = 12
    ) {
        return db
            .select()
            .from(boxAnalytics)
            .where(and(
                eq(boxAnalytics.boxId, boxId),
                eq(boxAnalytics.period, period)
            ))
            .orderBy(desc(boxAnalytics.periodStart))
            .limit(limit);
    }

    /**
     * Get athlete milestones and celebrations
     */
    static async getAthleteMilestones(
        boxId: string,
        membershipId?: string,
        milestoneType?: string,
        limit: number = 10
    ) {
        const conditions = [eq(athleteMilestones.boxId, boxId)];

        if (membershipId) {
            conditions.push(eq(athleteMilestones.membershipId, membershipId));
        }

        if (milestoneType) {
            conditions.push(eq(athleteMilestones.milestoneType, milestoneType));
        }

        return db
            .select()
            .from(athleteMilestones)
            .where(and(...conditions))
            .orderBy(desc(athleteMilestones.achievedAt))
            .limit(limit);
    }

    /**
     * Get comprehensive box health dashboard
     */
    static async getBoxHealthDashboard(
        boxId: string,
        days: number = 30
    ): Promise<BoxHealthMetrics & { dateRange: { start: Date; end: Date } }> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get various metrics in parallel
        const [
            riskDistribution,
            alertStats,
            interventionStats,
            wellnessTrends,
            attendanceTrends,
            performanceTrends
        ] = await Promise.all([
            // Risk distribution - unchanged
            db
                .select({
                    riskLevel: athleteRiskScores.riskLevel,
                    count: count()
                })
                .from(athleteRiskScores)
                .where(and(
                    eq(athleteRiskScores.boxId, boxId),
                    gte(athleteRiskScores.calculatedAt, startDate)
                ))
                .groupBy(athleteRiskScores.riskLevel),

            // Alert statistics - unchanged
            db
                .select({
                    alertType: athleteAlerts.alertType,
                    status: athleteAlerts.status,
                    count: count()
                })
                .from(athleteAlerts)
                .where(and(
                    eq(athleteAlerts.boxId, boxId),
                    gte(athleteAlerts.createdAt, startDate)
                ))
                .groupBy(athleteAlerts.alertType, athleteAlerts.status),

            // Intervention statistics - FIX: Filter out null outcomes
            db
                .select({
                    interventionType: athleteInterventions.interventionType,
                    outcome: athleteInterventions.outcome,
                    count: count()
                })
                .from(athleteInterventions)
                .where(and(
                    eq(athleteInterventions.boxId, boxId),
                    gte(athleteInterventions.interventionDate, startDate),
                    // Add condition to filter out null outcomes
                    sql`${athleteInterventions.outcome} IS NOT NULL`
                ))
                .groupBy(athleteInterventions.interventionType, athleteInterventions.outcome),

            // Wellness trends - FIX: Convert string averages to numbers
            db
                .select({
                    avgEnergy: sql<number>`CAST(AVG(${athleteWellnessCheckins.energyLevel}) AS DECIMAL(10,2))`,
                    avgSleep: sql<number>`CAST(AVG(${athleteWellnessCheckins.sleepQuality}) AS DECIMAL(10,2))`,
                    avgStress: sql<number>`CAST(AVG(${athleteWellnessCheckins.stressLevel}) AS DECIMAL(10,2))`,
                })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),

            // Attendance trends - unchanged
            db
                .select({
                    totalCheckins: count(),
                    uniqueAthletes: count(athleteWellnessCheckins.membershipId),
                })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),

            // Performance trends - FIX: Convert string average to number
            db
                .select({
                    totalPrs: count(),
                    avgImprovement: sql<number>`CAST(AVG(CAST(${athletePrs.value} AS NUMERIC)) AS DECIMAL(10,2))`,
                })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
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
    }

    /**
     * Calculate athlete engagement score
     */
    static async calculateAthleteEngagementScore(
        boxId: string,
        membershipId: string,
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

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
                    eq(athleteWellnessCheckins.boxId, boxId),
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),

            // Personal records
            db
                .select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    eq(athletePrs.membershipId, membershipId),
                    gte(athletePrs.achievedAt, startDate)
                )),

            // Class attendance
            db
                .select({ count: count() })
                .from(wodAttendance)
                .where(and(
                    eq(wodAttendance.boxId, boxId),
                    eq(wodAttendance.membershipId, membershipId),
                    gte(wodAttendance.wodTime, startDate)
                )),

            // Benchmark workouts
            db
                .select({ count: count() })
                .from(athleteBenchmarks)
                .where(and(
                    eq(athleteBenchmarks.boxId, boxId),
                    eq(athleteBenchmarks.membershipId, membershipId),
                    gte(athleteBenchmarks.completedAt, startDate)
                ))
        ]);

        const metrics: AthleteEngagementMetrics = {
            checkins: checkinCount[0].count,
            prs: prCount[0].count,
            attendance: attendanceCount[0].count,
            benchmarks: benchmarkCount[0].count,
        };

        // Calculate engagement score (weighted average)
        const maxPossibleDays = days;
        const checkinScore = (metrics.checkins / maxPossibleDays) * 30; // 30% weight
        const prScore = Math.min(metrics.prs / 5, 1) * 25; // 25% weight (max 5 PRs)
        const attendanceScore = (metrics.attendance / maxPossibleDays) * 35; // 35% weight
        const benchmarkScore = Math.min(metrics.benchmarks / 3, 1) * 10; // 10% weight (max 3 benchmarks)

        const engagementScore = Math.round(
            checkinScore + prScore + attendanceScore + benchmarkScore
        );

        const breakdown: EngagementBreakdown = {
            checkinScore: Math.round(checkinScore),
            prScore: Math.round(prScore),
            attendanceScore: Math.round(attendanceScore),
            benchmarkScore: Math.round(benchmarkScore),
        };

        return {
            score: engagementScore,
            metrics,
            breakdown,
            period: {
                days,
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Get correlation between wellness and performance
     */
    static async getWellnessPerformanceCorrelation(
        boxId: string,
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

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
                eq(athleteWellnessCheckins.boxId, boxId),
                gte(athleteWellnessCheckins.checkinDate, startDate)
            ))
            .limit(1000);

        // Calculate simple correlations
        const energyValues = correlationData.map(d => d.energyLevel);
        const sleepValues = correlationData.map(d => d.sleepQuality);
        const stressValues = correlationData.map(d => d.stressLevel);
        const prValues = correlationData.map(d => d.prValue);

        return {
            energyCorrelation: this.calculateSimpleCorrelation(energyValues, prValues),
            sleepCorrelation: this.calculateSimpleCorrelation(sleepValues, prValues),
            stressCorrelation: this.calculateSimpleCorrelation(stressValues, prValues),
            sampleSize: correlationData.length,
            period: {
                days,
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Calculate simple Pearson correlation coefficient
     */
    private static calculateSimpleCorrelation(x: number[], y: number[]): number {
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
    }
}
