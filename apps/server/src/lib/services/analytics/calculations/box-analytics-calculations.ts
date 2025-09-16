// src/lib/services/analytics/calculations/box-analytics-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteWellnessCheckins,
    athletePrs,
    athleteBenchmarks,
    boxAnalytics,
    athleteRiskScores,
    wodAttendance,
} from "@/db/schema";
import { eq, and, gte, count, sql, avg, lte } from "drizzle-orm";

export type AnalyticsPeriod = "daily" | "weekly" | "monthly";

export interface BoxAnalyticsSnapshotData {
    boxId: string;
    period: AnalyticsPeriod;
    periodStart: Date;
    periodEnd: Date;
    totalAthletes: number;
    activeAthletes: number;
    newAthletes: number;
    churnedAthletes: number;
    retentionRate: number;
    totalCheckins: number;
    totalAttendances: number;
    avgAttendancePerAthlete: number;
    checkinRate: number;
    totalPrs: number;
    totalBenchmarkAttempts: number;
    avgAthletePerformanceScore: number;
    highRiskAthletes: number;
    totalActiveAlerts: number;
    alertsResolved: number;
    avgTimeToAlertResolution: number | null;
    avgEnergyLevel: number | null;
    avgSleepQuality: number | null;
    avgStressLevel: number | null;
    avgWorkoutReadiness: number | null;
    customMetrics: any;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Calculates comprehensive box analytics snapshot
 */
export async function calculateBoxAnalyticsSnapshot(
    boxId: string,
    period: AnalyticsPeriod,
    referenceDate: Date = new Date()
): Promise<BoxAnalyticsSnapshotData> {
    // Calculate period boundaries
    let periodStart = new Date(referenceDate);
    let periodEnd = new Date(referenceDate);
    let daysInPeriod: number;

    switch (period) {
        case "daily":
            periodStart.setHours(0, 0, 0, 0);
            periodEnd.setHours(23, 59, 59, 999);
            daysInPeriod = 1;
            break;
        case "weekly":
            const dayOfWeek = periodStart.getDay();
            periodStart.setDate(periodStart.getDate() - dayOfWeek);
            periodStart.setHours(0, 0, 0, 0);
            periodEnd.setDate(periodStart.getDate() + 6);
            periodEnd.setHours(23, 59, 59, 999);
            daysInPeriod = 7;
            break;
        case "monthly":
        default:
            periodStart.setDate(1);
            periodStart.setHours(0, 0, 0, 0);
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            periodEnd.setDate(0);
            periodEnd.setHours(23, 59, 59, 999);
            daysInPeriod = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0).getDate();
            break;
    }

    // Get previous period for comparison
    const prevPeriodEnd = new Date(periodStart);
    prevPeriodEnd.setDate(prevPeriodEnd.getDate() - 1);
    const prevPeriodStart = new Date(prevPeriodEnd);

    switch (period) {
        case "daily":
            prevPeriodStart.setDate(prevPeriodStart.getDate() - 1);
            break;
        case "weekly":
            prevPeriodStart.setDate(prevPeriodStart.getDate() - 7);
            break;
        case "monthly":
            prevPeriodStart.setMonth(prevPeriodStart.getMonth() - 1);
            break;
    }

