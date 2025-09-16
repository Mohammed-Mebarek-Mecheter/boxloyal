// src/lib/services/analytics/calculations/alert-escalations-calculations.ts
import { db } from "@/db";
import {
    alertEscalations,
    athleteAlerts,
    boxMemberships,
    athleteRiskScores,
    athleteInterventions, wodAttendance
} from "@/db/schema";
import { eq, and, gte, lte, count, sql, desc, asc } from "drizzle-orm";
import { riskLevelEnum } from "@/db/schema/enums";

type RiskLevelEnum = typeof riskLevelEnum.enumValues[number];
export interface EscalationAnalysis {
    boxId: string;
    periodStart: Date;
    periodEnd: Date;
    totalEscalations: number;
    autoEscalations: number;
    manualEscalations: number;
    escalationsByType: { [alertType: string]: number };
    escalationPaths: Array<{
        fromSeverity: RiskLevelEnum;
        toSeverity: RiskLevelEnum;
        count: number;
        avgTimeToEscalate: number;
        commonReasons: string[];
    }>;
    alertsRequiringEscalation: Array<{
        alertId: string;
        membershipId: string;
        displayName: string;
        currentSeverity: RiskLevelEnum;
        suggestedSeverity: RiskLevelEnum;
        reason: string;
        urgencyScore: number;
    }>;
    escalationEffectiveness: {
        successfulInterventions: number;
        failedEscalations: number;
        avgTimeToResolution: number | null;
    };
}

/**
 * Escalation rules configuration
 */
const ESCALATION_RULES = {
    timeThresholds: {
        low: { toCritical: 14, toHigh: 7, toMedium: 3 },
        medium: { toCritical: 7, toHigh: 3 },
        high: { toCritical: 3 }
    },
    riskScoreThresholds: {
        low: { threshold: 85, escalateTo: 'critical' as RiskLevelEnum },
        medium: { threshold: 75, escalateTo: 'high' as RiskLevelEnum },
        high: { threshold: 90, escalateTo: 'critical' as RiskLevelEnum }
    },
    attendanceThresholds: {
        daysAbsent: 14, // Escalate if absent for 14+ days
        escalateTo: 'critical' as RiskLevelEnum
    }
};

/**
 * Auto-escalate alerts based on predefined rules
 */
