// src/lib/services/analytics/calculations/cohort-analytics-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteCohortAnalytics,
    athleteWellnessCheckins,
    athleteRiskScores,
    wodAttendance
} from "@/db/schema";
import { eq, and, gte, lte, count, sql } from "drizzle-orm";

export interface CohortAnalyticsData {
    boxId: string;
    cohortMonth: Date;
    cohortSize: number;
    analysisMonth: Date;
    monthsSinceCohortStart: number;
    activeAthletes: number;
    churnedAthletes: number;
    retentionRate: number;
    cohortRevenue: number | null;
    cumulativeRevenue: number | null;
    avgRevenuePerAthlete: number | null;
    avgCheckinRate: number | null;
    avgAttendanceRate: number | null;
    avgRiskScore: number | null;
    calculatedAt: Date;
}

interface CohortMember {
    membershipId: string;
    joinedAt: Date;
    isActive: boolean;
    leftAt: Date | null;
}

/**
 * Get all athletes who joined in a specific cohort month
 */
async function getCohortMembers(
    boxId: string,
    cohortMonth: Date
): Promise<CohortMember[]> {
    const cohortStart = new Date(cohortMonth);
    const cohortEnd = new Date(cohortMonth);
    cohortEnd.setMonth(cohortEnd.getMonth() + 1);
    cohortEnd.setDate(0); // Last day of the month

    const members = await db
        .select({
            membershipId: boxMemberships.id,
            joinedAt: boxMemberships.joinedAt,
            isActive: boxMemberships.isActive,
            leftAt: boxMemberships.leftAt
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            gte(boxMemberships.joinedAt, cohortStart),
            lte(boxMemberships.joinedAt, cohortEnd)
        ));

    return members.map(member => ({
        membershipId: member.membershipId,
        joinedAt: member.joinedAt,
        isActive: member.isActive,
        leftAt: member.leftAt
    }));
}

/**
 * Calculate retention metrics for a cohort at a specific analysis month
 */
async function calculateCohortMetrics(
    boxId: string,
    cohortMembers: CohortMember[],
    analysisMonth: Date
): Promise<{
    activeAthletes: number;
    churnedAthletes: number;
    activeMemberIds: string[];
}> {
    const analysisEnd = new Date(analysisMonth);
    analysisEnd.setMonth(analysisEnd.getMonth() + 1);
    analysisEnd.setDate(0); // Last day of analysis month

    let activeAthletes = 0;
    let churnedAthletes = 0;
    const activeMemberIds: string[] = [];

    cohortMembers.forEach(member => {
        // Check if member was still active at the end of analysis month
        const wasActiveAtAnalysis = member.isActive ||
            !member.leftAt ||
            member.leftAt > analysisEnd;

        if (wasActiveAtAnalysis) {
            activeAthletes++;
            activeMemberIds.push(member.membershipId);
        } else {
            churnedAthletes++;
        }
    });

    return {
        activeAthletes,
        churnedAthletes,
        activeMemberIds
    };
}

/**
 * Calculate engagement metrics for active cohort members
 */
