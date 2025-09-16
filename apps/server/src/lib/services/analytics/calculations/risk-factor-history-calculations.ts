// src/lib/services/analytics/calculations/risk-factor-history-calculations.ts
import { db } from "@/db";
import {
    riskFactorHistory as riskFactorHistoryTable,
    boxMemberships,
    athleteWellnessCheckins,
    wodAttendance,
    athletePrs,
    athleteBenchmarks
} from "@/db/schema";
import {eq, and, gte, lte, count, sql, avg, desc, lt} from "drizzle-orm";
import { riskLevelEnum } from "@/db/schema/enums";

type RiskLevelEnum = typeof riskLevelEnum.enumValues[number];

export interface RiskFactorData {
    riskScoreId: string;
    membershipId: string;
    factorType: string;
    factorValue: number;
    weight: number;
    contribution: number;
    description: string;
    metadata: any;
    createdAt: Date;
}

export interface RiskFactorAnalysis {
    boxId: string;
    membershipId: string;
    periodStart: Date;
    periodEnd: Date;
    totalFactors: number;
    primaryRiskFactors: string[];
    riskFactorTrends: { [factorType: string]: number };
    factorContributionBreakdown: { [factorType: string]: number };
    riskFactorHistory: RiskFactorData[];
    predictiveInsights: {
        mostCriticalFactor: string | null;
        emergingRisks: string[];
        stabilizingFactors: string[];
    };
}

interface PartialRiskFactorData {
    factorType: string;
    factorValue: number;
    weight: number;
    contribution: number;
    description: string;
    metadata: any;
}

/**
 * Risk factor calculation weights and thresholds
 */
const RISK_FACTOR_CONFIG = {
    attendance_decline: {
        weight: 0.35,
        thresholds: {
            minor: -10,
            moderate: -25,
            severe: -40
        }
    },
    wellness_deterioration: {
        weight: 0.25,
        thresholds: {
            minor: -15,
            moderate: -30,
            severe: -50
        }
    },
    performance_stagnation: {
        weight: 0.20,
        thresholds: {
            minor: 30,
            moderate: 60,
            severe: 120
        }
    },
    engagement_drop: {
        weight: 0.15,
        thresholds: {
            minor: -20,
            moderate: -40,
            severe: -60
        }
    },
    checkin_inconsistency: {
        weight: 0.05,
        thresholds: {
            minor: 7,
            moderate: 14,
            severe: 30
        }
    }
};

/**
 * Calculate attendance decline factor
 */
