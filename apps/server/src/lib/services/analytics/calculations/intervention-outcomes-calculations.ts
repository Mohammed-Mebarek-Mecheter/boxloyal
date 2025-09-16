// src/lib/services/analytics/calculations/intervention-outcomes-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteInterventions,
    athleteRiskScores,
    athleteWellnessCheckins,
    wodAttendance,
    athletePrs,
    athleteBenchmarks,
    interventionOutcomes
} from "@/db/schema";
import { eq, and, gte, lte, count, sql, avg } from "drizzle-orm";

export interface InterventionOutcomeData {
    interventionId: string;
    membershipId: string;
    boxId: string;
    athleteName: string;
    interventionType: string;
    interventionDate: Date;
    outcomePeriodStart: Date;
    outcomePeriodEnd: Date;
    riskScoreChange: number | null;
    attendanceRateChange: number | null;
    checkinRateChange: number | null;
    wellnessScoreChange: number | null;
    prActivityChange: number | null;
    overallEffectiveness: 'positive' | 'neutral' | 'negative';
    effectivenessScore: number;
    measuredAt: Date;
    notes: string | null;
}

interface PreInterventionMetrics {
    riskScore: number | null;
    attendanceRate: number;
    checkinRate: number;
    wellnessScore: number;
    prActivity: number;
}

interface PostInterventionMetrics {
    riskScore: number | null;
    attendanceRate: number;
    checkinRate: number;
    wellnessScore: number;
    prActivity: number;
}

/**
 * Get pre-intervention metrics for an athlete
 */
async function getPreInterventionMetrics(
    membershipId: string,
    boxId: string,
    interventionDate: Date,
    lookbackDays: number = 30
): Promise<PreInterventionMetrics> {
    const preStart = new Date(interventionDate);
    preStart.setDate(preStart.getDate() - lookbackDays);
    const preEnd = new Date(interventionDate);
    preEnd.setDate(preEnd.getDate() - 1); // Day before intervention

    // Get risk score before intervention
    const riskScore = await db
        .select({
            score: athleteRiskScores.overallRiskScore
        })
        .from(athleteRiskScores)
        .where(and(
            eq(athleteRiskScores.membershipId, membershipId),
            lte(athleteRiskScores.calculatedAt, preEnd)
        ))
        .orderBy(sql`${athleteRiskScores.calculatedAt} DESC`)
        .limit(1);

    // Get attendance rate before intervention
    const attendance = await db
        .select({
            attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            total: count()
        })
        .from(wodAttendance)
        .where(and(
            eq(wodAttendance.membershipId, membershipId),
            eq(wodAttendance.boxId, boxId),
            gte(wodAttendance.attendanceDate, sql`${preStart}::date`),
            lte(wodAttendance.attendanceDate, sql`${preEnd}::date`)
        ));

    const attendanceRate = attendance[0]?.total > 0
        ? (attendance[0].attended / attendance[0].total) * 100
        : 0;

    // Get checkin rate before intervention
    const checkins = await db
        .select({
            checkinCount: count()
        })
        .from(athleteWellnessCheckins)
        .where(and(
            eq(athleteWellnessCheckins.membershipId, membershipId),
            eq(athleteWellnessCheckins.boxId, boxId),
            gte(athleteWellnessCheckins.checkinDate, preStart),
            lte(athleteWellnessCheckins.checkinDate, preEnd)
        ));

    const checkinRate = (checkins[0]?.checkinCount || 0) / lookbackDays * 100;

    // Get wellness score before intervention
    const wellness = await db
        .select({
            avgEnergy: avg(athleteWellnessCheckins.energyLevel),
            avgSleep: avg(athleteWellnessCheckins.sleepQuality),
            avgStress: avg(athleteWellnessCheckins.stressLevel),
            avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
        })
        .from(athleteWellnessCheckins)
        .where(and(
            eq(athleteWellnessCheckins.membershipId, membershipId),
            eq(athleteWellnessCheckins.boxId, boxId),
            gte(athleteWellnessCheckins.checkinDate, preStart),
            lte(athleteWellnessCheckins.checkinDate, preEnd)
        ));

    const wellnessScore = wellness[0]?.avgEnergy
        ? ((Number(wellness[0].avgEnergy) + Number(wellness[0].avgSleep) +
        Number(wellness[0].avgReadiness) + (10 - Number(wellness[0].avgStress))) / 4) * 10
        : 50; // Default neutral score

    // Get PR activity before intervention
    const [prCount, benchmarkCount] = await Promise.all([
        db.select({ count: count() })
            .from(athletePrs)
            .where(and(
                eq(athletePrs.membershipId, membershipId),
                eq(athletePrs.boxId, boxId),
                gte(athletePrs.achievedAt, preStart),
                lte(athletePrs.achievedAt, preEnd)
            )),

        db.select({ count: count() })
            .from(athleteBenchmarks)
            .where(and(
                eq(athleteBenchmarks.membershipId, membershipId),
                eq(athleteBenchmarks.boxId, boxId),
                gte(athleteBenchmarks.achievedAt, preStart),
                lte(athleteBenchmarks.achievedAt, preEnd)
            ))
    ]);

    const prActivity = (prCount[0]?.count || 0) + (benchmarkCount[0]?.count || 0);

    return {
        riskScore: riskScore[0]?.score ? Number(riskScore[0].score) : null,
        attendanceRate,
        checkinRate,
        wellnessScore,
        prActivity
    };
}

