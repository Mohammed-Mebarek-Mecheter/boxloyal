// src/lib/services/analytics/risk-score-service.ts
import { db } from "@/db";
import {
    athleteRiskScores,
    boxMemberships,
    boxes,
    wodAttendance,
    athletePrs,
    athleteBenchmarks,
    athleteWellnessCheckins,
    wodFeedback,
    movements,
    benchmarkWods
} from "@/db/schema";
import { and, eq, desc, sql, gt, gte, lte, count, avg, sum } from "drizzle-orm";
import { logger } from "@/lib/logger";

export interface RiskFactors {
    attendance: {
        score: number;
        trend: number;
        daysGap: number;
        frequency: number;
    };
    performance: {
        score: number;
        trend: number;
        prCount: number;
        benchmarkProgress: number;
    };
    engagement: {
        score: number;
        trend: number;
        checkinStreak: number;
        feedbackFrequency: number;
    };
    wellness: {
        score: number;
        trend: number;
        averageEnergy: number;
        averageReadiness: number;
    };
}

export class RiskScoreService {
    private static readonly ANALYSIS_PERIOD_DAYS = 30;
    private static readonly COMPARISON_PERIOD_DAYS = 30;

    static async calculateRiskScore(membershipId: string): Promise<void> {
        try {
            logger.info("Starting risk score calculation", { membershipId });

            // Get membership and box data
            const membership = await this.getMembershipData(membershipId);
            if (!membership) {
                throw new Error(`Membership ${membershipId} not found`);
            }

            // Calculate all component scores
            const factors = await this.calculateAllFactors(membershipId, membership.boxId);

            // Calculate overall risk score (weighted average)
            const overallRiskScore = this.calculateOverallScore(factors);

            // Determine risk level and churn probability
            const riskLevel = this.determineRiskLevel(overallRiskScore);
            const churnProbability = this.calculateChurnProbability(overallRiskScore);

            // Calculate key metrics for insights
            const keyMetrics = await this.calculateKeyMetrics(membershipId);

            // Upsert risk score (replace existing or insert new)
            await db.insert(athleteRiskScores)
                .values({
                    membershipId,
                    boxId: membership.boxId,
                    overallRiskScore: overallRiskScore.toString(),
                    riskLevel,
                    churnProbability: churnProbability.toString(),

                    // Component scores
                    attendanceScore: factors.attendance.score.toString(),
                    performanceScore: factors.performance.score.toString(),
                    engagementScore: factors.engagement.score.toString(),
                    wellnessScore: factors.wellness.score.toString(),

                    // Trends
                    attendanceTrend: factors.attendance.trend.toString(),
                    performanceTrend: factors.performance.trend.toString(),
                    engagementTrend: factors.engagement.trend.toString(),
                    wellnessTrend: factors.wellness.trend.toString(),

                    // Key metrics
                    daysSinceLastVisit: keyMetrics.daysSinceLastVisit,
                    daysSinceLastCheckin: keyMetrics.daysSinceLastCheckin,
                    daysSinceLastPr: keyMetrics.daysSinceLastPr,

                    // Risk factors
                    factors: {
                        attendance: factors.attendance,
                        performance: factors.performance,
                        engagement: factors.engagement,
                        wellness: factors.wellness,
                    },

                    validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
                    calculatedAt: new Date()
                })
                .onConflictDoUpdate({
                    target: [athleteRiskScores.membershipId],
                    set: {
                        overallRiskScore: overallRiskScore.toString(),
                        riskLevel,
                        churnProbability: churnProbability.toString(),
                        attendanceScore: factors.attendance.score.toString(),
                        performanceScore: factors.performance.score.toString(),
                        engagementScore: factors.engagement.score.toString(),
                        wellnessScore: factors.wellness.score.toString(),
                        attendanceTrend: factors.attendance.trend.toString(),
                        performanceTrend: factors.performance.trend.toString(),
                        engagementTrend: factors.engagement.trend.toString(),
                        wellnessTrend: factors.wellness.trend.toString(),
                        daysSinceLastVisit: keyMetrics.daysSinceLastVisit,
                        daysSinceLastCheckin: keyMetrics.daysSinceLastCheckin,
                        daysSinceLastPr: keyMetrics.daysSinceLastPr,
                        factors: {
                            attendance: factors.attendance,
                            performance: factors.performance,
                            engagement: factors.engagement,
                            wellness: factors.wellness,
                        },
                        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
                        calculatedAt: new Date(),
                        updatedAt: new Date()
                    }
                });

            logger.info("Risk score calculated successfully", {
                membershipId,
                overallRiskScore,
                riskLevel,
                churnProbability
            });
        } catch (error) {
            logger.error("Failed to calculate risk score", error as Error, { membershipId });
            throw error;
        }
    }

