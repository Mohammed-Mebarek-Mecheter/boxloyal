// src/lib/services/analytics/calculations/athlete-segment-analytics-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteSegmentAnalytics,
    athleteWellnessCheckins,
    athleteRiskScores,
    wodAttendance,
    athletePrs,
    athleteBenchmarks
} from "@/db/schema";
import { eq, and, gte, lte, count, sql, avg } from "drizzle-orm";

export interface SegmentCriteria {
    type: 'demographic' | 'behavioral' | 'risk' | 'engagement' | 'performance';
    rules: SegmentRule[];
}

export interface SegmentRule {
    field: string;
    operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'between' | 'in' | 'contains';
    value: any;
    value2?: any; // For 'between' operator
}

export interface AthleteSegmentAnalyticsData {
    boxId: string;
    segmentType: string;
    segmentName: string;
    segmentCriteria: SegmentCriteria;
    periodStart: Date;
    periodEnd: Date;
    segmentSize: number;
    percentOfTotal: number;
    avgRiskScore: number | null;
    avgAttendanceRate: number | null;
    avgCheckinRate: number | null;
    avgPrsPerMonth: number | null;
    avgEnergyLevel: number | null;
    avgSleepQuality: number | null;
    avgStressLevel: number | null;
    churnRate: number | null;
    avgTenure: number | null;
    totalRevenue: number | null;
    avgRevenuePerAthlete: number | null;
    calculatedAt: Date;
}

interface AthleteProfile {
    membershipId: string;
    displayName: string;
    joinedAt: Date;
    isActive: boolean;
    leftAt: Date | null;
    tenure: number; // days
    riskScore: number | null;
    attendanceRate: number;
    checkinRate: number;
    prsPerMonth: number;
    energyLevel: number | null;
    sleepQuality: number | null;
    stressLevel: number | null;
}

/**
 * Get athlete profiles with all metrics for segmentation
 */
async function getAthleteProfiles(
    boxId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<AthleteProfile[]> {
    // Get all athletes in the box
    const athletes = await db
        .select({
            membershipId: boxMemberships.id,
            displayName: boxMemberships.displayName,
            joinedAt: boxMemberships.joinedAt,
            isActive: boxMemberships.isActive,
            leftAt: boxMemberships.leftAt
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            lte(boxMemberships.joinedAt, periodEnd) // Must have joined by period end
        ));

    const profiles: AthleteProfile[] = [];
    const daysInPeriod = Math.floor((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    const monthsInPeriod = daysInPeriod / 30.44; // Average days per month

    for (const athlete of athletes) {
        const tenure = Math.floor((periodEnd.getTime() - athlete.joinedAt.getTime()) / (1000 * 60 * 60 * 24));

        // Get risk score
        const riskScore = await db
            .select({ score: athleteRiskScores.overallRiskScore })
            .from(athleteRiskScores)
            .where(and(
                eq(athleteRiskScores.membershipId, athlete.membershipId),
                lte(athleteRiskScores.calculatedAt, periodEnd)
            ))
            .orderBy(sql`${athleteRiskScores.calculatedAt} DESC`)
            .limit(1);

        // Get attendance rate
        const attendance = await db
            .select({
                attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
                total: count()
            })
            .from(wodAttendance)
            .where(and(
                eq(wodAttendance.membershipId, athlete.membershipId),
                gte(wodAttendance.attendanceDate, sql`${periodStart}::date`),
                lte(wodAttendance.attendanceDate, sql`${periodEnd}::date`)
            ));

        const attendanceRate = attendance[0]?.total > 0
            ? (attendance[0].attended / attendance[0].total) * 100
            : 0;

        // Get checkin rate
        const checkins = await db
            .select({ count: count() })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.membershipId, athlete.membershipId),
                gte(athleteWellnessCheckins.checkinDate, periodStart),
                lte(athleteWellnessCheckins.checkinDate, periodEnd)
            ));

        const checkinRate = (checkins[0]?.count || 0) / daysInPeriod * 100;

        // Get PRs per month
        const [prs, benchmarks] = await Promise.all([
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.membershipId, athlete.membershipId),
                    gte(athletePrs.achievedAt, periodStart),
                    lte(athletePrs.achievedAt, periodEnd)
                )),
            db.select({ count: count() })
                .from(athleteBenchmarks)
                .where(and(
                    eq(athleteBenchmarks.membershipId, athlete.membershipId),
                    gte(athleteBenchmarks.achievedAt, periodStart),
                    lte(athleteBenchmarks.achievedAt, periodEnd)
                ))
        ]);

        const totalPrs = (prs[0]?.count || 0) + (benchmarks[0]?.count || 0);
        const prsPerMonth = monthsInPeriod > 0 ? totalPrs / monthsInPeriod : 0;

        // Get wellness metrics
        const wellness = await db
            .select({
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgSleep: avg(athleteWellnessCheckins.sleepQuality),
                avgStress: avg(athleteWellnessCheckins.stressLevel)
            })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.membershipId, athlete.membershipId),
                gte(athleteWellnessCheckins.checkinDate, periodStart),
                lte(athleteWellnessCheckins.checkinDate, periodEnd)
            ));

        profiles.push({
            membershipId: athlete.membershipId,
            displayName: athlete.displayName,
            joinedAt: athlete.joinedAt,
            isActive: athlete.isActive,
            leftAt: athlete.leftAt,
            tenure,
            riskScore: riskScore[0]?.score ? Number(riskScore[0].score) : null,
            attendanceRate,
            checkinRate,
            prsPerMonth,
            energyLevel: wellness[0]?.avgEnergy ? Number(wellness[0].avgEnergy) : null,
            sleepQuality: wellness[0]?.avgSleep ? Number(wellness[0].avgSleep) : null,
            stressLevel: wellness[0]?.avgStress ? Number(wellness[0].avgStress) : null
        });
    }

    return profiles;
}

