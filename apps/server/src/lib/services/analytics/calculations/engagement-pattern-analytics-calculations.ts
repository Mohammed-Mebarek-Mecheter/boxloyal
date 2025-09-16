// src/lib/services/analytics/calculations/engagement-pattern-analytics-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteWellnessCheckins,
    wodAttendance,
    athleteRiskScores,
    engagementPatternAnalytics,
} from "@/db/schema";
import { eq, and, gte, lte, count, avg, sql } from "drizzle-orm";

export type PatternType = "weekly" | "monthly" | "seasonal" | "lifecycle";

export interface EngagementPatternData {
    boxId: string;
    patternType: PatternType;
    patternName: string;
    periodStart: Date;
    periodEnd: Date;
    occurrenceCount: number;
    avgIntensity: number;
    confidenceScore: number;
    athletesAffected: number;
    avgImpactOnRisk: number;
    avgImpactOnAttendance: number;
    avgImpactOnEngagement: number;
    patternDescription: string;
    triggerConditions: any;
    correlatedFactors: any;
    calculatedAt: Date;
}

interface MemberEngagementData {
    membershipId: string;
    joinedAt: Date;
    avgAttendanceRate: number;
    avgCheckinRate: number;
    avgRiskScore: number;
    weeklyAttendance: number[];
    monthlyCheckins: number[];
    engagementTrend: number[];
}

interface PatternDefinition {
    type: PatternType;
    name: string;
    description: string;
    detectionFunction: (data: MemberEngagementData[], periodStart: Date, periodEnd: Date) => {
        intensity: number;
        confidence: number;
        athletesAffected: string[];
        triggerConditions: any;
        correlatedFactors: any;
    };
}

/**
 * Get member engagement data for pattern detection
 */
async function getMemberEngagementData(
    boxId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<MemberEngagementData[]> {
    // Get all active members in the period
    const members = await db
        .select({
            membershipId: boxMemberships.id,
            joinedAt: boxMemberships.joinedAt
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            eq(boxMemberships.isActive, true),
            lte(boxMemberships.joinedAt, periodEnd)
        ));

    const memberData: MemberEngagementData[] = [];

    for (const member of members) {
        // Get attendance data
        const attendanceData = await db
            .select({
                total: count(),
                attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
                weekNum: sql<number>`EXTRACT(WEEK FROM ${wodAttendance.attendanceDate})`,
                monthNum: sql<number>`EXTRACT(MONTH FROM ${wodAttendance.attendanceDate})`
            })
            .from(wodAttendance)
            .where(and(
                eq(wodAttendance.boxId, boxId),
                eq(wodAttendance.membershipId, member.membershipId),
                gte(wodAttendance.attendanceDate, sql`${periodStart}::date`),
                lte(wodAttendance.attendanceDate, sql`${periodEnd}::date`)
            ))
            .groupBy(sql`EXTRACT(WEEK FROM ${wodAttendance.attendanceDate})`, sql`EXTRACT(MONTH FROM ${wodAttendance.attendanceDate})`);

        // Get checkin data
        const checkinData = await db
            .select({
                total: count(),
                monthNum: sql<number>`EXTRACT(MONTH FROM ${athleteWellnessCheckins.checkinDate})`
            })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.boxId, boxId),
                eq(athleteWellnessCheckins.membershipId, member.membershipId),
                gte(athleteWellnessCheckins.checkinDate, periodStart),
                lte(athleteWellnessCheckins.checkinDate, periodEnd)
            ))
            .groupBy(sql`EXTRACT(MONTH FROM ${athleteWellnessCheckins.checkinDate})`);

        // Get risk score data
        const riskData = await db
            .select({
                avgRisk: avg(athleteRiskScores.overallRiskScore)
            })
            .from(athleteRiskScores)
            .where(and(
                eq(athleteRiskScores.boxId, boxId),
                eq(athleteRiskScores.membershipId, member.membershipId),
                gte(athleteRiskScores.calculatedAt, periodStart),
                lte(athleteRiskScores.calculatedAt, periodEnd)
            ));

        // Calculate metrics
        const totalAttended = attendanceData.reduce((sum, a) => sum + a.attended, 0);
        const totalScheduled = attendanceData.reduce((sum, a) => sum + a.total, 0);
        const avgAttendanceRate = totalScheduled > 0 ? (totalAttended / totalScheduled) * 100 : 0;

        const totalCheckins = checkinData.reduce((sum, c) => sum + c.total, 0);
        const expectedCheckins = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000));
        const avgCheckinRate = expectedCheckins > 0 ? (totalCheckins / expectedCheckins) * 100 : 0;

        const avgRiskScore = Number(riskData[0]?.avgRisk || 0);

        // Build weekly attendance pattern
        const weeklyAttendance: number[] = [];
        for (let week = 1; week <= 52; week++) {
            const weekData = attendanceData.find(a => a.weekNum === week);
            const rate = weekData && weekData.total > 0 ? (weekData.attended / weekData.total) * 100 : 0;
            weeklyAttendance.push(rate);
        }

        // Build monthly checkin pattern
        const monthlyCheckins: number[] = [];
        for (let month = 1; month <= 12; month++) {
            const monthData = checkinData.find(c => c.monthNum === month);
            monthlyCheckins.push(monthData?.total || 0);
        }

        // Calculate engagement trend (simplified linear trend)
        const engagementTrend = calculateEngagementTrend(weeklyAttendance, monthlyCheckins);

        memberData.push({
            membershipId: member.membershipId,
            joinedAt: member.joinedAt,
            avgAttendanceRate,
            avgCheckinRate,
            avgRiskScore,
            weeklyAttendance,
            monthlyCheckins,
            engagementTrend
        });
    }

    return memberData;
}