export async function processAutoEscalations(boxId: string): Promise<{
    escalationsCreated: number;
    alertsEvaluated: number;
}> {
    console.log(`[Escalations] Processing auto-escalations for box ${boxId}`);

    // Get all active alerts that haven't been escalated in the last 24 hours
    const activeAlerts = await db.select({
        id: athleteAlerts.id,
        membershipId: athleteAlerts.membershipId,
        alertType: athleteAlerts.alertType,
        severity: athleteAlerts.severity,
        createdAt: athleteAlerts.createdAt,
        triggerData: athleteAlerts.triggerData
    })
        .from(athleteAlerts)
        .where(and(
            eq(athleteAlerts.boxId, boxId),
            eq(athleteAlerts.status, 'active')
        ))
        .orderBy(desc(athleteAlerts.createdAt));

    let escalationsCreated = 0;
    const alertsEvaluated = activeAlerts.length;

    for (const alert of activeAlerts) {
        try {
            // Check if alert was recently escalated (within last 24 hours)
            const recentEscalation = await db.select({ id: alertEscalations.id })
                .from(alertEscalations)
                .where(and(
                    eq(alertEscalations.alertId, alert.id),
                    gte(alertEscalations.escalatedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
                ))
                .limit(1);

            if (recentEscalation.length > 0) {
                continue; // Skip recently escalated alerts
            }

            const escalationResult = await evaluateAlertForEscalation(alert);

            if (escalationResult.shouldEscalate) {
                await createEscalation({
                    alertId: alert.id,
                    fromSeverity: alert.severity,
                    toSeverity: escalationResult.targetSeverity,
                    reason: escalationResult.reason,
                    autoEscalated: true
                });

                // Update the alert severity
                await db.update(athleteAlerts)
                    .set({
                        severity: escalationResult.targetSeverity,
                        updatedAt: new Date()
                    })
                    .where(eq(athleteAlerts.id, alert.id));

                escalationsCreated++;
                console.log(`[Escalations] Auto-escalated alert ${alert.id} from ${alert.severity} to ${escalationResult.targetSeverity}`);
            }
        } catch (error) {
            console.error(`[Escalations] Error processing alert ${alert.id} for escalation:`, error);
        }
    }

    console.log(`[Escalations] Completed auto-escalation: ${escalationsCreated} escalations created from ${alertsEvaluated} alerts evaluated`);

    return {
        escalationsCreated,
        alertsEvaluated
    };
}

/**
 * Evaluate if an alert should be escalated
 */
async function evaluateAlertForEscalation(alert: any): Promise<{
    shouldEscalate: boolean;
    targetSeverity: RiskLevelEnum;
    reason: string;
}> {
    const daysSinceCreated = Math.floor(
        (Date.now() - alert.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Rule 1: Time-based escalation
    const timeBasedEscalation = evaluateTimeBasedEscalation(alert.severity, daysSinceCreated);
    if (timeBasedEscalation.shouldEscalate) {
        return timeBasedEscalation;
    }

    // Rule 2: Risk score escalation
    const riskScoreEscalation = await evaluateRiskScoreEscalation(alert.membershipId, alert.severity);
    if (riskScoreEscalation.shouldEscalate) {
        return riskScoreEscalation;
    }

    // Rule 3: Attendance-based escalation
    const attendanceEscalation = await evaluateAttendanceEscalation(alert.membershipId, alert.severity);
    if (attendanceEscalation.shouldEscalate) {
        return attendanceEscalation;
    }

    // Rule 4: Alert type-specific escalation
    const typeBasedEscalation = evaluateTypeBasedEscalation(alert.alertType, alert.severity, alert.triggerData);
    if (typeBasedEscalation.shouldEscalate) {
        return typeBasedEscalation;
    }

    return {
        shouldEscalate: false,
        targetSeverity: alert.severity,
        reason: ''
    };
}

/**
 * Evaluate time-based escalation rules
 */
function evaluateTimeBasedEscalation(currentSeverity: RiskLevelEnum, daysSinceCreated: number): {
    shouldEscalate: boolean;
    targetSeverity: RiskLevelEnum;
    reason: string;
} {
    const rules = ESCALATION_RULES.timeThresholds;

    switch (currentSeverity) {
        case 'low':
            if (daysSinceCreated >= rules.low.toCritical) {
                return {
                    shouldEscalate: true,
                    targetSeverity: 'critical',
                    reason: `Alert unaddressed for ${daysSinceCreated} days - escalating to critical`
                };
            } else if (daysSinceCreated >= rules.low.toHigh) {
                return {
                    shouldEscalate: true,
                    targetSeverity: 'high',
                    reason: `Alert unaddressed for ${daysSinceCreated} days - escalating to high`
                };
            } else if (daysSinceCreated >= rules.low.toMedium) {
                return {
                    shouldEscalate: true,
                    targetSeverity: 'medium',
                    reason: `Alert unaddressed for ${daysSinceCreated} days - escalating to medium`
                };
            }
            break;

        case 'medium':
            if (daysSinceCreated >= rules.medium.toCritical) {
                return {
                    shouldEscalate: true,
                    targetSeverity: 'critical',
                    reason: `Medium alert unaddressed for ${daysSinceCreated} days - escalating to critical`
                };
            } else if (daysSinceCreated >= rules.medium.toHigh) {
                return {
                    shouldEscalate: true,
                    targetSeverity: 'high',
                    reason: `Medium alert unaddressed for ${daysSinceCreated} days - escalating to high`
                };
            }
            break;

        case 'high':
            if (daysSinceCreated >= rules.high.toCritical) {
                return {
                    shouldEscalate: true,
                    targetSeverity: 'critical',
                    reason: `High alert unaddressed for ${daysSinceCreated} days - escalating to critical`
                };
            }
            break;

        case 'critical':
            // Critical alerts don't auto-escalate further
            break;
    }

    return {
        shouldEscalate: false,
        targetSeverity: currentSeverity,
        reason: ''
    };
}

/**
 * Evaluate risk score-based escalation
 */
async function evaluateRiskScoreEscalation(membershipId: string, currentSeverity: RiskLevelEnum): Promise<{
    shouldEscalate: boolean;
    targetSeverity: RiskLevelEnum;
    reason: string;
}> {
    // Get latest risk score
    const latestRiskScore = await db.select({
        overallRiskScore: athleteRiskScores.overallRiskScore,
        calculatedAt: athleteRiskScores.calculatedAt
    })
        .from(athleteRiskScores)
        .where(eq(athleteRiskScores.membershipId, membershipId))
        .orderBy(desc(athleteRiskScores.calculatedAt))
        .limit(1);

    if (!latestRiskScore[0]) {
        return {
            shouldEscalate: false,
            targetSeverity: currentSeverity,
            reason: ''
        };
    }

    const riskScore = Number(latestRiskScore[0].overallRiskScore);
    const rules = ESCALATION_RULES.riskScoreThresholds;

    // Check if risk score warrants escalation
    switch (currentSeverity) {
        case 'low':
            if (riskScore >= rules.low.threshold) {
                return {
                    shouldEscalate: true,
                    targetSeverity: rules.low.escalateTo,
                    reason: `Risk score increased to ${riskScore} - escalating from low to ${rules.low.escalateTo}`
                };
            }
            break;

        case 'medium':
            if (riskScore >= rules.medium.threshold) {
                return {
                    shouldEscalate: true,
                    targetSeverity: rules.medium.escalateTo,
                    reason: `Risk score increased to ${riskScore} - escalating from medium to ${rules.medium.escalateTo}`
                };
            }
            break;

        case 'high':
            if (riskScore >= rules.high.threshold) {
                return {
                    shouldEscalate: true,
                    targetSeverity: rules.high.escalateTo,
                    reason: `Risk score increased to ${riskScore} - escalating from high to ${rules.high.escalateTo}`
                };
            }
            break;
    }

    return {
        shouldEscalate: false,
        targetSeverity: currentSeverity,
        reason: ''
    };
}

/**
 * Evaluate attendance-based escalation
 */
async function evaluateAttendanceEscalation(membershipId: string, currentSeverity: RiskLevelEnum): Promise<{
    shouldEscalate: boolean;
    targetSeverity: RiskLevelEnum;
    reason: string;
}> {
    // Get days since last attendance
    const lastAttendance = await db.select({
        attendanceDate: sql<Date>`MAX(${sql`${wodAttendance.attendanceDate}::timestamp`})`
    })
        .from(wodAttendance)
        .where(and(
            eq(wodAttendance.membershipId, membershipId),
            eq(wodAttendance.status, 'attended')
        ));

    if (!lastAttendance[0]?.attendanceDate) {
        // No attendance recorded - escalate if not already critical
        if (currentSeverity !== 'critical') {
            return {
                shouldEscalate: true,
                targetSeverity: 'critical',
                reason: 'No attendance records found - escalating to critical'
            };
        }
    } else {
        const daysSinceLastAttendance = Math.floor(
            (Date.now() - lastAttendance[0].attendanceDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceLastAttendance >= ESCALATION_RULES.attendanceThresholds.daysAbsent) {
            if (currentSeverity !== 'critical') {
                return {
                    shouldEscalate: true,
                    targetSeverity: ESCALATION_RULES.attendanceThresholds.escalateTo,
                    reason: `${daysSinceLastAttendance} days since last attendance - escalating to critical`
                };
            }
        }
    }

    return {
        shouldEscalate: false,
        targetSeverity: currentSeverity,
        reason: ''
    };
}

/**
 * Evaluate alert type-specific escalation rules
 */
function evaluateTypeBasedEscalation(
    alertType: string,
    currentSeverity: RiskLevelEnum,
    triggerData: any
): {
    shouldEscalate: boolean;
    targetSeverity: RiskLevelEnum;
    reason: string;
} {
    // Parse trigger data if it's a string
    let parsedTriggerData = triggerData;
    if (typeof triggerData === 'string') {
        try {
            parsedTriggerData = JSON.parse(triggerData);
        } catch (e) {
            parsedTriggerData = {};
        }
    }

    switch (alertType) {
        case 'churn_risk':
            if (currentSeverity === 'high' && parsedTriggerData?.churnProbability > 0.8) {
                return {
                    shouldEscalate: true,
                    targetSeverity: 'critical',
                    reason: `Churn probability increased to ${(parsedTriggerData.churnProbability * 100).toFixed(1)}%`
                };
            }
            break;

        case 'wellness_concern':
            if (currentSeverity === 'medium' && parsedTriggerData?.wellnessTrend < -40) {
                return {
                    shouldEscalate: true,
                    targetSeverity: 'critical',
                    reason: `Wellness trend severely declined to ${parsedTriggerData.wellnessTrend}%`
                };
            }
            break;

        case 'declining_performance':
            if (currentSeverity === 'medium' && parsedTriggerData?.performanceTrend < -50) {
                return {
                    shouldEscalate: true,
                    targetSeverity: 'high',
                    reason: `Performance decline worsened to ${parsedTriggerData.performanceTrend}%`
                };
            }
            break;
    }

    return {
        shouldEscalate: false,
        targetSeverity: currentSeverity,
        reason: ''
    };
}

/**
 * Create an escalation record
 */
export async function createEscalation(escalationData: {
    alertId: string;
    fromSeverity: RiskLevelEnum;
    toSeverity: RiskLevelEnum;
    reason: string;
    autoEscalated: boolean;
}): Promise<string> {
    const escalation = await db.insert(alertEscalations).values({
        alertId: escalationData.alertId,
        fromSeverity: escalationData.fromSeverity,
        toSeverity: escalationData.toSeverity,
        escalatedAt: new Date(),
        reason: escalationData.reason,
        autoEscalated: escalationData.autoEscalated,
        createdAt: new Date()
    }).returning({ id: alertEscalations.id });

    return escalation[0].id;
}

/**
 * Analyze escalation patterns and effectiveness
 */
export async function analyzeEscalationPatterns(
    boxId: string,
    lookbackDays: number = 30
): Promise<EscalationAnalysis> {
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - lookbackDays);

    console.log(`[Escalations] Analyzing escalation patterns for box ${boxId}`);

    // Get all escalations in the period
    const escalations = await db.select({
        id: alertEscalations.id,
        alertId: alertEscalations.alertId,
        fromSeverity: alertEscalations.fromSeverity,
        toSeverity: alertEscalations.toSeverity,
        escalatedAt: alertEscalations.escalatedAt,
        reason: alertEscalations.reason,
        autoEscalated: alertEscalations.autoEscalated,
        alertType: athleteAlerts.alertType,
        alertCreatedAt: athleteAlerts.createdAt,
        membershipId: athleteAlerts.membershipId,
        displayName: boxMemberships.displayName
    })
        .from(alertEscalations)
        .innerJoin(athleteAlerts, eq(alertEscalations.alertId, athleteAlerts.id))
        .innerJoin(boxMemberships, eq(athleteAlerts.membershipId, boxMemberships.id))
        .where(and(
            eq(athleteAlerts.boxId, boxId),
            gte(alertEscalations.escalatedAt, periodStart),
            lte(alertEscalations.escalatedAt, periodEnd)
        ));

    const totalEscalations = escalations.length;
    const autoEscalations = escalations.filter(e => e.autoEscalated).length;
    const manualEscalations = totalEscalations - autoEscalations;

    // Analyze escalations by alert type
    const escalationsByType: { [alertType: string]: number } = {};
    escalations.forEach(escalation => {
        escalationsByType[escalation.alertType] = (escalationsByType[escalation.alertType] || 0) + 1;
    });

    // Analyze escalation paths
    const pathMap = new Map<string, {
        fromSeverity: RiskLevelEnum;
        toSeverity: RiskLevelEnum;
        escalations: Array<{ escalatedAt: Date; alertCreatedAt: Date; reason: string }>;
    }>();

    escalations.forEach(escalation => {
        const pathKey = `${escalation.fromSeverity}-${escalation.toSeverity}`;
        if (!pathMap.has(pathKey)) {
            pathMap.set(pathKey, {
                fromSeverity: escalation.fromSeverity,
                toSeverity: escalation.toSeverity,
                escalations: []
            });
        }

        pathMap.get(pathKey)!.escalations.push({
            escalatedAt: escalation.escalatedAt,
            alertCreatedAt: escalation.alertCreatedAt,
            reason: escalation.reason
        });
    });

    const escalationPaths = Array.from(pathMap.entries()).map(([pathKey, pathData]) => {
        const avgTimeToEscalate = pathData.escalations.reduce((sum, escalation) => {
            const hours = (escalation.escalatedAt.getTime() - escalation.alertCreatedAt.getTime()) / (1000 * 60 * 60);
            return sum + hours;
        }, 0) / pathData.escalations.length;

        // Get most common reasons
        const reasonCounts = new Map<string, number>();
        pathData.escalations.forEach(escalation => {
            const reason = escalation.reason.split(' - ')[0]; // Get main reason
            reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
        });

        const commonReasons = Array.from(reasonCounts.entries())
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)
            .map(([reason]) => reason);

        return {
            fromSeverity: pathData.fromSeverity,
            toSeverity: pathData.toSeverity,
            count: pathData.escalations.length,
            avgTimeToEscalate: Math.round(avgTimeToEscalate * 100) / 100,
            commonReasons
        };
    });

    // Identify alerts that might need escalation
    const alertsRequiringEscalation = await identifyAlertsNeedingEscalation(boxId);

    // Analyze escalation effectiveness
    const escalationEffectiveness = await analyzeEscalationEffectiveness(escalations);

    return {
        boxId,
        periodStart,
        periodEnd,
        totalEscalations,
        autoEscalations,
        manualEscalations,
        escalationsByType,
        escalationPaths,
        alertsRequiringEscalation,
        escalationEffectiveness
    };
}

/**
 * Identify alerts that might need escalation
 */
async function identifyAlertsNeedingEscalation(boxId: string): Promise<Array<{
    alertId: string;
    membershipId: string;
    displayName: string;
    currentSeverity: RiskLevelEnum;
    suggestedSeverity: RiskLevelEnum;
    reason: string;
    urgencyScore: number;
}>> {
    // Get active alerts
    const activeAlerts = await db.select({
        id: athleteAlerts.id,
        membershipId: athleteAlerts.membershipId,
        alertType: athleteAlerts.alertType,
        severity: athleteAlerts.severity,
        createdAt: athleteAlerts.createdAt,
        triggerData: athleteAlerts.triggerData,
        displayName: boxMemberships.displayName
    })
        .from(athleteAlerts)
        .innerJoin(boxMemberships, eq(athleteAlerts.membershipId, boxMemberships.id))
        .where(and(
            eq(athleteAlerts.boxId, boxId),
            eq(athleteAlerts.status, 'active')
        ));

    const alertsNeedingEscalation = [];

    for (const alert of activeAlerts) {
        const evaluation = await evaluateAlertForEscalation(alert);

        if (evaluation.shouldEscalate) {
            // Calculate urgency score based on various factors
            const daysSinceCreated = Math.floor(
                (Date.now() - alert.createdAt.getTime()) / (1000 * 60 * 60 * 24)
            );

            let urgencyScore = 0;
            urgencyScore += daysSinceCreated * 2; // Age factor
            urgencyScore += getSeverityWeight(alert.severity) * 10; // Current severity
            urgencyScore += getSeverityWeight(evaluation.targetSeverity) * 15; // Target severity

            alertsNeedingEscalation.push({
                alertId: alert.id,
                membershipId: alert.membershipId,
                displayName: alert.displayName,
                currentSeverity: alert.severity,
                suggestedSeverity: evaluation.targetSeverity,
                reason: evaluation.reason,
                urgencyScore
            });
        }
    }

    return alertsNeedingEscalation
        .sort((a, b) => b.urgencyScore - a.urgencyScore)
        .slice(0, 10); // Top 10 most urgent
}

/**
 * Analyze escalation effectiveness
 */
async function analyzeEscalationEffectiveness(escalations: any[]): Promise<{
    successfulInterventions: number;
    failedEscalations: number;
    avgTimeToResolution: number | null;
}> {
    let successfulInterventions = 0;
    let failedEscalations = 0;
    const resolutionTimes: number[] = [];

    for (const escalation of escalations) {
        // Check if there was an intervention after escalation
        const intervention = await db.select({
            interventionDate: athleteInterventions.interventionDate,
            outcome: athleteInterventions.outcome
        })
            .from(athleteInterventions)
            .where(and(
                eq(athleteInterventions.membershipId, escalation.membershipId),
                gte(athleteInterventions.interventionDate, escalation.escalatedAt)
            ))
            .orderBy(asc(athleteInterventions.interventionDate))
            .limit(1);

        if (intervention[0]) {
            const timeToResolution = (intervention[0].interventionDate.getTime() - escalation.escalatedAt.getTime()) / (1000 * 60 * 60);
            resolutionTimes.push(timeToResolution);

            if (intervention[0].outcome === 'positive') {
                successfulInterventions++;
            } else if (intervention[0].outcome === 'negative') {
                failedEscalations++;
            }
        } else {
            // No intervention found - consider as failed escalation if it's been more than 7 days
            const daysSinceEscalation = (Date.now() - escalation.escalatedAt.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceEscalation > 7) {
                failedEscalations++;
            }
        }
    }

    const avgTimeToResolution = resolutionTimes.length > 0
        ? resolutionTimes.reduce((sum, time) => sum + time, 0) / resolutionTimes.length
        : null;

    return {
        successfulInterventions,
        failedEscalations,
        avgTimeToResolution: avgTimeToResolution ? Math.round(avgTimeToResolution * 100) / 100 : null
    };
}

/**
 * Get severity weight for calculations
 */
function getSeverityWeight(severity: RiskLevelEnum): number {
    switch (severity) {
        case 'low': return 1;
        case 'medium': return 2;
        case 'high': return 3;
        case 'critical': return 4;
        default: return 1;
    }
}

/**
 * Get escalation metrics for a specific coach
 */
export async function getCoachEscalationMetrics(
    coachMembershipId: string,
    boxId: string,
    lookbackDays: number = 30
): Promise<{
    coachMembershipId: string;
    totalAlertsHandled: number;
    escalationsCreated: number;
    escalationsReceived: number;
    avgTimeToHandleEscalation: number | null;
    escalationSuccessRate: number | null;
    mostCommonEscalationReasons: string[];
}> {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - lookbackDays);

    // Get alerts assigned to this coach that were escalated
    const escalatedAlerts = await db.select({
        id: alertEscalations.id,
        alertId: alertEscalations.alertId,
        escalatedAt: alertEscalations.escalatedAt,
        reason: alertEscalations.reason,
        alertCreatedAt: athleteAlerts.createdAt
    })
        .from(alertEscalations)
        .innerJoin(athleteAlerts, eq(alertEscalations.alertId, athleteAlerts.id))
        .where(and(
            eq(athleteAlerts.boxId, boxId),
            eq(athleteAlerts.assignedCoachId, coachMembershipId),
            gte(alertEscalations.escalatedAt, periodStart)
        ));

    // Get total alerts handled by coach
    const totalAlertsHandled = await db.select({ count: count() })
        .from(athleteAlerts)
        .where(and(
            eq(athleteAlerts.boxId, boxId),
            eq(athleteAlerts.assignedCoachId, coachMembershipId),
            gte(athleteAlerts.createdAt, periodStart)
        ));

    // Calculate metrics
    const escalationsCreated = escalatedAlerts.length;
    const escalationsReceived = escalationsCreated; // Assuming coach handles their own escalated alerts

    // Calculate average time to handle escalation
    const handlingTimes = escalatedAlerts
        .map(escalation => {
            const timeToEscalation = escalation.escalatedAt.getTime() - escalation.alertCreatedAt.getTime();
            return timeToEscalation / (1000 * 60 * 60); // Convert to hours
        });

    const avgTimeToHandleEscalation = handlingTimes.length > 0
        ? handlingTimes.reduce((sum, time) => sum + time, 0) / handlingTimes.length
        : null;

    // Calculate success rate (based on interventions after escalation)
    let successfulEscalations = 0;
    for (const escalatedAlert of escalatedAlerts) {
        const intervention = await db.select({ outcome: athleteInterventions.outcome })
            .from(athleteInterventions)
            .where(and(
                eq(athleteInterventions.alertId, escalatedAlert.alertId),
                eq(athleteInterventions.coachId, coachMembershipId),
                gte(athleteInterventions.interventionDate, escalatedAlert.escalatedAt)
            ))
            .limit(1);

        if (intervention[0]?.outcome === 'positive') {
            successfulEscalations++;
        }
    }

    const escalationSuccessRate = escalationsCreated > 0
        ? (successfulEscalations / escalationsCreated) * 100
        : null;

    // Get most common escalation reasons
    const reasonCounts = new Map<string, number>();
    escalatedAlerts.forEach(escalation => {
        const reason = escalation.reason.split(' - ')[0]; // Get main reason
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    });

    const mostCommonEscalationReasons = Array.from(reasonCounts.entries())
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([reason]) => reason);

    return {
        coachMembershipId,
        totalAlertsHandled: totalAlertsHandled[0]?.count || 0,
        escalationsCreated,
        escalationsReceived,
        avgTimeToHandleEscalation: avgTimeToHandleEscalation ? Math.round(avgTimeToHandleEscalation * 100) / 100 : null,
        escalationSuccessRate: escalationSuccessRate ? Math.round(escalationSuccessRate * 100) / 100 : null,
        mostCommonEscalationReasons
    };
}