    // Fetch comprehensive analytics data
    const [
        totalAthletesResult,
        activeAthletesResult,
        newAthletesResult,
        churnedAthletesResult,
        wellnessResult,
        attendanceResult,
        performanceResult,
        riskResult
    ] = await Promise.all([
        // Total Athletes (all time)
        db.select({ count: count() })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.role, 'athlete')
            )),

        // Active Athletes (in period)
        db.select({ count: count() })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.role, 'athlete'),
                eq(boxMemberships.isActive, true),
                gte(boxMemberships.lastCheckinDate || sql`'1970-01-01'::timestamp`, periodStart)
            )),

        // New Athletes (joined in period)
        db.select({ count: count() })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.role, 'athlete'),
                gte(boxMemberships.joinedAt, periodStart),
                lte(boxMemberships.joinedAt, periodEnd)
            )),

        // Churned Athletes (left in period)
        db.select({ count: count() })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.role, 'athlete'),
                eq(boxMemberships.isActive, false),
                gte(boxMemberships.leftAt || sql`'1970-01-01'::timestamp`, periodStart),
                lte(boxMemberships.leftAt || sql`'9999-12-31'::timestamp`, periodEnd)
            )),

        // Wellness Metrics
        db.select({
            totalCheckins: count(),
            avgEnergy: avg(athleteWellnessCheckins.energyLevel),
            avgSleep: avg(athleteWellnessCheckins.sleepQuality),
            avgStress: avg(athleteWellnessCheckins.stressLevel),
            avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
        })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.boxId, boxId),
                gte(athleteWellnessCheckins.checkinDate, periodStart),
                lte(athleteWellnessCheckins.checkinDate, periodEnd)
            )),

        // Attendance Metrics
        db.select({
            totalAttendances: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            totalScheduled: count()
        })
            .from(wodAttendance)
            .where(and(
                eq(wodAttendance.boxId, boxId),
                gte(wodAttendance.attendanceDate, sql`${periodStart}::date`),
                lte(wodAttendance.attendanceDate, sql`${periodEnd}::date`)
            )),

        // Performance Metrics
        Promise.all([
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, periodStart),
                    lte(athletePrs.achievedAt, periodEnd)
                )),
            db.select({ count: count() })
                .from(athleteBenchmarks)
                .where(and(
                    eq(athleteBenchmarks.boxId, boxId),
                    gte(athleteBenchmarks.achievedAt, periodStart),
                    lte(athleteBenchmarks.achievedAt, periodEnd)
                ))
        ]),

        // Risk Metrics (from athleteRiskScores table)
        db.select({
            highRiskCount: sql<number>`COUNT(CASE WHEN ${athleteRiskScores.riskLevel} = 'high' THEN 1 END)`,
            criticalRiskCount: sql<number>`COUNT(CASE WHEN ${athleteRiskScores.riskLevel} = 'critical' THEN 1 END)`
        })
            .from(athleteRiskScores)
            .where(and(
                eq(athleteRiskScores.boxId, boxId),
                gte(athleteRiskScores.validUntil, new Date()) // Only current valid scores
            ))
    ]);

    const totalAthletes = totalAthletesResult[0]?.count ?? 0;
    const activeAthletes = activeAthletesResult[0]?.count ?? 0;
    const newAthletes = newAthletesResult[0]?.count ?? 0;
    const churnedAthletes = churnedAthletesResult[0]?.count ?? 0;
    const wellness = wellnessResult[0];
    const attendance = attendanceResult[0];
    const [totalPrsResult, totalBenchmarksResult] = performanceResult;
    const totalPrs = totalPrsResult[0]?.count ?? 0;
    const totalBenchmarks = totalBenchmarksResult[0]?.count ?? 0;
    const riskMetrics = riskResult[0];

    // Calculate derived metrics
    const retentionRate = totalAthletes > 0 ? ((totalAthletes - churnedAthletes) / totalAthletes) * 100 : 0;
    const checkinRate = totalAthletes > 0 ? ((wellness?.totalCheckins ?? 0) / totalAthletes) * 100 : 0;
    const avgAttendancePerAthlete = activeAthletes > 0 ? (attendance?.totalAttendances ?? 0) / activeAthletes : 0;
    const avgAthletePerformanceScore = activeAthletes > 0 ? (totalPrs * 10 + totalBenchmarks * 5) / activeAthletes : 0;
    const highRiskAthletes = (riskMetrics?.highRiskCount ?? 0) + (riskMetrics?.criticalRiskCount ?? 0);

    return {
        boxId,
        period,
        periodStart,
        periodEnd,
        totalAthletes,
        activeAthletes,
        newAthletes,
        churnedAthletes,
        retentionRate: Math.round(retentionRate * 100) / 100,
        totalCheckins: wellness?.totalCheckins ?? 0,
        totalAttendances: attendance?.totalAttendances ?? 0,
        avgAttendancePerAthlete: Math.round(avgAttendancePerAthlete * 100) / 100,
        checkinRate: Math.round(checkinRate * 100) / 100,
        totalPrs,
        totalBenchmarkAttempts: totalBenchmarks,
        avgAthletePerformanceScore: Math.round(avgAthletePerformanceScore * 100) / 100,
        highRiskAthletes,
        totalActiveAlerts: 0, // TODO: Implement alerts table
        alertsResolved: 0, // TODO: Implement alerts table
        avgTimeToAlertResolution: null, // TODO: Implement alerts table
        avgEnergyLevel: wellness?.avgEnergy ? Math.round(Number(wellness.avgEnergy) * 100) / 100 : null,
        avgSleepQuality: wellness?.avgSleep ? Math.round(Number(wellness.avgSleep) * 100) / 100 : null,
        avgStressLevel: wellness?.avgStress ? Math.round(Number(wellness.avgStress) * 100) / 100 : null,
        avgWorkoutReadiness: wellness?.avgReadiness ? Math.round(Number(wellness.avgReadiness) * 100) / 100 : null,
        customMetrics: {},
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

/**
 * Process and upsert box analytics snapshot
 */
export async function processBoxAnalyticsSnapshot(boxId: string, period: AnalyticsPeriod) {
    try {
        console.log(`[Analytics] Calculating ${period} snapshot for box ${boxId}`);
        const snapshotData = await calculateBoxAnalyticsSnapshot(boxId, period);
        console.log(`[Analytics] Upserting ${period} snapshot for box ${boxId}`);

        await db.insert(boxAnalytics).values({
            boxId: snapshotData.boxId,
            period: snapshotData.period,
            periodStart: snapshotData.periodStart,
            periodEnd: snapshotData.periodEnd,
            totalAthletes: snapshotData.totalAthletes,
            activeAthletes: snapshotData.activeAthletes,
            newAthletes: snapshotData.newAthletes,
            churnedAthletes: snapshotData.churnedAthletes,
            retentionRate: snapshotData.retentionRate.toString(),
            totalCheckins: snapshotData.totalCheckins,
            totalAttendances: snapshotData.totalAttendances,
            avgAttendancePerAthlete: snapshotData.avgAttendancePerAthlete.toString(),
            checkinRate: snapshotData.checkinRate.toString(),
            totalPrs: snapshotData.totalPrs,
            totalBenchmarkAttempts: snapshotData.totalBenchmarkAttempts,
            avgAthletePerformanceScore: snapshotData.avgAthletePerformanceScore.toString(),
            highRiskAthletes: snapshotData.highRiskAthletes,
            totalActiveAlerts: snapshotData.totalActiveAlerts,
            alertsResolved: snapshotData.alertsResolved,
            avgTimeToAlertResolution: snapshotData.avgTimeToAlertResolution !== null ? snapshotData.avgTimeToAlertResolution.toString() : null,
            avgEnergyLevel: snapshotData.avgEnergyLevel?.toString() ?? null,
            avgSleepQuality: snapshotData.avgSleepQuality?.toString() ?? null,
            avgStressLevel: snapshotData.avgStressLevel?.toString() ?? null,
            avgWorkoutReadiness: snapshotData.avgWorkoutReadiness?.toString() ?? null,
            customMetrics: snapshotData.customMetrics,
            createdAt: snapshotData.createdAt,
            updatedAt: snapshotData.updatedAt,
        })
            .onConflictDoUpdate({
                target: [boxAnalytics.boxId, boxAnalytics.period, boxAnalytics.periodStart],
                set: {
                    totalAthletes: snapshotData.totalAthletes,
                    activeAthletes: snapshotData.activeAthletes,
                    newAthletes: snapshotData.newAthletes,
                    churnedAthletes: snapshotData.churnedAthletes,
                    // Convert numbers to strings for decimal fields
                    retentionRate: snapshotData.retentionRate.toString(),
                    totalCheckins: snapshotData.totalCheckins,
                    totalAttendances: snapshotData.totalAttendances,
                    avgAttendancePerAthlete: snapshotData.avgAttendancePerAthlete.toString(),
                    checkinRate: snapshotData.checkinRate.toString(),
                    totalPrs: snapshotData.totalPrs,
                    totalBenchmarkAttempts: snapshotData.totalBenchmarkAttempts,
                    avgAthletePerformanceScore: snapshotData.avgAthletePerformanceScore.toString(),
                    highRiskAthletes: snapshotData.highRiskAthletes,
                    totalActiveAlerts: snapshotData.totalActiveAlerts,
                    alertsResolved: snapshotData.alertsResolved,
                    avgTimeToAlertResolution: snapshotData.avgTimeToAlertResolution !== null ? snapshotData.avgTimeToAlertResolution.toString() : null,
                    avgEnergyLevel: snapshotData.avgEnergyLevel?.toString() ?? null,
                    avgSleepQuality: snapshotData.avgSleepQuality?.toString() ?? null,
                    avgStressLevel: snapshotData.avgStressLevel?.toString() ?? null,
                    avgWorkoutReadiness: snapshotData.avgWorkoutReadiness?.toString() ?? null,
                    customMetrics: snapshotData.customMetrics,
                    updatedAt: new Date(),
                    periodEnd: snapshotData.periodEnd
                }
            });

        console.log(`[Analytics] Successfully updated ${period} snapshot for box ${boxId}`);
    } catch (error) {
        console.error(`[Analytics] Error processing ${period} snapshot for box ${boxId}:`, error);
        throw error;
    }
}