/**
 * Calculate engagement trend (simplified version)
 */
function calculateEngagementTrend(
    weeklyAttendance: number[],
    monthlyCheckins: number[]
): number[] {
    // Simple moving average trend calculation
    const trend: number[] = [];
    const windowSize = 4; // 4-week moving average

    for (let i = 0; i < weeklyAttendance.length; i++) {
        const start = Math.max(0, i - windowSize + 1);
        const end = i + 1;
        const window = weeklyAttendance.slice(start, end);
        const avg = window.reduce((sum, val) => sum + val, 0) / window.length;
        trend.push(avg);
    }

    return trend;
}

/**
 * Define engagement patterns to detect
 */
const patternDefinitions: PatternDefinition[] = [
    // Weekly patterns
    {
        type: "weekly",
        name: "monday_dropoff",
        description: "Significant decrease in Monday attendance compared to other weekdays",
        detectionFunction: (data, periodStart, periodEnd) => {
            const mondayAttendance: number[] = [];
            const otherDayAttendance: number[] = [];

            data.forEach(member => {
                // Simplified: assume first day of week is Monday (index 0)
                const mondayAvg = member.weeklyAttendance.filter((_, i) => i % 7 === 0).reduce((a, b) => a + b, 0) / 52;
                const otherAvg = member.weeklyAttendance.filter((_, i) => i % 7 !== 0).reduce((a, b) => a + b, 0) / (52 * 6);

                mondayAttendance.push(mondayAvg);
                otherDayAttendance.push(otherAvg);
            });

            const mondayMean = mondayAttendance.reduce((a, b) => a + b, 0) / mondayAttendance.length;
            const otherMean = otherDayAttendance.reduce((a, b) => a + b, 0) / otherDayAttendance.length;

            const intensity = otherMean > 0 ? ((otherMean - mondayMean) / otherMean) * 100 : 0;
            const confidence = intensity > 15 ? 0.8 : intensity > 10 ? 0.6 : 0.3;
            const athletesAffected = data
                .filter((_, i) => mondayAttendance[i] < otherDayAttendance[i] * 0.8)
                .map(m => m.membershipId);

            return {
                intensity,
                confidence,
                athletesAffected,
                triggerConditions: { mondayThreshold: 0.8 },
                correlatedFactors: { weekendRecovery: true, workSchedule: true }
            };
        }
    },
    {
        type: "weekly",
        name: "friday_enthusiasm",
        description: "Higher attendance and engagement on Fridays",
        detectionFunction: (data, periodStart, periodEnd) => {
            const fridayAttendance: number[] = [];
            const otherDayAttendance: number[] = [];

            data.forEach(member => {
                const fridayAvg = member.weeklyAttendance.filter((_, i) => i % 7 === 4).reduce((a, b) => a + b, 0) / 52;
                const otherAvg = member.weeklyAttendance.filter((_, i) => i % 7 !== 4).reduce((a, b) => a + b, 0) / (52 * 6);

                fridayAttendance.push(fridayAvg);
                otherDayAttendance.push(otherAvg);
            });

            const fridayMean = fridayAttendance.reduce((a, b) => a + b, 0) / fridayAttendance.length;
            const otherMean = otherDayAttendance.reduce((a, b) => a + b, 0) / otherDayAttendance.length;

            const intensity = otherMean > 0 ? ((fridayMean - otherMean) / otherMean) * 100 : 0;
            const confidence = intensity > 10 ? 0.7 : intensity > 5 ? 0.5 : 0.2;
            const athletesAffected = data
                .filter((_, i) => fridayAttendance[i] > otherDayAttendance[i] * 1.1)
                .map(m => m.membershipId);

            return {
                intensity,
                confidence,
                athletesAffected,
                triggerConditions: { fridayBoost: 1.1 },
                correlatedFactors: { weekendPrep: true, socialAspect: true }
            };
        }
    },

    // Monthly patterns
    {
        type: "monthly",
        name: "new_year_surge",
        description: "Increased engagement in January following New Year resolutions",
        detectionFunction: (data, periodStart, periodEnd) => {
            const januaryEngagement: number[] = [];
            const restOfYearEngagement: number[] = [];

            data.forEach(member => {
                const januaryCheckins = member.monthlyCheckins[0] || 0; // January is index 0
                const restOfYearCheckins = member.monthlyCheckins.slice(1).reduce((a, b) => a + b, 0) / 11;

                januaryEngagement.push(januaryCheckins);
                restOfYearEngagement.push(restOfYearCheckins);
            });

            const januaryMean = januaryEngagement.reduce((a, b) => a + b, 0) / januaryEngagement.length;
            const restOfYearMean = restOfYearEngagement.reduce((a, b) => a + b, 0) / restOfYearEngagement.length;

            const intensity = restOfYearMean > 0 ? ((januaryMean - restOfYearMean) / restOfYearMean) * 100 : 0;
            const confidence = intensity > 25 ? 0.9 : intensity > 15 ? 0.7 : 0.4;
            const athletesAffected = data
                .filter((_, i) => januaryEngagement[i] > restOfYearEngagement[i] * 1.2)
                .map(m => m.membershipId);

            return {
                intensity,
                confidence,
                athletesAffected,
                triggerConditions: { newYearBoost: 1.2 },
                correlatedFactors: { resolutions: true, motivation: true, newMemberInflux: true }
            };
        }
    },
    {
        type: "monthly",
        name: "summer_decline",
        description: "Decreased engagement during summer months (June-August)",
        detectionFunction: (data, periodStart, periodEnd) => {
            const summerEngagement: number[] = [];
            const nonSummerEngagement: number[] = [];

            data.forEach(member => {
                const summerCheckins = (member.monthlyCheckins[5] + member.monthlyCheckins[6] + member.monthlyCheckins[7]) / 3; // June, July, August
                const nonSummerCheckins = member.monthlyCheckins
                    .filter((_, i) => ![5, 6, 7].includes(i))
                    .reduce((a, b) => a + b, 0) / 9;

                summerEngagement.push(summerCheckins);
                nonSummerEngagement.push(nonSummerCheckins);
            });

            const summerMean = summerEngagement.reduce((a, b) => a + b, 0) / summerEngagement.length;
            const nonSummerMean = nonSummerEngagement.reduce((a, b) => a + b, 0) / nonSummerEngagement.length;

            const intensity = nonSummerMean > 0 ? ((nonSummerMean - summerMean) / nonSummerMean) * 100 : 0;
            const confidence = intensity > 20 ? 0.8 : intensity > 10 ? 0.6 : 0.3;
            const athletesAffected = data
                .filter((_, i) => summerEngagement[i] < nonSummerEngagement[i] * 0.8)
                .map(m => m.membershipId);

            return {
                intensity,
                confidence,
                athletesAffected,
                triggerConditions: { summerDecline: 0.8 },
                correlatedFactors: { vacation: true, outdoorActivities: true, scheduleChanges: true }
            };
        }
    },

    // Lifecycle patterns
    {
        type: "lifecycle",
        name: "new_member_enthusiasm",
        description: "High engagement in first 30 days, then gradual decline",
        detectionFunction: (data, periodStart, periodEnd) => {
            const recentMembers = data.filter(m => {
                const daysSinceJoin = (Date.now() - m.joinedAt.getTime()) / (24 * 60 * 60 * 1000);
                return daysSinceJoin <= 90; // Members who joined in last 90 days
            });

            if (recentMembers.length < 5) {
                return {
                    intensity: 0,
                    confidence: 0,
                    athletesAffected: [],
                    triggerConditions: {},
                    correlatedFactors: {}
                };
            }

            const enthusiasticMembers = recentMembers.filter(m => {
                const daysSinceJoin = (Date.now() - m.joinedAt.getTime()) / (24 * 60 * 60 * 1000);
                if (daysSinceJoin <= 30) {
                    return m.avgAttendanceRate > 70 && m.avgCheckinRate > 60;
                } else {
                    return m.avgAttendanceRate < 50 || m.avgCheckinRate < 40;
                }
            });

            const intensity = recentMembers.length > 0 ? (enthusiasticMembers.length / recentMembers.length) * 100 : 0;
            const confidence = recentMembers.length >= 10 ? 0.8 : 0.5;
            const athletesAffected = enthusiasticMembers.map(m => m.membershipId);

            return {
                intensity,
                confidence,
                athletesAffected,
                triggerConditions: { initialEngagement: { attendance: 70, checkin: 60 } },
                correlatedFactors: { newMemberExcitement: true, onboardingEffectiveness: true }
            };
        }
    },
    {
        type: "lifecycle",
        name: "ninety_day_cliff",
        description: "Significant dropout risk around 90-day mark",
        detectionFunction: (data, periodStart, periodEnd) => {
            const ninetyDayMembers = data.filter(m => {
                const daysSinceJoin = (Date.now() - m.joinedAt.getTime()) / (24 * 60 * 60 * 1000);
                return daysSinceJoin >= 80 && daysSinceJoin <= 100;
            });

            if (ninetyDayMembers.length < 3) {
                return {
                    intensity: 0,
                    confidence: 0,
                    athletesAffected: [],
                    triggerConditions: {},
                    correlatedFactors: {}
                };
            }

            const atRiskMembers = ninetyDayMembers.filter(m =>
                m.avgRiskScore > 0.6 || m.avgAttendanceRate < 40
            );

            const intensity = ninetyDayMembers.length > 0 ? (atRiskMembers.length / ninetyDayMembers.length) * 100 : 0;
            const confidence = ninetyDayMembers.length >= 5 ? 0.7 : 0.4;
            const athletesAffected = atRiskMembers.map(m => m.membershipId);

            return {
                intensity,
                confidence,
                athletesAffected,
                triggerConditions: { riskThreshold: 0.6, attendanceThreshold: 40 },
                correlatedFactors: { habitFormation: true, initialExcitementFade: true }
            };
        }
    }
];