/**
 * Get box-wide escalation summary
 */
export async function getBoxEscalationSummary(
    boxId: string,
    lookbackDays: number = 30
): Promise<{
    boxId: string;
    totalEscalations: number;
    escalationRate: number; // Percentage of alerts that get escalated
    autoEscalationRate: number;
    avgEscalationTime: number | null;
    criticalEscalations: number;
    escalationTrends: { [day: string]: number };
    topEscalationReasons: Array<{ reason: string; count: number }>;
    coachEscalationPerformance: Array<{
        coachMembershipId: string;
        displayName: string;
        escalationsHandled: number;
        avgHandlingTime: number | null;
    }>;
}> {
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - lookbackDays);

    // Get all escalations and alerts for the period
    const [escalations, totalAlerts] = await Promise.all([
        db.select({
            id: alertEscalations.id,
            escalatedAt: alertEscalations.escalatedAt,
            reason: alertEscalations.reason,
            autoEscalated: alertEscalations.autoEscalated,
            toSeverity: alertEscalations.toSeverity,
            alertCreatedAt: athleteAlerts.createdAt,
            coachMembershipId: athleteAlerts.assignedCoachId,
            coachName: boxMemberships.displayName
        })
            .from(alertEscalations)
            .innerJoin(athleteAlerts, eq(alertEscalations.alertId, athleteAlerts.id))
            .leftJoin(boxMemberships, eq(athleteAlerts.assignedCoachId, boxMemberships.id))
            .where(and(
                eq(athleteAlerts.boxId, boxId),
                gte(alertEscalations.escalatedAt, periodStart),
                lte(alertEscalations.escalatedAt, periodEnd)
            )),

        db.select({ count: count() })
            .from(athleteAlerts)
            .where(and(
                eq(athleteAlerts.boxId, boxId),
                gte(athleteAlerts.createdAt, periodStart),
                lte(athleteAlerts.createdAt, periodEnd)
            ))
    ]);

    const totalEscalations = escalations.length;
    const escalationRate = totalAlerts[0]?.count > 0
        ? (totalEscalations / totalAlerts[0].count) * 100
        : 0;

    const autoEscalations = escalations.filter(e => e.autoEscalated).length;
    const autoEscalationRate = totalEscalations > 0
        ? (autoEscalations / totalEscalations) * 100
        : 0;

    const criticalEscalations = escalations.filter(e => e.toSeverity === 'critical').length;

    // Calculate average escalation time
    const escalationTimes = escalations.map(escalation => {
        return (escalation.escalatedAt.getTime() - escalation.alertCreatedAt.getTime()) / (1000 * 60 * 60);
    });
    const avgEscalationTime = escalationTimes.length > 0
        ? escalationTimes.reduce((sum, time) => sum + time, 0) / escalationTimes.length
        : null;

    // Generate daily escalation trends
    const escalationTrends: { [day: string]: number } = {};
    for (let i = 0; i < lookbackDays; i++) {
        const date = new Date(periodStart);
        date.setDate(date.getDate() + i);
        const dayKey = date.toISOString().split('T')[0];
        escalationTrends[dayKey] = 0;
    }

    escalations.forEach(escalation => {
        const dayKey = escalation.escalatedAt.toISOString().split('T')[0];
        if (escalationTrends.hasOwnProperty(dayKey)) {
            escalationTrends[dayKey]++;
        }
    });

    // Get top escalation reasons
    const reasonCounts = new Map<string, number>();
    escalations.forEach(escalation => {
        const reason = escalation.reason.split(' - ')[0];
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    });

    const topEscalationReasons = Array.from(reasonCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    // Analyze coach performance
    const coachPerformanceMap = new Map<string, {
        coachMembershipId: string;
        displayName: string;
        escalations: Array<{ escalatedAt: Date; alertCreatedAt: Date }>;
    }>();

    escalations.forEach(escalation => {
        if (escalation.coachMembershipId && escalation.coachName) {
            if (!coachPerformanceMap.has(escalation.coachMembershipId)) {
                coachPerformanceMap.set(escalation.coachMembershipId, {
                    coachMembershipId: escalation.coachMembershipId,
                    displayName: escalation.coachName,
                    escalations: []
                });
            }

            coachPerformanceMap.get(escalation.coachMembershipId)!.escalations.push({
                escalatedAt: escalation.escalatedAt,
                alertCreatedAt: escalation.alertCreatedAt
            });
        }
    });

    const coachEscalationPerformance = Array.from(coachPerformanceMap.values()).map(coach => {
        const handlingTimes = coach.escalations.map(escalation => {
            return (escalation.escalatedAt.getTime() - escalation.alertCreatedAt.getTime()) / (1000 * 60 * 60);
        });

        const avgHandlingTime = handlingTimes.length > 0
            ? handlingTimes.reduce((sum, time) => sum + time, 0) / handlingTimes.length
            : null;

        return {
            coachMembershipId: coach.coachMembershipId,
            displayName: coach.displayName,
            escalationsHandled: coach.escalations.length,
            avgHandlingTime: avgHandlingTime ? Math.round(avgHandlingTime * 100) / 100 : null
        };
    });

    return {
        boxId,
        totalEscalations,
        escalationRate: Math.round(escalationRate * 100) / 100,
        autoEscalationRate: Math.round(autoEscalationRate * 100) / 100,
        avgEscalationTime: avgEscalationTime ? Math.round(avgEscalationTime * 100) / 100 : null,
        criticalEscalations,
        escalationTrends,
        topEscalationReasons,
        coachEscalationPerformance
    };
}

