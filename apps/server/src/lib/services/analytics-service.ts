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
    user, userProfiles
} from "@/db/schema";
import {
    mvBoxHealthDashboard,
    vwAthleteRiskOverview,
    mvCoachPerformance,
    mvAthleteEngagementScores,
    vwWellnessPerformanceCorrelation,
    mvMonthlyRetention,
    mvAthleteProgress,
    vwBoxSubscriptionHealth,
    mvWellnessTrends
} from "@/db/schema/views";
import {eq, desc, and, gte, count, sql, inArray} from "drizzle-orm";

// Types for better type safety
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AnalyticsPeriod = "daily" | "weekly" | "monthly";

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

export interface RetentionData {
    boxId: string;
    cohortMonth: Date;
    cohortSize: number;
    activityMonth: Date;
    activeMembers: number;
    retentionRate: number;
    monthsSinceJoin: number;
}

export interface SubscriptionHealth {
    boxId: string;
    boxName: string;
    subscriptionStatus: string;
    subscriptionTier: string;
    trialEndsAt: Date | null;
    subscriptionEndsAt: Date | null;
    polarSubscriptionStatus: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean | null;
    activeAthletes: number;
    activeCoaches: number;
    athleteLimit: number | null;
    coachLimit: number | null;
    healthStatus: string;
}

export interface WellnessTrend {
    boxId: string;
    membershipId: string;
    weekStart: Date;
    avgEnergy: number;
    avgSleep: number;
    avgStress: number;
    avgMotivation: number;
    avgReadiness: number;
    checkinCount: number;
}