async function calculateCohortEngagementMetrics(
    activeMemberIds: string[],
    analysisMonth: Date
): Promise<{
    avgCheckinRate: number | null;
    avgAttendanceRate: number | null;
    avgRiskScore: number | null;
}> {
    if (activeMemberIds.length === 0) {
        return {
            avgCheckinRate: null,
            avgAttendanceRate: null,
            avgRiskScore: null
        };
    }

    const analysisStart = new Date(analysisMonth);
    const analysisEnd = new Date(analysisMonth);
    analysisEnd.setMonth(analysisEnd.getMonth() + 1);
    analysisEnd.setDate(0);

    // Calculate checkin rates
    const checkinData = await db
        .select({
            membershipId: athleteWellnessCheckins.membershipId,
            checkinCount: count()
        })
        .from(athleteWellnessCheckins)
        .where(and(
            sql`${athleteWellnessCheckins.membershipId} = ANY(${activeMemberIds})`,
            gte(athleteWellnessCheckins.checkinDate, analysisStart),
            lte(athleteWellnessCheckins.checkinDate, analysisEnd)
        ))
        .groupBy(athleteWellnessCheckins.membershipId);

    const daysInMonth = new Date(analysisEnd.getFullYear(), analysisEnd.getMonth() + 1, 0).getDate();
    const checkinRates = checkinData.map(data => (data.checkinCount / daysInMonth) * 100);
    const avgCheckinRate = checkinRates.length > 0
        ? checkinRates.reduce((sum, rate) => sum + rate, 0) / checkinRates.length
        : null;

    // Calculate attendance rates
    const attendanceData = await db
        .select({
            membershipId: wodAttendance.membershipId,
            attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            total: count()
        })
        .from(wodAttendance)
        .where(and(
            sql`${wodAttendance.membershipId} = ANY(${activeMemberIds})`,
            gte(wodAttendance.attendanceDate, sql`${analysisStart}::date`),
            lte(wodAttendance.attendanceDate, sql`${analysisEnd}::date`)
        ))
        .groupBy(wodAttendance.membershipId);

    const attendanceRates = attendanceData
        .filter(data => data.total > 0)
        .map(data => (data.attended / data.total) * 100);

    const avgAttendanceRate = attendanceRates.length > 0
        ? attendanceRates.reduce((sum, rate) => sum + rate, 0) / attendanceRates.length
        : null;

    // Calculate average risk scores (using most recent scores within analysis period)
    const riskScores = await db
        .select({
            membershipId: athleteRiskScores.membershipId,
            riskScore: athleteRiskScores.overallRiskScore
        })
        .from(athleteRiskScores)
        .where(and(
            sql`${athleteRiskScores.membershipId} = ANY(${activeMemberIds})`,
            gte(athleteRiskScores.calculatedAt, analysisStart),
            lte(athleteRiskScores.calculatedAt, analysisEnd)
        ));

    const avgRiskScore = riskScores.length > 0
        ? riskScores.reduce((sum, score) => sum + Number(score.riskScore), 0) / riskScores.length
        : null;

    return {
        avgCheckinRate: avgCheckinRate ? Math.round(avgCheckinRate * 100) / 100 : null,
        avgAttendanceRate: avgAttendanceRate ? Math.round(avgAttendanceRate * 100) / 100 : null,
        avgRiskScore: avgRiskScore ? Math.round(avgRiskScore * 100) / 100 : null
    };
}

/**
 * Calculate cohort analytics for a specific cohort and analysis month
 */
export async function calculateCohortAnalytics(
    boxId: string,
    cohortMonth: Date,
    analysisMonth: Date
): Promise<CohortAnalyticsData | null> {
    // Get all members who joined in the cohort month
    const cohortMembers = await getCohortMembers(boxId, cohortMonth);

    if (cohortMembers.length === 0) {
        return null; // No cohort to analyze
    }

    const cohortSize = cohortMembers.length;

    // Calculate how many months have passed since cohort start
    const monthsSinceCohortStart =
        (analysisMonth.getFullYear() - cohortMonth.getFullYear()) * 12 +
        (analysisMonth.getMonth() - cohortMonth.getMonth());

    // Calculate retention metrics
    const metrics = await calculateCohortMetrics(boxId, cohortMembers, analysisMonth);

    const retentionRate = (metrics.activeAthletes / cohortSize) * 100;

    // Calculate engagement metrics for active members
    const engagementMetrics = await calculateCohortEngagementMetrics(
        metrics.activeMemberIds,
        analysisMonth
    );

    // Revenue calculations would require subscription/billing data
    // For now, we'll set these as null - implement when billing system is available
    const cohortRevenue = null;
    const cumulativeRevenue = null;
    const avgRevenuePerAthlete = null;

    return {
        boxId,
        cohortMonth,
        cohortSize,
        analysisMonth,
        monthsSinceCohortStart,
        activeAthletes: metrics.activeAthletes,
        churnedAthletes: metrics.churnedAthletes,
        retentionRate: Math.round(retentionRate * 100) / 100,
        cohortRevenue,
        cumulativeRevenue,
        avgRevenuePerAthlete,
        avgCheckinRate: engagementMetrics.avgCheckinRate,
        avgAttendanceRate: engagementMetrics.avgAttendanceRate,
        avgRiskScore: engagementMetrics.avgRiskScore,
        calculatedAt: new Date()
    };
}

/**
 * Process cohort analytics for all relevant cohort/analysis month combinations
 */