    private static async getMembershipData(membershipId: string) {
        return await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, membershipId),
            with: { box: true }
        });
    }

    private static async calculateAllFactors(membershipId: string, boxId: string): Promise<RiskFactors> {
        const now = new Date();
        const analysisStart = new Date(now.getTime() - this.ANALYSIS_PERIOD_DAYS * 24 * 60 * 60 * 1000);
        const comparisonStart = new Date(now.getTime() - (this.ANALYSIS_PERIOD_DAYS + this.COMPARISON_PERIOD_DAYS) * 24 * 60 * 60 * 1000);

        // Calculate all factors in parallel
        const [attendance, performance, engagement, wellness] = await Promise.all([
            this.calculateAttendanceFactors(membershipId, boxId, analysisStart, comparisonStart),
            this.calculatePerformanceFactors(membershipId, boxId, analysisStart, comparisonStart),
            this.calculateEngagementFactors(membershipId, boxId, analysisStart, comparisonStart),
            this.calculateWellnessFactors(membershipId, boxId, analysisStart, comparisonStart)
        ]);

        return { attendance, performance, engagement, wellness };
    }

    private static async calculateAttendanceFactors(
        membershipId: string,
        boxId: string,
        analysisStart: Date,
        comparisonStart: Date
    ) {
        // Current period attendance
        const currentAttendance = await db
            .select({
                count: count(),
                lastAttendance: sql<Date>`MAX(${wodAttendance.attendanceDate})`.as('lastAttendance')
            })
            .from(wodAttendance)
            .where(
                and(
                    eq(wodAttendance.membershipId, membershipId),
                    eq(wodAttendance.status, "attended"),
                    gte(wodAttendance.attendanceDate, analysisStart)
                )
            );

        // Previous period attendance for trend
        const previousAttendance = await db
            .select({ count: count() })
            .from(wodAttendance)
            .where(
                and(
                    eq(wodAttendance.membershipId, membershipId),
                    eq(wodAttendance.status, "attended"),
                    gte(wodAttendance.attendanceDate, comparisonStart),
                    lte(wodAttendance.attendanceDate, analysisStart)
                )
            );

        const currentCount = currentAttendance[0]?.count || 0;
        const previousCount = previousAttendance[0]?.count || 0;
        const lastAttendance = currentAttendance[0]?.lastAttendance;

        // Calculate days since last visit
        const daysGap = lastAttendance ?
            Math.floor((Date.now() - new Date(lastAttendance).getTime()) / (1000 * 60 * 60 * 24)) : 999;

        // Calculate frequency (sessions per week)
        const frequency = (currentCount / this.ANALYSIS_PERIOD_DAYS) * 7;

        // Calculate trend (percentage change)
        const trend = previousCount > 0 ? ((currentCount - previousCount) / previousCount) * 100 : 0;

        // Score calculation: frequency weight (70%) + recency weight (30%)
        const frequencyScore = Math.min(100, (frequency / 4) * 100); // Assuming 4 sessions/week is ideal
        const recencyScore = Math.max(0, 100 - (daysGap * 5)); // -5 points per day gap
        const score = (frequencyScore * 0.7) + (recencyScore * 0.3);

        return {
            score: Math.round(score),
            trend: Math.round(trend * 100) / 100,
            daysGap,
            frequency: Math.round(frequency * 100) / 100
        };
    }

    private static async calculatePerformanceFactors(
        membershipId: string,
        boxId: string,
        analysisStart: Date,
        comparisonStart: Date
    ) {
        // Current period PRs and benchmarks
        const currentPrs = await db
            .select({ count: count() })
            .from(athletePrs)
            .where(
                and(
                    eq(athletePrs.membershipId, membershipId),
                    gte(athletePrs.achievedAt, analysisStart)
                )
            );

        const currentBenchmarks = await db
            .select({ count: count() })
            .from(athleteBenchmarks)
            .where(
                and(
                    eq(athleteBenchmarks.membershipId, membershipId),
                    gte(athleteBenchmarks.achievedAt, analysisStart)
                )
            );

        // Previous period for trend
        const previousPrs = await db
            .select({ count: count() })
            .from(athletePrs)
            .where(
                and(
                    eq(athletePrs.membershipId, membershipId),
                    gte(athletePrs.achievedAt, comparisonStart),
                    lte(athletePrs.achievedAt, analysisStart)
                )
            );

        const previousBenchmarks = await db
            .select({ count: count() })
            .from(athleteBenchmarks)
            .where(
                and(
                    eq(athleteBenchmarks.membershipId, membershipId),
                    gte(athleteBenchmarks.achievedAt, comparisonStart),
                    lte(athleteBenchmarks.achievedAt, analysisStart)
                )
            );

        const currentPrCount = currentPrs[0]?.count || 0;
        const currentBenchmarkCount = currentBenchmarks[0]?.count || 0;
        const previousPrCount = previousPrs[0]?.count || 0;
        const previousBenchmarkCount = previousBenchmarks[0]?.count || 0;

        const totalCurrentProgress = currentPrCount + currentBenchmarkCount;
        const totalPreviousProgress = previousPrCount + previousBenchmarkCount;

        // Calculate trend
        const trend = totalPreviousProgress > 0 ?
            ((totalCurrentProgress - totalPreviousProgress) / totalPreviousProgress) * 100 : 0;

        // Score calculation: PRs are weighted more heavily than benchmarks
        const prScore = Math.min(100, currentPrCount * 25); // 25 points per PR, max 100
        const benchmarkScore = Math.min(50, currentBenchmarkCount * 15); // 15 points per benchmark, max 50
        const score = prScore + benchmarkScore;

        return {
            score: Math.min(100, Math.round(score)),
            trend: Math.round(trend * 100) / 100,
            prCount: currentPrCount,
            benchmarkProgress: currentBenchmarkCount
        };
    }

    private static async calculateEngagementFactors(
        membershipId: string,
        boxId: string,
        analysisStart: Date,
        comparisonStart: Date
    ) {
        // Get membership data for streak info
        const membership = await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, membershipId)
        });

        // Current period wellness checkins
        const currentCheckins = await db
            .select({ count: count() })
            .from(athleteWellnessCheckins)
            .where(
                and(
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    gte(athleteWellnessCheckins.checkinDate, analysisStart)
                )
            );

        // Current period WOD feedback
        const currentFeedback = await db
            .select({ count: count() })
            .from(wodFeedback)
            .where(
                and(
                    eq(wodFeedback.membershipId, membershipId),
                    gte(wodFeedback.wodDate, analysisStart)
                )
            );

        // Previous period data for trend
        const previousCheckins = await db
            .select({ count: count() })
            .from(athleteWellnessCheckins)
            .where(
                and(
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    gte(athleteWellnessCheckins.checkinDate, comparisonStart),
                    lte(athleteWellnessCheckins.checkinDate, analysisStart)
                )
            );

        const previousFeedback = await db
            .select({ count: count() })
            .from(wodFeedback)
            .where(
                and(
                    eq(wodFeedback.membershipId, membershipId),
                    gte(wodFeedback.wodDate, comparisonStart),
                    lte(wodFeedback.wodDate, analysisStart)
                )
            );

        const currentCheckinCount = currentCheckins[0]?.count || 0;
        const currentFeedbackCount = currentFeedback[0]?.count || 0;
        const previousCheckinCount = previousCheckins[0]?.count || 0;
        const previousFeedbackCount = previousFeedback[0]?.count || 0;
        const checkinStreak = membership?.checkinStreak || 0;

        const currentEngagement = currentCheckinCount + currentFeedbackCount;
        const previousEngagement = previousCheckinCount + previousFeedbackCount;

        // Calculate trend
        const trend = previousEngagement > 0 ?
            ((currentEngagement - previousEngagement) / previousEngagement) * 100 : 0;

        // Score calculation: streak (40%) + checkins (30%) + feedback (30%)
        const streakScore = Math.min(100, checkinStreak * 3); // 3 points per day streak
        const checkinScore = Math.min(100, (currentCheckinCount / this.ANALYSIS_PERIOD_DAYS) * 100 * 3); // Ideal: daily checkins
        const feedbackScore = Math.min(100, currentFeedbackCount * 10); // 10 points per feedback

        const score = (streakScore * 0.4) + (checkinScore * 0.3) + (feedbackScore * 0.3);

        return {
            score: Math.round(score),
            trend: Math.round(trend * 100) / 100,
            checkinStreak,
            feedbackFrequency: Math.round((currentFeedbackCount / this.ANALYSIS_PERIOD_DAYS) * 7 * 100) / 100
        };
    }

    private static async calculateWellnessFactors(
        membershipId: string,
        boxId: string,
        analysisStart: Date,
        comparisonStart: Date
    ) {
        // Current period wellness averages
        const currentWellness = await db
            .select({
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgMotivation: avg(athleteWellnessCheckins.motivationLevel),
                count: count()
            })
            .from(athleteWellnessCheckins)
            .where(
                and(
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    gte(athleteWellnessCheckins.checkinDate, analysisStart)
                )
            );

        // Previous period for trend
        const previousWellness = await db
            .select({
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgMotivation: avg(athleteWellnessCheckins.motivationLevel)
            })
            .from(athleteWellnessCheckins)
            .where(
                and(
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    gte(athleteWellnessCheckins.checkinDate, comparisonStart),
                    lte(athleteWellnessCheckins.checkinDate, analysisStart)
                )
            );

        const current = currentWellness[0];
        const previous = previousWellness[0];

        // Default values if no data
        const currentAvgEnergy = Number(current?.avgEnergy) || 5;
        const currentAvgReadiness = Number(current?.avgReadiness) || 5;
        const currentAvgStress = Number(current?.avgStress) || 5;
        const currentAvgMotivation = Number(current?.avgMotivation) || 5;

        const previousAvgEnergy = Number(previous?.avgEnergy) || currentAvgEnergy;
        const previousAvgReadiness = Number(previous?.avgReadiness) || currentAvgReadiness;

        // Calculate composite wellness score (positive factors - negative factors)
        const positiveScore = ((currentAvgEnergy + currentAvgReadiness + currentAvgMotivation) / 30) * 100;
        const stressImpact = ((10 - currentAvgStress) / 10) * 100; // Invert stress (lower is better)
        const score = (positiveScore * 0.8) + (stressImpact * 0.2);

        // Calculate trend based on energy and readiness
        const currentComposite = (currentAvgEnergy + currentAvgReadiness) / 2;
        const previousComposite = (previousAvgEnergy + previousAvgReadiness) / 2;
        const trend = ((currentComposite - previousComposite) / previousComposite) * 100;

        return {
            score: Math.round(score),
            trend: Math.round(trend * 100) / 100,
            averageEnergy: Math.round(currentAvgEnergy * 100) / 100,
            averageReadiness: Math.round(currentAvgReadiness * 100) / 100
        };
    }

    private static calculateOverallScore(factors: RiskFactors): number {
        // Weighted calculation based on retention impact
        const weights = {
            attendance: 0.35,    // Most important
            engagement: 0.25,    // Second most important
            wellness: 0.25,      // Health indicators
            performance: 0.15    // Least predictive of churn
        };

        return Math.round(
            factors.attendance.score * weights.attendance +
            factors.engagement.score * weights.engagement +
            factors.wellness.score * weights.wellness +
            factors.performance.score * weights.performance
        );
    }

    private static determineRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
        if (score >= 80) return "low";
        if (score >= 60) return "medium";
        if (score >= 40) return "high";
        return "critical";
    }

    private static calculateChurnProbability(score: number): number {
        // Sigmoid function for more realistic probability curve
        const normalizedScore = (score - 50) / 25; // Center around 50, scale by 25
        const probability = 1 / (1 + Math.exp(normalizedScore));
        return Math.round(probability * 10000) / 10000; // 4 decimal places
    }

    private static async calculateKeyMetrics(membershipId: string) {
        const now = new Date();

        // Last visit (attendance)
        const lastVisit = await db
            .select({ lastDate: sql<Date>`MAX(${wodAttendance.attendanceDate})`.as('lastDate') })
            .from(wodAttendance)
            .where(
                and(
                    eq(wodAttendance.membershipId, membershipId),
                    eq(wodAttendance.status, "attended")
                )
            );

        // Last checkin
        const lastCheckin = await db
            .select({ lastDate: sql<Date>`MAX(${athleteWellnessCheckins.checkinDate})`.as('lastDate') })
            .from(athleteWellnessCheckins)
            .where(eq(athleteWellnessCheckins.membershipId, membershipId));

        // Last PR
        const lastPr = await db
            .select({ lastDate: sql<Date>`MAX(${athletePrs.achievedAt})`.as('lastDate') })
            .from(athletePrs)
            .where(eq(athletePrs.membershipId, membershipId));

        const calculateDays = (date: Date | null) =>
            date ? Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)) : null;

        return {
            daysSinceLastVisit: calculateDays(lastVisit[0]?.lastDate),
            daysSinceLastCheckin: calculateDays(lastCheckin[0]?.lastDate),
            daysSinceLastPr: calculateDays(lastPr[0]?.lastDate)
        };
    }

    /**
     * Calculate risk scores for all active memberships in a box
     */
    static async calculateBoxRiskScores(boxId: string): Promise<void> {
        const activeMemberships = await db.query.boxMemberships.findMany({
            where: and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                eq(boxMemberships.role, "athlete")
            ),
            columns: { id: true }
        });

        logger.info("Starting box risk score calculation", {
            boxId,
            membershipCount: activeMemberships.length
        });

        const results = [];
        for (const membership of activeMemberships) {
            try {
                await this.calculateRiskScore(membership.id);
                results.push({ membershipId: membership.id, status: 'success' });
            } catch (error) {
                logger.error("Failed to calculate risk score for membership", error as Error, {
                    membershipId: membership.id
                });
                results.push({
                    membershipId: membership.id,
                    status: 'error',
                    error: (error as Error).message
                });
            }
        }

        logger.info("Completed box risk score calculation", {
            boxId,
            total: results.length,
            successful: results.filter(r => r.status === 'success').length,
            failed: results.filter(r => r.status === 'error').length
        });
    }
}