/**
 * Get post-intervention metrics for an athlete
 */
async function getPostInterventionMetrics(
    membershipId: string,
    boxId: string,
    interventionDate: Date,
    measurementPeriodDays: number = 30
): Promise<PostInterventionMetrics> {
    const postStart = new Date(interventionDate);
    postStart.setDate(postStart.getDate() + 1); // Day after intervention
    const postEnd = new Date(interventionDate);
    postEnd.setDate(postEnd.getDate() + measurementPeriodDays);

    // Get risk score after intervention
    const riskScore = await db
        .select({
            score: athleteRiskScores.overallRiskScore
        })
        .from(athleteRiskScores)
        .where(and(
            eq(athleteRiskScores.membershipId, membershipId),
            gte(athleteRiskScores.calculatedAt, postStart),
            lte(athleteRiskScores.calculatedAt, postEnd)
        ))
        .orderBy(sql`${athleteRiskScores.calculatedAt} DESC`)
        .limit(1);

    // Get attendance rate after intervention
    const attendance = await db
        .select({
            attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
            total: count()
        })
        .from(wodAttendance)
        .where(and(
            eq(wodAttendance.membershipId, membershipId),
            eq(wodAttendance.boxId, boxId),
            gte(wodAttendance.attendanceDate, sql`${postStart}::date`),
            lte(wodAttendance.attendanceDate, sql`${postEnd}::date`)
        ));

    const attendanceRate = attendance[0]?.total > 0
        ? (attendance[0].attended / attendance[0].total) * 100
        : 0;

    // Get checkin rate after intervention
    const checkins = await db
        .select({
            checkinCount: count()
        })
        .from(athleteWellnessCheckins)
        .where(and(
            eq(athleteWellnessCheckins.membershipId, membershipId),
            eq(athleteWellnessCheckins.boxId, boxId),
            gte(athleteWellnessCheckins.checkinDate, postStart),
            lte(athleteWellnessCheckins.checkinDate, postEnd)
        ));

    const checkinRate = (checkins[0]?.checkinCount || 0) / measurementPeriodDays * 100;

    // Get wellness score after intervention
    const wellness = await db
        .select({
            avgEnergy: avg(athleteWellnessCheckins.energyLevel),
            avgSleep: avg(athleteWellnessCheckins.sleepQuality),
            avgStress: avg(athleteWellnessCheckins.stressLevel),
            avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
        })
        .from(athleteWellnessCheckins)
        .where(and(
            eq(athleteWellnessCheckins.membershipId, membershipId),
            eq(athleteWellnessCheckins.boxId, boxId),
            gte(athleteWellnessCheckins.checkinDate, postStart),
            lte(athleteWellnessCheckins.checkinDate, postEnd)
        ));

    const wellnessScore = wellness[0]?.avgEnergy
        ? ((Number(wellness[0].avgEnergy) + Number(wellness[0].avgSleep) +
        Number(wellness[0].avgReadiness) + (10 - Number(wellness[0].avgStress))) / 4) * 10
        : 50; // Default neutral score

    // Get PR activity after intervention
    const [prCount, benchmarkCount] = await Promise.all([
        db.select({ count: count() })
            .from(athletePrs)
            .where(and(
                eq(athletePrs.membershipId, membershipId),
                eq(athletePrs.boxId, boxId),
                gte(athletePrs.achievedAt, postStart),
                lte(athletePrs.achievedAt, postEnd)
            )),

        db.select({ count: count() })
            .from(athleteBenchmarks)
            .where(and(
                eq(athleteBenchmarks.membershipId, membershipId),
                eq(athleteBenchmarks.boxId, boxId),
                gte(athleteBenchmarks.achievedAt, postStart),
                lte(athleteBenchmarks.achievedAt, postEnd)
            ))
    ]);

    const prActivity = (prCount[0]?.count || 0) + (benchmarkCount[0]?.count || 0);

    return {
        riskScore: riskScore[0]?.score ? Number(riskScore[0].score) : null,
        attendanceRate,
        checkinRate,
        wellnessScore,
        prActivity
    };
}

