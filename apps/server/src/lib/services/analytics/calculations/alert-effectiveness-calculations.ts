// src/lib/services/analytics/calculations/alert-effectiveness-calculations.ts
import { db } from "@/db";
import {
    athleteAlerts,
    athleteInterventions,
    athleteRiskScores,
    boxMemberships,
    alertEffectivenessMetrics,
    alertEscalations
} from "@/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import {alertTypeEnum, riskLevelEnum} from "@/db/schema/enums";

// Get the union type of allowed alert types from the schema enum
type SchemaAlertTypeEnum = typeof alertTypeEnum.enumValues[number]; // Resolves to "declining_performance" | "poor_attendance" | ...
// Get the union type of allowed severity levels from the schema enum
type SchemaRiskLevelEnum = typeof riskLevelEnum.enumValues[number]; // Resolves to "low" | "medium" | "high" | "critical"

export interface AlertEffectivenessData {
    boxId: string;
    alertType: SchemaAlertTypeEnum; // Was string
    severity: SchemaRiskLevelEnum;  // Was 'low' | 'medium' | 'high' | 'critical'
    periodStart: Date;
    periodEnd: Date;
    totalAlerts: number;
    alertsAcknowledged: number;
    alertsResolved: number;
    alertsIgnored: number;
    alertsEscalated: number;
    avgTimeToAcknowledge: number | null;
    avgTimeToResolve: number | null;
    avgTimeToIntervention: number | null;
    successRate: number | null;
    falsePositiveRate: number | null;
    avgRiskReduction: number | null;
    churnsPrevented: number | null;
    avgCoachResponseTime: number | null;
    coachEngagementRate: number | null;
    calculatedAt: Date;
}

interface AlertAnalysisData {
    alertId: string;
    membershipId: string;
    alertType: SchemaAlertTypeEnum; // Was string
    severity: SchemaRiskLevelEnum;  // Was string
    createdAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    assignedCoachId: string | null;
    status: string;
    wasEscalated: boolean;
    interventionDate: Date | null;
    outcomePositive: boolean | null;
    athleteRetained: boolean;
    initialRiskScore: number | null;
    currentRiskScore: number | null;
}

/**
 * Get comprehensive alert data for analysis
 */
async function getAlertAnalysisData(
    boxId: string,
    alertType: SchemaAlertTypeEnum, // Was string
    severity: SchemaRiskLevelEnum,  // Was string
    periodStart: Date,
    periodEnd: Date
): Promise<AlertAnalysisData[]> {
    const alertData = await db
        .select({
            alertId: athleteAlerts.id,
            membershipId: athleteAlerts.membershipId,
            alertType: athleteAlerts.alertType,
            severity: athleteAlerts.severity,
            createdAt: athleteAlerts.createdAt,
            acknowledgedAt: athleteAlerts.acknowledgedAt,
            resolvedAt: athleteAlerts.resolvedAt,
            assignedCoachId: athleteAlerts.assignedCoachId,
            status: athleteAlerts.status,
            athleteIsActive: boxMemberships.isActive
        })
        .from(athleteAlerts)
        .innerJoin(boxMemberships, eq(athleteAlerts.membershipId, boxMemberships.id))
        .where(and(
            eq(athleteAlerts.boxId, boxId),
            eq(athleteAlerts.alertType, alertType),
            eq(athleteAlerts.severity, severity),
            gte(athleteAlerts.createdAt, periodStart),
            lte(athleteAlerts.createdAt, periodEnd)
        ));

    const analysisData: AlertAnalysisData[] = [];

    for (const alert of alertData) {
        // Check if alert was escalated
        const escalation = await db
            .select({ escalatedAt: alertEscalations.escalatedAt })
            .from(alertEscalations)
            .where(eq(alertEscalations.alertId, alert.alertId))
            .limit(1);

        // Get related intervention
        const intervention = await db
            .select({
                interventionDate: athleteInterventions.interventionDate,
                outcome: athleteInterventions.outcome
            })
            .from(athleteInterventions)
            .where(and(
                eq(athleteInterventions.membershipId, alert.membershipId),
                eq(athleteInterventions.alertId, alert.alertId)
            ))
            .limit(1);

        // Get risk scores before and after alert
        const [initialRisk, currentRisk] = await Promise.all([
            db.select({ score: athleteRiskScores.overallRiskScore })
                .from(athleteRiskScores)
                .where(and(
                    eq(athleteRiskScores.membershipId, alert.membershipId),
                    lte(athleteRiskScores.calculatedAt, alert.createdAt)
                ))
                .orderBy(sql`${athleteRiskScores.calculatedAt} DESC`)
                .limit(1),

            db.select({ score: athleteRiskScores.overallRiskScore })
                .from(athleteRiskScores)
                .where(and(
                    eq(athleteRiskScores.membershipId, alert.membershipId),
                    gte(athleteRiskScores.calculatedAt, alert.createdAt)
                ))
                .orderBy(sql`${athleteRiskScores.calculatedAt} DESC`)
                .limit(1)
        ]);

        // Determine outcome
        let outcomePositive: boolean | null = null;
        if (intervention[0]?.outcome) {
            outcomePositive = intervention[0].outcome === 'positive';
        } else if (alert.status === 'resolved') {
            // If resolved without explicit outcome, check if risk improved
            if (initialRisk[0] && currentRisk[0]) {
                outcomePositive = Number(currentRisk[0].score) < Number(initialRisk[0].score);
            }
        }

        analysisData.push({
            alertId: alert.alertId,
            membershipId: alert.membershipId,
            alertType: alert.alertType,
            severity: alert.severity,
            createdAt: alert.createdAt,
            acknowledgedAt: alert.acknowledgedAt,
            resolvedAt: alert.resolvedAt,
            assignedCoachId: alert.assignedCoachId,
            status: alert.status,
            wasEscalated: escalation.length > 0,
            interventionDate: intervention[0]?.interventionDate || null,
            outcomePositive,
            athleteRetained: alert.athleteIsActive,
            initialRiskScore: initialRisk[0]?.score ? Number(initialRisk[0].score) : null,
            currentRiskScore: currentRisk[0]?.score ? Number(currentRisk[0].score) : null
        });
    }

    return analysisData;
}

