// src/lib/services/analytics/calculations/seasonal-analytics-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteWellnessCheckins,
    wodAttendance,
    seasonalAnalytics,
} from "@/db/schema";
import { eq, and, gte, lte, count, avg, sql } from "drizzle-orm";

export type TemporalType = "monthly" | "quarterly" | "seasonal" | "holiday";

export interface SeasonalAnalyticsData {
    boxId: string;
    temporalType: TemporalType;
    temporalValue: string;
    year: number;
    baselineAthleteCount: number;
    baselineAttendanceRate: number;
    baselineCheckinRate: number;
    baselineChurnRate: number;
    athleteCountChange: number | null;
    attendanceRateChange: number | null;
    checkinRateChange: number | null;
    churnRateChange: number | null;
    newMemberSignups: number;
    avgEnergyChange: number | null;
    avgSleepQualityChange: number | null;
    avgStressLevelChange: number | null;
    avgMotivationChange: number | null;
    confidenceLevel: number;
    pValue: number | null;
    calculatedAt: Date;
}

/**
 * Define temporal periods with their date ranges
 */
function getTemporalPeriods(year: number): Array<{
    type: TemporalType;
    value: string;
    start: Date;
    end: Date;
}> {
    const periods: { type: TemporalType; value: string; start: Date; end: Date; }[] = [];

    // Monthly periods
    const months = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december"
    ];

    months.forEach((month, index) => {
        periods.push({
            type: "monthly" as TemporalType,
            value: month,
            start: new Date(year, index, 1),
            end: new Date(year, index + 1, 0, 23, 59, 59, 999)
        });
    });

    // Quarterly periods
    const quarters = [
        { name: "q1", months: [0, 1, 2] },
        { name: "q2", months: [3, 4, 5] },
        { name: "q3", months: [6, 7, 8] },
        { name: "q4", months: [9, 10, 11] }
    ];

    quarters.forEach(quarter => {
        periods.push({
            type: "quarterly" as TemporalType,
            value: quarter.name,
            start: new Date(year, quarter.months[0], 1),
            end: new Date(year, quarter.months[2] + 1, 0, 23, 59, 59, 999)
        });
    });

    // Seasonal periods (Northern Hemisphere)
    const seasons = [
        { name: "winter", start: new Date(year - 1, 11, 21), end: new Date(year, 2, 19, 23, 59, 59, 999) },
        { name: "spring", start: new Date(year, 2, 20), end: new Date(year, 5, 20, 23, 59, 59, 999) },
        { name: "summer", start: new Date(year, 5, 21), end: new Date(year, 8, 22, 23, 59, 59, 999) },
        { name: "fall", start: new Date(year, 8, 23), end: new Date(year, 11, 20, 23, 59, 59, 999) }
    ];

    seasons.forEach(season => {
        periods.push({
            type: "seasonal" as TemporalType,
            value: season.name,
            start: season.start,
            end: season.end
        });
    });

    // Holiday periods (key fitness industry periods)
    const holidays = [
        { name: "new_years", start: new Date(year, 0, 1), end: new Date(year, 1, 14, 23, 59, 59, 999) }, // Jan 1 - Feb 14
        { name: "summer_break", start: new Date(year, 5, 15), end: new Date(year, 7, 31, 23, 59, 59, 999) }, // June 15 - Aug 31
        { name: "thanksgiving", start: new Date(year, 10, 20), end: new Date(year, 11, 10, 23, 59, 59, 999) }, // Nov 20 - Dec 10
        { name: "holiday_season", start: new Date(year, 11, 11), end: new Date(year, 11, 31, 23, 59, 59, 999) } // Dec 11 - Dec 31
    ];

    holidays.forEach(holiday => {
        periods.push({
            type: "holiday" as TemporalType,
            value: holiday.name,
            start: holiday.start,
            end: holiday.end
        });
    });

    return periods;
}

/**
 * Calculate baseline metrics for a box over the past year
 */