/**
 * Calculate intervention outcome effectiveness
 */
function calculateInterventionEffectiveness(
    pre: PreInterventionMetrics,
    post: PostInterventionMetrics,
    interventionType: string
): { effectiveness: 'positive' | 'neutral' | 'negative'; score: number; notes: string } {
    const changes: { metric: string; change: number; weight: number }[] = [];
    let notes: string[] = [];

    // Risk score change (lower is better)
    if (pre.riskScore !== null && post.riskScore !== null) {
        const riskChange = pre.riskScore - post.riskScore; // Positive = improvement
        changes.push({ metric: 'risk', change: riskChange, weight: 0.3 });
        if (riskChange > 5) notes.push('Risk score improved significantly');
        else if (riskChange < -5) notes.push('Risk score worsened');
    }

    // Attendance rate change
    const attendanceChange = post.attendanceRate - pre.attendanceRate;
    changes.push({ metric: 'attendance', change: attendanceChange, weight: 0.25 });
    if (attendanceChange > 10) notes.push('Attendance improved notably');
    else if (attendanceChange < -10) notes.push('Attendance declined');

    // Checkin rate change
    const checkinChange = post.checkinRate - pre.checkinRate;
    changes.push({ metric: 'checkin', change: checkinChange, weight: 0.2 });
    if (checkinChange > 15) notes.push('Engagement improved');
    else if (checkinChange < -15) notes.push('Engagement declined');

    // Wellness score change
    const wellnessChange = post.wellnessScore - pre.wellnessScore;
    changes.push({ metric: 'wellness', change: wellnessChange, weight: 0.15 });
    if (wellnessChange > 5) notes.push('Wellness indicators improved');
    else if (wellnessChange < -5) notes.push('Wellness indicators declined');

    // PR activity change
    const prChange = post.prActivity - pre.prActivity;
    changes.push({ metric: 'performance', change: prChange * 10, weight: 0.1 }); // Scale up PR changes
    if (prChange > 0) notes.push('Performance activity increased');
    else if (prChange < 0) notes.push('Performance activity decreased');

    // Calculate weighted effectiveness score
    const weightedScore = changes.reduce((sum, item) => sum + (item.change * item.weight), 0);

    // Normalize to 0-100 scale
    const normalizedScore = Math.max(0, Math.min(100, 50 + weightedScore));

    let effectiveness: 'positive' | 'neutral' | 'negative';
    if (normalizedScore >= 60) effectiveness = 'positive';
    else if (normalizedScore >= 40) effectiveness = 'neutral';
    else effectiveness = 'negative';

    return {
        effectiveness,
        score: Math.round(normalizedScore * 100) / 100,
        notes: notes.length > 0 ? notes.join('; ') : 'No significant changes observed'
    };
}

/**
 * Calculate intervention outcome for a specific intervention
 */