/**
 * Calculate alert effectiveness metrics
 */
export async function calculateAlertEffectiveness(
    boxId: string,
    alertType: SchemaAlertTypeEnum, // Was string
    severity: SchemaRiskLevelEnum,  // Was 'low' | 'medium' | 'high' | 'critical'
    periodStart: Date,
    periodEnd: Date
): Promise<AlertEffectivenessData> {
    const alertData = await getAlertAnalysisData(boxId, alertType, severity, periodStart, periodEnd);

    const totalAlerts = alertData.length;

    if (totalAlerts === 0) {
        return {
            boxId,
            alertType,
            severity,
            periodStart,
            periodEnd,
            totalAlerts: 0,
            alertsAcknowledged: 0,
            alertsResolved: 0,
            alertsIgnored: 0,
            alertsEscalated: 0,
            avgTimeToAcknowledge: null,
            avgTimeToResolve: null,
            avgTimeToIntervention: null,
            successRate: null,
            falsePositiveRate: null,
            avgRiskReduction: null,
            churnsPrevented: null,
            avgCoachResponseTime: null,
            coachEngagementRate: null,
            calculatedAt: new Date()
        };
    }

    // Volume metrics
    const alertsAcknowledged = alertData.filter(a => a.acknowledgedAt !== null).length;
    const alertsResolved = alertData.filter(a => a.status === 'resolved').length;
    const alertsIgnored = alertData.filter(a => a.acknowledgedAt === null).length;
    const alertsEscalated = alertData.filter(a => a.wasEscalated).length;

    // Response time metrics
    const acknowledgedAlerts = alertData.filter(a => a.acknowledgedAt !== null);
    const avgTimeToAcknowledge = acknowledgedAlerts.length > 0
        ? acknowledgedAlerts.reduce((sum, alert) => {
        const hours = (alert.acknowledgedAt!.getTime() - alert.createdAt.getTime()) / (1000 * 60 * 60);
        return sum + hours;
    }, 0) / acknowledgedAlerts.length
        : null;

    const resolvedAlerts = alertData.filter(a => a.resolvedAt !== null);
    const avgTimeToResolve = resolvedAlerts.length > 0
        ? resolvedAlerts.reduce((sum, alert) => {
        const hours = (alert.resolvedAt!.getTime() - alert.createdAt.getTime()) / (1000 * 60 * 60);
        return sum + hours;
    }, 0) / resolvedAlerts.length
        : null;

    const interventionAlerts = alertData.filter(a => a.interventionDate !== null);
    const avgTimeToIntervention = interventionAlerts.length > 0
        ? interventionAlerts.reduce((sum, alert) => {
        const hours = (alert.interventionDate!.getTime() - alert.createdAt.getTime()) / (1000 * 60 * 60);
        return sum + hours;
    }, 0) / interventionAlerts.length
        : null;

    // Effectiveness metrics
    const alertsWithOutcome = alertData.filter(a => a.outcomePositive !== null);
    const successfulAlerts = alertData.filter(a => a.outcomePositive === true);
    const successRate = alertsWithOutcome.length > 0
        ? (successfulAlerts.length / alertsWithOutcome.length) * 100
        : null;

    // False positive rate (alerts that didn't need intervention)
    const dismissedAlerts = alertData.filter(a => a.status === 'dismissed' || (a.outcomePositive === false));
    const falsePositiveRate = totalAlerts > 0
        ? (dismissedAlerts.length / totalAlerts) * 100
        : null;

    // Risk reduction
    const alertsWithRiskScores = alertData.filter(a => a.initialRiskScore !== null && a.currentRiskScore !== null);
    const avgRiskReduction = alertsWithRiskScores.length > 0
        ? alertsWithRiskScores.reduce((sum, alert) => {
        return sum + (alert.initialRiskScore! - alert.currentRiskScore!);
    }, 0) / alertsWithRiskScores.length
        : null;

    // Churn prevention estimation
    const retainedAthletes = alertData.filter(a => a.athleteRetained).length;
    const churnsPrevented = severity === 'critical' || severity === 'high'
        ? Math.round(retainedAthletes * 0.7) // Estimate based on severity
        : Math.round(retainedAthletes * 0.3);

    // Coach performance
    const assignedAlerts = alertData.filter(a => a.assignedCoachId !== null);
    const coachEngagementRate = assignedAlerts.length > 0
        ? (interventionAlerts.length / assignedAlerts.length) * 100
        : null;

    // Coach response time (time from assignment to intervention)
    const assignedInterventions = alertData.filter(a =>
        a.assignedCoachId !== null && a.interventionDate !== null && a.acknowledgedAt !== null
    );
    const avgCoachResponseTime = assignedInterventions.length > 0
        ? assignedInterventions.reduce((sum, alert) => {
        const hours = (alert.interventionDate!.getTime() - alert.acknowledgedAt!.getTime()) / (1000 * 60 * 60);
        return sum + hours;
    }, 0) / assignedInterventions.length
        : null;

    return {
        boxId,
        alertType,
        severity,
        periodStart,
        periodEnd,
        totalAlerts,
        alertsAcknowledged,
        alertsResolved,
        alertsIgnored,
        alertsEscalated,
        avgTimeToAcknowledge: avgTimeToAcknowledge ? Math.round(avgTimeToAcknowledge * 100) / 100 : null,
        avgTimeToResolve: avgTimeToResolve ? Math.round(avgTimeToResolve * 100) / 100 : null,
        avgTimeToIntervention: avgTimeToIntervention ? Math.round(avgTimeToIntervention * 100) / 100 : null,
        successRate: successRate ? Math.round(successRate * 100) / 100 : null,
        falsePositiveRate: falsePositiveRate ? Math.round(falsePositiveRate * 100) / 100 : null,
        avgRiskReduction: avgRiskReduction ? Math.round(avgRiskReduction * 100) / 100 : null,
        churnsPrevented,
        avgCoachResponseTime: avgCoachResponseTime ? Math.round(avgCoachResponseTime * 100) / 100 : null,
        coachEngagementRate: coachEngagementRate ? Math.round(coachEngagementRate * 100) / 100 : null,
        calculatedAt: new Date()
    };
}

