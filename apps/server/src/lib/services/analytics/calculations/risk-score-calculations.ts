// src/lib/services/analytics/calculations/risk-score-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteWellnessCheckins,
    athletePrs,
    athleteBenchmarks,
    athleteRiskScores,
    wodAttendance,
} from "@/db/schema";
import { eq, and, gte, count, sql, avg, lte, desc } from "drizzle-orm";

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
    await db.insert(athleteRiskScores).values({
        ...riskScoreData,
        // Convert numbers to strings for decimal fields
        overallRiskScore: riskScoreData.overallRiskScore.toString(),
        churnProbability: riskScoreData.churnProbability?.toString() ?? null,
        attendanceScore: riskScoreData.attendanceScore.toString(),
        performanceScore: riskScoreData.performanceScore.toString(),
        engagementScore: riskScoreData.engagementScore.toString(),
        wellnessScore: riskScoreData.wellnessScore.toString(),
        attendanceTrend: riskScoreData.attendanceTrend?.toString() ?? null,
        performanceTrend: riskScoreData.performanceTrend?.toString() ?? null,
        engagementTrend: riskScoreData.engagementTrend?.toString() ?? null,
        wellnessTrend: riskScoreData.wellnessTrend?.toString() ?? null,
    })
        .onConflictDoUpdate({
            target: [athleteRiskScores.membershipId],
            set: {
                // Convert numbers to strings for decimal fields
                overallRiskScore: riskScoreData.overallRiskScore.toString(),
                churnProbability: riskScoreData.churnProbability?.toString() ?? null,
                attendanceScore: riskScoreData.attendanceScore.toString(),
                performanceScore: riskScoreData.performanceScore.toString(),
                engagementScore: riskScoreData.engagementScore.toString(),
                wellnessScore: riskScoreData.wellnessScore.toString(),
                attendanceTrend: riskScoreData.attendanceTrend?.toString() ?? null,
                performanceTrend: riskScoreData.performanceTrend?.toString() ?? null,
                engagementTrend: riskScoreData.engagementTrend?.toString() ?? null,
                wellnessTrend: riskScoreData.wellnessTrend?.toString() ?? null,
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