export async function calculateInterventionOutcome(
    interventionId: string,
    measurementPeriodDays: number = 30
): Promise<InterventionOutcomeData | null> {
    // Get intervention details
    const intervention = await db
        .select({
            id: athleteInterventions.id,
            membershipId: athleteInterventions.membershipId,
            boxId: athleteInterventions.boxId,
            interventionType: athleteInterventions.interventionType,
            interventionDate: athleteInterventions.interventionDate,
            athleteName: boxMemberships.displayName
        })
        .from(athleteInterventions)
        .innerJoin(boxMemberships, eq(athleteInterventions.membershipId, boxMemberships.id))
        .where(eq(athleteInterventions.id, interventionId))
        .limit(1);

    if (!intervention[0]) {
        return null;
    }

    const int = intervention[0];

    // Calculate outcome period
    const outcomePeriodStart = new Date(int.interventionDate);
    outcomePeriodStart.setDate(outcomePeriodStart.getDate() + 1);
    const outcomePeriodEnd = new Date(int.interventionDate);
    outcomePeriodEnd.setDate(outcomePeriodEnd.getDate() + measurementPeriodDays);

    // Get pre and post metrics
    const [preMetrics, postMetrics] = await Promise.all([
        getPreInterventionMetrics(int.membershipId, int.boxId, int.interventionDate),
        getPostInterventionMetrics(int.membershipId, int.boxId, int.interventionDate, measurementPeriodDays)
    ]);

    // Calculate effectiveness
    const effectiveness = calculateInterventionEffectiveness(preMetrics, postMetrics, int.interventionType);

    // Calculate changes
    const riskScoreChange = (preMetrics.riskScore !== null && postMetrics.riskScore !== null)
        ? preMetrics.riskScore - postMetrics.riskScore // Positive = improvement
        : null;

    const attendanceRateChange = postMetrics.attendanceRate - preMetrics.attendanceRate;
    const checkinRateChange = postMetrics.checkinRate - preMetrics.checkinRate;
    const wellnessScoreChange = postMetrics.wellnessScore - preMetrics.wellnessScore;
    const prActivityChange = postMetrics.prActivity - preMetrics.prActivity;

    return {
        interventionId,
        membershipId: int.membershipId,
        boxId: int.boxId,
        athleteName: int.athleteName,
        interventionType: int.interventionType,
        interventionDate: int.interventionDate,
        outcomePeriodStart,
        outcomePeriodEnd,
        riskScoreChange: riskScoreChange ? Math.round(riskScoreChange * 100) / 100 : null,
        attendanceRateChange: Math.round(attendanceRateChange * 100) / 100,
        checkinRateChange: Math.round(checkinRateChange * 100) / 100,
        wellnessScoreChange: Math.round(wellnessScoreChange * 100) / 100,
        prActivityChange,
        overallEffectiveness: effectiveness.effectiveness,
        effectivenessScore: effectiveness.score,
        measuredAt: new Date(),
        notes: effectiveness.notes
    };
}

/**
 * Process intervention outcomes for interventions that are ready for measurement
 */