async function calculateBaselineMetrics(
    boxId: string,
    referenceDate: Date = new Date()
): Promise<{
    baselineAthleteCount: number;
    baselineAttendanceRate: number;
    baselineCheckinRate: number;
    baselineChurnRate: number;
}> {
    const oneYearAgo = new Date(referenceDate);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // Get average athlete count over the year
    const athleteCountData = await db
        .select({
            avgCount: avg(sql<number>`CASE WHEN ${boxMemberships.isActive} = true THEN 1 ELSE 0 END`)
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            gte(boxMemberships.joinedAt, oneYearAgo)
        ));

    // Get average attendance rate
    const attendanceData = await db
        .select({
            avgRate: sql<number>`
                AVG(CASE WHEN ${wodAttendance.status} = 'attended' THEN 100.0 ELSE 0.0 END)
            `
        })
        .from(wodAttendance)
        .where(and(
            eq(wodAttendance.boxId, boxId),
            gte(wodAttendance.attendanceDate, sql`${oneYearAgo}::date`)
        ));

    // Get average checkin rate
    const checkinData = await db
        .select({
            totalDays: sql<number>`COUNT(DISTINCT DATE(${athleteWellnessCheckins.checkinDate}))`,
            totalMembers: sql<number>`COUNT(DISTINCT ${athleteWellnessCheckins.membershipId})`,
            totalCheckins: count()
        })
        .from(athleteWellnessCheckins)
        .where(and(
            eq(athleteWellnessCheckins.boxId, boxId),
            gte(athleteWellnessCheckins.checkinDate, oneYearAgo)
        ));

    // Calculate churn rate (members who left in the past year)
    const churnData = await db
        .select({
            totalMembers: count(),
            churnedMembers: sql<number>`COUNT(CASE WHEN ${boxMemberships.isActive} = false AND ${boxMemberships.leftAt} IS NOT NULL THEN 1 END)`
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            gte(boxMemberships.joinedAt, oneYearAgo)
        ));

    const baselineAthleteCount = Number(athleteCountData[0]?.avgCount || 0);
    const baselineAttendanceRate = Number(attendanceData[0]?.avgRate || 0);

    const checkinInfo = checkinData[0];
    const baselineCheckinRate = checkinInfo?.totalMembers > 0 && checkinInfo?.totalDays > 0
        ? (checkinInfo.totalCheckins / (checkinInfo.totalMembers * checkinInfo.totalDays)) * 100
        : 0;

    const churnInfo = churnData[0];
    const baselineChurnRate = churnInfo?.totalMembers > 0
        ? (churnInfo.churnedMembers / churnInfo.totalMembers) * 100
        : 0;

    return {
        baselineAthleteCount,
        baselineAttendanceRate,
        baselineCheckinRate,
        baselineChurnRate
    };
}

/**
 * Calculate metrics for a specific temporal period
 */
