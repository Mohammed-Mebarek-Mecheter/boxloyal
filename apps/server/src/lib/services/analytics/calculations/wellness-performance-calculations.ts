// src/lib/services/analytics/calculations/wellness-performance-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteWellnessCheckins,
    athletePrs,
    athleteBenchmarks,
    wellnessPerformanceCorrelations,
    wodAttendance
} from "@/db/schema";
import { eq, and, gte, lte, sql, avg, count } from "drizzle-orm";

export interface WellnessPerformanceCorrelationData {
    boxId: string;
    wellnessMetric: string;
    performanceMetric: string;
    correlationType: 'pearson' | 'spearman';
    correlationValue: number;
    pValue: number | null;
    sampleSize: number;
    periodStart: Date;
    periodEnd: Date;
    significance: 'high' | 'moderate' | 'low' | 'none';
    calculatedAt: Date;
    version: string;
}

interface WellnessData {
    membershipId: string;
    avgEnergy: number;
    avgSleep: number;
    avgStress: number;
    avgReadiness: number;
    avgMotivation: number;
    checkinCount: number;
}

interface PerformanceData {
    membershipId: string;
    prCount: number;
    benchmarkCount: number;
    attendanceRate: number;
    avgWorkoutDuration: number;
    performanceScore: number;
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculatePearsonCorrelation(x: number[], y: number[]): { correlation: number; pValue: number | null } {
    const n = x.length;
    if (n < 3) return { correlation: 0, pValue: null };

    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
    const sumY2 = y.reduce((sum, val) => sum + val * val, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) return { correlation: 0, pValue: null };

    const correlation = numerator / denominator;

    // Simple p-value approximation for Pearson correlation
    // More sophisticated statistical tests would be needed for production
    const tStatistic = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
    const pValue = n > 10 ? Math.min(1, 2 * (1 - Math.abs(tStatistic) / Math.sqrt(n - 2))) : null;

    return { correlation, pValue };
}

/**
 * Calculate Spearman correlation coefficient (rank-based)
 */
function calculateSpearmanCorrelation(x: number[], y: number[]): { correlation: number; pValue: number | null } {
    const n = x.length;
    if (n < 3) return { correlation: 0, pValue: null };

    // Convert to ranks
    const getRanks = (arr: number[]): number[] => {
        const sorted = [...arr].map((val, index) => ({ val, index }))
            .sort((a, b) => a.val - b.val);
        const ranks = new Array(n);
        sorted.forEach((item, rank) => {
            ranks[item.index] = rank + 1;
        });
        return ranks;
    };

    const xRanks = getRanks(x);
    const yRanks = getRanks(y);

    // Calculate Pearson correlation on ranks
    return calculatePearsonCorrelation(xRanks, yRanks);
}

/**
 * Get wellness data for athletes in a box within a period
 */
async function getWellnessData(boxId: string, periodStart: Date, periodEnd: Date): Promise<WellnessData[]> {
    const results = await db
        .select({
            membershipId: athleteWellnessCheckins.membershipId,
            avgEnergy: avg(athleteWellnessCheckins.energyLevel),
            avgSleep: avg(athleteWellnessCheckins.sleepQuality),
            avgStress: avg(athleteWellnessCheckins.stressLevel),
            avgReadiness: avg(athleteWellnessCheckins.workoutReadiness),
            avgMotivation: avg(athleteWellnessCheckins.motivationLevel),
            checkinCount: count()
        })
        .from(athleteWellnessCheckins)
        .innerJoin(boxMemberships, eq(athleteWellnessCheckins.membershipId, boxMemberships.id))
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            eq(boxMemberships.isActive, true),
            gte(athleteWellnessCheckins.checkinDate, periodStart),
            lte(athleteWellnessCheckins.checkinDate, periodEnd)
        ))
        .groupBy(athleteWellnessCheckins.membershipId)
        .having(sql`COUNT(*) >= 5`); // Minimum 5 check-ins for meaningful data

    return results.map(r => ({
        membershipId: r.membershipId,
        avgEnergy: Number(r.avgEnergy || 0),
        avgSleep: Number(r.avgSleep || 0),
        avgStress: Number(r.avgStress || 0),
        avgReadiness: Number(r.avgReadiness || 0),
        avgMotivation: Number(r.avgMotivation || 0),
        checkinCount: r.checkinCount
    }));
}

/**
 * Get performance data for athletes in a box within a period
 */