/**
 * Apply segmentation criteria to filter athletes
 */
function applySegmentCriteria(profiles: AthleteProfile[], criteria: SegmentCriteria): AthleteProfile[] {
    return profiles.filter(profile => {
        return criteria.rules.every(rule => {
            const value = getProfileValue(profile, rule.field);
            return matchesRule(value, rule);
        });
    });
}

/**
 * Get profile value by field name
 */
function getProfileValue(profile: AthleteProfile, field: string): any {
    switch (field) {
        case 'tenure': return profile.tenure;
        case 'riskScore': return profile.riskScore;
        case 'attendanceRate': return profile.attendanceRate;
        case 'checkinRate': return profile.checkinRate;
        case 'prsPerMonth': return profile.prsPerMonth;
        case 'energyLevel': return profile.energyLevel;
        case 'sleepQuality': return profile.sleepQuality;
        case 'stressLevel': return profile.stressLevel;
        case 'isActive': return profile.isActive;
        default: return null;
    }
}

/**
 * Check if a value matches a segmentation rule
 */
function matchesRule(value: any, rule: SegmentRule): boolean {
    if (value === null || value === undefined) return false;

    switch (rule.operator) {
        case 'eq': return value === rule.value;
        case 'gt': return value > rule.value;
        case 'lt': return value < rule.value;
        case 'gte': return value >= rule.value;
        case 'lte': return value <= rule.value;
        case 'between': return value >= rule.value && value <= (rule.value2 || rule.value);
        case 'in': return Array.isArray(rule.value) && rule.value.includes(value);
        case 'contains': return typeof value === 'string' && typeof rule.value === 'string' &&
            value.toLowerCase().includes(rule.value.toLowerCase());
        default: return false;
    }
}

/**
 * Calculate segment metrics from filtered profiles
 */