async function calculatePeriodMetrics(
    boxId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<{
    athleteCount: number;
    attendanceRate: number;
    checkinRate: number;
    churnRate: number;
    newMemberSignups: number;
    avgEnergy: number | null;
    avgSleepQuality: number | null;
    avgStressLevel: number | null;
    avgMotivation: number | null;
}> {
    // Get athlete count for the period
    const athleteCountData = await db
        .select({
            count: count()
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            eq(boxMemberships.isActive, true),
            lte(boxMemberships.joinedAt, periodEnd)
        ));

    // Get attendance rate for the period
    const attendanceData = await db
        .select({
            attendanceRate: sql<number>`
                AVG(CASE WHEN ${wodAttendance.status} = 'attended' THEN 100.0 ELSE 0.0 END)
            `
        })
        .from(wodAttendance)
        .where(and(
            eq(wodAttendance.boxId, boxId),
            gte(wodAttendance.attendanceDate, sql`${periodStart}::date`),
            lte(wodAttendance.attendanceDate, sql`${periodEnd}::date`)
        ));

    // Get checkin rate for the period
    const checkinData = await db
        .select({
            totalDays: sql<number>`${Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000))}`,
            totalMembers: sql<number>`COUNT(DISTINCT ${athleteWellnessCheckins.membershipId})`,
            totalCheckins: count()
        })
        .from(athleteWellnessCheckins)
        .where(and(
            eq(athleteWellnessCheckins.boxId, boxId),
            gte(athleteWellnessCheckins.checkinDate, periodStart),
            lte(athleteWellnessCheckins.checkinDate, periodEnd)
        ));

    // Get churn rate for the period
    const churnData = await db
        .select({
            totalMembers: count(),
            churnedMembers: sql<number>`COUNT(CASE WHEN ${boxMemberships.isActive} = false AND ${boxMemberships.leftAt} BETWEEN ${periodStart} AND ${periodEnd} THEN 1 END)`
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete')
        ));

    // Get new member signups for the period
    const newSignupData = await db
        .select({
            count: count()
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            gte(boxMemberships.joinedAt, periodStart),
            lte(boxMemberships.joinedAt, periodEnd)
        ));

    // Get wellness metrics for the period
    const wellnessData = await db
        .select({
            avgEnergy: avg(athleteWellnessCheckins.energyLevel),
            avgSleep: avg(athleteWellnessCheckins.sleepQuality),
            avgStress: avg(athleteWellnessCheckins.stressLevel),
            avgMotivation: avg(athleteWellnessCheckins.motivationLevel)
        })
        .from(athleteWellnessCheckins)
        .where(and(
            eq(athleteWellnessCheckins.boxId, boxId),
            gte(athleteWellnessCheckins.checkinDate, periodStart),
            lte(athleteWellnessCheckins.checkinDate, periodEnd)
        ));

    const athleteCount = athleteCountData[0]?.count || 0;
    const attendanceRate = Number(attendanceData[0]?.attendanceRate || 0);

    const checkinInfo = checkinData[0];
    const checkinRate = checkinInfo?.totalMembers > 0 && checkinInfo?.totalDays > 0
        ? (checkinInfo.totalCheckins / (checkinInfo.totalMembers * checkinInfo.totalDays)) * 100
        : 0;

    const churnInfo = churnData[0];
    const churnRate = churnInfo?.totalMembers > 0
        ? (churnInfo.churnedMembers / churnInfo.totalMembers) * 100
        : 0;

    const newMemberSignups = newSignupData[0]?.count || 0;
    const wellness = wellnessData[0];

    return {
        athleteCount,
        attendanceRate,
        checkinRate,
        churnRate,
        newMemberSignups,
        avgEnergy: wellness?.avgEnergy ? Number(wellness.avgEnergy) : null,
        avgSleepQuality: wellness?.avgSleep ? Number(wellness.avgSleep) : null,
        avgStressLevel: wellness?.avgStress ? Number(wellness.avgStress) : null,
        avgMotivation: wellness?.avgMotivation ? Number(wellness.avgMotivation) : null
    };
}

/**
 * Calculate statistical significance using simple t-test approximation
 */
function calculateStatisticalSignificance(
    periodValue: number,
    baselineValue: number,
    sampleSize: number
): { confidenceLevel: number; pValue: number | null } {
    if (sampleSize < 10 || baselineValue === 0) {
        return { confidenceLevel: 0, pValue: null };
    }

    // Simple approximation - in production, use proper statistical libraries
    const percentChange = Math.abs((periodValue - baselineValue) / baselineValue);
    const tStatistic = percentChange * Math.sqrt(sampleSize);

    // Rough approximation of p-value based on t-statistic
    let pValue = null;
    let confidenceLevel = 0;

    if (tStatistic > 2.576) { // ~99% confidence
        confidenceLevel = 99;
        pValue = 0.01;
    } else if (tStatistic > 1.96) { // ~95% confidence
        confidenceLevel = 95;
        pValue = 0.05;
    } else if (tStatistic > 1.645) { // ~90% confidence
        confidenceLevel = 90;
        pValue = 0.10;
    }

    return { confidenceLevel, pValue };
}

/**
 * Calculate seasonal analytics for a specific temporal period
 */
export async function calculateSeasonalAnalytics(
    boxId: string,
    temporalType: TemporalType,
    temporalValue: string,
    year: number,
    periodStart: Date,
    periodEnd: Date
): Promise<SeasonalAnalyticsData> {
    // Get baseline metrics
    const baseline = await calculateBaselineMetrics(boxId, periodEnd);

    // Get period metrics
    const periodMetrics = await calculatePeriodMetrics(boxId, periodStart, periodEnd);

    // Calculate percentage changes
    const athleteCountChange = baseline.baselineAthleteCount > 0
        ? ((periodMetrics.athleteCount - baseline.baselineAthleteCount) / baseline.baselineAthleteCount) * 100
        : null;

    const attendanceRateChange = baseline.baselineAttendanceRate > 0
        ? ((periodMetrics.attendanceRate - baseline.baselineAttendanceRate) / baseline.baselineAttendanceRate) * 100
        : null;

    const checkinRateChange = baseline.baselineCheckinRate > 0
        ? ((periodMetrics.checkinRate - baseline.baselineCheckinRate) / baseline.baselineCheckinRate) * 100
        : null;

    const churnRateChange = baseline.baselineChurnRate > 0
        ? ((periodMetrics.churnRate - baseline.baselineChurnRate) / baseline.baselineChurnRate) * 100
        : null;

    // Calculate wellness changes (absolute differences since these are on 1-10 scales)
    const avgEnergyChange = periodMetrics.avgEnergy !== null ? periodMetrics.avgEnergy - 5.5 : null; // 5.5 is neutral
    const avgSleepQualityChange = periodMetrics.avgSleepQuality !== null ? periodMetrics.avgSleepQuality - 5.5 : null;
    const avgStressLevelChange = periodMetrics.avgStressLevel !== null ? 5.5 - periodMetrics.avgStressLevel : null; // Reverse for stress (lower is better)
    const avgMotivationChange = periodMetrics.avgMotivation !== null ? periodMetrics.avgMotivation - 5.5 : null;

    // Calculate statistical significance (using athlete count as sample size)
    const significance = calculateStatisticalSignificance(
        periodMetrics.athleteCount,
        baseline.baselineAthleteCount,
        periodMetrics.athleteCount
    );

    return {
        boxId,
        temporalType,
        temporalValue,
        year,
        baselineAthleteCount: baseline.baselineAthleteCount,
        baselineAttendanceRate: baseline.baselineAttendanceRate,
        baselineCheckinRate: baseline.baselineCheckinRate,
        baselineChurnRate: baseline.baselineChurnRate,
        athleteCountChange,
        attendanceRateChange,
        checkinRateChange,
        churnRateChange,
        newMemberSignups: periodMetrics.newMemberSignups,
        avgEnergyChange,
        avgSleepQualityChange,
        avgStressLevelChange,
        avgMotivationChange,
        confidenceLevel: significance.confidenceLevel,
        pValue: significance.pValue,
        calculatedAt: new Date()
    };
}

/**
 * Process seasonal analytics for all temporal periods for a specific year
 */
export async function processSeasonalAnalytics(
    boxId: string,
    year: number = new Date().getFullYear()
) {
    try {
        console.log(`[Analytics] Processing seasonal analytics for box ${boxId}, year ${year}`);

        const periods = getTemporalPeriods(year);
        const results: SeasonalAnalyticsData[] = [];

        for (const period of periods) {
            const analytics = await calculateSeasonalAnalytics(
                boxId,
                period.type,
                period.value,
                year,
                period.start,
                period.end
            );

            results.push(analytics);

            // Upsert to database
            await db.insert(seasonalAnalytics).values({
                boxId: analytics.boxId,
                temporalType: analytics.temporalType,
                temporalValue: analytics.temporalValue,
                year: analytics.year,
                baselineAthleteCount: analytics.baselineAthleteCount,
                baselineAttendanceRate: analytics.baselineAttendanceRate.toString(),
                baselineCheckinRate: analytics.baselineCheckinRate.toString(),
                baselineChurnRate: analytics.baselineChurnRate.toString(),
                athleteCountChange: analytics.athleteCountChange?.toString() ?? null,
                attendanceRateChange: analytics.attendanceRateChange?.toString() ?? null,
                checkinRateChange: analytics.checkinRateChange?.toString() ?? null,
                churnRateChange: analytics.churnRateChange?.toString() ?? null,
                newMemberSignups: analytics.newMemberSignups,
                avgEnergyChange: analytics.avgEnergyChange?.toString() ?? null,
                avgSleepQualityChange: analytics.avgSleepQualityChange?.toString() ?? null,
                avgStressLevelChange: analytics.avgStressLevelChange?.toString() ?? null,
                avgMotivationChange: analytics.avgMotivationChange?.toString() ?? null,
                confidenceLevel: analytics.confidenceLevel.toString(),
                pValue: analytics.pValue?.toString() ?? null,
                calculatedAt: analytics.calculatedAt
            })
                .onConflictDoUpdate({
                    target: [seasonalAnalytics.boxId, seasonalAnalytics.temporalType, seasonalAnalytics.temporalValue, seasonalAnalytics.year],
                    set: {
                        baselineAthleteCount: analytics.baselineAthleteCount,
                        baselineAttendanceRate: analytics.baselineAttendanceRate.toString(),
                        baselineCheckinRate: analytics.baselineCheckinRate.toString(),
                        baselineChurnRate: analytics.baselineChurnRate.toString(),
                        athleteCountChange: analytics.athleteCountChange?.toString() ?? null,
                        attendanceRateChange: analytics.attendanceRateChange?.toString() ?? null,
                        checkinRateChange: analytics.checkinRateChange?.toString() ?? null,
                        churnRateChange: analytics.churnRateChange?.toString() ?? null,
                        newMemberSignups: analytics.newMemberSignups,
                        avgEnergyChange: analytics.avgEnergyChange?.toString() ?? null,
                        avgSleepQualityChange: analytics.avgSleepQualityChange?.toString() ?? null,
                        avgStressLevelChange: analytics.avgStressLevelChange?.toString() ?? null,
                        avgMotivationChange: analytics.avgMotivationChange?.toString() ?? null,
                        confidenceLevel: analytics.confidenceLevel.toString(),
                        pValue: analytics.pValue?.toString() ?? null,
                        calculatedAt: analytics.calculatedAt
                    }
                });
        }

        console.log(`[Analytics] Successfully processed ${results.length} seasonal analytics for box ${boxId}, year ${year}`);

        return {
            boxId,
            year,
            periodsProcessed: results.length,
            significantPatterns: results.filter(r => r.confidenceLevel >= 95).length,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing seasonal analytics for box ${boxId}, year ${year}:`, error);
        throw error;
    }
}