export async function processCohortAnalytics(
    boxId: string,
    lookbackMonths: number = 12,
    maxCohortAge: number = 24
) {
    try {
        const today = new Date();
        const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        console.log(`[Analytics] Processing cohort analytics for box ${boxId}`);

        const results = [];
        const cohortAnalyticsList: CohortAnalyticsData[] = [];

        // Generate analysis for each month going back
        for (let analysisOffset = 0; analysisOffset < lookbackMonths; analysisOffset++) {
            const analysisMonth = new Date(currentMonth);
            analysisMonth.setMonth(analysisMonth.getMonth() - analysisOffset);

            // For each analysis month, look at cohorts from the past maxCohortAge months
            for (let cohortOffset = analysisOffset; cohortOffset < maxCohortAge + analysisOffset; cohortOffset++) {
                const cohortMonth = new Date(currentMonth);
                cohortMonth.setMonth(cohortMonth.getMonth() - cohortOffset);

                // Skip if cohort month is after analysis month
                if (cohortMonth > analysisMonth) continue;

                const analytics = await calculateCohortAnalytics(boxId, cohortMonth, analysisMonth);

                if (analytics) {
                    cohortAnalyticsList.push(analytics);
                }
            }
        }

        console.log(`[Analytics] Generated ${cohortAnalyticsList.length} cohort analytics records for box ${boxId}`);

        // Upsert all cohort analytics
        for (const analytics of cohortAnalyticsList) {
            // Convert Date objects to strings in YYYY-MM-DD format
            const cohortMonthStr = analytics.cohortMonth.toISOString().split('T')[0];
            const analysisMonthStr = analytics.analysisMonth.toISOString().split('T')[0];

            await db.insert(athleteCohortAnalytics).values({
                boxId: analytics.boxId,
                cohortMonth: cohortMonthStr,
                cohortSize: analytics.cohortSize,
                analysisMonth: analysisMonthStr,
                monthsSinceCohortStart: analytics.monthsSinceCohortStart,
                activeAthletes: analytics.activeAthletes,
                churnedAthletes: analytics.churnedAthletes,
                retentionRate: analytics.retentionRate.toString(),
                cohortRevenue: analytics.cohortRevenue?.toString() ?? null,
                cumulativeRevenue: analytics.cumulativeRevenue?.toString() ?? null,
                avgRevenuePerAthlete: analytics.avgRevenuePerAthlete?.toString() ?? null,
                avgCheckinRate: analytics.avgCheckinRate?.toString() ?? null,
                avgAttendanceRate: analytics.avgAttendanceRate?.toString() ?? null,
                avgRiskScore: analytics.avgRiskScore?.toString() ?? null,
                calculatedAt: analytics.calculatedAt
            })
                .onConflictDoUpdate({
                    target: [
                        athleteCohortAnalytics.boxId,
                        athleteCohortAnalytics.cohortMonth,
                        athleteCohortAnalytics.analysisMonth
                    ],
                    set: {
                        cohortSize: analytics.cohortSize,
                        monthsSinceCohortStart: analytics.monthsSinceCohortStart,
                        activeAthletes: analytics.activeAthletes,
                        churnedAthletes: analytics.churnedAthletes,
                        retentionRate: analytics.retentionRate.toString(),
                        avgCheckinRate: analytics.avgCheckinRate?.toString() ?? null,
                        avgAttendanceRate: analytics.avgAttendanceRate?.toString() ?? null,
                        avgRiskScore: analytics.avgRiskScore?.toString() ?? null,
                        calculatedAt: analytics.calculatedAt
                    }
                });

            results.push(analytics);
        }

        console.log(`[Analytics] Successfully processed cohort analytics for box ${boxId}`);

        return {
            boxId,
            cohortsProcessed: results.length,
            avgRetentionRate: results.length > 0
                ? Math.round(results.reduce((sum, r) => sum + r.retentionRate, 0) / results.length * 100) / 100
                : 0,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing cohort analytics for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Get cohort retention curve for visualization
 */
export async function getCohortRetentionCurve(
    boxId: string,
    cohortMonth: Date,
    maxMonths: number = 12
): Promise<{
    cohortMonth: Date;
    cohortSize: number;
    retentionCurve: Array<{
        month: number;
        activeAthletes: number;
        retentionRate: number;
        churnedThisMonth: number;
    }>;
}> {
    const cohortData = await getCohortMembers(boxId, cohortMonth);
    const cohortSize = cohortData.length;

    const retentionCurve = [];

    for (let monthOffset = 0; monthOffset < maxMonths; monthOffset++) {
        const analysisMonth = new Date(cohortMonth);
        analysisMonth.setMonth(analysisMonth.getMonth() + monthOffset);

        const metrics = await calculateCohortMetrics(boxId, cohortData, analysisMonth);
        const retentionRate = cohortSize > 0 ? (metrics.activeAthletes / cohortSize) * 100 : 0;

        // Calculate churn for this specific month
        let churnedThisMonth = 0;
        if (monthOffset > 0) {
            const prevMonth = new Date(analysisMonth);
            prevMonth.setMonth(prevMonth.getMonth() - 1);
            const prevMetrics = await calculateCohortMetrics(boxId, cohortData, prevMonth);
            churnedThisMonth = prevMetrics.activeAthletes - metrics.activeAthletes;
        }

        retentionCurve.push({
            month: monthOffset,
            activeAthletes: metrics.activeAthletes,
            retentionRate: Math.round(retentionRate * 100) / 100,
            churnedThisMonth
        });
    }

    return {
        cohortMonth,
        cohortSize,
        retentionCurve
    };
}

/**
 * Compare cohort performance across different time periods
 */
export async function compareCohortPerformance(
    boxId: string,
    lookbackMonths: number = 6
): Promise<{
    cohortComparison: Array<{
        cohortMonth: string;
        cohortSize: number;
        month1Retention: number;
        month3Retention: number;
        month6Retention: number;
        month12Retention: number;
    }>;
    bestPerformingCohort: string | null;
    worstPerformingCohort: string | null;
    avgRetentionByMonth: { [key: number]: number };
}> {
    const currentMonth = new Date();
    currentMonth.setDate(1);

    const cohortComparison = [];
    const retentionByMonth: { [key: number]: number[] } = { 1: [], 3: [], 6: [], 12: [] };

    // Analyze cohorts from the past lookbackMonths
    for (let offset = 1; offset <= lookbackMonths; offset++) {
        const cohortMonth = new Date(currentMonth);
        cohortMonth.setMonth(cohortMonth.getMonth() - offset);

        const cohortMembers = await getCohortMembers(boxId, cohortMonth);
        if (cohortMembers.length === 0) continue;

        const cohortSize = cohortMembers.length;
        const cohortKey = `${cohortMonth.getFullYear()}-${(cohortMonth.getMonth() + 1).toString().padStart(2, '0')}`;

        // Calculate retention at different intervals
        const retentions = { month1: 0, month3: 0, month6: 0, month12: 0 };

        const intervals = [1, 3, 6, 12];
        for (const interval of intervals) {
            const analysisMonth = new Date(cohortMonth);
            analysisMonth.setMonth(analysisMonth.getMonth() + interval);

            if (analysisMonth <= currentMonth) {
                const metrics = await calculateCohortMetrics(boxId, cohortMembers, analysisMonth);
                const retention = (metrics.activeAthletes / cohortSize) * 100;

                if (interval === 1) retentions.month1 = retention;
                if (interval === 3) retentions.month3 = retention;
                if (interval === 6) retentions.month6 = retention;
                if (interval === 12) retentions.month12 = retention;

                retentionByMonth[interval].push(retention);
            }
        }

        cohortComparison.push({
            cohortMonth: cohortKey,
            cohortSize,
            month1Retention: Math.round(retentions.month1 * 100) / 100,
            month3Retention: Math.round(retentions.month3 * 100) / 100,
            month6Retention: Math.round(retentions.month6 * 100) / 100,
            month12Retention: Math.round(retentions.month12 * 100) / 100,
        });
    }

    // Find best and worst performing cohorts (based on 3-month retention)
    const cohortsWithData = cohortComparison.filter(c => c.month3Retention > 0);
    const bestPerformingCohort = cohortsWithData.length > 0
        ? cohortsWithData.sort((a, b) => b.month3Retention - a.month3Retention)[0].cohortMonth
        : null;

    const worstPerformingCohort = cohortsWithData.length > 0
        ? cohortsWithData.sort((a, b) => a.month3Retention - b.month3Retention)[0].cohortMonth
        : null;

    // Calculate average retention by month across all cohorts
    const avgRetentionByMonth: { [key: number]: number } = {};
    Object.keys(retentionByMonth).forEach(month => {
        const monthNum = parseInt(month);
        const retentions = retentionByMonth[monthNum];
        avgRetentionByMonth[monthNum] = retentions.length > 0
            ? Math.round(retentions.reduce((sum, r) => sum + r, 0) / retentions.length * 100) / 100
            : 0;
    });

    return {
        cohortComparison,
        bestPerformingCohort,
        worstPerformingCohort,
        avgRetentionByMonth
    };
}
