// src/lib/services/analytics/calculations/coach-performance-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteInterventions,
    athleteRiskScores,
    athleteAlerts,
    athletePrs,
    athleteBenchmarks,
    coachPerformanceMetrics,
    wodAttendance
} from "@/db/schema";
import { eq, and, gte, lte, count, sql } from "drizzle-orm";

export interface CoachPerformanceMetricsData {
    boxId: string;
    coachMembershipId: string;
    coachName: string;
    periodStart: Date;
    periodEnd: Date;
    athletesAssigned: number;
    athletesActive: number;
    avgRiskScoreReduction: number | null;
    interventionsCompleted: number;
    interventionsWithOutcome: number;
    alertsReceived: number;
    alertsResolved: number;
    avgTimeToAlertResolution: number | null;
    athleteRetentionRate: number | null;
    athletePrImprovementRate: number | null;
    athleteAttendanceImpact: number | null;
    engagementScore: number;
    effectivenessScore: number;
    calculatedAt: Date;
    version: string;
}

interface CoachAssignment {
    coachMembershipId: string;
    athleteMembershipId: string;
    assignedAt: Date;
    isActive: boolean;
}

/**
 * Get coach assignments (for now, we'll infer from intervention history and alert assignments)
 * In a full implementation, you'd have a dedicated coach-athlete assignment table
 */
async function getCoachAssignments(boxId: string, periodStart: Date, periodEnd: Date): Promise<CoachAssignment[]> {
    // Get coaches who have conducted interventions or been assigned alerts in the period
    const coachInteractionData = await db
        .select({
            coachMembershipId: athleteInterventions.coachId,
            athleteMembershipId: athleteInterventions.membershipId,
            lastInteraction: sql<Date>`MAX(${athleteInterventions.interventionDate})`
        })
        .from(athleteInterventions)
        .innerJoin(boxMemberships, eq(athleteInterventions.coachId, boxMemberships.id))
        .where(and(
            eq(athleteInterventions.boxId, boxId),
            gte(athleteInterventions.interventionDate, periodStart),
            lte(athleteInterventions.interventionDate, periodEnd),
            eq(boxMemberships.isActive, true),
            sql`${boxMemberships.role} IN ('coach', 'head_coach', 'owner')`
        ))
        .groupBy(athleteInterventions.coachId, athleteInterventions.membershipId);

    // Also get alert assignments (assuming coaches are assigned to handle specific athletes' alerts)
    const alertAssignments = await db
        .select({
            coachMembershipId: athleteAlerts.assignedCoachId, // Changed from assignedToId
            athleteMembershipId: athleteAlerts.membershipId,
            lastAlert: sql<Date>`MAX(${athleteAlerts.createdAt})` // Using createdAt instead of triggeredAt
        })
        .from(athleteAlerts)
        .where(and(
            eq(athleteAlerts.boxId, boxId),
            gte(athleteAlerts.createdAt, periodStart),
            lte(athleteAlerts.createdAt, periodEnd),
            sql`${athleteAlerts.assignedCoachId} IS NOT NULL` // Changed from assignedToId
        ))
        .groupBy(athleteAlerts.assignedCoachId, athleteAlerts.membershipId); // Changed from assignedToId

    // Combine and deduplicate assignments
    const assignmentMap = new Map<string, CoachAssignment>();

    coachInteractionData.forEach(item => {
        const key = `${item.coachMembershipId}-${item.athleteMembershipId}`;
        assignmentMap.set(key, {
            coachMembershipId: item.coachMembershipId,
            athleteMembershipId: item.athleteMembershipId,
            assignedAt: item.lastInteraction,
            isActive: true
        });
    });

    alertAssignments.forEach(item => {
        if (!item.coachMembershipId) return;
        const key = `${item.coachMembershipId}-${item.athleteMembershipId}`;
        if (!assignmentMap.has(key)) {
            assignmentMap.set(key, {
                coachMembershipId: item.coachMembershipId,
                athleteMembershipId: item.athleteMembershipId,
                assignedAt: item.lastAlert,
                isActive: true
            });
        }
    });

    return Array.from(assignmentMap.values());
}