/**
 * Process alert effectiveness for all alert types and severities
 */
export async function processAlertEffectiveness(
    boxId: string,
    lookbackDays: number = 30
) {
    try {
        const periodEnd = new Date();
        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - lookbackDays);

        console.log(`[Analytics] Processing alert effectiveness for box ${boxId}`);
        console.log(`[Analytics] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

        const alertTypes: SchemaAlertTypeEnum[] = [ // Type the array
            'declining_performance',
            'poor_attendance',
            'negative_wellness',
            'no_checkin',
            'injury_risk',
            'engagement_drop',
            'churn_risk'
        ];

        const severityLevels: ('low' | 'medium' | 'high' | 'critical')[] = ['low', 'medium', 'high', 'critical'];
        const results = [];

        for (const alertType of alertTypes) {
            for (const severity of severityLevels) {
                try {
                    const effectiveness = await calculateAlertEffectiveness(
                        boxId,
                        alertType,
                        severity,
                        periodStart,
                        periodEnd
                    );

                    // Only store if there were alerts
                    if (effectiveness.totalAlerts > 0) {
                        // Upsert to database
                        await db.insert(alertEffectivenessMetrics).values({
                            ...effectiveness,
                            avgTimeToAcknowledge: effectiveness.avgTimeToAcknowledge?.toString() ?? null,
                            avgTimeToResolve: effectiveness.avgTimeToResolve?.toString() ?? null,
                            avgTimeToIntervention: effectiveness.avgTimeToIntervention?.toString() ?? null,
                            successRate: effectiveness.successRate?.toString() ?? null,
                            falsePositiveRate: effectiveness.falsePositiveRate?.toString() ?? null,
                            avgRiskReduction: effectiveness.avgRiskReduction?.toString() ?? null,
                            avgCoachResponseTime: effectiveness.avgCoachResponseTime?.toString() ?? null,
                            coachEngagementRate: effectiveness.coachEngagementRate?.toString() ?? null
                        })
                            .onConflictDoUpdate({
                                target: [
                                    alertEffectivenessMetrics.boxId,
                                    alertEffectivenessMetrics.alertType,
                                    alertEffectivenessMetrics.severity,
                                    alertEffectivenessMetrics.periodStart
                                ],
                                set: {
                                    totalAlerts: effectiveness.totalAlerts,
                                    alertsAcknowledged: effectiveness.alertsAcknowledged,
                                    alertsResolved: effectiveness.alertsResolved,
                                    alertsIgnored: effectiveness.alertsIgnored,
                                    alertsEscalated: effectiveness.alertsEscalated,
                                    avgTimeToAcknowledge: effectiveness.avgTimeToAcknowledge?.toString() ?? null,
                                    avgTimeToResolve: effectiveness.avgTimeToResolve?.toString() ?? null,
                                    avgTimeToIntervention: effectiveness.avgTimeToIntervention?.toString() ?? null,
                                    successRate: effectiveness.successRate?.toString() ?? null,
                                    falsePositiveRate: effectiveness.falsePositiveRate?.toString() ?? null,
                                    avgRiskReduction: effectiveness.avgRiskReduction?.toString() ?? null,
                                    churnsPrevented: effectiveness.churnsPrevented,
                                    avgCoachResponseTime: effectiveness.avgCoachResponseTime?.toString() ?? null,
                                    coachEngagementRate: effectiveness.coachEngagementRate?.toString() ?? null,
                                    calculatedAt: effectiveness.calculatedAt,
                                    periodEnd: effectiveness.periodEnd
                                }
                            });

                        results.push(effectiveness);

                        console.log(`[Analytics] ${alertType} (${severity}): ${effectiveness.totalAlerts} alerts, ${effectiveness.successRate || 0}% success rate`);
                    }
                } catch (error) {
                    console.error(`[Analytics] Error processing ${alertType}/${severity} for box ${boxId}:`, error);
                }
            }
        }

        const totalAlerts = results.reduce((sum, r) => sum + r.totalAlerts, 0);
        const avgSuccessRate = results.length > 0 && results.some(r => r.successRate !== null)
            ? results.filter(r => r.successRate !== null).reduce((sum, r) => sum + r.successRate!, 0) /
            results.filter(r => r.successRate !== null).length
            : 0;

        console.log(`[Analytics] Successfully processed alert effectiveness for box ${boxId}: ${totalAlerts} alerts analyzed`);

        return {
            boxId,
            alertTypesProcessed: results.length,
            totalAlertsAnalyzed: totalAlerts,
            avgSuccessRate: Math.round(avgSuccessRate * 100) / 100,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing alert effectiveness for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Get alert performance summary
 */
export async function getAlertPerformanceSummary(
    boxId: string,
    lookbackDays: number = 30
): Promise<{
    totalAlerts: number;
    avgResponseTime: number | null;
    avgSuccessRate: number | null;
    topPerformingAlertType: string | null;
    worstPerformingAlertType: string | null;
    alertsByType: { [key: string]: { count: number; successRate: number | null } };
    alertsBySeverity: { [key: string]: { count: number; successRate: number | null } };
    churnsPrevented: number;
    falsePositiveRate: number | null;
}> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const metrics = await db
        .select({
            alertType: alertEffectivenessMetrics.alertType,
            severity: alertEffectivenessMetrics.severity,
            totalAlerts: alertEffectivenessMetrics.totalAlerts,
            avgTimeToResolve: alertEffectivenessMetrics.avgTimeToResolve,
            successRate: alertEffectivenessMetrics.successRate,
            falsePositiveRate: alertEffectivenessMetrics.falsePositiveRate,
            churnsPrevented: alertEffectivenessMetrics.churnsPrevented
        })
        .from(alertEffectivenessMetrics)
        .where(and(
            eq(alertEffectivenessMetrics.boxId, boxId),
            gte(alertEffectivenessMetrics.periodStart, cutoffDate)
        ));

    const totalAlerts = metrics.reduce((sum, m) => sum + m.totalAlerts, 0);
    const churnsPrevented = metrics.reduce((sum, m) => sum + (m.churnsPrevented || 0), 0);

    const metricsWithResponseTime = metrics.filter(m => m.avgTimeToResolve !== null);
    const avgResponseTime = metricsWithResponseTime.length > 0
        ? metricsWithResponseTime.reduce((sum, m) => sum + Number(m.avgTimeToResolve!), 0) / metricsWithResponseTime.length
        : null;

    const metricsWithSuccess = metrics.filter(m => m.successRate !== null);
    const avgSuccessRate = metricsWithSuccess.length > 0
        ? metricsWithSuccess.reduce((sum, m) => sum + Number(m.successRate!), 0) / metricsWithSuccess.length
        : null;

    const metricsWithFalsePositive = metrics.filter(m => m.falsePositiveRate !== null);
    const falsePositiveRate = metricsWithFalsePositive.length > 0
        ? metricsWithFalsePositive.reduce((sum, m) => sum + Number(m.falsePositiveRate!), 0) / metricsWithFalsePositive.length
        : null;

    // Group by alert type
    const alertsByType: { [key: string]: { count: number; successRate: number | null } } = {};
    metrics.forEach(metric => {
        if (!alertsByType[metric.alertType]) {
            alertsByType[metric.alertType] = { count: 0, successRate: null };
        }
        alertsByType[metric.alertType].count += metric.totalAlerts;
    });

    // Calculate average success rate by type
    Object.keys(alertsByType).forEach(alertType => {
        const typeMetrics = metrics.filter(m => m.alertType === alertType && m.successRate !== null);
        if (typeMetrics.length > 0) {
            alertsByType[alertType].successRate =
                typeMetrics.reduce((sum, m) => sum + Number(m.successRate!), 0) / typeMetrics.length;
        }
    });

    // Group by severity
    const alertsBySeverity: { [key: string]: { count: number; successRate: number | null } } = {};
    metrics.forEach(metric => {
        if (!alertsBySeverity[metric.severity]) {
            alertsBySeverity[metric.severity] = { count: 0, successRate: null };
        }
        alertsBySeverity[metric.severity].count += metric.totalAlerts;
    });

    // Calculate average success rate by severity
    Object.keys(alertsBySeverity).forEach(severity => {
        const severityMetrics = metrics.filter(m => m.severity === severity && m.successRate !== null);
        if (severityMetrics.length > 0) {
            alertsBySeverity[severity].successRate =
                severityMetrics.reduce((sum, m) => sum + Number(m.successRate!), 0) / severityMetrics.length;
        }
    });

    // Find top and worst performing alert types
    const alertTypesWithSuccess = Object.entries(alertsByType)
        .filter(([_, data]) => data.successRate !== null && data.count >= 5)
        .sort(([_, a], [__, b]) => b.successRate! - a.successRate!);

    const topPerformingAlertType = alertTypesWithSuccess.length > 0 ? alertTypesWithSuccess[0][0] : null;
    const worstPerformingAlertType = alertTypesWithSuccess.length > 0
        ? alertTypesWithSuccess[alertTypesWithSuccess.length - 1][0]
        : null;

    return {
        totalAlerts,
        avgResponseTime: avgResponseTime ? Math.round(avgResponseTime * 100) / 100 : null,
        avgSuccessRate: avgSuccessRate ? Math.round(avgSuccessRate * 100) / 100 : null,
        topPerformingAlertType,
        worstPerformingAlertType,
        alertsByType,
        alertsBySeverity,
        churnsPrevented,
        falsePositiveRate: falsePositiveRate ? Math.round(falsePositiveRate * 100) / 100 : null
    };
}

/**
 * Record alert escalation
 */
export async function recordAlertEscalation(
    alertId: string,
    fromSeverity: 'low' | 'medium' | 'high' | 'critical',
    toSeverity: 'low' | 'medium' | 'high' | 'critical',
    reason: string,
    autoEscalated: boolean = false
) {
    return db.insert(alertEscalations).values({
        alertId,
        fromSeverity,
        toSeverity,
        reason,
        autoEscalated,
        escalatedAt: new Date(),
        createdAt: new Date()
    });
}

/**
 * Get alert escalation patterns
 */
export async function getAlertEscalationPatterns(
    boxId: string,
    lookbackDays: number = 30
): Promise<{
    totalEscalations: number;
    autoEscalations: number;
    manualEscalations: number;
    escalationsByType: { [key: string]: number };
    commonEscalationPaths: Array<{ from: string; to: string; count: number; reason: string }>;
    avgTimeToEscalation: number | null;
}> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const escalations = await db
        .select({
            alertType: athleteAlerts.alertType,
            fromSeverity: alertEscalations.fromSeverity,
            toSeverity: alertEscalations.toSeverity,
            reason: alertEscalations.reason,
            autoEscalated: alertEscalations.autoEscalated,
            createdAt: athleteAlerts.createdAt,
            escalatedAt: alertEscalations.escalatedAt
        })
        .from(alertEscalations)
        .innerJoin(athleteAlerts, eq(alertEscalations.alertId, athleteAlerts.id))
        .where(and(
            eq(athleteAlerts.boxId, boxId),
            gte(alertEscalations.escalatedAt, cutoffDate)
        ));

    const totalEscalations = escalations.length;
    const autoEscalations = escalations.filter(e => e.autoEscalated).length;
    const manualEscalations = totalEscalations - autoEscalations;

    // Group by alert type
    const escalationsByType: { [key: string]: number } = {};
    escalations.forEach(escalation => {
        escalationsByType[escalation.alertType] = (escalationsByType[escalation.alertType] || 0) + 1;
    });

    // Find common escalation paths
    const pathCounts = new Map<string, { count: number; reasons: string[] }>();
    escalations.forEach(escalation => {
        const path = `${escalation.fromSeverity}->${escalation.toSeverity}`;
        if (!pathCounts.has(path)) {
            pathCounts.set(path, { count: 0, reasons: [] });
        }
        const pathData = pathCounts.get(path)!;
        pathData.count++;
        if (!pathData.reasons.includes(escalation.reason)) {
            pathData.reasons.push(escalation.reason);
        }
    });

    const commonEscalationPaths = Array.from(pathCounts.entries())
        .map(([path, data]) => {
            const [from, to] = path.split('->');
            return {
                from,
                to,
                count: data.count,
                reason: data.reasons.join(', ')
            };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    // Calculate average time to escalation
    const avgTimeToEscalation = escalations.length > 0
        ? escalations.reduce((sum, escalation) => {
        const hours = (escalation.escalatedAt.getTime() - escalation.createdAt.getTime()) / (1000 * 60 * 60);
        return sum + hours;
    }, 0) / escalations.length
        : null;

    return {
        totalEscalations,
        autoEscalations,
        manualEscalations,
        escalationsByType,
        commonEscalationPaths,
        avgTimeToEscalation: avgTimeToEscalation ? Math.round(avgTimeToEscalation * 100) / 100 : null
    };
}