async function calculateAttendanceDeclineFactor(
    membershipId: string,
    boxId: string,
    currentDate: Date
): Promise<PartialRiskFactorData | null> {
    const thirtyDaysAgo = new Date(currentDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date(currentDate);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Get attendance for current 30 days vs previous 30 days
    const [currentPeriod, previousPeriod] = await Promise.all([
        db.select({
            attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            total: count()
        })
            .from(wodAttendance)
            .where(and(
                eq(wodAttendance.membershipId, membershipId),
                eq(wodAttendance.boxId, boxId),
                gte(wodAttendance.attendanceDate, sql`${thirtyDaysAgo}::date`),
                lte(wodAttendance.attendanceDate, sql`${currentDate}::date`)
            )),

        db.select({
            attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            total: count()
        })
            .from(wodAttendance)
            .where(and(
                eq(wodAttendance.membershipId, membershipId),
                eq(wodAttendance.boxId, boxId),
                gte(wodAttendance.attendanceDate, sql`${sixtyDaysAgo}::date`),
                lt(wodAttendance.attendanceDate, sql`${thirtyDaysAgo}::date`)
            ))
    ]);

    const currentRate = currentPeriod[0]?.total > 0
        ? (currentPeriod[0].attended / currentPeriod[0].total) * 100
        : 0;

    const previousRate = previousPeriod[0]?.total > 0
        ? (previousPeriod[0].attended / previousPeriod[0].total) * 100
        : 0;

    const attendanceDecline = currentRate - previousRate;

    // Only create factor if there's a significant decline
    if (attendanceDecline >= RISK_FACTOR_CONFIG.attendance_decline.thresholds.minor) {
        return null;
    }

    const config = RISK_FACTOR_CONFIG.attendance_decline;
    const contribution = Math.max(-100, attendanceDecline * config.weight);

    let severity = 'minor';
    if (attendanceDecline <= config.thresholds.severe) severity = 'severe';
    else if (attendanceDecline <= config.thresholds.moderate) severity = 'moderate';

    return {
        factorType: 'attendance_decline',
        factorValue: attendanceDecline,
        weight: config.weight,
        contribution,
        description: `Attendance declined by ${Math.abs(attendanceDecline).toFixed(1)}% over the last 30 days (${severity})`,
        metadata: {
            currentRate,
            previousRate,
            severity,
            currentAttended: currentPeriod[0]?.attended || 0,
            currentTotal: currentPeriod[0]?.total || 0,
            previousAttended: previousPeriod[0]?.attended || 0,
            previousTotal: previousPeriod[0]?.total || 0
        }
    };
}

/**
 * Calculate wellness deterioration factor
 */
async function calculateWellnessDeteriorationFactor(
    membershipId: string,
    boxId: string,
    currentDate: Date
): Promise<PartialRiskFactorData | null> {
    const thirtyDaysAgo = new Date(currentDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date(currentDate);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Get wellness metrics for current vs previous period
    const [currentWellness, previousWellness] = await Promise.all([
        db.select({
            avgEnergy: avg(athleteWellnessCheckins.energyLevel),
            avgSleep: avg(athleteWellnessCheckins.sleepQuality),
            avgStress: avg(athleteWellnessCheckins.stressLevel),
            avgMotivation: avg(athleteWellnessCheckins.motivationLevel),
            count: count()
        })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.membershipId, membershipId),
                eq(athleteWellnessCheckins.boxId, boxId),
                gte(athleteWellnessCheckins.checkinDate, thirtyDaysAgo),
                lte(athleteWellnessCheckins.checkinDate, currentDate)
            )),

        db.select({
            avgEnergy: avg(athleteWellnessCheckins.energyLevel),
            avgSleep: avg(athleteWellnessCheckins.sleepQuality),
            avgStress: avg(athleteWellnessCheckins.stressLevel),
            avgMotivation: avg(athleteWellnessCheckins.motivationLevel),
            count: count()
        })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.membershipId, membershipId),
                eq(athleteWellnessCheckins.boxId, boxId),
                gte(athleteWellnessCheckins.checkinDate, sixtyDaysAgo),
                lt(athleteWellnessCheckins.checkinDate, thirtyDaysAgo)
            ))
    ]);

    if (!currentWellness[0]?.count || !previousWellness[0]?.count) {
        return null;
    }

    // Calculate composite wellness score (higher stress reduces score)
    const currentScore = (
        Number(currentWellness[0].avgEnergy || 0) +
        Number(currentWellness[0].avgSleep || 0) +
        Number(currentWellness[0].avgMotivation || 0) +
        (10 - Number(currentWellness[0].avgStress || 5))
    ) / 4;

    const previousScore = (
        Number(previousWellness[0].avgEnergy || 0) +
        Number(previousWellness[0].avgSleep || 0) +
        Number(previousWellness[0].avgMotivation || 0) +
        (10 - Number(previousWellness[0].avgStress || 5))
    ) / 4;

    const wellnessDecline = ((currentScore - previousScore) / previousScore) * 100;

    // Only create factor if there's a significant decline
    if (wellnessDecline >= RISK_FACTOR_CONFIG.wellness_deterioration.thresholds.minor) {
        return null;
    }

    const config = RISK_FACTOR_CONFIG.wellness_deterioration;
    const contribution = Math.max(-100, wellnessDecline * config.weight);

    let severity = 'minor';
    if (wellnessDecline <= config.thresholds.severe) severity = 'severe';
    else if (wellnessDecline <= config.thresholds.moderate) severity = 'moderate';

    return {
        factorType: 'wellness_deterioration',
        factorValue: wellnessDecline,
        weight: config.weight,
        contribution,
        description: `Wellness metrics declined by ${Math.abs(wellnessDecline).toFixed(1)}% over the last 30 days (${severity})`,
        metadata: {
            currentScore,
            previousScore,
            severity,
            currentMetrics: {
                energy: Number(currentWellness[0].avgEnergy || 0),
                sleep: Number(currentWellness[0].avgSleep || 0),
                stress: Number(currentWellness[0].avgStress || 0),
                motivation: Number(currentWellness[0].avgMotivation || 0)
            },
            previousMetrics: {
                energy: Number(previousWellness[0].avgEnergy || 0),
                sleep: Number(previousWellness[0].avgSleep || 0),
                stress: Number(previousWellness[0].avgStress || 0),
                motivation: Number(previousWellness[0].avgMotivation || 0)
            }
        }
    };
}