/**
 * Generate escalation recommendations
 */
export async function generateEscalationRecommendations(
    boxId: string
): Promise<{
    recommendations: Array<{
        type: 'process' | 'training' | 'threshold' | 'assignment';
        priority: 'high' | 'medium' | 'low';
        title: string;
        description: string;
        actionItems: string[];
    }>;
    insights: {
        escalationEfficiency: number;
        commonBottlenecks: string[];
        improvementOpportunities: string[];
    };
}> {
    const escalationAnalysis = await analyzeEscalationPatterns(boxId, 60);
    const boxSummary = await getBoxEscalationSummary(boxId, 30);

    const recommendations: Array<{
        type: 'process' | 'training' | 'threshold' | 'assignment';
        priority: 'high' | 'medium' | 'low';
        title: string;
        description: string;
        actionItems: string[];
    }> = [];

    const insights = {
        escalationEfficiency: 0,
        commonBottlenecks: [] as string[],
        improvementOpportunities: [] as string[]
    };

    // Calculate escalation efficiency
    const totalEscalations = escalationAnalysis.totalEscalations;
    const successfulInterventions = escalationAnalysis.escalationEffectiveness.successfulInterventions;
    insights.escalationEfficiency = totalEscalations > 0
        ? (successfulInterventions / totalEscalations) * 100
        : 0;

    // Generate recommendations based on patterns
    if (boxSummary.autoEscalationRate > 70) {
        recommendations.push({
            type: 'process',
            priority: 'high',
            title: 'High Auto-Escalation Rate',
            description: `${boxSummary.autoEscalationRate.toFixed(1)}% of escalations are automatic, indicating coaches may not be responding to alerts promptly.`,
            actionItems: [
                'Review coach alert notification settings',
                'Implement alert acknowledgment requirements',
                'Provide training on timely alert response',
                'Consider adjusting auto-escalation thresholds'
            ]
        });

        insights.commonBottlenecks.push('Delayed coach response to alerts');
    }

    if (boxSummary.avgEscalationTime && boxSummary.avgEscalationTime > 48) {
        recommendations.push({
            type: 'threshold',
            priority: 'medium',
            title: 'Slow Escalation Times',
            description: `Average time to escalation is ${boxSummary.avgEscalationTime.toFixed(1)} hours, which may delay critical interventions.`,
            actionItems: [
                'Review and optimize escalation time thresholds',
                'Implement priority-based alert routing',
                'Set up automated reminders for pending alerts',
                'Create escalation urgency indicators'
            ]
        });

        insights.commonBottlenecks.push('Slow escalation processing');
    }

    if (insights.escalationEfficiency < 50) {
        recommendations.push({
            type: 'training',
            priority: 'high',
            title: 'Low Escalation Success Rate',
            description: `Only ${insights.escalationEfficiency.toFixed(1)}% of escalations result in successful interventions.`,
            actionItems: [
                'Provide intervention training for coaches',
                'Review escalation criteria accuracy',
                'Implement post-escalation follow-up protocols',
                'Analyze successful intervention patterns'
            ]
        });

        insights.improvementOpportunities.push('Improve intervention effectiveness training');
    }

    // Analyze coach workload distribution
    const coachWorkloads = boxSummary.coachEscalationPerformance;
    if (coachWorkloads && coachWorkloads.length > 1) {
        const workloadVariance = calculateVariance(coachWorkloads.map(c => c.escalationsHandled));
        if (workloadVariance > 10) {
            recommendations.push({
                type: 'assignment',
                priority: 'medium',
                title: 'Uneven Escalation Distribution',
                description: 'Escalation workload is unevenly distributed among coaches.',
                actionItems: [
                    'Review alert assignment algorithms',
                    'Implement workload balancing for escalations',
                    'Cross-train coaches for escalation handling',
                    'Monitor coach capacity and availability'
                ]
            });

            insights.commonBottlenecks.push('Uneven coach workload distribution');
        }
    }

    // Check for patterns in escalation reasons
    const topReasons = boxSummary.topEscalationReasons || [];
    if (topReasons.length > 0 && topReasons[0].count > totalEscalations * 0.4) {
        recommendations.push({
            type: 'process',
            priority: 'medium',
            title: `High Frequency of "${topReasons[0].reason}" Escalations`,
            description: `${topReasons[0].reason} accounts for ${((topReasons[0].count / totalEscalations) * 100).toFixed(1)}% of escalations.`,
            actionItems: [
                `Implement proactive monitoring for ${topReasons[0].reason.toLowerCase()}`,
                'Review early warning systems for this risk factor',
                'Create specific intervention protocols',
                'Train coaches on prevention strategies'
            ]
        });

        insights.improvementOpportunities.push(`Proactive ${topReasons[0].reason.toLowerCase()} prevention`);
    }

    // Define priority order for sorting
    const priorityOrder: Record<'high' | 'medium' | 'low', number> = {
        'high': 3,
        'medium': 2,
        'low': 1
    };

    return {
        recommendations: recommendations.sort((a, b) => {
            return priorityOrder[b.priority] - priorityOrder[a.priority];
        }),
        insights
    };
}

/**
 * Helper function to calculate variance
 */
function calculateVariance(numbers: number[]): number {
    if (numbers.length === 0) return 0;

    const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
    const squaredDifferences = numbers.map(num => Math.pow(num - mean, 2));
    const variance = squaredDifferences.reduce((sum, diff) => sum + diff, 0) / numbers.length;

    return Math.sqrt(variance);
}