/**
 * Calculate engagement patterns for a specific box
 */
export async function calculateEngagementPatterns(
    boxId: string,
    lookbackDays: number = 365
): Promise<EngagementPatternData[]> {
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - lookbackDays);

    console.log(`[Analytics] Calculating engagement patterns for box ${boxId}`);
    console.log(`[Analytics] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

    // Get member engagement data
    const memberData = await getMemberEngagementData(boxId, periodStart, periodEnd);

    if (memberData.length < 5) {
        console.log(`[Analytics] Insufficient data for pattern detection in box ${boxId}: ${memberData.length} members`);
        return [];
    }

    const patterns: EngagementPatternData[] = [];

    // Apply each pattern definition
    for (const patternDef of patternDefinitions) {
        try {
            const result = patternDef.detectionFunction(memberData, periodStart, periodEnd);

            if (result.confidence > 0.3 && result.athletesAffected.length > 0) {
                // Calculate impact metrics
                const affectedMembers = memberData.filter(m =>
                    result.athletesAffected.includes(m.membershipId)
                );

                const avgImpactOnRisk = affectedMembers.length > 0
                    ? affectedMembers.reduce((sum, m) => sum + m.avgRiskScore, 0) / affectedMembers.length
                    : 0;

                const avgImpactOnAttendance = affectedMembers.length > 0
                    ? affectedMembers.reduce((sum, m) => sum + m.avgAttendanceRate, 0) / affectedMembers.length
                    : 0;

                const avgImpactOnEngagement = affectedMembers.length > 0
                    ? affectedMembers.reduce((sum, m) => sum + m.avgCheckinRate, 0) / affectedMembers.length
                    : 0;

                patterns.push({
                    boxId,
                    patternType: patternDef.type,
                    patternName: patternDef.name,
                    periodStart,
                    periodEnd,
                    occurrenceCount: 1, // Simplified - could track multiple occurrences
                    avgIntensity: Math.round(result.intensity * 100) / 100,
                    confidenceScore: Math.round(result.confidence * 10000) / 10000,
                    athletesAffected: result.athletesAffected.length,
                    avgImpactOnRisk: Math.round(avgImpactOnRisk * 100) / 100,
                    avgImpactOnAttendance: Math.round(avgImpactOnAttendance * 100) / 100,
                    avgImpactOnEngagement: Math.round(avgImpactOnEngagement * 100) / 100,
                    patternDescription: patternDef.description,
                    triggerConditions: result.triggerConditions,
                    correlatedFactors: result.correlatedFactors,
                    calculatedAt: new Date()
                });

                console.log(`[Analytics] Detected pattern: ${patternDef.name} - Confidence: ${result.confidence.toFixed(3)}, Athletes affected: ${result.athletesAffected.length}`);
            }
        } catch (error) {
            console.error(`[Analytics] Error detecting pattern ${patternDef.name}:`, error);
        }
    }

    return patterns;
}

/**
 * Process engagement pattern analytics for a box
 */
export async function processEngagementPatternAnalytics(
    boxId: string,
    lookbackDays: number = 365
) {
    try {
        console.log(`[Analytics] Processing engagement pattern analytics for box ${boxId}`);

        const patterns = await calculateEngagementPatterns(boxId, lookbackDays);

        if (patterns.length === 0) {
            console.log(`[Analytics] No significant patterns detected for box ${boxId}`);
            return { boxId, patternsProcessed: 0, completedAt: new Date() };
        }

        // Upsert patterns to database
        for (const pattern of patterns) {
            await db.insert(engagementPatternAnalytics).values({
                boxId: pattern.boxId,
                patternType: pattern.patternType,
                patternName: pattern.patternName,
                periodStart: pattern.periodStart,
                periodEnd: pattern.periodEnd,
                occurrenceCount: pattern.occurrenceCount,
                avgIntensity: pattern.avgIntensity.toString(),
                confidenceScore: pattern.confidenceScore.toString(),
                athletesAffected: pattern.athletesAffected,
                avgImpactOnRisk: pattern.avgImpactOnRisk.toString(),
                avgImpactOnAttendance: pattern.avgImpactOnAttendance.toString(),
                avgImpactOnEngagement: pattern.avgImpactOnEngagement.toString(),
                patternDescription: pattern.patternDescription,
                triggerConditions: pattern.triggerConditions,
                correlatedFactors: pattern.correlatedFactors,
                calculatedAt: pattern.calculatedAt
            })
                .onConflictDoUpdate({
                    target: [engagementPatternAnalytics.boxId, engagementPatternAnalytics.patternType, engagementPatternAnalytics.patternName],
                    set: {
                        periodStart: pattern.periodStart,
                        periodEnd: pattern.periodEnd,
                        occurrenceCount: pattern.occurrenceCount,
                        avgIntensity: pattern.avgIntensity.toString(),
                        confidenceScore: pattern.confidenceScore.toString(),
                        athletesAffected: pattern.athletesAffected,
                        avgImpactOnRisk: pattern.avgImpactOnRisk.toString(),
                        avgImpactOnAttendance: pattern.avgImpactOnAttendance.toString(),
                        avgImpactOnEngagement: pattern.avgImpactOnEngagement.toString(),
                        patternDescription: pattern.patternDescription,
                        triggerConditions: pattern.triggerConditions,
                        correlatedFactors: pattern.correlatedFactors,
                        calculatedAt: pattern.calculatedAt
                    }
                });
        }

        console.log(`[Analytics] Successfully processed ${patterns.length} engagement patterns for box ${boxId}`);

        return {
            boxId,
            patternsProcessed: patterns.length,
            highConfidencePatterns: patterns.filter(p => p.confidenceScore > 0.7).length,
            athletesTotalAffected: patterns.reduce((sum, p) => sum + p.athletesAffected, 0),
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing engagement pattern analytics for box ${boxId}:`, error);
        throw error;
    }
}