async function getPerformanceData(boxId: string, periodStart: Date, periodEnd: Date): Promise<PerformanceData[]> {
    // Get PR counts
    const prData = await db
        .select({
            membershipId: athletePrs.membershipId,
            prCount: count()
        })
        .from(athletePrs)
        .where(and(
            eq(athletePrs.boxId, boxId),
            gte(athletePrs.achievedAt, periodStart),
            lte(athletePrs.achievedAt, periodEnd)
        ))
        .groupBy(athletePrs.membershipId);

    // Get benchmark counts
    const benchmarkData = await db
        .select({
            membershipId: athleteBenchmarks.membershipId,
            benchmarkCount: count()
        })
        .from(athleteBenchmarks)
        .where(and(
            eq(athleteBenchmarks.boxId, boxId),
            gte(athleteBenchmarks.achievedAt, periodStart),
            lte(athleteBenchmarks.achievedAt, periodEnd)
        ))
        .groupBy(athleteBenchmarks.membershipId);

    // Get attendance data
    const attendanceData = await db
        .select({
            membershipId: wodAttendance.membershipId,
            attendedCount: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            totalScheduled: count(),
            avgDuration: avg(wodAttendance.durationMinutes)
        })
        .from(wodAttendance)
        .where(and(
            eq(wodAttendance.boxId, boxId),
            gte(wodAttendance.attendanceDate, sql`${periodStart}::date`),
            lte(wodAttendance.attendanceDate, sql`${periodEnd}::date`)
        ))
        .groupBy(wodAttendance.membershipId);

    // Combine all data
    const performanceMap = new Map<string, PerformanceData>();

    // Initialize with PR data
    prData.forEach(pr => {
        performanceMap.set(pr.membershipId, {
            membershipId: pr.membershipId,
            prCount: pr.prCount,
            benchmarkCount: 0,
            attendanceRate: 0,
            avgWorkoutDuration: 0,
            performanceScore: 0
        });
    });

    // Add benchmark data
    benchmarkData.forEach(benchmark => {
        const existing = performanceMap.get(benchmark.membershipId);
        if (existing) {
            existing.benchmarkCount = benchmark.benchmarkCount;
        } else {
            performanceMap.set(benchmark.membershipId, {
                membershipId: benchmark.membershipId,
                prCount: 0,
                benchmarkCount: benchmark.benchmarkCount,
                attendanceRate: 0,
                avgWorkoutDuration: 0,
                performanceScore: 0
            });
        }
    });

    // Add attendance data
    attendanceData.forEach(attendance => {
        const existing = performanceMap.get(attendance.membershipId);
        const attendanceRate = attendance.totalScheduled > 0
            ? (attendance.attendedCount / attendance.totalScheduled) * 100
            : 0;

        if (existing) {
            existing.attendanceRate = attendanceRate;
            existing.avgWorkoutDuration = Number(attendance.avgDuration || 0);
        } else {
            performanceMap.set(attendance.membershipId, {
                membershipId: attendance.membershipId,
                prCount: 0,
                benchmarkCount: 0,
                attendanceRate,
                avgWorkoutDuration: Number(attendance.avgDuration || 0),
                performanceScore: 0
            });
        }
    });

    // Calculate performance scores
    Array.from(performanceMap.values()).forEach(perf => {
        perf.performanceScore = (perf.prCount * 10) + (perf.benchmarkCount * 5) + (perf.attendanceRate * 0.5);
    });

    return Array.from(performanceMap.values()).filter(p =>
        p.prCount > 0 || p.benchmarkCount > 0 || p.attendanceRate > 0
    );
}

/**
 * Calculate wellness-performance correlations for a box
 */
