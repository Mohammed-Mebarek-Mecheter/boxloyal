// lib/services/analytics/analytics-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteWellnessCheckins,
    athletePrs,
    athleteBenchmarks,
    boxAnalytics,
    athleteRiskScores,
    athleteAlerts,
    wodAttendance,
    boxes
} from "@/db/schema";
import { eq, and, gte, count, sql, avg, lte, inArray } from "drizzle-orm";

type AlertTypeEnum = 'risk_threshold' | 'performance_decline' | 'attendance_drop' | 'wellness_concern' | 'milestone_celebration' | 'checkin_reminder' | 'pr_celebration' | 'benchmark_improvement' | 'intervention_needed' | 'feedback_request';
type RiskLevelEnum = 'low' | 'medium' | 'high' | 'critical';
type AlertStatusEnum = 'active' | 'acknowledged' | 'resolved' | 'escalated' | 'snoozed';

export interface GeneratedAlertData {
    boxId: string;
    membershipId: string;
    alertType: AlertTypeEnum;
    severity: RiskLevelEnum; // Maps to riskLevel from risk score
    title: string;
    description: string;
    triggerData: any; // Store relevant risk score data or metrics that triggered the alert
    suggestedActions: any; // Basic suggestions based on alert type
    status: AlertStatusEnum;
    assignedCoachId: string | null; // Could be looked up or assigned later
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Generates an alert object based on an athlete's risk score.
 * This determines the alert type, severity, title, description, and suggested actions.
 */
export function generateAlertFromRiskScore(riskScore: any): GeneratedAlertData | null {
    // Only generate alerts for medium, high, or critical risk levels
    if (riskScore.riskLevel === 'low') {
        return null;
    }

    let alertType: AlertTypeEnum = 'risk_threshold'; // Default type
    let title = `Athlete at ${riskScore.riskLevel} Risk`;
    let description = `Athlete ${riskScore.membershipId} has been assessed with a ${riskScore.riskLevel} risk level (Score: ${riskScore.overallRiskScore}).`;
    let suggestedActions: any = { general: "Review athlete's recent activity, wellness check-ins, and performance data. Consider reaching out for a check-in or discussion." };

    // Determine specific alert type and details based on factors or trends
    // Example logic (you can refine based on your `factors` structure or trends):
    if (riskScore.attendanceTrend !== null && riskScore.attendanceTrend < -20) { // e.g., 20% decline
        alertType = 'attendance_drop';
        title = "Significant Attendance Drop Detected";
        description = `Athlete's attendance has declined by ${Math.abs(riskScore.attendanceTrend).toFixed(1)}% recently. This could indicate disengagement.`;
        suggestedActions = { attendance: "Reach out to understand reasons for missed sessions. Offer support or schedule a catch-up." };
    } else if (riskScore.performanceTrend !== null && riskScore.performanceTrend < -10) { // e.g., 10% decline
        alertType = 'performance_decline';
        title = "Athlete Performance Declining";
        description = `Athlete's performance metrics (PRs/Benchmarks) show a ${Math.abs(riskScore.performanceTrend).toFixed(1)}% decline.`;
        suggestedActions = { performance: "Review recent workouts. Discuss training load or potential plateaus. Offer personalized coaching tips." };
    } else if (riskScore.wellnessTrend !== null && riskScore.wellnessTrend < -15) { // e.g., 15% decline in wellness score
        alertType = 'wellness_concern';
        title = "Athlete Wellness Concern";
        description = `Athlete's self-reported wellness scores have dropped significantly by ${Math.abs(riskScore.wellnessTrend).toFixed(1)}%.`;
        suggestedActions = { wellness: "Consider checking in on the athlete's well-being. Offer resources or discuss workload." };
    } else if (riskScore.daysSinceLastVisit !== null && riskScore.daysSinceLastVisit > 14) { // e.g., 2 weeks
        alertType = 'risk_threshold';
        title = "Prolonged Absence from Box";
        description = `Athlete has not attended a session in ${riskScore.daysSinceLastVisit} days.`;
        suggestedActions = { re_engagement: "Initiate contact to understand the absence. Offer support or invite back to sessions." };
    } else if (riskScore.daysSinceLastCheckin !== null && riskScore.daysSinceLastCheckin > 7) { // e.g., 1 week
        // This might be a lower severity alert or a different type, but for now, we can include it if risk is high/critical
        if (riskScore.riskLevel === 'high' || riskScore.riskLevel === 'critical') {
            alertType = 'checkin_reminder'; // Or modify existing alert description
            title = "Athlete at Risk - No Recent Check-in";
            description += ` They have also not submitted a wellness check-in for ${riskScore.daysSinceLastCheckin} days.`;
            suggestedActions['checkin'] = "Prompt athlete to complete their wellness check-in for better insights.";
        }
    }

    // Severity maps directly from risk level
    const severity: RiskLevelEnum = riskScore.riskLevel;

    return {
        boxId: riskScore.boxId,
        membershipId: riskScore.membershipId,
        alertType,
        severity,
        title,
        description,
        triggerData: {
            riskScore: riskScore.overallRiskScore,
            riskLevel: riskScore.riskLevel,
            churnProbability: riskScore.churnProbability,
            factors: riskScore.factors,
            trends: {
                attendance: riskScore.attendanceTrend,
                performance: riskScore.performanceTrend,
                wellness: riskScore.wellnessTrend
            },
            lastActivity: {
                visit: riskScore.daysSinceLastVisit,
                checkin: riskScore.daysSinceLastCheckin,
                pr: riskScore.daysSinceLastPr
            }
        },
        suggestedActions,
        status: 'active', // Default status
        assignedCoachId: null, // Assignment logic can be separate or part of upsert
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

/**
 * Processes and upserts alerts for athletes in a specific box based on their latest risk scores.
 * This function identifies athletes with risk scores above a threshold and creates or updates alerts.
 */
export async function processAthleteAlertsForBox(boxId: string) {
    try {
        console.log(`[Alerts] Starting alert processing for box ${boxId}`);

        // 1. Fetch the latest valid risk scores for all active athletes in the box
        // Using a window function or subquery to get the most recent score per athlete
        // This query gets the latest risk score for each membership in the box that is still valid
        const latestRiskScores = await db.execute(sql`
            SELECT DISTINCT ON (membership_id)
                id, box_id, membership_id, overall_risk_score, risk_level, churn_probability,
                attendance_score, performance_score, engagement_score, wellness_score,
                attendance_trend, performance_trend, engagement_trend, wellness_trend,
                days_since_last_visit, days_since_last_checkin, days_since_last_pr,
                factors, calculated_at, valid_until
            FROM ${athleteRiskScores}
            WHERE box_id = ${boxId} AND valid_until > NOW()
            ORDER BY membership_id, calculated_at DESC
        `);

        if (!latestRiskScores || latestRiskScores.rows.length === 0) {
            console.log(`[Alerts] No valid risk scores found for box ${boxId}.`);
            return { boxId, alertsGenerated: 0, alertsUpdated: 0 };
        }

        console.log(`[Alerts] Found ${latestRiskScores.rows.length} latest risk scores for box ${boxId}`);

        // 2. Generate alert data for each relevant risk score
        const generatedAlerts: GeneratedAlertData[] = [];
        for (const riskScoreRow of latestRiskScores.rows) {
            // The row from `execute` is a plain object, might need type assertion or mapping
            // Map the row object to the structure expected by `generateAlertFromRiskScore`
            // Ensure decimal strings are converted if needed by the logic (though comparison might work)
            const mappedRiskScore = {
                ...riskScoreRow,
                // Convert string decimals back to numbers if your logic requires it
                // overallRiskScore: parseFloat(riskScoreRow.overall_risk_score),
                // churnProbability: riskScoreRow.churn_probability ? parseFloat(riskScoreRow.churn_probability) : null,
                // ... (convert other decimal fields if necessary)
                riskLevel: riskScoreRow.risk_level, // This should match the enum type
                // Ensure nested objects like `factors` are parsed if stored as JSON strings
                factors: typeof riskScoreRow.factors === 'string' ? JSON.parse(riskScoreRow.factors) : riskScoreRow.factors
            };

            const alertData = generateAlertFromRiskScore(mappedRiskScore);
            if (alertData) {
                generatedAlerts.push(alertData);
            }
        }

        console.log(`[Alerts] Generated ${generatedAlerts.length} alerts for box ${boxId}`);

        if (generatedAlerts.length === 0) {
            console.log(`[Alerts] No alerts generated for box ${boxId}.`);
            return { boxId, alertsGenerated: 0, alertsUpdated: 0 };
        }

        // 3. Upsert the generated alerts into the athleteAlerts table
        // Use a transaction or loop for upserts if needed, but drizzle's `insert ... onConflict` should work
        let alertsGenerated = 0;
        let alertsUpdated = 0;

        // Process alerts in batches to avoid overwhelming the DB
        const batchSize = 20;
        for (let i = 0; i < generatedAlerts.length; i += batchSize) {
            const batch = generatedAlerts.slice(i, i + batchSize);

            // For each alert in the batch, perform an upsert
            // We'll upsert based on membershipId and alertType, assuming one active alert of a type per athlete
            // Adjust the conflict target and logic as needed (e.g., maybe just membershipId and status='active')
            const batchPromises = batch.map(alert => {
                // Convert numbers to strings for decimal fields if your schema requires it (like in processBoxAnalyticsSnapshot)
                // Although athleteAlerts doesn't seem to have decimal fields for the main alert data itself,
                // the triggerData JSON might contain them. Ensure consistency.
                return db.insert(athleteAlerts).values({
                    boxId: alert.boxId,
                    membershipId: alert.membershipId,
                    alertType: alert.alertType,
                    severity: alert.severity,
                    title: alert.title,
                    description: alert.description,
                    triggerData: alert.triggerData, // JSON field
                    suggestedActions: alert.suggestedActions, // JSON field
                    status: alert.status,
                    assignedCoachId: alert.assignedCoachId,
                    createdAt: alert.createdAt,
                    updatedAt: alert.updatedAt,
                    // Add other fields like `acknowledgedAt`, `resolvedAt` if needed, defaulting to null
                })
                    .onConflictDoUpdate({
                        // Conflict target: Modify based on your unique constraint logic
                        // Example: Unique constraint on (box_id, membership_id, alert_type) for active alerts
                        // Or maybe just (membership_id) if only one alert per athlete is desired at a time.
                        // Check your schema definition for the unique constraint or primary key.
                        // Assuming a unique constraint like `boxMembershipAlertTypeUnique` on (boxId, membershipId, alertType)
                        // Adjust the target fields accordingly.
                        // If no specific unique constraint, you might need a different strategy like checking for existing 'active' alerts first.
                        target: [athleteAlerts.boxId, athleteAlerts.membershipId, athleteAlerts.alertType], // Example target
                        set: {
                            // On conflict, update the alert details as the risk score might have changed
                            severity: alert.severity,
                            title: alert.title,
                            description: alert.description,
                            triggerData: alert.triggerData,
                            suggestedActions: alert.suggestedActions,
                            updatedAt: new Date(),
                            // Potentially reset status to 'active' if it was resolved/acknowledged?
                            // status: sql`CASE WHEN ${athleteAlerts.status} IN ('resolved', 'acknowledged') THEN 'active' ELSE ${athleteAlerts.status} END`,
                            // Or keep status as is if it was already acknowledged/resolved?
                            // For simplicity, let's update the details but not force status change.
                            // status: alert.status // This might reactivate resolved alerts, be careful.
                        },
                        // If you want to avoid updating if the alert is already resolved/acknowledged:
                        // where: eq(athleteAlerts.status, 'active') // Only update if currently active
                        // The `where` clause in `onConflictDoUpdate` is not standard SQL in all ORMs.
                        // Drizzle might not support it directly in this context. You might need to handle this logic differently.
                        // E.g., fetch existing alert, check status, then decide to insert/update.
                        // For now, we'll proceed with the basic upsert, assuming the conflict target handles uniqueness appropriately
                        // and that updating details of an existing alert (even if resolved) is acceptable or handled by the UI.
                    });
            });

            const batchResults = await Promise.allSettled(batchPromises);

            batchResults.forEach(result => {
                if (result.status === 'fulfilled') {
                    // Drizzle's `onConflictDoUpdate` doesn't directly tell if it was an insert or update in the result.
                    // You might need to inspect the result or use separate queries/transactions if you need this distinction.
                    // For now, we'll increment a general counter or assume all are new/updated.
                    // A simple way (though not 100% accurate) is to assume if there were no errors, something happened.
                    // A more robust way would be to check the number of affected rows or use a transaction with explicit checks.
                    // Let's assume for now each call results in an alert being present/updated.
                    alertsGenerated++; // This is a simplification.
                } else {
                    console.error(`[Alerts] Error upserting alert:`, result.reason);
                }
            });

            // Small delay between batches
            if (i + batchSize < generatedAlerts.length) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        console.log(`[Alerts] Completed alert processing for box ${boxId}. Alerts handled: ${alertsGenerated}`);
        return { boxId, alertsGenerated, alertsUpdated }; // Refine counts if needed

    } catch (error) {
        console.error(`[Alerts] Error processing alerts for box ${boxId}:`, error);
        throw error;
    }
}

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