/**
 * Calculate risk score changes for athletes assigned to a coach
 */
async function calculateRiskScoreImpact(
    coachMembershipId: string,
    athleteMembershipIds: string[],
    periodStart: Date,
    periodEnd: Date
): Promise<number | null> {
    if (athleteMembershipIds.length === 0) return null;

    // Get risk scores before and during the period
    const riskScoreChanges = await db
        .select({
            membershipId: athleteRiskScores.membershipId,
            firstScore: sql<number>`MIN(CAST(${athleteRiskScores.overallRiskScore} AS DECIMAL))`,
            lastScore: sql<number>`MAX(CAST(${athleteRiskScores.overallRiskScore} AS DECIMAL))`,
            scoreCount: count()
        })
        .from(athleteRiskScores)
        .where(and(
            sql`${athleteRiskScores.membershipId} = ANY(${athleteMembershipIds})`,
            gte(athleteRiskScores.calculatedAt, periodStart),
            lte(athleteRiskScores.calculatedAt, periodEnd)
        ))
        .groupBy(athleteRiskScores.membershipId)
        .having(sql`COUNT(*) >= 2`); // Need at least 2 scores to calculate change

    if (riskScoreChanges.length === 0) return null;

    const totalReduction = riskScoreChanges.reduce((sum, athlete) => {
        return sum + (athlete.firstScore - athlete.lastScore); // Positive means risk reduced
    }, 0);

    return Math.round((totalReduction / riskScoreChanges.length) * 100) / 100;
}

/**
 * Calculate athlete retention rate for a coach's assigned athletes
 */
async function calculateAthleteRetentionRate(
    athleteMembershipIds: string[],
    periodStart: Date,
    periodEnd: Date
): Promise<number | null> {
    if (athleteMembershipIds.length === 0) return null;

    const retentionData = await db
        .select({
            membershipId: boxMemberships.id,
            isActive: boxMemberships.isActive,
            leftAt: boxMemberships.leftAt
        })
        .from(boxMemberships)
        .where(sql`${boxMemberships.id} = ANY(${athleteMembershipIds})`);

    const totalAthletes = retentionData.length;
    const retainedAthletes = retentionData.filter(athlete =>
        athlete.isActive ||
        !athlete.leftAt ||
        athlete.leftAt > periodEnd
    ).length;

    return Math.round((retainedAthletes / totalAthletes) * 10000) / 100;
}

/**
 * Calculate PR improvement rate for a coach's assigned athletes
 */