function calculateSegmentMetrics(
    segmentProfiles: AthleteProfile[],
    allProfiles: AthleteProfile[],
    periodStart: Date,
    periodEnd: Date
): {
    segmentSize: number;
    percentOfTotal: number;
    avgRiskScore: number | null;
    avgAttendanceRate: number | null;
    avgCheckinRate: number | null;
    avgPrsPerMonth: number | null;
    avgEnergyLevel: number | null;
    avgSleepQuality: number | null;
    avgStressLevel: number | null;
    churnRate: number | null;
    avgTenure: number | null;
} {
    const segmentSize = segmentProfiles.length;
    const percentOfTotal = allProfiles.length > 0 ? (segmentSize / allProfiles.length) * 100 : 0;

    if (segmentSize === 0) {
        return {
            segmentSize: 0,
            percentOfTotal: 0,
            avgRiskScore: null,
            avgAttendanceRate: null,
            avgCheckinRate: null,
            avgPrsPerMonth: null,
            avgEnergyLevel: null,
            avgSleepQuality: null,
            avgStressLevel: null,
            churnRate: null,
            avgTenure: null
        };
    }

    // Calculate averages
    const profilesWithRiskScore = segmentProfiles.filter(p => p.riskScore !== null);
    const avgRiskScore = profilesWithRiskScore.length > 0
        ? profilesWithRiskScore.reduce((sum, p) => sum + p.riskScore!, 0) / profilesWithRiskScore.length
        : null;

    const avgAttendanceRate = segmentProfiles.reduce((sum, p) => sum + p.attendanceRate, 0) / segmentSize;
    const avgCheckinRate = segmentProfiles.reduce((sum, p) => sum + p.checkinRate, 0) / segmentSize;
    const avgPrsPerMonth = segmentProfiles.reduce((sum, p) => sum + p.prsPerMonth, 0) / segmentSize;

    const profilesWithEnergy = segmentProfiles.filter(p => p.energyLevel !== null);
    const avgEnergyLevel = profilesWithEnergy.length > 0
        ? profilesWithEnergy.reduce((sum, p) => sum + p.energyLevel!, 0) / profilesWithEnergy.length
        : null;

    const profilesWithSleep = segmentProfiles.filter(p => p.sleepQuality !== null);
    const avgSleepQuality = profilesWithSleep.length > 0
        ? profilesWithSleep.reduce((sum, p) => sum + p.sleepQuality!, 0) / profilesWithSleep.length
        : null;

    const profilesWithStress = segmentProfiles.filter(p => p.stressLevel !== null);
    const avgStressLevel = profilesWithStress.length > 0
        ? profilesWithStress.reduce((sum, p) => sum + p.stressLevel!, 0) / profilesWithStress.length
        : null;

    const churnedProfiles = segmentProfiles.filter(p => !p.isActive && p.leftAt && p.leftAt <= periodEnd);
    const churnRate = (churnedProfiles.length / segmentSize) * 100;

    const avgTenure = segmentProfiles.reduce((sum, p) => sum + p.tenure, 0) / segmentSize;

    return {
        segmentSize,
        percentOfTotal: Math.round(percentOfTotal * 100) / 100,
        avgRiskScore: avgRiskScore ? Math.round(avgRiskScore * 100) / 100 : null,
        avgAttendanceRate: Math.round(avgAttendanceRate * 100) / 100,
        avgCheckinRate: Math.round(avgCheckinRate * 100) / 100,
        avgPrsPerMonth: Math.round(avgPrsPerMonth * 100) / 100,
        avgEnergyLevel: avgEnergyLevel ? Math.round(avgEnergyLevel * 100) / 100 : null,
        avgSleepQuality: avgSleepQuality ? Math.round(avgSleepQuality * 100) / 100 : null,
        avgStressLevel: avgStressLevel ? Math.round(avgStressLevel * 100) / 100 : null,
        churnRate: Math.round(churnRate * 100) / 100,
        avgTenure: Math.round(avgTenure * 100) / 100
    };
}

/**
 * Define standard segment criteria
 */