export async function calculateWellnessPerformanceCorrelations(
    boxId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<WellnessPerformanceCorrelationData[]> {
    const [wellnessData, performanceData] = await Promise.all([
        getWellnessData(boxId, periodStart, periodEnd),
        getPerformanceData(boxId, periodStart, periodEnd)
    ]);

    // Create lookup map for performance data
    const performanceMap = new Map(performanceData.map(p => [p.membershipId, p]));

    // Filter to athletes with both wellness and performance data
    const combinedData = wellnessData
        .map(w => ({
            wellness: w,
            performance: performanceMap.get(w.membershipId)
        }))
        .filter(item => item.performance !== undefined);

    if (combinedData.length < 10) {
        console.log(`[Analytics] Insufficient data for correlations in box ${boxId}: ${combinedData.length} athletes`);
        return [];
    }

    const correlations: WellnessPerformanceCorrelationData[] = [];

    // Define wellness and performance metrics to correlate
    const wellnessMetrics = [
        { key: 'avgEnergy', name: 'avg_energy_level' },
        { key: 'avgSleep', name: 'avg_sleep_quality' },
        { key: 'avgStress', name: 'avg_stress_level' },
        { key: 'avgReadiness', name: 'avg_workout_readiness' },
        { key: 'avgMotivation', name: 'avg_motivation_level' }
    ];

    const performanceMetrics = [
        { key: 'prCount', name: 'pr_count' },
        { key: 'benchmarkCount', name: 'benchmark_count' },
        { key: 'attendanceRate', name: 'attendance_rate' },
        { key: 'performanceScore', name: 'performance_score' }
    ];

    // Calculate correlations for each wellness-performance pair
    for (const wellnessMetric of wellnessMetrics) {
        for (const performanceMetric of performanceMetrics) {
            const wellnessValues = combinedData.map(item => item.wellness[wellnessMetric.key as keyof WellnessData] as number);
            const performanceValues = combinedData.map(item => item.performance![performanceMetric.key as keyof PerformanceData] as number);

            // Skip if no variation in data
            const wellnessVariance = wellnessValues.reduce((acc, val, _, arr) => acc + Math.pow(val - arr.reduce((a, b) => a + b) / arr.length, 2), 0);
            const performanceVariance = performanceValues.reduce((acc, val, _, arr) => acc + Math.pow(val - arr.reduce((a, b) => a + b) / arr.length, 2), 0);

            if (wellnessVariance === 0 || performanceVariance === 0) continue;

            // Calculate Pearson correlation
            const pearson = calculatePearsonCorrelation(wellnessValues, performanceValues);
            if (Math.abs(pearson.correlation) > 0.1) { // Only store meaningful correlations
                correlations.push({
                    boxId,
                    wellnessMetric: wellnessMetric.name,
                    performanceMetric: performanceMetric.name,
                    correlationType: 'pearson',
                    correlationValue: Math.round(pearson.correlation * 1000) / 1000,
                    pValue: pearson.pValue ? Math.round(pearson.pValue * 100000) / 100000 : null,
                    sampleSize: combinedData.length,
                    periodStart,
                    periodEnd,
                    significance: getSignificance(pearson.correlation, pearson.pValue),
                    calculatedAt: new Date(),
                    version: '1.0'
                });
            }

            // Calculate Spearman correlation
            const spearman = calculateSpearmanCorrelation(wellnessValues, performanceValues);
            if (Math.abs(spearman.correlation) > 0.1) { // Only store meaningful correlations
                correlations.push({
                    boxId,
                    wellnessMetric: wellnessMetric.name,
                    performanceMetric: performanceMetric.name,
                    correlationType: 'spearman',
                    correlationValue: Math.round(spearman.correlation * 1000) / 1000,
                    pValue: spearman.pValue ? Math.round(spearman.pValue * 100000) / 100000 : null,
                    sampleSize: combinedData.length,
                    periodStart,
                    periodEnd,
                    significance: getSignificance(spearman.correlation, spearman.pValue),
                    calculatedAt: new Date(),
                    version: '1.0'
                });
            }
        }
    }

    return correlations;
}

/**
 * Determine statistical significance level
 */
function getSignificance(correlation: number, pValue: number | null): 'high' | 'moderate' | 'low' | 'none' {
    const absCorr = Math.abs(correlation);

    if (!pValue) return 'none';

    if (pValue < 0.01 && absCorr > 0.5) return 'high';
    if (pValue < 0.05 && absCorr > 0.3) return 'moderate';
    if (pValue < 0.1 && absCorr > 0.2) return 'low';

    return 'none';
}

/**
 * Process and upsert wellness-performance correlations
 */
export async function processWellnessPerformanceCorrelations(
    boxId: string,
    lookbackDays: number = 90
) {
    try {
        const periodEnd = new Date();
        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - lookbackDays);

        console.log(`[Analytics] Calculating wellness-performance correlations for box ${boxId}`);
        console.log(`[Analytics] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

        const correlations = await calculateWellnessPerformanceCorrelations(boxId, periodStart, periodEnd);

        console.log(`[Analytics] Found ${correlations.length} correlations for box ${boxId}`);

        if (correlations.length === 0) {
            console.log(`[Analytics] No correlations to store for box ${boxId}`);
            return { boxId, correlationsProcessed: 0, completedAt: new Date() };
        }

        // Upsert correlations
        for (const correlation of correlations) {
            await db.insert(wellnessPerformanceCorrelations).values({
                ...correlation,
                correlationValue: correlation.correlationValue.toString(),
                pValue: correlation.pValue?.toString() ?? null
            })
                .onConflictDoUpdate({
                    target: [
                        wellnessPerformanceCorrelations.boxId,
                        wellnessPerformanceCorrelations.wellnessMetric,
                        wellnessPerformanceCorrelations.performanceMetric,
                        wellnessPerformanceCorrelations.periodStart
                    ],
                    set: {
                        correlationType: correlation.correlationType,
                        correlationValue: correlation.correlationValue.toString(),
                        pValue: correlation.pValue?.toString() ?? null,
                        sampleSize: correlation.sampleSize,
                        periodEnd: correlation.periodEnd,
                        calculatedAt: correlation.calculatedAt,
                        version: correlation.version
                    }
                });

            // Log significant correlations
            if (correlation.significance === 'high' || correlation.significance === 'moderate') {
                console.log(`[Analytics] ${correlation.significance.toUpperCase()} correlation: ${correlation.wellnessMetric} ↔ ${correlation.performanceMetric} = ${correlation.correlationValue} (p=${correlation.pValue})`);
            }
        }

        console.log(`[Analytics] Successfully updated ${correlations.length} correlations for box ${boxId}`);

        return {
            boxId,
            correlationsProcessed: correlations.length,
            significantCorrelations: correlations.filter(c => c.significance === 'high' || c.significance === 'moderate').length,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing wellness-performance correlations for box ${boxId}:`, error);
        throw error;
    }
}