/**
 * Calculate performance stagnation factor
 */
async function calculatePerformanceStagnationFactor(
    membershipId: string,
    boxId: string,
    currentDate: Date
): Promise<PartialRiskFactorData | null> {
    // Get last PR or benchmark achievement
    const [lastPr, lastBenchmark] = await Promise.all([
        db.select({ achievedAt: athletePrs.achievedAt })
            .from(athletePrs)
            .where(and(
                eq(athletePrs.membershipId, membershipId),
                eq(athletePrs.boxId, boxId)
            ))
            .orderBy(desc(athletePrs.achievedAt))
            .limit(1),

        db.select({ achievedAt: athleteBenchmarks.achievedAt })
            .from(athleteBenchmarks)
            .where(and(
                eq(athleteBenchmarks.membershipId, membershipId),
                eq(athleteBenchmarks.boxId, boxId)
            ))
            .orderBy(desc(athleteBenchmarks.achievedAt))
            .limit(1)
    ]);

    const lastPrDate = lastPr[0]?.achievedAt;
    const lastBenchmarkDate = lastBenchmark[0]?.achievedAt;

    // Find the most recent achievement
    let lastAchievementDate: Date | null = null;
    if (lastPrDate && lastBenchmarkDate) {
        lastAchievementDate = lastPrDate > lastBenchmarkDate ? lastPrDate : lastBenchmarkDate;
    } else if (lastPrDate) {
        lastAchievementDate = lastPrDate;
    } else if (lastBenchmarkDate) {
        lastAchievementDate = lastBenchmarkDate;
    }

    if (!lastAchievementDate) {
        // No achievements recorded - this is a stagnation factor
        return {
            factorType: 'performance_stagnation',
            factorValue: 999,
            weight: RISK_FACTOR_CONFIG.performance_stagnation.weight,
            contribution: -20,
            description: 'No personal records or benchmark improvements recorded',
            metadata: {
                severity: 'severe',
                daysSinceLastAchievement: null,
                lastAchievementType: null
            }
        };
    }

    const daysSinceLastAchievement = Math.floor(
        (currentDate.getTime() - lastAchievementDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const config = RISK_FACTOR_CONFIG.performance_stagnation;

    // Only create factor if stagnation period exceeds threshold
    if (daysSinceLastAchievement < config.thresholds.minor) {
        return null;
    }

    let severity = 'minor';
    let contribution = -5;

    if (daysSinceLastAchievement >= config.thresholds.severe) {
        severity = 'severe';
        contribution = -25;
    } else if (daysSinceLastAchievement >= config.thresholds.moderate) {
        severity = 'moderate';
        contribution = -15;
    }

    return {
        factorType: 'performance_stagnation',
        factorValue: daysSinceLastAchievement,
        weight: config.weight,
        contribution,
        description: `${daysSinceLastAchievement} days since last personal record or benchmark improvement (${severity})`,
        metadata: {
            severity,
            daysSinceLastAchievement,
            lastAchievementDate: lastAchievementDate.toISOString(),
            lastAchievementType: lastPrDate === lastAchievementDate ? 'pr' : 'benchmark'
        }
    };
}

/**
 * Calculate engagement drop factor based on checkin frequency
 */
async function calculateEngagementDropFactor(
    membershipId: string,
    boxId: string,
    currentDate: Date
): Promise<PartialRiskFactorData | null> {
    const thirtyDaysAgo = new Date(currentDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date(currentDate);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Get checkin frequency for current vs previous period
    const [currentPeriod, previousPeriod] = await Promise.all([
        db.select({ count: count() })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.membershipId, membershipId),
                eq(athleteWellnessCheckins.boxId, boxId),
                gte(athleteWellnessCheckins.checkinDate, thirtyDaysAgo),
                lte(athleteWellnessCheckins.checkinDate, currentDate)
            )),

        db.select({ count: count() })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.membershipId, membershipId),
                eq(athleteWellnessCheckins.boxId, boxId),
                gte(athleteWellnessCheckins.checkinDate, sixtyDaysAgo),
                lt(athleteWellnessCheckins.checkinDate, thirtyDaysAgo)
            ))
    ]);

    const currentCheckins = currentPeriod[0]?.count || 0;
    const previousCheckins = previousPeriod[0]?.count || 0;

    // Calculate engagement change
    const engagementChange = previousCheckins > 0
        ? ((currentCheckins - previousCheckins) / previousCheckins) * 100
        : (currentCheckins > 0 ? 100 : 0);

    const config = RISK_FACTOR_CONFIG.engagement_drop;

    // Only create factor if there's a significant drop
    if (engagementChange >= config.thresholds.minor) {
        return null;
    }

    const contribution = Math.max(-100, engagementChange * config.weight);

    let severity = 'minor';
    if (engagementChange <= config.thresholds.severe) severity = 'severe';
    else if (engagementChange <= config.thresholds.moderate) severity = 'moderate';

    return {
        factorType: 'engagement_drop',
        factorValue: engagementChange,
        weight: config.weight,
        contribution,
        description: `Check-in frequency dropped by ${Math.abs(engagementChange).toFixed(1)}% over the last 30 days (${severity})`,
        metadata: {
            severity,
            currentCheckins,
            previousCheckins,
            engagementChange
        }
    };
}