export function getStandardSegmentCriteria(): { [key: string]: SegmentCriteria } {
    return {
        // Risk-based segments
        high_risk: {
            type: 'risk',
            rules: [
                { field: 'riskScore', operator: 'gte', value: 70 },
                { field: 'isActive', operator: 'eq', value: true }
            ]
        },
        low_risk: {
            type: 'risk',
            rules: [
                { field: 'riskScore', operator: 'lt', value: 30 },
                { field: 'isActive', operator: 'eq', value: true }
            ]
        },

        // Engagement-based segments
        highly_engaged: {
            type: 'engagement',
            rules: [
                { field: 'attendanceRate', operator: 'gte', value: 70 },
                { field: 'checkinRate', operator: 'gte', value: 50 },
                { field: 'isActive', operator: 'eq', value: true }
            ]
        },
        low_engagement: {
            type: 'engagement',
            rules: [
                { field: 'attendanceRate', operator: 'lt', value: 30 },
                { field: 'checkinRate', operator: 'lt', value: 20 },
                { field: 'isActive', operator: 'eq', value: true }
            ]
        },

        // Performance-based segments
        high_performers: {
            type: 'performance',
            rules: [
                { field: 'prsPerMonth', operator: 'gte', value: 2 },
                { field: 'attendanceRate', operator: 'gte', value: 60 }
            ]
        },
        beginners: {
            type: 'performance',
            rules: [
                { field: 'tenure', operator: 'lt', value: 90 }, // Less than 3 months
                { field: 'isActive', operator: 'eq', value: true }
            ]
        },

        // Behavioral segments
        consistent_attendees: {
            type: 'behavioral',
            rules: [
                { field: 'attendanceRate', operator: 'between', value: 60, value2: 85 },
                { field: 'tenure', operator: 'gte', value: 90 }
            ]
        },
        wellness_focused: {
            type: 'behavioral',
            rules: [
                { field: 'checkinRate', operator: 'gte', value: 60 },
                { field: 'energyLevel', operator: 'gte', value: 7 }
            ]
        },

        // Demographic segments
        new_members: {
            type: 'demographic',
            rules: [
                { field: 'tenure', operator: 'lt', value: 30 }, // Less than 1 month
                { field: 'isActive', operator: 'eq', value: true }
            ]
        },
        long_term_members: {
            type: 'demographic',
            rules: [
                { field: 'tenure', operator: 'gte', value: 365 }, // More than 1 year
                { field: 'isActive', operator: 'eq', value: true }
            ]
        },

        // Recently churned
        recent_churn: {
            type: 'behavioral',
            rules: [
                { field: 'isActive', operator: 'eq', value: false },
                { field: 'tenure', operator: 'gte', value: 30 } // Had some tenure before churning
            ]
        }
    };
}

/**
 * Calculate analytics for a specific segment
 */
export async function calculateAthleteSegmentAnalytics(
    boxId: string,
    segmentType: string,
    segmentName: string,
    segmentCriteria: SegmentCriteria,
    periodStart: Date,
    periodEnd: Date
): Promise<AthleteSegmentAnalyticsData> {
    // Get all athlete profiles
    const allProfiles = await getAthleteProfiles(boxId, periodStart, periodEnd);

    // Apply segmentation criteria
    const segmentProfiles = applySegmentCriteria(allProfiles, segmentCriteria);

    // Calculate metrics
    const metrics = calculateSegmentMetrics(segmentProfiles, allProfiles, periodStart, periodEnd);

    return {
        boxId,
        segmentType,
        segmentName,
        segmentCriteria,
        periodStart,
        periodEnd,
        ...metrics,
        totalRevenue: null, // Would require billing integration
        avgRevenuePerAthlete: null, // Would require billing integration
        calculatedAt: new Date()
    };
}

/**
 * Process segment analytics for all standard segments
 */