export class AnalyticsService {
    /**
     * Get at-risk athletes for a box - Using vw_athlete_risk_overview
     */
    static async getAtRiskAthletes(
        boxId: string,
        riskLevel?: RiskLevel,
        limit: number = 20
    ) {
        const conditions = [eq(vwAthleteRiskOverview.boxId, boxId)];

        if (riskLevel) {
            conditions.push(eq(vwAthleteRiskOverview.riskLevel, riskLevel));
        }

        return db
            .select()
            .from(vwAthleteRiskOverview)
            .where(and(...conditions))
            .orderBy(desc(vwAthleteRiskOverview.overallRiskScore))
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
     * Get detailed athlete information with risk scores - Using vw_athlete_risk_overview
     */
    static async getAthletesWithRiskScores(
        boxId: string,
        riskLevel?: RiskLevel,
        limit: number = 50
    ) {
        const conditions = [eq(vwAthleteRiskOverview.boxId, boxId)];

        if (riskLevel) {
            conditions.push(eq(vwAthleteRiskOverview.riskLevel, riskLevel));
        }

        return db
            .select()
            .from(vwAthleteRiskOverview)
            .where(and(...conditions))
            .orderBy(desc(vwAthleteRiskOverview.overallRiskScore))
            .limit(limit);
    }

    /**
     * Get athlete engagement leaderboard for a box - Using mv_athlete_engagement_scores
     */
    static async getEngagementLeaderboard(
        boxId: string,
        days: number = 30,
        limit: number = 20
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return db
            .select()
            .from(mvAthleteEngagementScores)
            .where(and(
                eq(mvAthleteEngagementScores.boxId, boxId),
                gte(mvAthleteEngagementScores.calculatedAt, startDate)
            ))
            .orderBy(desc(mvAthleteEngagementScores.engagementScore))
            .limit(limit);
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
     * Get coach performance metrics - Using mv_coach_performance
     */
    static async getCoachPerformance(boxId: string) {
        return db
            .select()
            .from(mvCoachPerformance)
            .where(eq(mvCoachPerformance.boxId, boxId))
            .orderBy(desc(mvCoachPerformance.successfulInterventions));
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
     * Get comprehensive box health dashboard - Using mv_box_health_dashboard
     */
    static async getBoxHealthDashboard(
        boxId: string,
        days: number = 30
    ): Promise<BoxHealthMetrics & { dateRange: { start: Date; end: Date } }> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get the latest dashboard data
        const dashboardData = await db
            .select()
            .from(mvBoxHealthDashboard)
            .where(and(
                eq(mvBoxHealthDashboard.boxId, boxId),
                gte(mvBoxHealthDashboard.periodStart, startDate)
            ))
            .orderBy(desc(mvBoxHealthDashboard.periodStart))
            .limit(1);

        if (!dashboardData[0]) {
            // Return empty metrics if no data found
            return {
                riskDistribution: [],
                alertStats: [],
                interventionStats: [],
                wellnessTrends: { avgEnergy: null, avgSleep: null, avgStress: null },
                attendanceTrends: { totalCheckins: 0, uniqueAthletes: 0 },
                performanceTrends: { totalPrs: 0, avgImprovement: null },
                dateRange: { start: startDate, end: new Date() }
            };
        }

        const data = dashboardData[0];

        // Get additional stats that aren't in the materialized view
        const [riskDistribution, alertStats, interventionStats] = await Promise.all([
            // Risk distribution
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

            // Alert statistics
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

            // Intervention statistics - Filter out null outcomes
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
                    sql`${athleteInterventions.outcome} IS NOT NULL`
                ))
                .groupBy(athleteInterventions.interventionType, athleteInterventions.outcome),
        ]);

        return {
            riskDistribution,
            alertStats,
            interventionStats,
            wellnessTrends: {
                avgEnergy: data.avgEnergy ? parseFloat(data.avgEnergy) : null,
                avgSleep: data.avgSleep ? parseFloat(data.avgSleep) : null,
                avgStress: data.avgStress ? parseFloat(data.avgStress) : null,
            },
            attendanceTrends: {
                totalCheckins: data.totalCheckins || 0,
                uniqueAthletes: data.uniqueAthletes || 0,
            },
            performanceTrends: {
                totalPrs: data.totalPrs || 0,
                avgImprovement: data.avgImprovement ? parseFloat(data.avgImprovement) : null,
            },
            dateRange: {
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Calculate athlete engagement score - Using mv_athlete_engagement_scores
     */
    static async calculateAthleteEngagementScore(
        boxId: string,
        membershipId: string,
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get engagement data from materialized view
        const engagementData = await db
            .select()
            .from(mvAthleteEngagementScores)
            .where(and(
                eq(mvAthleteEngagementScores.boxId, boxId),
                eq(mvAthleteEngagementScores.membershipId, membershipId),
                gte(mvAthleteEngagementScores.calculatedAt, startDate)
            ))
            .orderBy(desc(mvAthleteEngagementScores.calculatedAt))
            .limit(1);

        if (!engagementData[0]) {
            return {
                score: 0,
                metrics: { checkins: 0, prs: 0, attendance: 0, benchmarks: 0 },
                breakdown: { checkinScore: 0, prScore: 0, attendanceScore: 0, benchmarkScore: 0 },
                period: { days, start: startDate, end: new Date() }
            };
        }

        const data = engagementData[0];

        // Provide default values for potentially null fields
        const checkinCount = data.checkinCount || 0;
        const prCount = data.prCount || 0;
        const attendanceCount = data.attendanceCount || 0;
        const benchmarkCount = data.benchmarkCount || 0;
        const engagementScore = data.engagementScore || 0;

        return {
            score: engagementScore,
            metrics: {
                checkins: checkinCount,
                prs: prCount,
                attendance: attendanceCount,
                benchmarks: benchmarkCount,
            },
            breakdown: {
                checkinScore: Math.round((checkinCount / days) * 30),
                prScore: Math.round(Math.min(prCount / 5, 1) * 25),
                attendanceScore: Math.round((attendanceCount / days) * 35),
                benchmarkScore: Math.round(Math.min(benchmarkCount / 3, 1) * 10),
            },
            period: {
                days,
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Get correlation between wellness and performance - Using vw_wellness_performance_correlation
     */
    static async getWellnessPerformanceCorrelation(
        boxId: string,
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const correlationData = await db
            .select()
            .from(vwWellnessPerformanceCorrelation)
            .where(and(
                eq(vwWellnessPerformanceCorrelation.boxId, boxId)
            ));

        // Handle potential null values
        const energyCorrelation = correlationData[0]?.energyPrCorrelation ?
            parseFloat(correlationData[0].energyPrCorrelation) : 0;
        const sleepCorrelation = correlationData[0]?.sleepPrCorrelation ?
            parseFloat(correlationData[0].sleepPrCorrelation) : 0;
        const stressCorrelation = correlationData[0]?.stressPrCorrelation ?
            parseFloat(correlationData[0].stressPrCorrelation) : 0;
        const dataPoints = correlationData[0]?.dataPoints || 0;

        return {
            energyCorrelation,
            sleepCorrelation,
            stressCorrelation,
            sampleSize: dataPoints,
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

    /**
     * Get monthly retention cohort analysis - Using mv_monthly_retention
     */
    static async getMonthlyRetention(
        boxId: string,
        months: number = 12
    ): Promise<RetentionData[]> {
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);

        const retentionData = await db
            .select()
            .from(mvMonthlyRetention)
            .where(and(
                eq(mvMonthlyRetention.boxId, boxId),
                gte(mvMonthlyRetention.cohortMonth, startDate)
            ))
            .orderBy(desc(mvMonthlyRetention.cohortMonth), desc(mvMonthlyRetention.activityMonth));

        // Transform the data to ensure no null values
        return retentionData.map(item => ({
            boxId: item.boxId || boxId,
            cohortMonth: item.cohortMonth || new Date(),
            cohortSize: item.cohortSize || 0,
            activityMonth: item.activityMonth || new Date(),
            activeMembers: item.activeMembers || 0,
            retentionRate: item.retentionRate ? parseFloat(item.retentionRate) : 0,
            monthsSinceJoin: item.monthsSinceJoin || 0
        }));
    }

    /**
     * Get athlete progress timeline - Using mv_athlete_progress
     */
    static async getAthleteProgressTimeline(
        boxId: string,
        membershipId: string,
        limit: number = 50
    ) {
        return db
            .select()
            .from(mvAthleteProgress)
            .where(and(
                eq(mvAthleteProgress.boxId, boxId),
                eq(mvAthleteProgress.membershipId, membershipId)
            ))
            .orderBy(desc(mvAthleteProgress.eventDate))
            .limit(limit);
    }

    /**
     * Get box subscription health - Using vw_box_subscription_health
     */
    static async getBoxSubscriptionHealth(boxId: string): Promise<SubscriptionHealth | null> {
        const result = await db
            .select()
            .from(vwBoxSubscriptionHealth)
            .where(eq(vwBoxSubscriptionHealth.boxId, boxId))
            .limit(1);

        if (!result[0]) return null;

        const item = result[0];
        return {
            boxId: item.boxId || boxId,
            boxName: item.boxName || '',
            subscriptionStatus: item.subscriptionStatus || 'unknown',
            subscriptionTier: item.subscriptionTier || 'unknown',
            trialEndsAt: item.trialEndsAt,
            subscriptionEndsAt: item.subscriptionEndsAt,
            polarSubscriptionStatus: item.polarSubscriptionStatus,
            currentPeriodEnd: item.currentPeriodEnd,
            cancelAtPeriodEnd: item.cancelAtPeriodEnd,
            activeAthletes: item.activeAthletes || 0,
            activeCoaches: item.activeCoaches || 0,
            athleteLimit: item.athleteLimit,
            coachLimit: item.coachLimit,
            healthStatus: item.healthStatus || 'unknown'
        };
    }

    /**
     * Get wellness trends over time - Using mv_wellness_trends
     */
    static async getWellnessTrends(
        boxId: string,
        membershipId: string,
        weeks: number = 12
    ): Promise<WellnessTrend[]> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (weeks * 7));

        const wellnessData = await db
            .select()
            .from(mvWellnessTrends)
            .where(and(
                eq(mvWellnessTrends.boxId, boxId),
                eq(mvWellnessTrends.membershipId, membershipId),
                gte(mvWellnessTrends.weekStart, startDate)
            ))
            .orderBy(desc(mvWellnessTrends.weekStart));

        // Transform the data to ensure no null values
        return wellnessData.map(item => ({
            boxId: item.boxId || boxId,
            membershipId: item.membershipId || membershipId,
            weekStart: item.weekStart || new Date(),
            avgEnergy: item.avgEnergy ? parseFloat(item.avgEnergy) : 0,
            avgSleep: item.avgSleep ? parseFloat(item.avgSleep) : 0,
            avgStress: item.avgStress ? parseFloat(item.avgStress) : 0,
            avgMotivation: item.avgMotivation ? parseFloat(item.avgMotivation) : 0,
            avgReadiness: item.avgReadiness ? parseFloat(item.avgReadiness) : 0,
            checkinCount: item.checkinCount || 0
        }));
    }

    /**
     * Get recent activity feed (simple query - no view needed)
     */
    static async getRecentActivityFeed(
        boxId: string,
        limit: number = 50
    ) {
        const prs = await db
            .select({
                type: sql`'pr'`.as('type'),
                date: athletePrs.achievedAt,
                membershipId: athletePrs.membershipId,
                boxId: athletePrs.boxId,
                description: sql`'PR Set'`.as('description')
            })
            .from(athletePrs)
            .where(eq(athletePrs.boxId, boxId))
            .orderBy(desc(athletePrs.achievedAt))
            .limit(limit);

        const benchmarks = await db
            .select({
                type: sql`'benchmark'`.as('type'),
                date: athleteBenchmarks.updatedAt,
                membershipId: athleteBenchmarks.membershipId,
                boxId: athleteBenchmarks.boxId,
                description: sql`'Benchmark Completed'`.as('description')
            })
            .from(athleteBenchmarks)
            .where(eq(athleteBenchmarks.boxId, boxId))
            .orderBy(desc(athleteBenchmarks.updatedAt))
            .limit(limit);

        const checkins = await db
            .select({
                type: sql`'checkin'`.as('type'),
                date: athleteWellnessCheckins.checkinDate,
                membershipId: athleteWellnessCheckins.membershipId,
                boxId: athleteWellnessCheckins.boxId,
                description: sql`'Wellness Checkin'`.as('description')
            })
            .from(athleteWellnessCheckins)
            .where(eq(athleteWellnessCheckins.boxId, boxId))
            .orderBy(desc(athleteWellnessCheckins.checkinDate))
            .limit(limit);

        // Combine and sort all activities
        const allActivities = [...prs, ...benchmarks, ...checkins];
        allActivities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return allActivities.slice(0, limit);
    }

    /**
     * Get basic box statistics (simple query - no view needed)
     */
    static async getBasicBoxStatistics(boxId: string) {
        const stats = await db
            .select({
                activeAthletes: sql<number>`
                    COUNT(CASE 
                        WHEN ${boxMemberships.role} = 'athlete' 
                        AND ${boxMemberships.isActive} = true 
                        THEN 1 
                    END)`
                ,
                activeCoaches: sql<number>`
                    COUNT(CASE 
                        WHEN ${boxMemberships.role} IN ('head_coach', 'coach') 
                        AND ${boxMemberships.isActive} = true 
                        THEN 1 
                    END)`
                ,
                newMembers30d: sql<number>`
                    COUNT(CASE 
                        WHEN ${boxMemberships.joinedAt} >= NOW() - INTERVAL '30 days' 
                        THEN 1 
                    END)`
                ,
                avgCheckinStreak: sql<number>`
                    COALESCE(AVG(
                        CASE 
                            WHEN ${boxMemberships.role} = 'athlete'
                    THEN ${boxMemberships.checkinStreak}
                    END
                    ), 0)`
            })
            .from(boxMemberships)
            .where(eq(boxMemberships.boxId, boxId));

        return {
            activeAthletes: stats[0]?.activeAthletes || 0,
            activeCoaches: stats[0]?.activeCoaches || 0,
            newMembers30d: stats[0]?.newMembers30d || 0,
            avgCheckinStreak: stats[0]?.avgCheckinStreak || 0
        };
    }

    /**
     * Get recent interventions (simple query - no view needed)
     */
    static async getRecentInterventions(
        boxId: string,
        limit: number = 20
    ) {
        return db
            .select()
            .from(athleteInterventions)
            .where(eq(athleteInterventions.boxId, boxId))
            .orderBy(desc(athleteInterventions.interventionDate))
            .limit(limit);
    }
}