export async function processInterventionOutcomes(
    boxId: string,
    measurementDelayDays: number = 30,
    measurementPeriodDays: number = 30
) {
    try {
        // Find interventions that are ready for outcome measurement
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - measurementDelayDays);

        const readyInterventions = await db
            .select({
                id: athleteInterventions.id,
                membershipId: athleteInterventions.membershipId,
                interventionType: athleteInterventions.interventionType,
                interventionDate: athleteInterventions.interventionDate,
                athleteName: boxMemberships.displayName
            })
            .from(athleteInterventions)
            .innerJoin(boxMemberships, eq(athleteInterventions.membershipId, boxMemberships.id))
            .leftJoin(interventionOutcomes, eq(athleteInterventions.id, interventionOutcomes.interventionId))
            .where(and(
                eq(athleteInterventions.boxId, boxId),
                lte(athleteInterventions.interventionDate, cutoffDate),
                sql`${interventionOutcomes.id} IS NULL` // Not already measured
            ));

        console.log(`[Analytics] Found ${readyInterventions.length} interventions ready for outcome measurement in box ${boxId}`);

        const results = [];

        for (const intervention of readyInterventions) {
            try {
                const outcome = await calculateInterventionOutcome(intervention.id, measurementPeriodDays);

                if (outcome) {
                    // Upsert to database
                    await db.insert(interventionOutcomes).values({
                        interventionId: outcome.interventionId,
                        membershipId: outcome.membershipId,
                        boxId: outcome.boxId,
                        riskScoreChange: outcome.riskScoreChange?.toString() ?? null,
                        attendanceRateChange: outcome.attendanceRateChange?.toString() ?? null,
                        checkinRateChange: outcome.checkinRateChange?.toString() ?? null,
                        wellnessScoreChange: outcome.wellnessScoreChange?.toString() ?? null,
                        prActivityChange: outcome.prActivityChange,
                        overallEffectiveness: outcome.overallEffectiveness,
                        effectivenessScore: outcome.effectivenessScore.toString(),
                        outcomePeriodStart: outcome.outcomePeriodStart,
                        outcomePeriodEnd: outcome.outcomePeriodEnd,
                        measuredAt: outcome.measuredAt,
                        notes: outcome.notes
                    })
                        .onConflictDoUpdate({
                            target: [interventionOutcomes.interventionId],
                            set: {
                                riskScoreChange: outcome.riskScoreChange?.toString() ?? null,
                                attendanceRateChange: outcome.attendanceRateChange?.toString() ?? null,
                                checkinRateChange: outcome.checkinRateChange?.toString() ?? null,
                                wellnessScoreChange: outcome.wellnessScoreChange?.toString() ?? null,
                                prActivityChange: outcome.prActivityChange,
                                overallEffectiveness: outcome.overallEffectiveness,
                                effectivenessScore: outcome.effectivenessScore.toString(),
                                outcomePeriodEnd: outcome.outcomePeriodEnd,
                                measuredAt: outcome.measuredAt,
                                notes: outcome.notes
                            }
                        });

                    results.push(outcome);

                    console.log(`[Analytics] ${outcome.overallEffectiveness.toUpperCase()} outcome for ${outcome.athleteName}'s ${outcome.interventionType} intervention (effectiveness: ${outcome.effectivenessScore}%)`);
                }
            } catch (error) {
                console.error(`[Analytics] Error calculating outcome for intervention ${intervention.id}:`, error);
            }
        }

        const positiveOutcomes = results.filter(r => r.overallEffectiveness === 'positive').length;
        const neutralOutcomes = results.filter(r => r.overallEffectiveness === 'neutral').length;
        const negativeOutcomes = results.filter(r => r.overallEffectiveness === 'negative').length;

        console.log(`[Analytics] Processed ${results.length} intervention outcomes for box ${boxId}`);
        console.log(`[Analytics] Results: ${positiveOutcomes} positive, ${neutralOutcomes} neutral, ${negativeOutcomes} negative`);

        return {
            boxId,
            outcomesProcessed: results.length,
            positiveOutcomes,
            neutralOutcomes,
            negativeOutcomes,
            avgEffectivenessScore: results.length > 0
                ? Math.round(results.reduce((sum, r) => sum + r.effectivenessScore, 0) / results.length * 100) / 100
                : 0,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing intervention outcomes for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Get intervention effectiveness summary for reporting
 */
export async function getInterventionEffectivenessSummary(
    boxId: string,
    lookbackDays: number = 90
): Promise<{
    totalOutcomes: number;
    positiveOutcomes: number;
    neutralOutcomes: number;
    negativeOutcomes: number;
    avgEffectivenessScore: number;
    effectivenessByType: { [key: string]: { count: number; avgScore: number; positiveRate: number } };
    topPerformingInterventionTypes: string[];
}> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const outcomes = await db
        .select({
            interventionType: athleteInterventions.interventionType,
            overallEffectiveness: interventionOutcomes.overallEffectiveness,
            effectivenessScore: interventionOutcomes.effectivenessScore
        })
        .from(interventionOutcomes)
        .innerJoin(athleteInterventions, eq(interventionOutcomes.interventionId, athleteInterventions.id))
        .where(and(
            eq(interventionOutcomes.boxId, boxId),
            gte(interventionOutcomes.measuredAt, cutoffDate)
        ));

    const totalOutcomes = outcomes.length;
    const positiveOutcomes = outcomes.filter(o => o.overallEffectiveness === 'positive').length;
    const neutralOutcomes = outcomes.filter(o => o.overallEffectiveness === 'neutral').length;
    const negativeOutcomes = outcomes.filter(o => o.overallEffectiveness === 'negative').length;

    const avgEffectivenessScore = outcomes.length > 0
        ? outcomes.reduce((sum, o) => sum + Number(o.effectivenessScore), 0) / outcomes.length
        : 0;

    // Group by intervention type
    const effectivenessByType: { [key: string]: { count: number; avgScore: number; positiveRate: number } } = {};

    outcomes.forEach(outcome => {
        const type = outcome.interventionType;
        if (!effectivenessByType[type]) {
            effectivenessByType[type] = { count: 0, avgScore: 0, positiveRate: 0 };
        }
        effectivenessByType[type].count++;
    });

    // Calculate averages for each type
    Object.keys(effectivenessByType).forEach(type => {
        const typeOutcomes = outcomes.filter(o => o.interventionType === type);
        const totalScore = typeOutcomes.reduce((sum, o) => sum + Number(o.effectivenessScore), 0);
        const positiveCount = typeOutcomes.filter(o => o.overallEffectiveness === 'positive').length;

        effectivenessByType[type].avgScore = Math.round(totalScore / typeOutcomes.length * 100) / 100;
        effectivenessByType[type].positiveRate = Math.round(positiveCount / typeOutcomes.length * 10000) / 100;
    });

    // Get top performing intervention types
    const topPerformingInterventionTypes = Object.entries(effectivenessByType)
        .filter(([_, data]) => data.count >= 3) // Minimum 3 outcomes for statistical relevance
        .sort(([_, a], [__, b]) => b.avgScore - a.avgScore)
        .slice(0, 3)
        .map(([type, _]) => type);

    return {
        totalOutcomes,
        positiveOutcomes,
        neutralOutcomes,
        negativeOutcomes,
        avgEffectivenessScore: Math.round(avgEffectivenessScore * 100) / 100,
        effectivenessByType,
        topPerformingInterventionTypes
    };
}