async function calculatePrImprovementRate(
    athleteMembershipIds: string[],
    boxId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<number | null> {
    if (athleteMembershipIds.length === 0) return null;

    // Count athletes with PRs or benchmarks in the period
    const [prAthletes, benchmarkAthletes] = await Promise.all([
        db.selectDistinct({
            membershipId: athletePrs.membershipId
        })
            .from(athletePrs)
            .where(and(
                eq(athletePrs.boxId, boxId),
                sql`${athletePrs.membershipId} = ANY(${athleteMembershipIds})`,
                gte(athletePrs.achievedAt, periodStart),
                lte(athletePrs.achievedAt, periodEnd)
            )),

        db.selectDistinct({
            membershipId: athleteBenchmarks.membershipId
        })
            .from(athleteBenchmarks)
            .where(and(
                eq(athleteBenchmarks.boxId, boxId),
                sql`${athleteBenchmarks.membershipId} = ANY(${athleteMembershipIds})`,
                gte(athleteBenchmarks.achievedAt, periodStart),
                lte(athleteBenchmarks.achievedAt, periodEnd)
            ))
    ]);

    const athletesWithPrs = new Set([
        ...prAthletes.map(a => a.membershipId),
        ...benchmarkAthletes.map(a => a.membershipId)
    ]);

    return Math.round((athletesWithPrs.size / athleteMembershipIds.length) * 10000) / 100;
}

/**
 * Calculate attendance impact for a coach's assigned athletes
 */
async function calculateAttendanceImpact(
    athleteMembershipIds: string[],
    boxId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<number | null> {
    if (athleteMembershipIds.length === 0) return null;

    // Calculate average attendance rate for assigned athletes
    const attendanceData = await db
        .select({
            membershipId: wodAttendance.membershipId,
            attendedCount: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            totalScheduled: count()
        })
        .from(wodAttendance)
        .where(and(
            eq(wodAttendance.boxId, boxId),
            sql`${wodAttendance.membershipId} = ANY(${athleteMembershipIds})`,
            gte(wodAttendance.attendanceDate, sql`${periodStart}::date`),
            lte(wodAttendance.attendanceDate, sql`${periodEnd}::date`)
        ))
        .groupBy(wodAttendance.membershipId);

    if (attendanceData.length === 0) return null;

    const avgAttendanceRate = attendanceData.reduce((sum, athlete) => {
        const rate = athlete.totalScheduled > 0 ? (athlete.attendedCount / athlete.totalScheduled) * 100 : 0;
        return sum + rate;
    }, 0) / attendanceData.length;

    return Math.round(avgAttendanceRate * 100) / 100;
}

/**
 * Calculate comprehensive coach performance metrics
 */
export async function calculateCoachPerformanceMetrics(
    boxId: string,
    coachMembershipId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<CoachPerformanceMetricsData | null> {
    // Get coach information
    const coach = await db.select({
        id: boxMemberships.id,
        displayName: boxMemberships.displayName,
        role: boxMemberships.role
    })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.id, coachMembershipId),
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.isActive, true),
            sql`${boxMemberships.role} IN ('coach', 'head_coach', 'owner')`
        ))
        .limit(1);

    if (!coach[0]) {
        return null;
    }

    // Get coach assignments for this period
    const allAssignments = await getCoachAssignments(boxId, periodStart, periodEnd);
    const coachAssignments = allAssignments.filter(a => a.coachMembershipId === coachMembershipId);
    const athleteMembershipIds = coachAssignments.map(a => a.athleteMembershipId);

    // Get interventions data
    const interventionsData = await db
        .select({
            id: athleteInterventions.id,
            outcome: athleteInterventions.outcome,
            interventionDate: athleteInterventions.interventionDate
        })
        .from(athleteInterventions)
        .where(and(
            eq(athleteInterventions.boxId, boxId),
            eq(athleteInterventions.coachId, coachMembershipId),
            gte(athleteInterventions.interventionDate, periodStart),
            lte(athleteInterventions.interventionDate, periodEnd)
        ));

    // Get alerts data
    const alertsData = await db
        .select({
            id: athleteAlerts.id,
            status: athleteAlerts.status,
            createdAt: athleteAlerts.createdAt, // Using createdAt instead of triggeredAt
            resolvedAt: athleteAlerts.resolvedAt
        })
        .from(athleteAlerts)
        .where(and(
            eq(athleteAlerts.boxId, boxId),
            eq(athleteAlerts.assignedCoachId, coachMembershipId), // Changed from assignedToId
            gte(athleteAlerts.createdAt, periodStart),
            lte(athleteAlerts.createdAt, periodEnd)
        ));

    // Calculate metrics
    const athletesAssigned = coachAssignments.length;

    // Count active athletes (those still active in the box)
    const activeAthletes = await db
        .select({ count: count() })
        .from(boxMemberships)
        .where(and(
            sql`${boxMemberships.id} = ANY(${athleteMembershipIds})`,
            eq(boxMemberships.isActive, true)
        ));

    const athletesActive = activeAthletes[0]?.count ?? 0;

    const interventionsCompleted = interventionsData.length;
    const interventionsWithOutcome = interventionsData.filter(i => i.outcome).length;

    const alertsReceived = alertsData.length;
    const alertsResolved = alertsData.filter(a => a.status === 'resolved').length;

    // Calculate average time to alert resolution
    const resolvedAlerts = alertsData.filter(a => a.resolvedAt);
    const avgTimeToAlertResolution = resolvedAlerts.length > 0
        ? resolvedAlerts.reduce((sum, alert) => {
        const hours = (alert.resolvedAt!.getTime() - alert.createdAt.getTime()) / (1000 * 60 * 60);
        return sum + hours;
    }, 0) / resolvedAlerts.length
        : null;

    // Calculate derived metrics
    const [
        avgRiskScoreReduction,
        athleteRetentionRate,
        athletePrImprovementRate,
        athleteAttendanceImpact
    ] = await Promise.all([
        calculateRiskScoreImpact(coachMembershipId, athleteMembershipIds, periodStart, periodEnd),
        calculateAthleteRetentionRate(athleteMembershipIds, periodStart, periodEnd),
        calculatePrImprovementRate(athleteMembershipIds, boxId, periodStart, periodEnd),
        calculateAttendanceImpact(athleteMembershipIds, boxId, periodStart, periodEnd)
    ]);

    // Calculate engagement score (0-100)
    let engagementScore = 0;
    if (athletesAssigned > 0) {
        const interventionRate = interventionsCompleted / athletesAssigned;
        const alertResponseRate = alertsReceived > 0 ? alertsResolved / alertsReceived : 1;
        engagementScore = Math.min(100, (interventionRate * 40) + (alertResponseRate * 60));
    }

    // Calculate effectiveness score (0-100)
    let effectivenessScore = 0;
    const scores: number[] = [];

    if (avgRiskScoreReduction !== null) {
        scores.push(Math.max(0, Math.min(100, 50 + (avgRiskScoreReduction * 2))));
    }
    if (athleteRetentionRate !== null) {
        scores.push(athleteRetentionRate);
    }
    if (athletePrImprovementRate !== null) {
        scores.push(athletePrImprovementRate);
    }
    if (athleteAttendanceImpact !== null) {
        scores.push(Math.min(100, athleteAttendanceImpact));
    }

    if (scores.length > 0) {
        effectivenessScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    }

    return {
        boxId,
        coachMembershipId,
        coachName: coach[0].displayName,
        periodStart,
        periodEnd,
        athletesAssigned,
        athletesActive,
        avgRiskScoreReduction: avgRiskScoreReduction ? Math.round(avgRiskScoreReduction * 100) / 100 : null,
        interventionsCompleted,
        interventionsWithOutcome,
        alertsReceived,
        alertsResolved,
        avgTimeToAlertResolution: avgTimeToAlertResolution ? Math.round(avgTimeToAlertResolution * 100) / 100 : null,
        athleteRetentionRate,
        athletePrImprovementRate,
        athleteAttendanceImpact,
        engagementScore: Math.round(engagementScore * 100) / 100,
        effectivenessScore: Math.round(effectivenessScore * 100) / 100,
        calculatedAt: new Date(),
        version: '1.0'
    };
}