export async function processAthleteSegmentAnalytics(
    boxId: string,
    lookbackDays: number = 30
) {
    try {
        const periodEnd = new Date();
        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - lookbackDays);

        console.log(`[Analytics] Processing athlete segment analytics for box ${boxId}`);
        console.log(`[Analytics] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

        const standardSegments = getStandardSegmentCriteria();
        const results = [];

        for (const [segmentName, segmentCriteria] of Object.entries(standardSegments)) {
            try {
                const analytics = await calculateAthleteSegmentAnalytics(
                    boxId,
                    segmentCriteria.type,
                    segmentName,
                    segmentCriteria,
                    periodStart,
                    periodEnd
                );

                // Only store segments with at least 1 athlete
                if (analytics.segmentSize > 0) {
                    // Upsert to database
                    await db.insert(athleteSegmentAnalytics).values({
                        ...analytics,
                        segmentCriteria: analytics.segmentCriteria as any, // JSON field
                        percentOfTotal: analytics.percentOfTotal.toString(),
                        avgRiskScore: analytics.avgRiskScore?.toString() ?? null,
                        avgAttendanceRate: analytics.avgAttendanceRate?.toString() ?? null,
                        avgCheckinRate: analytics.avgCheckinRate?.toString() ?? null,
                        avgPrsPerMonth: analytics.avgPrsPerMonth?.toString() ?? null,
                        avgEnergyLevel: analytics.avgEnergyLevel?.toString() ?? null,
                        avgSleepQuality: analytics.avgSleepQuality?.toString() ?? null,
                        avgStressLevel: analytics.avgStressLevel?.toString() ?? null,
                        churnRate: analytics.churnRate?.toString() ?? null,
                        avgTenure: analytics.avgTenure?.toString() ?? null,
                        totalRevenue: analytics.totalRevenue?.toString() ?? null,
                        avgRevenuePerAthlete: analytics.avgRevenuePerAthlete?.toString() ?? null
                    })
                        .onConflictDoUpdate({
                            target: [
                                athleteSegmentAnalytics.boxId,
                                athleteSegmentAnalytics.segmentType,
                                athleteSegmentAnalytics.segmentName,
                                athleteSegmentAnalytics.periodStart
                            ],
                            set: {
                                segmentSize: analytics.segmentSize,
                                percentOfTotal: analytics.percentOfTotal.toString(),
                                avgRiskScore: analytics.avgRiskScore?.toString() ?? null,
                                avgAttendanceRate: analytics.avgAttendanceRate?.toString() ?? null,
                                avgCheckinRate: analytics.avgCheckinRate?.toString() ?? null,
                                avgPrsPerMonth: analytics.avgPrsPerMonth?.toString() ?? null,
                                avgEnergyLevel: analytics.avgEnergyLevel?.toString() ?? null,
                                avgSleepQuality: analytics.avgSleepQuality?.toString() ?? null,
                                avgStressLevel: analytics.avgStressLevel?.toString() ?? null,
                                churnRate: analytics.churnRate?.toString() ?? null,
                                avgTenure: analytics.avgTenure?.toString() ?? null,
                                calculatedAt: analytics.calculatedAt,
                                periodEnd: analytics.periodEnd
                            }
                        });

                    results.push(analytics);
                    console.log(`[Analytics] ${segmentName} segment: ${analytics.segmentSize} athletes (${analytics.percentOfTotal}% of total)`);
                }
            } catch (error) {
                console.error(`[Analytics] Error processing segment ${segmentName} for box ${boxId}:`, error);
            }
        }

        console.log(`[Analytics] Successfully processed ${results.length} segments for box ${boxId}`);

        return {
            boxId,
            segmentsProcessed: results.length,
            totalAthletes: results.length > 0 ? Math.round(results[0].segmentSize / (results[0].percentOfTotal / 100)) : 0,
            largestSegment: results.length > 0 ? results.sort((a, b) => b.segmentSize - a.segmentSize)[0].segmentName : null,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing athlete segment analytics for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Get segment comparison analysis
 */
export async function getSegmentComparisonAnalysis(
    boxId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<{
    segments: Array<{
        segmentName: string;
        segmentSize: number;
        percentOfTotal: number;
        avgRiskScore: number | null;
        avgAttendanceRate: number | null;
        churnRate: number | null;
        avgTenure: number | null;
    }>;
    insights: {
        mostEngaged: string | null;
        highestRisk: string | null;
        bestRetention: string | null;
        largestSegment: string | null;
    };
}> {
    const segments = await db
        .select({
            segmentName: athleteSegmentAnalytics.segmentName,
            segmentSize: athleteSegmentAnalytics.segmentSize,
            percentOfTotal: athleteSegmentAnalytics.percentOfTotal,
            avgRiskScore: athleteSegmentAnalytics.avgRiskScore,
            avgAttendanceRate: athleteSegmentAnalytics.avgAttendanceRate,
            churnRate: athleteSegmentAnalytics.churnRate,
            avgTenure: athleteSegmentAnalytics.avgTenure
        })
        .from(athleteSegmentAnalytics)
        .where(and(
            eq(athleteSegmentAnalytics.boxId, boxId),
            gte(athleteSegmentAnalytics.periodStart, periodStart),
            lte(athleteSegmentAnalytics.periodEnd, periodEnd)
        ))
        .orderBy(sql`${athleteSegmentAnalytics.segmentSize} DESC`);

    const segmentData = segments.map(s => ({
        segmentName: s.segmentName,
        segmentSize: s.segmentSize,
        percentOfTotal: Number(s.percentOfTotal),
        avgRiskScore: s.avgRiskScore ? Number(s.avgRiskScore) : null,
        avgAttendanceRate: s.avgAttendanceRate ? Number(s.avgAttendanceRate) : null,
        churnRate: s.churnRate ? Number(s.churnRate) : null,
        avgTenure: s.avgTenure ? Number(s.avgTenure) : null
    }));

    // Generate insights
    const segmentsWithAttendance = segmentData.filter(s => s.avgAttendanceRate !== null);
    const mostEngaged = segmentsWithAttendance.length > 0
        ? segmentsWithAttendance.sort((a, b) => b.avgAttendanceRate! - a.avgAttendanceRate!)[0].segmentName
        : null;

    const segmentsWithRisk = segmentData.filter(s => s.avgRiskScore !== null);
    const highestRisk = segmentsWithRisk.length > 0
        ? segmentsWithRisk.sort((a, b) => b.avgRiskScore! - a.avgRiskScore!)[0].segmentName
        : null;

    const segmentsWithChurn = segmentData.filter(s => s.churnRate !== null);
    const bestRetention = segmentsWithChurn.length > 0
        ? segmentsWithChurn.sort((a, b) => a.churnRate! - b.churnRate!)[0].segmentName
        : null;

    const largestSegment = segmentData.length > 0 ? segmentData[0].segmentName : null;

    return {
        segments: segmentData,
        insights: {
            mostEngaged,
            highestRisk,
            bestRetention,
            largestSegment
        }
    };
}

/**
 * Create custom segment
 */
export async function createCustomSegment(
    boxId: string,
    segmentName: string,
    segmentCriteria: SegmentCriteria,
    periodStart: Date,
    periodEnd: Date
): Promise<AthleteSegmentAnalyticsData> {
    return await calculateAthleteSegmentAnalytics(
        boxId,
        'custom',
        segmentName,
        segmentCriteria,
        periodStart,
        periodEnd
    );
}

/**
 * Get segment trends over time
 */
export async function getSegmentTrends(
    boxId: string,
    segmentName: string,
    lookbackMonths: number = 6
): Promise<{
    segmentName: string;
    trends: Array<{
        periodStart: Date;
        segmentSize: number;
        percentOfTotal: number;
        avgRiskScore: number | null;
        avgAttendanceRate: number | null;
        churnRate: number | null;
    }>;
    overallTrend: 'growing' | 'shrinking' | 'stable';
}> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - lookbackMonths);

    const trends = await db
        .select({
            periodStart: athleteSegmentAnalytics.periodStart,
            segmentSize: athleteSegmentAnalytics.segmentSize,
            percentOfTotal: athleteSegmentAnalytics.percentOfTotal,
            avgRiskScore: athleteSegmentAnalytics.avgRiskScore,
            avgAttendanceRate: athleteSegmentAnalytics.avgAttendanceRate,
            churnRate: athleteSegmentAnalytics.churnRate
        })
        .from(athleteSegmentAnalytics)
        .where(and(
            eq(athleteSegmentAnalytics.boxId, boxId),
            eq(athleteSegmentAnalytics.segmentName, segmentName),
            gte(athleteSegmentAnalytics.periodStart, cutoffDate)
        ))
        .orderBy(athleteSegmentAnalytics.periodStart);

    const trendData = trends.map(t => ({
        periodStart: t.periodStart,
        segmentSize: t.segmentSize,
        percentOfTotal: Number(t.percentOfTotal),
        avgRiskScore: t.avgRiskScore ? Number(t.avgRiskScore) : null,
        avgAttendanceRate: t.avgAttendanceRate ? Number(t.avgAttendanceRate) : null,
        churnRate: t.churnRate ? Number(t.churnRate) : null
    }));

    let overallTrend: 'growing' | 'shrinking' | 'stable' = 'stable';

    if (trendData.length >= 2) {
        const firstSize = trendData[0].segmentSize;
        const lastSize = trendData[trendData.length - 1].segmentSize;
        const changePercent = ((lastSize - firstSize) / firstSize) * 100;

        if (changePercent > 10) overallTrend = 'growing';
        else if (changePercent < -10) overallTrend = 'shrinking';
    }

    return {
        segmentName,
        trends: trendData,
        overallTrend
    };
}
