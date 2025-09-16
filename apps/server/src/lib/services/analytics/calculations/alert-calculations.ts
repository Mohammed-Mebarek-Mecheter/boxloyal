// src/lib/services/analytics/calculations/alert-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteRiskScores,
    athleteAlerts,
    boxes
} from "@/db/schema";
import { eq, and, sql, gte } from "drizzle-orm";

type AlertTypeEnum = 'risk_threshold' | 'performance_decline' | 'attendance_drop' | 'wellness_concern' | 'milestone_celebration' | 'checkin_reminder' | 'pr_celebration' | 'benchmark_improvement' | 'intervention_needed' | 'feedback_request';
type RiskLevelEnum = 'low' | 'medium' | 'high' | 'critical';
type AlertStatusEnum = 'active' | 'acknowledged' | 'resolved' | 'escalated' | 'snoozed';

export interface GeneratedAlertData {
    boxId: string;
    membershipId: string;
    alertType: AlertTypeEnum;
    severity: RiskLevelEnum;
    title: string;
    description: string;
    triggerData: any;
    suggestedActions: any;
    status: AlertStatusEnum;
    assignedCoachId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

interface AlertConfiguration {
    type: AlertTypeEnum;
    priority: number;
    title: string;
    description: string;
    actions: string[];
    escalationThreshold?: number; // Days before escalation
    followUpDays?: number;
}

/**
 * Enhanced alert configuration with proper prioritization and actions
 */
const ALERT_CONFIGURATIONS: Record<string, AlertConfiguration> = {
    // Critical alerts - immediate attention required
    'extended_absence': {
        type: 'risk_threshold',
        priority: 1,
        title: 'Extended Absence from Box',
        description: 'Athlete has not attended sessions for {days} days. Immediate outreach recommended to prevent churn.',
        actions: [
            'Call athlete within 24 hours',
            'Send personalized message asking about their absence',
            'Offer flexible scheduling or makeup sessions',
            'Check if there are any personal/health issues affecting attendance'
        ],
        escalationThreshold: 3,
        followUpDays: 7
    },
    'wellness_crisis': {
        type: 'wellness_concern',
        priority: 1,
        title: 'Significant Wellness Decline',
        description: 'Athlete\'s wellness metrics show concerning decline ({trend}% drop). May indicate burnout or personal issues.',
        actions: [
            'Schedule immediate one-on-one check-in',
            'Review recent training load and suggest modifications',
            'Discuss stress levels and potential external factors',
            'Consider recommending recovery-focused programming'
        ],
        escalationThreshold: 2,
        followUpDays: 3
    },
    'performance_crash': {
        type: 'performance_decline',
        priority: 1,
        title: 'Severe Performance Decline',
        description: 'Athlete\'s performance metrics dropped by {trend}%. This may indicate overtraining or underlying issues.',
        actions: [
            'Review recent training intensity and volume',
            'Schedule movement assessment or form check',
            'Discuss nutrition, sleep, and recovery habits',
            'Consider deload week or modified programming'
        ],
        escalationThreshold: 5,
        followUpDays: 5
    },

    // High priority alerts - action needed soon
    'attendance_decline': {
        type: 'attendance_drop',
        priority: 2,
        title: 'Attendance Pattern Change',
        description: 'Athlete\'s attendance dropped {trend}% from their typical pattern. Early intervention can prevent further decline.',
        actions: [
            'Send friendly check-in message',
            'Review their schedule preferences and barriers',
            'Offer alternative class times or formats',
            'Invite to upcoming social events or challenges'
        ],
        escalationThreshold: 7,
        followUpDays: 10
    },
    'engagement_drop': {
        type: 'checkin_reminder',
        priority: 2,
        title: 'Decreased Engagement',
        description: 'Athlete hasn\'t completed wellness check-ins for {days} days. Their engagement score declined {trend}%.',
        actions: [
            'Remind about wellness check-in importance',
            'Simplify check-in process or offer assistance',
            'Encourage participation in box community activities',
            'Check if they understand the value of tracking wellness'
        ],
        escalationThreshold: 10,
        followUpDays: 14
    },
    'moderate_wellness_concern': {
        type: 'wellness_concern',
        priority: 2,
        title: 'Wellness Metrics Declining',
        description: 'Athlete\'s wellness scores show concerning trends. Stress levels increased while energy decreased.',
        actions: [
            'Check in about work/life balance',
            'Suggest stress management techniques',
            'Review sleep hygiene and recovery practices',
            'Offer modified workout intensity options'
        ],
        escalationThreshold: 14,
        followUpDays: 7
    },

    // Medium priority - monitoring required
    'performance_stagnation': {
        type: 'performance_decline',
        priority: 3,
        title: 'Performance Plateau',
        description: 'Athlete hasn\'t achieved PRs in {days} days. May benefit from program adjustments.',
        actions: [
            'Review current programming effectiveness',
            'Set new movement-specific goals',
            'Introduce skill work or accessory movements',
            'Plan benchmark retest to track progress'
        ],
        followUpDays: 21
    },
    'checkin_lapse': {
        type: 'checkin_reminder',
        priority: 3,
        title: 'Missed Recent Check-ins',
        description: 'Athlete hasn\'t submitted wellness data in {days} days. Gentle reminder may help re-establish routine.',
        actions: [
            'Send gentle reminder about wellness tracking',
            'Share benefits of consistent check-ins',
            'Offer to help troubleshoot any app issues',
            'Recognize their previous consistency'
        ],
        followUpDays: 7
    }
};

/**
 * Determines alert priority based on risk factors and trends
 */
function determineAlertCategory(riskScore: any): string | null {
    const {
        daysSinceLastVisit,
        daysSinceLastCheckin,
        daysSinceLastPr,
        attendanceTrend,
        performanceTrend,
        wellnessTrend,
        engagementTrend,
        riskLevel
    } = riskScore;

    // Critical situations - immediate attention
    if (daysSinceLastVisit && daysSinceLastVisit > 14) {
        return 'extended_absence';
    }

    if (wellnessTrend !== null && wellnessTrend < -25) {
        return 'wellness_crisis';
    }

    if (performanceTrend !== null && performanceTrend < -30) {
        return 'performance_crash';
    }

    // High priority situations
    if (attendanceTrend !== null && attendanceTrend < -20) {
        return 'attendance_decline';
    }

    if (engagementTrend !== null && engagementTrend < -30 && daysSinceLastCheckin && daysSinceLastCheckin > 7) {
        return 'engagement_drop';
    }

    if (wellnessTrend !== null && wellnessTrend < -15) {
        return 'moderate_wellness_concern';
    }

    // Medium priority situations
    if (daysSinceLastPr && daysSinceLastPr > 60) {
        return 'performance_stagnation';
    }

    if (daysSinceLastCheckin && daysSinceLastCheckin > 10 && riskLevel !== 'low') {
        return 'checkin_lapse';
    }

    return null;
}

/**
 * Enhanced alert generation with proper prioritization and actionable insights
 */
export function generateAlertFromRiskScore(riskScore: any): GeneratedAlertData | null {
    // Only generate alerts for medium, high, or critical risk levels
    if (riskScore.riskLevel === 'low') {
        return null;
    }

    const alertCategory = determineAlertCategory(riskScore);
    if (!alertCategory) {
        return null;
    }

    const config = ALERT_CONFIGURATIONS[alertCategory];
    if (!config) {
        return null;
    }

    // Generate dynamic content based on risk score data
    let title = config.title;
    let description = config.description;

    // Replace placeholders with actual values
    if (riskScore.daysSinceLastVisit) {
        description = description.replace('{days}', riskScore.daysSinceLastVisit.toString());
    }
    if (riskScore.daysSinceLastCheckin) {
        description = description.replace('{days}', riskScore.daysSinceLastCheckin.toString());
    }
    if (riskScore.daysSinceLastPr) {
        description = description.replace('{days}', riskScore.daysSinceLastPr.toString());
    }
    if (riskScore.attendanceTrend !== null) {
        description = description.replace('{trend}', Math.abs(riskScore.attendanceTrend).toFixed(1));
    }
    if (riskScore.performanceTrend !== null) {
        description = description.replace('{trend}', Math.abs(riskScore.performanceTrend).toFixed(1));
    }
    if (riskScore.wellnessTrend !== null) {
        description = description.replace('{trend}', Math.abs(riskScore.wellnessTrend).toFixed(1));
    }

    // Create comprehensive trigger data for coach context
    const triggerData = {
        riskScore: riskScore.overallRiskScore,
        riskLevel: riskScore.riskLevel,
        churnProbability: riskScore.churnProbability,
        alertCategory,
        priority: config.priority,
        keyMetrics: {
            attendance: {
                score: riskScore.attendanceScore,
                trend: riskScore.attendanceTrend,
                daysSinceLastVisit: riskScore.daysSinceLastVisit
            },
            wellness: {
                score: riskScore.wellnessScore,
                trend: riskScore.wellnessTrend,
                daysSinceLastCheckin: riskScore.daysSinceLastCheckin
            },
            performance: {
                score: riskScore.performanceScore,
                trend: riskScore.performanceTrend,
                daysSinceLastPr: riskScore.daysSinceLastPr
            },
            engagement: {
                score: riskScore.engagementScore,
                trend: riskScore.engagementTrend
            }
        },
        factors: riskScore.factors,
        calculatedAt: new Date()
    };

    // Create actionable suggestions based on the specific situation
    const suggestedActions = {
        immediate: config.actions,
        followUp: {
            scheduledDays: config.followUpDays || 7,
            escalationThreshold: config.escalationThreshold || 7,
            suggestedFollowUpActions: [
                'Check if initial outreach was successful',
                'Assess if athlete situation has improved',
                'Consider escalating to head coach if no improvement'
            ]
        },
        metrics_to_monitor: [
            'Attendance rate changes',
            'Wellness check-in frequency',
            'Response to coach communication',
            'Performance metrics improvements'
        ]
    };

    const now = new Date();
    const followUpDate = new Date(now);
    followUpDate.setDate(followUpDate.getDate() + (config.followUpDays || 7));

    return {
        boxId: riskScore.boxId,
        membershipId: riskScore.membershipId,
        alertType: config.type,
        severity: riskScore.riskLevel,
        title,
        description,
        triggerData,
        suggestedActions,
        status: 'active',
        assignedCoachId: null, // Will be assigned based on box's coach assignment strategy
        createdAt: now,
        updatedAt: now
    };
}

/**
 * Enhanced alert processing with proper conflict resolution and coach assignment
 */
export async function processAthleteAlertsForBox(boxId: string) {
    try {
        console.log(`[Alerts] Starting alert processing for box ${boxId}`);

        // Get latest valid risk scores for all active athletes
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
            console.log(`[Alerts] No valid risk scores found for box ${boxId}`);
            return { boxId, alertsGenerated: 0, alertsUpdated: 0, alertsDismissed: 0 };
        }

        console.log(`[Alerts] Found ${latestRiskScores.rows.length} risk scores for box ${boxId}`);

        // Get available coaches for alert assignment
        const availableCoaches = await db.select({
            id: boxMemberships.id,
            displayName: boxMemberships.displayName,
            role: boxMemberships.role
        })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                sql`${boxMemberships.role} IN ('coach', 'head_coach', 'owner')`
            ));

        // Get existing active alerts to avoid duplicates
        const existingAlerts = await db.select({
            membershipId: athleteAlerts.membershipId,
            alertType: athleteAlerts.alertType,
            severity: athleteAlerts.severity,
            status: athleteAlerts.status
        })
            .from(athleteAlerts)
            .where(and(
                eq(athleteAlerts.boxId, boxId),
                eq(athleteAlerts.status, 'active')
            ));

        const existingAlertMap = new Map(
            existingAlerts.map(alert =>
                [`${alert.membershipId}-${alert.alertType}`, alert]
            )
        );

        // Process risk scores and generate alerts
        const generatedAlerts: GeneratedAlertData[] = [];
        const alertsToUpdate: Array<{alert: GeneratedAlertData, existingAlert: any}> = [];
        const alertsToDismiss: string[] = [];

        for (const riskScoreRow of latestRiskScores.rows) {
            const mappedRiskScore = {
                ...riskScoreRow,
                riskLevel: riskScoreRow.risk_level,
                factors: typeof riskScoreRow.factors === 'string'
                    ? JSON.parse(riskScoreRow.factors)
                    : riskScoreRow.factors
            };

            const alertData = generateAlertFromRiskScore(mappedRiskScore);

            if (alertData) {
                const alertKey = `${alertData.membershipId}-${alertData.alertType}`;
                const existingAlert = existingAlertMap.get(alertKey);

                if (existingAlert) {
                    // Check if alert needs updating (severity change or new trigger data)
                    if (existingAlert.severity !== alertData.severity) {
                        alertsToUpdate.push({ alert: alertData, existingAlert });
                    }
                } else {
                    // Assign coach using round-robin or workload-based assignment
                    alertData.assignedCoachId = assignCoachToAlert(availableCoaches, alertData);
                    generatedAlerts.push(alertData);
                }
            }
        }

        // Process alerts in batches
        let alertsGenerated = 0;
        let alertsUpdated = 0;
        let alertsDismissed = 0;

        // Insert new alerts
        if (generatedAlerts.length > 0) {
            const batchSize = 20;
            for (let i = 0; i < generatedAlerts.length; i += batchSize) {
                const batch = generatedAlerts.slice(i, i + batchSize);

                const insertPromises = batch.map(alert =>
                    db.insert(athleteAlerts).values({
                        boxId: alert.boxId,
                        membershipId: alert.membershipId,
                        alertType: alert.alertType,
                        severity: alert.severity,
                        title: alert.title,
                        description: alert.description,
                        triggerData: alert.triggerData,
                        suggestedActions: alert.suggestedActions,
                        status: alert.status,
                        assignedCoachId: alert.assignedCoachId,
                        createdAt: alert.createdAt,
                        updatedAt: alert.updatedAt,
                    })
                );

                const results = await Promise.allSettled(insertPromises);
                alertsGenerated += results.filter(r => r.status === 'fulfilled').length;

                // Log any failures
                results.forEach((result, index) => {
                    if (result.status === 'rejected') {
                        console.error(`[Alerts] Failed to insert alert for ${batch[index].membershipId}:`, result.reason);
                    }
                });

                if (i + batchSize < generatedAlerts.length) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        }

        // Update existing alerts if needed
        for (const { alert, existingAlert } of alertsToUpdate) {
            try {
                await db.update(athleteAlerts)
                    .set({
                        severity: alert.severity,
                        description: alert.description,
                        triggerData: alert.triggerData,
                        suggestedActions: alert.suggestedActions,
                        updatedAt: new Date()
                    })
                    .where(and(
                        eq(athleteAlerts.membershipId, alert.membershipId),
                        eq(athleteAlerts.alertType, alert.alertType),
                        eq(athleteAlerts.status, 'active')
                    ));
                alertsUpdated++;
            } catch (error) {
                console.error(`[Alerts] Failed to update alert for ${alert.membershipId}:`, error);
            }
        }

        console.log(`[Alerts] Completed alert processing for box ${boxId}. Generated: ${alertsGenerated}, Updated: ${alertsUpdated}, Dismissed: ${alertsDismissed}`);

        return {
            boxId,
            alertsGenerated,
            alertsUpdated,
            alertsDismissed,
            totalActiveAlerts: alertsGenerated + alertsUpdated
        };

    } catch (error) {
        console.error(`[Alerts] Error processing alerts for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Simple round-robin coach assignment strategy
 * TODO: Enhance with workload balancing and coach specializations
 */
function assignCoachToAlert(coaches: any[], alert: GeneratedAlertData): string | null {
    if (coaches.length === 0) return null;

    // Prefer head coaches for high-priority alerts
    const headCoaches = coaches.filter(c => c.role === 'head_coach' || c.role === 'owner');
    const regularCoaches = coaches.filter(c => c.role === 'coach');

    if (alert.severity === 'critical' && headCoaches.length > 0) {
        return headCoaches[Math.floor(Math.random() * headCoaches.length)].id;
    }

    // Round-robin assignment for now
    const allCoaches = [...headCoaches, ...regularCoaches];
    return allCoaches[Math.floor(Math.random() * allCoaches.length)].id;
}