/**
 * Process coach performance metrics for all coaches in a box
 */
export async function processCoachPerformanceMetrics(
    boxId: string,
    lookbackDays: number = 30
) {
    try {
        const periodEnd = new Date();
        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - lookbackDays);

        console.log(`[Analytics] Calculating coach performance metrics for box ${boxId}`);
        console.log(`[Analytics] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

        // Get all coaches in the box
        const coaches = await db
            .select({
                id: boxMemberships.id,
                displayName: boxMemberships.displayName,
                role: boxMemberships.role
            })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                sql`${boxMemberships.role} IN ('coach', 'head_coach', 'owner')`
            ));

        console.log(`[Analytics] Found ${coaches.length} coaches for box ${boxId}`);

        const results = [];

        for (const coach of coaches) {
            const metrics = await calculateCoachPerformanceMetrics(
                boxId,
                coach.id,
                periodStart,
                periodEnd
            );

            if (metrics) {
                // Upsert to database
                await db.insert(coachPerformanceMetrics).values({
                    boxId: metrics.boxId,
                    coachMembershipId: metrics.coachMembershipId,
                    periodStart: metrics.periodStart,
                    periodEnd: metrics.periodEnd,
                    athletesAssigned: metrics.athletesAssigned,
                    athletesActive: metrics.athletesActive,
                    avgRiskScoreReduction: metrics.avgRiskScoreReduction?.toString() ?? null,
                    interventionsCompleted: metrics.interventionsCompleted,
                    interventionsWithOutcome: metrics.interventionsWithOutcome,
                    alertsReceived: metrics.alertsReceived,
                    alertsResolved: metrics.alertsResolved,
                    avgTimeToAlertResolution: metrics.avgTimeToAlertResolution?.toString() ?? null,
                    athleteRetentionRate: metrics.athleteRetentionRate?.toString() ?? null,
                    athletePrImprovementRate: metrics.athletePrImprovementRate?.toString() ?? null,
                    athleteAttendanceImpact: metrics.athleteAttendanceImpact?.toString() ?? null,
                    engagementScore: metrics.engagementScore.toString(),
                    effectivenessScore: metrics.effectivenessScore.toString(),
                    calculatedAt: metrics.calculatedAt,
                    version: metrics.version
                })
                    .onConflictDoUpdate({
                        target: [
                            coachPerformanceMetrics.boxId,
                            coachPerformanceMetrics.coachMembershipId,
                            coachPerformanceMetrics.periodStart
                        ],
                        set: {
                            athletesAssigned: metrics.athletesAssigned,
                            athletesActive: metrics.athletesActive,
                            avgRiskScoreReduction: metrics.avgRiskScoreReduction?.toString() ?? null,
                            interventionsCompleted: metrics.interventionsCompleted,
                            interventionsWithOutcome: metrics.interventionsWithOutcome,
                            alertsReceived: metrics.alertsReceived,
                            alertsResolved: metrics.alertsResolved,
                            avgTimeToAlertResolution: metrics.avgTimeToAlertResolution?.toString() ?? null,
                            athleteRetentionRate: metrics.athleteRetentionRate?.toString() ?? null,
                            athletePrImprovementRate: metrics.athletePrImprovementRate?.toString() ?? null,
                            athleteAttendanceImpact: metrics.athleteAttendanceImpact?.toString() ?? null,
                            engagementScore: metrics.engagementScore.toString(),
                            effectivenessScore: metrics.effectivenessScore.toString(),
                            calculatedAt: metrics.calculatedAt,
                            periodEnd: metrics.periodEnd
                        }
                    });

                results.push(metrics);

                console.log(`[Analytics] Updated metrics for coach ${metrics.coachName}: ${metrics.athletesAssigned} athletes, ${metrics.interventionsCompleted} interventions, effectiveness score: ${metrics.effectivenessScore}`);
            }
        }

        console.log(`[Analytics] Successfully processed coach performance metrics for ${results.length} coaches in box ${boxId}`);

        return {
            boxId,
            coachesProcessed: results.length,
            totalMetrics: results.length,
            avgEffectivenessScore: results.length > 0
                ? Math.round(results.reduce((sum, r) => sum + r.effectivenessScore, 0) / results.length * 100) / 100
                : 0,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing coach performance metrics for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Get coach performance rankings for a box
 */
export async function getCoachPerformanceRankings(
    boxId: string,
    lookbackDays: number = 30
): Promise<{
    rankings: Array<{
        coachMembershipId: string;
        coachName: string;
        effectivenessScore: number;
        engagementScore: number;
        athletesAssigned: number;
        interventionsCompleted: number;
        alertsResolved: number;
        rank: number;
    }>;
    avgBoxEffectiveness: number;
    topPerformer: string | null;
}> {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - lookbackDays);

    const metrics = await db
        .select({
            coachMembershipId: coachPerformanceMetrics.coachMembershipId,
            effectivenessScore: coachPerformanceMetrics.effectivenessScore,
            engagementScore: coachPerformanceMetrics.engagementScore,
            athletesAssigned: coachPerformanceMetrics.athletesAssigned,
            interventionsCompleted: coachPerformanceMetrics.interventionsCompleted,
            alertsResolved: coachPerformanceMetrics.alertsResolved,
            coachName: boxMemberships.displayName
        })
        .from(coachPerformanceMetrics)
        .innerJoin(boxMemberships, eq(coachPerformanceMetrics.coachMembershipId, boxMemberships.id))
        .where(and(
            eq(coachPerformanceMetrics.boxId, boxId),
            gte(coachPerformanceMetrics.periodStart, periodStart)
        ))
        .orderBy(sql`CAST(${coachPerformanceMetrics.effectivenessScore} AS DECIMAL) DESC`);

    const rankings = metrics.map((metric, index) => ({
        coachMembershipId: metric.coachMembershipId,
        coachName: metric.coachName,
        effectivenessScore: Number(metric.effectivenessScore),
        engagementScore: Number(metric.engagementScore),
        athletesAssigned: metric.athletesAssigned,
        interventionsCompleted: metric.interventionsCompleted,
        alertsResolved: metric.alertsResolved,
        rank: index + 1
    }));

    const avgBoxEffectiveness = rankings.length > 0
        ? Math.round(rankings.reduce((sum, r) => sum + r.effectivenessScore, 0) / rankings.length * 100) / 100
        : 0;

    const topPerformer = rankings.length > 0 ? rankings[0].coachName : null;

    return {
        rankings,
        avgBoxEffectiveness,
        topPerformer
    };
}

/**
 * Get coach performance trends over time
 */
export async function getCoachPerformanceTrends(
    coachMembershipId: string,
    boxId: string,
    lookbackDays: number = 90
): Promise<{
    trends: Array<{
        periodStart: Date;
        effectivenessScore: number;
        engagementScore: number;
        athletesAssigned: number;
        interventionsCompleted: number;
    }>;
    overallTrend: 'improving' | 'declining' | 'stable';
    avgImprovement: number;
}> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const trends = await db
        .select({
            periodStart: coachPerformanceMetrics.periodStart,
            effectivenessScore: coachPerformanceMetrics.effectivenessScore,
            engagementScore: coachPerformanceMetrics.engagementScore,
            athletesAssigned: coachPerformanceMetrics.athletesAssigned,
            interventionsCompleted: coachPerformanceMetrics.interventionsCompleted
        })
        .from(coachPerformanceMetrics)
        .where(and(
            eq(coachPerformanceMetrics.boxId, boxId),
            eq(coachPerformanceMetrics.coachMembershipId, coachMembershipId),
            gte(coachPerformanceMetrics.periodStart, cutoffDate)
        ))
        .orderBy(coachPerformanceMetrics.periodStart);

    const trendData = trends.map(trend => ({
        periodStart: trend.periodStart,
        effectivenessScore: Number(trend.effectivenessScore),
        engagementScore: Number(trend.engagementScore),
        athletesAssigned: trend.athletesAssigned,
        interventionsCompleted: trend.interventionsCompleted
    }));

    let overallTrend: 'improving' | 'declining' | 'stable' = 'stable';
    let avgImprovement = 0;

    if (trendData.length >= 2) {
        const firstScore = trendData[0].effectivenessScore;
        const lastScore = trendData[trendData.length - 1].effectivenessScore;
        avgImprovement = lastScore - firstScore;

        if (avgImprovement > 5) overallTrend = 'improving';
        else if (avgImprovement < -5) overallTrend = 'declining';
    }

    return {
        trends: trendData,
        overallTrend,
        avgImprovement: Math.round(avgImprovement * 100) / 100
    };
}

/**
 * Get intervention effectiveness analysis by coach
 */
export async function getCoachInterventionAnalysis(
    coachMembershipId: string,
    boxId: string,
    lookbackDays: number = 60
): Promise<{
    totalInterventions: number;
    interventionTypes: { [key: string]: { count: number; successRate: number } };
    avgTimeToResolution: number | null;
    mostEffectiveType: string | null;
    recommendedFocus: string[];
}> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const interventions = await db
        .select({
            id: athleteInterventions.id,
            interventionType: athleteInterventions.interventionType,
            outcome: athleteInterventions.outcome,
            interventionDate: athleteInterventions.interventionDate,
            followUpCompleted: athleteInterventions.followUpCompleted
        })
        .from(athleteInterventions)
        .where(and(
            eq(athleteInterventions.boxId, boxId),
            eq(athleteInterventions.coachId, coachMembershipId),
            gte(athleteInterventions.interventionDate, cutoffDate)
        ));

    const totalInterventions = interventions.length;
    const interventionTypes: { [key: string]: { count: number; successRate: number } } = {};

    interventions.forEach(intervention => {
        const type = intervention.interventionType;
        if (!interventionTypes[type]) {
            interventionTypes[type] = { count: 0, successRate: 0 };
        }
        interventionTypes[type].count++;
    });

    // Calculate success rates for each type
    Object.keys(interventionTypes).forEach(type => {
        const typeInterventions = interventions.filter(i => i.interventionType === type);
        const successfulInterventions = typeInterventions.filter(i =>
            i.outcome === 'positive' || i.followUpCompleted === true
        ).length;

        interventionTypes[type].successRate = typeInterventions.length > 0
            ? Math.round((successfulInterventions / typeInterventions.length) * 10000) / 100
            : 0;
    });

    // Find most effective intervention type
    const mostEffectiveType = Object.entries(interventionTypes)
        .filter(([_, data]) => data.count >= 3) // Minimum sample size
        .sort(([_, a], [__, b]) => b.successRate - a.successRate)[0]?.[0] || null;

    // Generate recommendations
    const recommendedFocus: string[] = [];

    if (totalInterventions < 5) {
        recommendedFocus.push('Increase intervention frequency for at-risk athletes');
    }

    const lowSuccessTypes = Object.entries(interventionTypes)
        .filter(([_, data]) => data.successRate < 50 && data.count >= 2)
        .map(([type, _]) => type);

    if (lowSuccessTypes.length > 0) {
        recommendedFocus.push(`Improve techniques for: ${lowSuccessTypes.join(', ')}`);
    }

    if (mostEffectiveType) {
        recommendedFocus.push(`Leverage successful approach from ${mostEffectiveType} interventions`);
    }

    return {
        totalInterventions,
        interventionTypes,
        avgTimeToResolution: null, // Would need more complex calculation with alert resolution times
        mostEffectiveType,
        recommendedFocus
    };
}

/**
 * Compare coach performance against box average
 */
export async function compareCoachToBoxAverage(
    coachMembershipId: string,
    boxId: string,
    lookbackDays: number = 30
): Promise<{
    coachMetrics: CoachPerformanceMetricsData | null;
    boxAverages: {
        avgEffectivenessScore: number;
        avgEngagementScore: number;
        avgAthletesAssigned: number;
        avgInterventionsCompleted: number;
        avgAlertsResolved: number;
    };
    performanceComparison: {
        effectivenessVsAvg: number; // Percentage difference
        engagementVsAvg: number;
        interventionsVsAvg: number;
        alertResolutionVsAvg: number;
        overallRanking: number; // 1 = best
        totalCoaches: number;
    };
}> {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - lookbackDays);

    // Get coach's metrics
    const coachMetrics = await calculateCoachPerformanceMetrics(boxId, coachMembershipId, periodStart, new Date());

    // Get all coaches' metrics for comparison
    const allCoachMetrics = await db
        .select({
            coachMembershipId: coachPerformanceMetrics.coachMembershipId,
            effectivenessScore: coachPerformanceMetrics.effectivenessScore,
            engagementScore: coachPerformanceMetrics.engagementScore,
            athletesAssigned: coachPerformanceMetrics.athletesAssigned,
            interventionsCompleted: coachPerformanceMetrics.interventionsCompleted,
            alertsResolved: coachPerformanceMetrics.alertsResolved
        })
        .from(coachPerformanceMetrics)
        .where(and(
            eq(coachPerformanceMetrics.boxId, boxId),
            gte(coachPerformanceMetrics.periodStart, periodStart)
        ));

    const totalCoaches = allCoachMetrics.length;

    const boxAverages = {
        avgEffectivenessScore: totalCoaches > 0
            ? Math.round(allCoachMetrics.reduce((sum, m) => sum + Number(m.effectivenessScore), 0) / totalCoaches * 100) / 100
            : 0,
        avgEngagementScore: totalCoaches > 0
            ? Math.round(allCoachMetrics.reduce((sum, m) => sum + Number(m.engagementScore), 0) / totalCoaches * 100) / 100
            : 0,
        avgAthletesAssigned: totalCoaches > 0
            ? Math.round(allCoachMetrics.reduce((sum, m) => sum + m.athletesAssigned, 0) / totalCoaches * 100) / 100
            : 0,
        avgInterventionsCompleted: totalCoaches > 0
            ? Math.round(allCoachMetrics.reduce((sum, m) => sum + m.interventionsCompleted, 0) / totalCoaches * 100) / 100
            : 0,
        avgAlertsResolved: totalCoaches > 0
            ? Math.round(allCoachMetrics.reduce((sum, m) => sum + m.alertsResolved, 0) / totalCoaches * 100) / 100
            : 0
    };

    // Calculate performance comparison
    let performanceComparison = {
        effectivenessVsAvg: 0,
        engagementVsAvg: 0,
        interventionsVsAvg: 0,
        alertResolutionVsAvg: 0,
        overallRanking: totalCoaches,
        totalCoaches
    };

    if (coachMetrics && boxAverages.avgEffectivenessScore > 0) {
        performanceComparison = {
            effectivenessVsAvg: Math.round(((coachMetrics.effectivenessScore - boxAverages.avgEffectivenessScore) / boxAverages.avgEffectivenessScore) * 10000) / 100,
            engagementVsAvg: Math.round(((coachMetrics.engagementScore - boxAverages.avgEngagementScore) / Math.max(boxAverages.avgEngagementScore, 1)) * 10000) / 100,
            interventionsVsAvg: boxAverages.avgInterventionsCompleted > 0
                ? Math.round(((coachMetrics.interventionsCompleted - boxAverages.avgInterventionsCompleted) / boxAverages.avgInterventionsCompleted) * 10000) / 100
                : 0,
            alertResolutionVsAvg: boxAverages.avgAlertsResolved > 0
                ? Math.round(((coachMetrics.alertsResolved - boxAverages.avgAlertsResolved) / boxAverages.avgAlertsResolved) * 10000) / 100
                : 0,
            overallRanking: allCoachMetrics
                .sort((a, b) => Number(b.effectivenessScore) - Number(a.effectivenessScore))
                .findIndex(m => m.coachMembershipId === coachMembershipId) + 1,
            totalCoaches
        };
    }

    return {
        coachMetrics,
        boxAverages,
        performanceComparison
    };
}