/**
 * Calculate checkin inconsistency factor
 */
async function calculateCheckinInconsistencyFactor(
    membershipId: string,
    boxId: string,
    currentDate: Date
): Promise<PartialRiskFactorData | null> {
    // Get last checkin
    const lastCheckin = await db.select({ checkinDate: athleteWellnessCheckins.checkinDate })
        .from(athleteWellnessCheckins)
        .where(and(
            eq(athleteWellnessCheckins.membershipId, membershipId),
            eq(athleteWellnessCheckins.boxId, boxId)
        ))
        .orderBy(desc(athleteWellnessCheckins.checkinDate))
        .limit(1);

    if (!lastCheckin[0]) {
        // No checkins at all
        return {
            factorType: 'checkin_inconsistency',
            factorValue: 999,
            weight: RISK_FACTOR_CONFIG.checkin_inconsistency.weight,
            contribution: -10,
            description: 'No wellness check-ins recorded',
            metadata: {
                severity: 'severe',
                daysSinceLastCheckin: null
            }
        };
    }

    const daysSinceLastCheckin = Math.floor(
        (currentDate.getTime() - lastCheckin[0].checkinDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const config = RISK_FACTOR_CONFIG.checkin_inconsistency;

    // Only create factor if inconsistency exceeds threshold
    if (daysSinceLastCheckin < config.thresholds.minor) {
        return null;
    }

    let severity = 'minor';
    let contribution = -2;

    if (daysSinceLastCheckin >= config.thresholds.severe) {
        severity = 'severe';
        contribution = -10;
    } else if (daysSinceLastCheckin >= config.thresholds.moderate) {
        severity = 'moderate';
        contribution = -5;
    }

    return {
        factorType: 'checkin_inconsistency',
        factorValue: daysSinceLastCheckin,
        weight: config.weight,
        contribution,
        description: `${daysSinceLastCheckin} days since last wellness check-in (${severity})`,
        metadata: {
            severity,
            daysSinceLastCheckin,
            lastCheckinDate: lastCheckin[0].checkinDate.toISOString()
        }
    };
}

/**
 * Calculate and store risk factors for an athlete's risk score
 */
export async function calculateRiskFactors(
    riskScoreId: string,
    membershipId: string,
    boxId: string,
    calculationDate: Date = new Date()
): Promise<RiskFactorData[]> {
    const factors: RiskFactorData[] = [];

    // Calculate all risk factors
    const factorCalculations = await Promise.allSettled([
        calculateAttendanceDeclineFactor(membershipId, boxId, calculationDate),
        calculateWellnessDeteriorationFactor(membershipId, boxId, calculationDate),
        calculatePerformanceStagnationFactor(membershipId, boxId, calculationDate),
        calculateEngagementDropFactor(membershipId, boxId, calculationDate),
        calculateCheckinInconsistencyFactor(membershipId, boxId, calculationDate)
    ]);

    // Process successful factor calculations
    for (const result of factorCalculations) {
        if (result.status === 'fulfilled' && result.value) {
            factors.push({
                ...result.value,
                riskScoreId,
                membershipId,
                createdAt: calculationDate
            });
        } else if (result.status === 'rejected') {
            console.warn('Risk factor calculation failed:', result.reason);
        }
    }

    // Store factors in database
    if (factors.length > 0) {
        try {
            await db.insert(riskFactorHistoryTable).values(
                factors.map(factor => ({
                    riskScoreId: factor.riskScoreId,
                    membershipId: factor.membershipId,
                    factorType: factor.factorType,
                    factorValue: factor.factorValue.toString(),
                    weight: factor.weight.toString(),
                    contribution: factor.contribution.toString(),
                    description: factor.description,
                    metadata: factor.metadata,
                    createdAt: factor.createdAt
                }))
            );
        } catch (error) {
            console.error('Error storing risk factors:', error);
            throw error;
        }
    }

    return factors;
}

/**
 * Analyze risk factor trends for an athlete
 */
export async function analyzeRiskFactorTrends(
    membershipId: string,
    boxId: string,
    lookbackDays: number = 90
): Promise<RiskFactorAnalysis> {
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - lookbackDays);

    // Get all risk factors for the period
    const riskFactorRecords = await db.select({
        factorType: riskFactorHistoryTable.factorType,
        factorValue: riskFactorHistoryTable.factorValue,
        weight: riskFactorHistoryTable.weight,
        contribution: riskFactorHistoryTable.contribution,
        description: riskFactorHistoryTable.description,
        metadata: riskFactorHistoryTable.metadata,
        createdAt: riskFactorHistoryTable.createdAt
    })
        .from(riskFactorHistoryTable)
        .where(and(
            eq(riskFactorHistoryTable.membershipId, membershipId),
            gte(riskFactorHistoryTable.createdAt, periodStart),
            lte(riskFactorHistoryTable.createdAt, periodEnd)
        ))
        .orderBy(desc(riskFactorHistoryTable.createdAt));

    // Analyze trends
    const factorTrends: { [factorType: string]: number } = {};
    const contributionBreakdown: { [factorType: string]: number } = {};
    const factorTypes = new Set(riskFactorRecords.map(f => f.factorType));

    factorTypes.forEach(factorType => {
        const typeFactors = riskFactorRecords.filter(f => f.factorType === factorType);

        if (typeFactors.length >= 2) {
            const recent = Number(typeFactors[0].factorValue);
            const older = Number(typeFactors[typeFactors.length - 1].factorValue);
            factorTrends[factorType] = recent - older;
        }

        // Average contribution
        contributionBreakdown[factorType] = typeFactors.reduce((sum, f) =>
            sum + Number(f.contribution), 0) / typeFactors.length;
    });

    // Identify primary risk factors (top contributors)
    const primaryRiskFactors = Object.entries(contributionBreakdown)
        .sort(([,a], [,b]) => a - b)
        .slice(0, 3)
        .map(([factorType]) => factorType);

    // Generate predictive insights
    const mostCriticalFactor = primaryRiskFactors.length > 0 ? primaryRiskFactors[0] : null;

    const emergingRisks = Object.entries(factorTrends)
        .filter(([, trend]) => trend < -5)
        .map(([factorType]) => factorType);

    const stabilizingFactors = Object.entries(factorTrends)
        .filter(([, trend]) => trend > 5)
        .map(([factorType]) => factorType);

    const riskFactorHistory: RiskFactorData[] = riskFactorRecords.map(f => ({
        riskScoreId: '',
        membershipId,
        factorType: f.factorType,
        factorValue: Number(f.factorValue),
        weight: Number(f.weight),
        contribution: Number(f.contribution),
        description: f.description ?? '',
        metadata: f.metadata,
        createdAt: f.createdAt
    }));

    return {
        boxId,
        membershipId,
        periodStart,
        periodEnd,
        totalFactors: riskFactorRecords.length,
        primaryRiskFactors,
        riskFactorTrends: factorTrends,
        factorContributionBreakdown: contributionBreakdown,
        riskFactorHistory,
        predictiveInsights: {
            mostCriticalFactor,
            emergingRisks,
            stabilizingFactors
        }
    };
}

/**
 * Get box-wide risk factor analytics
 */
export async function getBoxRiskFactorAnalytics(
    boxId: string,
    lookbackDays: number = 30
): Promise<{
    boxId: string;
    periodStart: Date;
    periodEnd: Date;
    totalAthletes: number;
    athletesWithRiskFactors: number;
    commonRiskFactors: { [factorType: string]: { count: number; avgContribution: number } };
    riskFactorTrends: { [factorType: string]: number };
    highRiskAthletes: Array<{
        membershipId: string;
        displayName: string;
        primaryRiskFactor: string;
        riskFactorCount: number;
        totalContribution: number;
    }>;
}> {
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - lookbackDays);

    // Get all risk factors for the box in the period
    const factors = await db.select({
        membershipId: riskFactorHistoryTable.membershipId,
        factorType: riskFactorHistoryTable.factorType,
        contribution: riskFactorHistoryTable.contribution,
        createdAt: riskFactorHistoryTable.createdAt,
        displayName: boxMemberships.displayName
    })
        .from(riskFactorHistoryTable)
        .innerJoin(boxMemberships, eq(riskFactorHistoryTable.membershipId, boxMemberships.id))
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            gte(riskFactorHistoryTable.createdAt, periodStart),
            lte(riskFactorHistoryTable.createdAt, periodEnd)
        ));

    const totalAthletes = await db.select({ count: count() })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            eq(boxMemberships.isActive, true)
        ));

    const athletesWithRiskFactors = new Set(factors.map(f => f.membershipId)).size;

    // Analyze common risk factors
    const commonRiskFactors: { [factorType: string]: { count: number; avgContribution: number } } = {};
    const factorTypes = new Set(factors.map(f => f.factorType));

    factorTypes.forEach(factorType => {
        const typeFactors = factors.filter(f => f.factorType === factorType);
        commonRiskFactors[factorType] = {
            count: typeFactors.length,
            avgContribution: typeFactors.reduce((sum, f) => sum + Number(f.contribution), 0) / typeFactors.length
        };
    });

    // Identify high-risk athletes
    const athleteRiskMap = new Map<string, {
        membershipId: string;
        displayName: string;
        factors: Array<{ factorType: string; contribution: number }>;
    }>();

    factors.forEach(factor => {
        if (!athleteRiskMap.has(factor.membershipId)) {
            athleteRiskMap.set(factor.membershipId, {
                membershipId: factor.membershipId,
                displayName: factor.displayName,
                factors: []
            });
        }

        athleteRiskMap.get(factor.membershipId)!.factors.push({
            factorType: factor.factorType,
            contribution: Number(factor.contribution)
        });
    });

    const highRiskAthletes = Array.from(athleteRiskMap.values())
        .map(athlete => {
            const totalContribution = athlete.factors.reduce((sum, f) => sum + f.contribution, 0);
            const primaryRiskFactor = athlete.factors
                .sort((a, b) => a.contribution - b.contribution)[0]?.factorType || 'unknown';

            return {
                membershipId: athlete.membershipId,
                displayName: athlete.displayName,
                primaryRiskFactor,
                riskFactorCount: athlete.factors.length,
                totalContribution
            };
        })
        .filter(athlete => athlete.totalContribution < -20)
        .sort((a, b) => a.totalContribution - b.totalContribution)
        .slice(0, 10);

    // Calculate risk factor trends
    const riskFactorTrends: { [factorType: string]: number } = {};
    factorTypes.forEach(factorType => {
        const recentFactors = factors.filter(f =>
            f.factorType === factorType &&
            f.createdAt >= new Date(periodEnd.getTime() - (7 * 24 * 60 * 60 * 1000))
        );
        const olderFactors = factors.filter(f =>
            f.factorType === factorType &&
            f.createdAt < new Date(periodEnd.getTime() - (7 * 24 * 60 * 60 * 1000))
        );

        const recentAvg = recentFactors.length > 0
            ? recentFactors.reduce((sum, f) => sum + Number(f.contribution), 0) / recentFactors.length
            : 0;
        const olderAvg = olderFactors.length > 0
            ? olderFactors.reduce((sum, f) => sum + Number(f.contribution), 0) / olderFactors.length
            : 0;

        riskFactorTrends[factorType] = recentAvg - olderAvg;
    });

    return {
        boxId,
        periodStart,
        periodEnd,
        totalAthletes: totalAthletes[0]?.count || 0,
        athletesWithRiskFactors,
        commonRiskFactors,
        riskFactorTrends,
        highRiskAthletes
    };
}
