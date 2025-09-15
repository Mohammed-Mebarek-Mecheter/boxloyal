// lib/services/analytics/analytics-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteWellnessCheckins,
    athletePrs,
    athleteBenchmarks,
    boxAnalytics,
    athleteRiskScores,
    wodAttendance,
    wodFeedback,
    boxes
} from "@/db/schema";
import { eq, and, gte, count, sql, avg, sum, lte, desc, inArray, not } from "drizzle-orm";

export type AnalyticsPeriod = "daily" | "weekly" | "monthly";

// --- Box Analytics Snapshot Calculation ---

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

// --- Risk Score Calculation ---

export interface AthleteRiskScoreData {
    boxId: string;
    membershipId: string;
    overallRiskScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    churnProbability: number;
    attendanceScore: number;
    performanceScore: number;
    engagementScore: number;
    wellnessScore: number;
    attendanceTrend: number | null;
    performanceTrend: number | null;
    engagementTrend: number | null;
    wellnessTrend: number | null;
    daysSinceLastVisit: number | null;
    daysSinceLastCheckin: number | null;
    daysSinceLastPr: number | null;
    factors: any;
    calculatedAt: Date;
    validUntil: Date;
}

/**
 * Calculate comprehensive athlete risk score using actual data
 */
export async function calculateAthleteRiskScore(
    membershipId: string,
    boxId: string,
    lookbackDays: number = 30
): Promise<AthleteRiskScoreData> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const prevStartDate = new Date();
    prevStartDate.setDate(prevStartDate.getDate() - (lookbackDays * 2));
    const prevEndDate = new Date();
    prevEndDate.setDate(prevEndDate.getDate() - lookbackDays);

    // Fetch comprehensive athlete data
    const [
        membership,
        currentWellness,
        previousWellness,
        currentAttendance,
        previousAttendance,
        currentPerformance,
        previousPerformance,
        recentActivity
    ] = await Promise.all([
        // Get membership info
        db.select()
            .from(boxMemberships)
            .where(eq(boxMemberships.id, membershipId))
            .limit(1),

        // Current period wellness
        db.select({
            checkinCount: count(),
            avgEnergy: avg(athleteWellnessCheckins.energyLevel),
            avgStress: avg(athleteWellnessCheckins.stressLevel),
            avgSleep: avg(athleteWellnessCheckins.sleepQuality),
            avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
        })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.membershipId, membershipId),
                gte(athleteWellnessCheckins.checkinDate, startDate)
            )),

        // Previous period wellness
        db.select({
            checkinCount: count(),
            avgEnergy: avg(athleteWellnessCheckins.energyLevel),
            avgStress: avg(athleteWellnessCheckins.stressLevel),
            avgSleep: avg(athleteWellnessCheckins.sleepQuality),
            avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
        })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.membershipId, membershipId),
                gte(athleteWellnessCheckins.checkinDate, prevStartDate),
                lte(athleteWellnessCheckins.checkinDate, prevEndDate)
            )),

        // Current period attendance
        db.select({
            attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            total: count()
        })
            .from(wodAttendance)
            .where(and(
                eq(wodAttendance.membershipId, membershipId),
                gte(wodAttendance.attendanceDate, sql`${startDate}::date`)
            )),

        // Previous period attendance
        db.select({
            attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            total: count()
        })
            .from(wodAttendance)
            .where(and(
                eq(wodAttendance.membershipId, membershipId),
                gte(wodAttendance.attendanceDate, sql`${prevStartDate}::date`),
                lte(wodAttendance.attendanceDate, sql`${prevEndDate}::date`)
            )),

        // Current period performance
        Promise.all([
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.membershipId, membershipId),
                    gte(athletePrs.achievedAt, startDate)
                )),
            db.select({ count: count() })
                .from(athleteBenchmarks)
                .where(and(
                    eq(athleteBenchmarks.membershipId, membershipId),
                    gte(athleteBenchmarks.achievedAt, startDate)
                ))
        ]),

        // Previous period performance
        Promise.all([
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.membershipId, membershipId),
                    gte(athletePrs.achievedAt, prevStartDate),
                    lte(athletePrs.achievedAt, prevEndDate)
                )),
            db.select({ count: count() })
                .from(athleteBenchmarks)
                .where(and(
                    eq(athleteBenchmarks.membershipId, membershipId),
                    gte(athleteBenchmarks.achievedAt, prevStartDate),
                    lte(athleteBenchmarks.achievedAt, prevEndDate)
                ))
        ]),

        // Recent activity timestamps
        Promise.all([
            db.select({ lastDate: sql<Date>`MAX(${wodAttendance.attendanceDate})` })
                .from(wodAttendance)
                .where(and(
                    eq(wodAttendance.membershipId, membershipId),
                    eq(wodAttendance.status, 'attended')
                )),
            db.select({ lastDate: sql<Date>`MAX(${athleteWellnessCheckins.checkinDate})` })
                .from(athleteWellnessCheckins)
                .where(eq(athleteWellnessCheckins.membershipId, membershipId)),
            db.select({ lastDate: sql<Date>`MAX(${athletePrs.achievedAt})` })
                .from(athletePrs)
                .where(eq(athletePrs.membershipId, membershipId))
        ])
    ]);

    if (!membership[0]) {
        throw new Error(`Membership ${membershipId} not found`);
    }

    // Calculate component scores (0-100 scale)

    // 1. Attendance Score
    const currentAttendanceRate = currentAttendance[0].total > 0
        ? currentAttendance[0].attended / currentAttendance[0].total
        : 0;
    const attendanceScore = Math.min(currentAttendanceRate * 100, 100);

    // 2. Wellness Score (inverse of stress, positive for energy/sleep/readiness)
    const currentWellnessData = currentWellness[0];
    let wellnessScore = 50; // Default neutral
    if (currentWellnessData.checkinCount > 0) {
        const energyScore = Number(currentWellnessData.avgEnergy || 5) * 10;
        const sleepScore = Number(currentWellnessData.avgSleep || 5) * 10;
        const readinessScore = Number(currentWellnessData.avgReadiness || 5) * 10;
        const stressScore = (10 - Number(currentWellnessData.avgStress || 5)) * 10;
        wellnessScore = (energyScore + sleepScore + readinessScore + stressScore) / 4;
    }

    // 3. Performance Score
    const [currentPrs, currentBenchmarks] = currentPerformance;
    const performanceScore = Math.min((currentPrs[0].count * 15) + (currentBenchmarks[0].count * 10), 100);

    // 4. Engagement Score (checkin frequency)
    const expectedCheckins = lookbackDays; // Ideally daily checkins
    const actualCheckins = currentWellnessData.checkinCount;
    const engagementScore = Math.min((actualCheckins / expectedCheckins) * 100, 100);

    // Calculate trends
    const prevAttendanceRate = previousAttendance[0].total > 0
        ? previousAttendance[0].attended / previousAttendance[0].total
        : currentAttendanceRate;
    const attendanceTrend = ((currentAttendanceRate - prevAttendanceRate) / Math.max(prevAttendanceRate, 0.01)) * 100;

    const [prevPrs, prevBenchmarks] = previousPerformance;
    const prevPerformanceCount = prevPrs[0].count + prevBenchmarks[0].count;
    const currentPerformanceCount = currentPrs[0].count + currentBenchmarks[0].count;
    const performanceTrend = prevPerformanceCount > 0
        ? ((currentPerformanceCount - prevPerformanceCount) / prevPerformanceCount) * 100
        : 0;

    const prevCheckinCount = previousWellness[0].checkinCount;
    const engagementTrend = prevCheckinCount > 0
        ? ((actualCheckins - prevCheckinCount) / prevCheckinCount) * 100
        : 0;

    // Calculate wellness trend (simplified)
    const prevWellnessScore = previousWellness[0].checkinCount > 0
        ? ((Number(previousWellness[0].avgEnergy || 5) + Number(previousWellness[0].avgSleep || 5) +
        Number(previousWellness[0].avgReadiness || 5) + (10 - Number(previousWellness[0].avgStress || 5))) / 4) * 10
        : wellnessScore;
    const wellnessTrend = ((wellnessScore - prevWellnessScore) / Math.max(prevWellnessScore, 1)) * 100;

    // Calculate overall risk score (inverted - lower component scores = higher risk)
    const componentWeights = {
        attendance: 0.3,
        wellness: 0.25,
        performance: 0.2,
        engagement: 0.25
    };

    const weightedScore =
        (attendanceScore * componentWeights.attendance) +
        (wellnessScore * componentWeights.wellness) +
        (performanceScore * componentWeights.performance) +
        (engagementScore * componentWeights.engagement);

    // Risk score is inverted (100 - weighted score)
    const overallRiskScore = 100 - weightedScore;

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (overallRiskScore >= 75) riskLevel = 'critical';
    else if (overallRiskScore >= 50) riskLevel = 'high';
    else if (overallRiskScore >= 25) riskLevel = 'medium';

    // Calculate churn probability (simplified model)
    const churnProbability = Math.min(overallRiskScore / 100, 0.95);

    // Calculate days since last activity
    const [lastVisit, lastCheckin, lastPr] = recentActivity;
    const now = new Date();

    const daysSinceLastVisit = lastVisit[0].lastDate
        ? Math.floor((now.getTime() - new Date(lastVisit[0].lastDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

    const daysSinceLastCheckin = lastCheckin[0].lastDate
        ? Math.floor((now.getTime() - new Date(lastCheckin[0].lastDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

    const daysSinceLastPr = lastPr[0].lastDate
        ? Math.floor((now.getTime() - new Date(lastPr[0].lastDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

    // Factors for explainability
    const factors = {
        attendanceRate: currentAttendanceRate,
        checkinFrequency: actualCheckins / lookbackDays,
        avgWellnessScore: wellnessScore / 100,
        recentPerformance: currentPerformanceCount,
        membershipAge: Math.floor((now.getTime() - membership[0].joinedAt.getTime()) / (1000 * 60 * 60 * 24))
    };

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 7); // Risk scores valid for 1 week

    return {
        boxId,
        membershipId,
        overallRiskScore: Math.round(overallRiskScore * 100) / 100,
        riskLevel,
        churnProbability: Math.round(churnProbability * 10000) / 10000,
        attendanceScore: Math.round(attendanceScore * 100) / 100,
        performanceScore: Math.round(performanceScore * 100) / 100,
        engagementScore: Math.round(engagementScore * 100) / 100,
        wellnessScore: Math.round(wellnessScore * 100) / 100,
        attendanceTrend: Math.round(attendanceTrend * 100) / 100,
        performanceTrend: Math.round(performanceTrend * 100) / 100,
        engagementTrend: Math.round(engagementTrend * 100) / 100,
        wellnessTrend: Math.round(wellnessTrend * 100) / 100,
        daysSinceLastVisit,
        daysSinceLastCheckin,
        daysSinceLastPr,
        factors,
        calculatedAt: new Date(),
        validUntil
    };
}

/**
 * Upsert risk score to database
 */
export async function upsertAthleteRiskScore(riskScoreData: AthleteRiskScoreData) {
    await db.insert(athleteRiskScores).values(riskScoreData)
        .onConflictDoUpdate({
            target: [athleteRiskScores.membershipId],
            set: {
                overallRiskScore: riskScoreData.overallRiskScore,
                riskLevel: riskScoreData.riskLevel,
                churnProbability: riskScoreData.churnProbability,
                attendanceScore: riskScoreData.attendanceScore,
                performanceScore: riskScoreData.performanceScore,
                engagementScore: riskScoreData.engagementScore,
                wellnessScore: riskScoreData.wellnessScore,
                attendanceTrend: riskScoreData.attendanceTrend,
                performanceTrend: riskScoreData.performanceTrend,
                engagementTrend: riskScoreData.engagementTrend,
                wellnessTrend: riskScoreData.wellnessTrend,
                daysSinceLastVisit: riskScoreData.daysSinceLastVisit,
                daysSinceLastCheckin: riskScoreData.daysSinceLastCheckin,
                daysSinceLastPr: riskScoreData.daysSinceLastPr,
                factors: riskScoreData.factors,
                calculatedAt: riskScoreData.calculatedAt,
                validUntil: riskScoreData.validUntil,
                updatedAt: new Date()
            }
        });
}

/**
 * Process and upsert box analytics snapshot
 */
export async function processBoxAnalyticsSnapshot(boxId: string, period: AnalyticsPeriod) {
    try {
        console.log(`[Analytics] Calculating ${period} snapshot for box ${boxId}`);
        const snapshotData = await calculateBoxAnalyticsSnapshot(boxId, period);
        console.log(`[Analytics] Upserting ${period} snapshot for box ${boxId}`);

        await db.insert(boxAnalytics).values(snapshotData)
            .onConflictDoUpdate({
                target: [boxAnalytics.boxId, boxAnalytics.period, boxAnalytics.periodStart],
                set: {
                    totalAthletes: snapshotData.totalAthletes,
                    activeAthletes: snapshotData.activeAthletes,
                    newAthletes: snapshotData.newAthletes,
                    churnedAthletes: snapshotData.churnedAthletes,
                    retentionRate: snapshotData.retentionRate,
                    totalCheckins: snapshotData.totalCheckins,
                    totalAttendances: snapshotData.totalAttendances,
                    avgAttendancePerAthlete: snapshotData.avgAttendancePerAthlete,
                    checkinRate: snapshotData.checkinRate,
                    totalPrs: snapshotData.totalPrs,
                    totalBenchmarkAttempts: snapshotData.totalBenchmarkAttempts,
                    avgAthletePerformanceScore: snapshotData.avgAthletePerformanceScore,
                    highRiskAthletes: snapshotData.highRiskAthletes,
                    totalActiveAlerts: snapshotData.totalActiveAlerts,
                    alertsResolved: snapshotData.alertsResolved,
                    avgTimeToAlertResolution: snapshotData.avgTimeToAlertResolution,
                    avgEnergyLevel: snapshotData.avgEnergyLevel,
                    avgSleepQuality: snapshotData.avgSleepQuality,
                    avgStressLevel: snapshotData.avgStressLevel,
                    avgWorkoutReadiness: snapshotData.avgWorkoutReadiness,
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

/**
 * Recalculate risk scores for all active athletes in a box
 */
export async function recalculateAllRiskScoresForBox(boxId: string) {
    try {
        console.log(`[Analytics] Starting risk score recalculation for box ${boxId}`);

        // Get all active athlete memberships in the box
        const athletes = await db.select({
            id: boxMemberships.id,
            userId: boxMemberships.userId,
            displayName: boxMemberships.displayName
        })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.role, 'athlete'),
                eq(boxMemberships.isActive, true)
            ));

        console.log(`[Analytics] Found ${athletes.length} active athletes for box ${boxId}`);

        // Process each athlete in batches to avoid overwhelming the database
        const batchSize = 10;
        const results = [];

        for (let i = 0; i < athletes.length; i += batchSize) {
            const batch = athletes.slice(i, i + batchSize);

            const batchResults = await Promise.allSettled(
                batch.map(async ({ id: membershipId, displayName }) => {
                    try {
                        const riskScore = await calculateAthleteRiskScore(membershipId, boxId);
                        await upsertAthleteRiskScore(riskScore);
                        console.log(`[Analytics] Updated risk score for athlete ${displayName} (${membershipId}): ${riskScore.riskLevel} (${riskScore.overallRiskScore})`);
                        return { membershipId, displayName, success: true, riskLevel: riskScore.riskLevel };
                    } catch (err) {
                        console.error(`[Analytics] Error calculating risk score for athlete ${displayName} (${membershipId}):`, err);
                        return { membershipId, displayName, success: false, error: err };
                    }
                })
            );

            results.push(...batchResults);

            // Small delay between batches to prevent database overload
            if (i + batchSize < athletes.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

        console.log(`[Analytics] Completed risk score recalculation for box ${boxId}. Success: ${successful}, Failed: ${failed}`);

        // Return summary for monitoring
        return {
            boxId,
            totalAthletes: athletes.length,
            successful,
            failed,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Critical error in recalculateAllRiskScoresForBox for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Clean up expired risk scores
 */
export async function cleanupExpiredRiskScores() {
    try {
        console.log('[Analytics] Cleaning up expired risk scores');

        const result = await db.delete(athleteRiskScores)
            .where(lte(athleteRiskScores.validUntil, new Date()));

        console.log(`[Analytics] Cleaned up expired risk scores`);
        return result;
    } catch (error) {
        console.error('[Analytics] Error cleaning up expired risk scores:', error);
        throw error;
    }
}

/**
 * Update box current counts (for subscription limits)
 */
export async function updateBoxCurrentCounts(boxId: string) {
    try {
        console.log(`[Analytics] Updating current counts for box ${boxId}`);

        const [athleteCount, coachCount] = await Promise.all([
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, 'athlete'),
                    eq(boxMemberships.isActive, true)
                )),
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    inArray(boxMemberships.role, ['coach', 'head_coach']),
                    eq(boxMemberships.isActive, true)
                ))
        ]);

        const athletes = athleteCount[0]?.count ?? 0;
        const coaches = coachCount[0]?.count ?? 0;

        // Get current limits to calculate overages
        const boxInfo = await db.select({
            currentAthleteLimit: boxes.currentAthleteLimit,
            currentCoachLimit: boxes.currentCoachLimit
        })
            .from(boxes)
            .where(eq(boxes.id, boxId))
            .limit(1);

        if (!boxInfo[0]) {
            throw new Error(`Box ${boxId} not found`);
        }

        const athleteOverage = Math.max(0, athletes - boxInfo[0].currentAthleteLimit);
        const coachOverage = Math.max(0, coaches - boxInfo[0].currentCoachLimit);

        await db.update(boxes)
            .set({
                currentAthleteCount: athletes,
                currentCoachCount: coaches,
                currentAthleteOverage: athleteOverage,
                currentCoachOverage: coachOverage,
                lastActivityAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        console.log(`[Analytics] Updated box ${boxId} counts: ${athletes} athletes (${athleteOverage} over), ${coaches} coaches (${coachOverage} over)`);

        return {
            boxId,
            athleteCount: athletes,
            coachCount: coaches,
            athleteOverage,
            coachOverage
        };
    } catch (error) {
        console.error(`[Analytics] Error updating box counts for ${boxId}:`, error);
        throw error;
    }
}
