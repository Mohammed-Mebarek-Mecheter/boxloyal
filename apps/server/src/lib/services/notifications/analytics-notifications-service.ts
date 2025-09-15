// lib/services/notifications/analytics-notifications-service.ts
import { NotificationService } from "./notification-service";
import { db } from "@/db";
import {
    boxMemberships,
    boxes,
    user,
    userProfiles,
    athleteRiskScores,
    athleteAlerts,
    athleteInterventions
} from "@/db/schema";
import {
    vwAthleteRiskOverview,
    mvMonthlyRetention,
    vwBoxSubscriptionHealth,
    mvBoxHealthDashboard,
    mvCoachPerformance,
    mvInterventionEffectiveness
} from "@/db/schema/views";
import { eq, and, desc, gte, count, sql, inArray } from "drizzle-orm";

export interface AnalyticsNotificationContext {
    coach: {
        id: string;
        userId: string;
        displayName: string;
        role: string;
    };
    box: {
        id: string;
        name: string;
        publicId: string;
    };
}

export interface AtRiskAthleteGroup {
    riskLevel: 'high' | 'critical';
    athletes: Array<{
        membershipId: string;
        displayName: string;
        riskScore: number;
        primaryRiskFactors: string[];
        daysSinceLastCheckin: number;
        interventionRecommended: boolean;
    }>;
}

export interface RetentionAlert {
    severity: 'warning' | 'critical';
    metric: string;
    currentValue: number;
    targetValue: number;
    trend: 'declining' | 'stable' | 'improving';
    period: string;
}

export interface BusinessMetricAlert {
    type: 'subscription' | 'billing' | 'capacity' | 'performance';
    title: string;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    actionRequired: boolean;
    dueDate?: Date;
}

export interface WellnessCrisisAlert {
    membershipId: string;
    athleteName: string;
    alertType: 'critical_low_energy' | 'high_stress' | 'low_readiness' | 'inconsistent_checkins';
    severity: 'low' | 'medium' | 'high';
    currentValue: number;
    averageDays: number;
    lastCheckinDate?: Date;
    recommendation: string;
}

export interface WellnessInsightData {
    period: { days: number; start: Date; end: Date };
    summary: {
        totalCheckins: number;
        uniqueAthletes: number;
        avgEnergyLevel: number;
        avgStressLevel: number;
        avgWorkoutReadiness: number;
        checkinRate: number;
    };
    trends: {
        energyTrend: 'improving' | 'stable' | 'declining';
        stressTrend: 'improving' | 'stable' | 'declining';
        readinessTrend: 'improving' | 'stable' | 'declining';
    };
    alerts: Array<{
        type: string;
        severity: 'low' | 'medium' | 'high';
        message: string;
        affectedAthletes: number;
    }>;
}

export class AnalyticsNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Send wellness crisis alerts to coaches for athletes in distress
     */
    async sendWellnessCrisisAlert(
        boxId: string,
        coachId: string,
        wellnessAlerts: WellnessCrisisAlert[]
    ) {
        const context = await this.getCoachContext(boxId, coachId);
        if (!context) return null;

        const criticalAlerts = wellnessAlerts.filter(a => a.severity === 'high');
        const mediumAlerts = wellnessAlerts.filter(a => a.severity === 'medium');
        const totalAlerts = wellnessAlerts.length;

        let title = "";
        let priority: "normal" | "high" | "urgent" = "normal";

        if (criticalAlerts.length > 0) {
            title = `🚨 URGENT: ${criticalAlerts.length} Wellness Crisis Alert${criticalAlerts.length > 1 ? 's' : ''}`;
            priority = "urgent";
        } else if (mediumAlerts.length > 0) {
            title = `⚠️ ${totalAlerts} Wellness Alert${totalAlerts > 1 ? 's' : ''} Need Attention`;
            priority = "high";
        } else {
            title = `📊 ${totalAlerts} Wellness Check${totalAlerts > 1 ? 's' : ''} Recommended`;
            priority = "normal";
        }

        let message = `Wellness alerts for athletes under your guidance:\n\n`;

        if (criticalAlerts.length > 0) {
            message += `🚨 CRITICAL WELLNESS CONCERNS:\n`;
            criticalAlerts.forEach(alert => {
                message += `• ${alert.athleteName}: ${this.getWellnessAlertDescription(alert)}\n`;
            });
            message += `\n`;
        }

        if (mediumAlerts.length > 0) {
            const highAlerts = wellnessAlerts.filter(a => a.severity === 'medium');
            message += `⚠️ WELLNESS CONCERNS:\n`;
            highAlerts.forEach(alert => {
                message += `• ${alert.athleteName}: ${this.getWellnessAlertDescription(alert)}\n`;
            });
            message += `\n`;
        }

        const lowAlerts = wellnessAlerts.filter(a => a.severity === 'low');
        if (lowAlerts.length > 0) {
            message += `📢 WELLNESS REMINDERS:\n`;
            lowAlerts.slice(0, 3).forEach(alert => {
                message += `• ${alert.athleteName}: ${this.getWellnessAlertDescription(alert)}\n`;
            });
            if (lowAlerts.length > 3) {
                message += `• ... and ${lowAlerts.length - 3} more athletes need wellness check-ins\n`;
            }
            message += `\n`;
        }

        message += `RECOMMENDED ACTIONS:\n`;
        if (criticalAlerts.length > 0) {
            message += `• Schedule immediate 1-on-1 conversations with critical alerts\n`;
            message += `• Review their recent wellness patterns and training load\n`;
        }
        if (mediumAlerts.length > 0) {
            message += `• Check in with medium-priority athletes within 24-48 hours\n`;
        }
        message += `• Encourage consistent wellness tracking for all athletes\n`;
        message += `• Consider modifications to training intensity if needed\n\n`;

        message += `Remember: Early wellness intervention prevents bigger problems later. These athletes trust you with their health and fitness journey.`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: coachId,
            type: "wellness_crisis",
            category: "retention",
            priority,
            title,
            message,
            actionUrl: `/coach/analytics/wellness`,
            actionLabel: "Review Wellness Data",
            channels: ["in_app", "email"],
            data: {
                totalAlerts,
                criticalCount: criticalAlerts.length,
                mediumCount: mediumAlerts.length,
                lowCount: lowAlerts.length,
                wellnessAlerts,
                alertTypes: wellnessAlerts.map(a => a.alertType),
            },
            deduplicationKey: `wellness_crisis_${coachId}_${new Date().toDateString()}`,
        });
    }

    /**
     * Send weekly wellness insights to coaches
     */
    async sendWeeklyWellnessInsights(
        boxId: string,
        coachId: string,
        wellnessData: WellnessInsightData
    ) {
        const context = await this.getCoachContext(boxId, coachId);
        if (!context) return null;

        const hasHighSeverityAlerts = wellnessData.alerts.some(a => a.severity === 'high');
        const trendDirection = this.getOverallWellnessTrend(wellnessData.trends);

        const title = hasHighSeverityAlerts
            ? `⚠️ Weekly Wellness Report - Action Needed`
            : trendDirection === 'positive'
                ? `📈 Weekly Wellness Report - Positive Trends`
                : `📊 Weekly Wellness Report`;

        let message = `Your weekly wellness summary for ${context.box.name}:\n\n`;

        message += `📊 WELLNESS OVERVIEW (${wellnessData.period.days} days):\n`;
        message += `• ${wellnessData.summary.totalCheckins} total wellness check-ins\n`;
        message += `• ${wellnessData.summary.uniqueAthletes} athletes tracked wellness\n`;
        message += `• ${wellnessData.summary.checkinRate}% check-in participation rate\n`;
        message += `• ${wellnessData.summary.avgEnergyLevel}/10 average energy level\n`;
        message += `• ${wellnessData.summary.avgStressLevel}/10 average stress level\n`;
        message += `• ${wellnessData.summary.avgWorkoutReadiness}/10 average workout readiness\n\n`;

        message += `📈 WELLNESS TRENDS:\n`;
        message += `• Energy: ${this.getTrendEmoji(wellnessData.trends.energyTrend)} ${wellnessData.trends.energyTrend}\n`;
        message += `• Stress: ${this.getTrendEmoji(wellnessData.trends.stressTrend)} ${wellnessData.trends.stressTrend}\n`;
        message += `• Readiness: ${this.getTrendEmoji(wellnessData.trends.readinessTrend)} ${wellnessData.trends.readinessTrend}\n\n`;

        if (wellnessData.alerts.length > 0) {
            message += `🚨 WELLNESS ALERTS:\n`;
            wellnessData.alerts.forEach(alert => {
                const alertEmoji = alert.severity === 'high' ? '🔥' : alert.severity === 'medium' ? '⚡' : '📢';
                message += `${alertEmoji} ${alert.message}\n`;
            });
            message += `\n`;
        }

        message += `💡 WELLNESS INSIGHTS:\n`;
        if (wellnessData.summary.checkinRate < 40) {
            message += `• Consider encouraging more athletes to track daily wellness\n`;
        }
        if (wellnessData.summary.avgEnergyLevel < 6) {
            message += `• Athletes showing lower energy - review training intensity and recovery\n`;
        }
        if (wellnessData.summary.avgStressLevel > 6) {
            message += `• Higher stress levels observed - check in on life balance and recovery\n`;
        }
        if (wellnessData.trends.energyTrend === 'declining') {
            message += `• Declining energy trend may indicate overtraining or life stress\n`;
        }

        const encouragement = hasHighSeverityAlerts
            ? "Address the wellness alerts above to help your athletes perform at their best."
            : trendDirection === 'positive'
                ? "Great work supporting your athletes' wellness! These positive trends show your coaching impact."
                : "Consistent wellness tracking helps you catch issues early and optimize training for each athlete.";

        message += `\n${encouragement}`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: coachId,
            type: "weekly_wellness_insights",
            category: "retention",
            priority: hasHighSeverityAlerts ? "high" : "normal",
            title,
            message,
            actionUrl: `/coach/analytics/wellness`,
            actionLabel: "View Detailed Wellness Analytics",
            channels: ["in_app", "email"],
            data: {
                period: wellnessData.period,
                summary: wellnessData.summary,
                trends: wellnessData.trends,
                alerts: wellnessData.alerts,
                overallTrend: trendDirection,
            },
            deduplicationKey: `wellness_insights_${coachId}_${this.getWeekIdentifier()}`,
        });
    }

    /**
     * Send athlete wellness concern follow-up reminders
     */
    async sendWellnessFollowUpReminder(
        boxId: string,
        coachId: string,
        pendingFollowUps: Array<{
            membershipId: string;
            athleteName: string;
            lastWellnessAlert: Date;
            alertType: string;
            daysSinceAlert: number;
            lastCheckinDate?: Date;
            recommendation: string;
        }>
    ) {
        const context = await this.getCoachContext(boxId, coachId);
        if (!context) return null;

        const urgentFollowUps = pendingFollowUps.filter(f => f.daysSinceAlert > 3);
        const totalCount = pendingFollowUps.length;

        const title = urgentFollowUps.length > 0
            ? `🚨 ${urgentFollowUps.length} Urgent Wellness Follow-ups`
            : `📋 ${totalCount} Wellness Follow-up${totalCount > 1 ? 's' : ''} Due`;

        let message = `Wellness follow-ups needed for your athletes:\n\n`;

        if (urgentFollowUps.length > 0) {
            message += `🚨 URGENT (${urgentFollowUps.length} athletes - 3+ days overdue):\n`;
            urgentFollowUps.slice(0, 4).forEach(followUp => {
                message += `• ${followUp.athleteName} - ${followUp.alertType} (${followUp.daysSinceAlert} days ago)\n`;
            });
            if (urgentFollowUps.length > 4) {
                message += `• ... and ${urgentFollowUps.length - 4} more\n`;
            }
            message += `\n`;
        }

        const recentFollowUps = pendingFollowUps.filter(f => f.daysSinceAlert <= 3);
        if (recentFollowUps.length > 0) {
            message += `📋 RECENT WELLNESS ALERTS:\n`;
            recentFollowUps.slice(0, 3).forEach(followUp => {
                message += `• ${followUp.athleteName} - ${followUp.alertType} (${followUp.daysSinceAlert} day${followUp.daysSinceAlert > 1 ? 's' : ''} ago)\n`;
            });
            if (recentFollowUps.length > 3) {
                message += `• ... and ${recentFollowUps.length - 3} more\n`;
            }
            message += `\n`;
        }

        message += `FOLLOW-UP ACTIONS:\n`;
        message += `• Check in personally with urgent cases immediately\n`;
        message += `• Review their recent wellness check-in patterns\n`;
        message += `• Ask about training load, sleep, and life stressors\n`;
        message += `• Adjust programming if needed based on their responses\n`;
        message += `• Document outcomes in the intervention system\n\n`;

        message += `💪 Remember: These wellness check-ins strengthen your coach-athlete relationship and prevent bigger issues down the road.`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: coachId,
            type: "wellness_followup",
            category: "workflow",
            priority: urgentFollowUps.length > 0 ? "high" : "normal",
            title,
            message,
            actionUrl: `/coach/wellness/follow-ups`,
            actionLabel: "Review Follow-ups",
            channels: ["in_app", "email"],
            data: {
                totalFollowUps: totalCount,
                urgentCount: urgentFollowUps.length,
                followUps: pendingFollowUps,
                alertTypes: [...new Set(pendingFollowUps.map(f => f.alertType))],
            },
            deduplicationKey: `wellness_followup_${coachId}_${new Date().toDateString()}`,
        });
    }

    /**
     * Send box-wide wellness trends to owners
     */
    async sendBoxWellnessTrends(
        boxId: string,
        ownerId: string,
        trendData: {
            period: { days: number; start: Date; end: Date };
            currentMetrics: {
                totalCheckins: number;
                participationRate: number;
                avgEnergyLevel: number;
                avgStressLevel: number;
                avgReadiness: number;
            };
            trends: {
                checkinTrend: 'improving' | 'stable' | 'declining';
                energyTrend: 'improving' | 'stable' | 'declining';
                stressTrend: 'improving' | 'stable' | 'declining';
                readinessTrend: 'improving' | 'stable' | 'declining';
            };
            coachInsights: Array<{
                coachName: string;
                athletesManaged: number;
                avgWellnessScore: number;
                alertsResolved: number;
            }>;
            recommendations: string[];
        }
    ) {
        const context = await this.getCoachContext(boxId, ownerId);
        if (!context) return null;

        const overallTrend = this.calculateOverallWellnessTrend(trendData.trends);

        const title = overallTrend === 'concerning'
            ? `📉 Box Wellness Trends - Action Needed`
            : overallTrend === 'positive'
                ? `📈 Box Wellness Trends - Looking Good!`
                : `📊 Monthly Box Wellness Report`;

        let message = `Wellness trends overview for ${context.box.name}:\n\n`;

        message += `📊 WELLNESS METRICS (${trendData.period.days} days):\n`;
        message += `• ${trendData.currentMetrics.totalCheckins} total wellness check-ins\n`;
        message += `• ${trendData.currentMetrics.participationRate}% member participation rate\n`;
        message += `• ${trendData.currentMetrics.avgEnergyLevel}/10 average energy\n`;
        message += `• ${trendData.currentMetrics.avgStressLevel}/10 average stress\n`;
        message += `• ${trendData.currentMetrics.avgReadiness}/10 average workout readiness\n\n`;

        message += `📈 WELLNESS TRENDS:\n`;
        message += `• Check-in Rate: ${this.getTrendEmoji(trendData.trends.checkinTrend)} ${trendData.trends.checkinTrend}\n`;
        message += `• Energy Levels: ${this.getTrendEmoji(trendData.trends.energyTrend)} ${trendData.trends.energyTrend}\n`;
        message += `• Stress Levels: ${this.getTrendEmoji(trendData.trends.stressTrend)} ${trendData.trends.stressTrend}\n`;
        message += `• Workout Readiness: ${this.getTrendEmoji(trendData.trends.readinessTrend)} ${trendData.trends.readinessTrend}\n\n`;

        if (trendData.coachInsights.length > 0) {
            message += `👥 COACH PERFORMANCE:\n`;
            trendData.coachInsights
                .sort((a, b) => b.avgWellnessScore - a.avgWellnessScore)
                .slice(0, 3)
                .forEach(coach => {
                    message += `• ${coach.coachName}: ${coach.athletesManaged} athletes, ${coach.avgWellnessScore.toFixed(1)} avg wellness\n`;
                });
            message += `\n`;
        }

        if (trendData.recommendations.length > 0) {
            message += `💡 RECOMMENDATIONS:\n`;
            trendData.recommendations.slice(0, 4).forEach(rec => {
                message += `• ${rec}\n`;
            });
            message += `\n`;
        }

        const businessInsight = overallTrend === 'concerning'
            ? "Declining wellness trends can impact retention. Consider box-wide wellness initiatives or coach training."
            : overallTrend === 'positive'
                ? "Positive wellness trends correlate with higher retention and member satisfaction. Keep up the great work!"
                : "Consistent wellness tracking gives you early warning signs and helps coaches provide personalized attention.";

        message += businessInsight;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: ownerId,
            type: "box_wellness_trends",
            category: "retention",
            priority: overallTrend === 'concerning' ? "high" : "normal",
            title,
            message,
            actionUrl: `/owner/analytics/wellness`,
            actionLabel: "View Wellness Dashboard",
            channels: ["in_app", "email"],
            data: {
                period: trendData.period,
                currentMetrics: trendData.currentMetrics,
                trends: trendData.trends,
                coachInsights: trendData.coachInsights,
                recommendations: trendData.recommendations,
                overallTrend,
            },
            deduplicationKey: `box_wellness_trends_${ownerId}_${this.getMonthIdentifier()}`,
        });
    }

// Helper methods for wellness notifications

    private getWellnessAlertDescription(alert: WellnessCrisisAlert): string {
        switch (alert.alertType) {
            case 'critical_low_energy':
                return `Critical low energy (${alert.currentValue.toFixed(1)}/10 avg over ${alert.averageDays} days)`;
            case 'high_stress':
                return `High stress levels (${alert.currentValue.toFixed(1)}/10 avg over ${alert.averageDays} days)`;
            case 'low_readiness':
                return `Low workout readiness (${alert.currentValue.toFixed(1)}/10 avg over ${alert.averageDays} days)`;
            case 'inconsistent_checkins':
                return `Inconsistent wellness tracking (${alert.currentValue} check-ins in ${alert.averageDays} days)`;
            default:
                return alert.recommendation;
        }
    }

    private getOverallWellnessTrend(trends: {
        energyTrend: 'improving' | 'stable' | 'declining';
        stressTrend: 'improving' | 'stable' | 'declining';
        readinessTrend: 'improving' | 'stable' | 'declining';
    }): 'positive' | 'neutral' | 'concerning' {
        const positiveCount = Object.values(trends).filter(t => t === 'improving').length;
        const decliningCount = Object.values(trends).filter(t => t === 'declining').length;

        if (positiveCount >= 2) return 'positive';
        if (decliningCount >= 2) return 'concerning';
        return 'neutral';
    }

    private calculateOverallWellnessTrend(trends: {
        checkinTrend: 'improving' | 'stable' | 'declining';
        energyTrend: 'improving' | 'stable' | 'declining';
        stressTrend: 'improving' | 'stable' | 'declining';
        readinessTrend: 'improving' | 'stable' | 'declining';
    }): 'positive' | 'neutral' | 'concerning' {
        const trendValues = Object.values(trends);
        const positiveCount = trendValues.filter(t => t === 'improving').length;
        const decliningCount = trendValues.filter(t => t === 'declining').length;

        if (positiveCount >= 3) return 'positive';
        if (decliningCount >= 2) return 'concerning';
        return 'neutral';
    }

    private getTrendEmoji(trend: 'improving' | 'stable' | 'declining'): string {
        switch (trend) {
            case 'improving': return '📈';
            case 'declining': return '📉';
            case 'stable': return '➡️';
            default: return '➡️';
        }
    }

    /**
     * Send at-risk athletes alert to coaches
     */
    async sendAtRiskAthletesAlert(
        boxId: string,
        coachId: string,
        atRiskGroups: AtRiskAthleteGroup[]
    ) {
        const context = await this.getCoachContext(boxId, coachId);
        if (!context) return null;

        const totalAtRisk = atRiskGroups.reduce((sum, group) => sum + group.athletes.length, 0);
        const criticalCount = atRiskGroups.find(g => g.riskLevel === 'critical')?.athletes.length || 0;
        const highRiskCount = atRiskGroups.find(g => g.riskLevel === 'high')?.athletes.length || 0;

        let title = "";
        let message = "";
        let priority: "normal" | "high" | "urgent" = "normal";

        if (criticalCount > 0) {
            title = `🚨 ${criticalCount} Athletes at Critical Risk`;
            priority = "urgent";
            message = `URGENT: ${criticalCount} athletes are at critical risk of churning. Immediate intervention required.\n\n`;
        } else if (highRiskCount > 0) {
            title = `⚠️ ${highRiskCount} Athletes Need Attention`;
            priority = "high";
            message = `${highRiskCount} athletes are showing high risk patterns. Schedule check-ins this week.\n\n`;
        }

        message += `RISK BREAKDOWN:\n`;
        if (criticalCount > 0) {
            const criticalAthletes = atRiskGroups.find(g => g.riskLevel === 'critical')?.athletes || [];
            message += `Critical Risk (${criticalCount}):\n`;
            criticalAthletes.slice(0, 3).forEach(athlete => {
                message += `• ${athlete.displayName} - ${athlete.riskScore}% risk, ${athlete.daysSinceLastCheckin}d since check-in\n`;
            });
            if (criticalAthletes.length > 3) {
                message += `• ... and ${criticalAthletes.length - 3} more\n`;
            }
            message += `\n`;
        }

        if (highRiskCount > 0) {
            const highRiskAthletes = atRiskGroups.find(g => g.riskLevel === 'high')?.athletes || [];
            message += `High Risk (${highRiskCount}):\n`;
            highRiskAthletes.slice(0, 3).forEach(athlete => {
                message += `• ${athlete.displayName} - ${athlete.riskScore}% risk\n`;
            });
            if (highRiskAthletes.length > 3) {
                message += `• ... and ${highRiskAthletes.length - 3} more\n`;
            }
            message += `\n`;
        }

        message += `RECOMMENDED ACTIONS:\n`;
        if (criticalCount > 0) {
            message += `• Schedule immediate 1-on-1 conversations with critical risk athletes\n`;
            message += `• Review their recent wellness data and attendance patterns\n`;
        }
        message += `• Send personalized check-in messages\n`;
        message += `• Consider adjusting training programs based on their feedback\n`;
        message += `\nEarly intervention is key to retention. These athletes need your coaching expertise!`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: coachId,
            type: "at_risk_athletes",
            category: "retention",
            priority,
            title,
            message,
            actionUrl: `/coach/analytics/at-risk`,
            actionLabel: "Review At-Risk Athletes",
            channels: ["in_app", "email"],
            data: {
                totalAtRisk,
                criticalCount,
                highRiskCount,
                coachRole: context.coach.role,
                athleteDetails: atRiskGroups,
                alertSeverity: criticalCount > 0 ? 'critical' : highRiskCount > 0 ? 'high' : 'medium',
            },
            deduplicationKey: `at_risk_alert_${coachId}_${new Date().toDateString()}`,
        });
    }

    /**
     * Send intervention follow-up reminders to coaches
     */
    async sendInterventionFollowUpReminder(
        boxId: string,
        coachId: string,
        overdueInterventions: Array<{
            interventionId: string;
            athleteName: string;
            membershipId: string;
            interventionType: string;
            daysSinceIntervention: number;
            followUpDue: Date;
            originalIssue: string;
        }>
    ) {
        const context = await this.getCoachContext(boxId, coachId);
        if (!context) return null;

        const urgentCount = overdueInterventions.filter(i => i.daysSinceIntervention > 7).length;
        const totalCount = overdueInterventions.length;

        const title = totalCount === 1
            ? `Follow-up Due: ${overdueInterventions[0].athleteName}`
            : `${totalCount} Intervention Follow-ups Due`;

        let message = totalCount === 1
            ? `Time to check in on your intervention with ${overdueInterventions[0].athleteName}.\n\n`
            : `You have ${totalCount} intervention follow-ups that need attention:\n\n`;

        if (totalCount > 1) {
            const displayList = overdueInterventions.slice(0, 5);
            displayList.forEach(intervention => {
                const urgentFlag = intervention.daysSinceIntervention > 7 ? " (URGENT)" : "";
                message += `• ${intervention.athleteName} - ${intervention.interventionType}${urgentFlag}\n`;
            });

            if (overdueInterventions.length > 5) {
                message += `• ... and ${overdueInterventions.length - 5} more\n`;
            }
            message += `\n`;
        }

        if (urgentCount > 0) {
            message += `⚠️ ${urgentCount} follow-up${urgentCount > 1 ? 's' : ''} ${urgentCount > 1 ? 'are' : 'is'} overdue by more than a week.\n\n`;
        }

        message += `NEXT STEPS:\n`;
        message += `• Review progress since your last conversation\n`;
        message += `• Update intervention outcomes in the system\n`;
        message += `• Schedule additional support if needed\n`;
        message += `• Document what's working and what isn't\n\n`;
        message += `Consistent follow-through on interventions is what separates great coaches from good ones!`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: coachId,
            type: "intervention_followup",
            category: "workflow",
            priority: urgentCount > 0 ? "high" : "normal",
            title,
            message,
            actionUrl: `/coach/interventions/follow-up`,
            actionLabel: "Review Follow-ups",
            channels: ["in_app", "email"],
            data: {
                totalInterventions: totalCount,
                urgentCount,
                interventions: overdueInterventions,
                coachRole: context.coach.role,
            },
            deduplicationKey: `intervention_followup_${coachId}_${new Date().toDateString()}`,
        });
    }

    /**
     * Send retention insights alert to owners
     */
    async sendRetentionInsightsAlert(
        boxId: string,
        ownerId: string,
        retentionData: {
            currentRetentionRate: number;
            previousRetentionRate: number;
            trend: 'improving' | 'stable' | 'declining';
            atRiskCount: number;
            newMemberRetention: number;
            thirtyDayRetention: number;
            recommendations: string[];
            criticalThreshold: boolean;
        }
    ) {
        const context = await this.getCoachContext(boxId, ownerId);
        if (!context) return null;

        let title = "";
        let message = "";
        let priority: "normal" | "high" | "urgent" = "normal";

        const retentionChange = retentionData.currentRetentionRate - retentionData.previousRetentionRate;
        const changeText = retentionChange > 0 ? `+${retentionChange.toFixed(1)}%` : `${retentionChange.toFixed(1)}%`;

        if (retentionData.criticalThreshold || retentionData.currentRetentionRate < 70) {
            title = `🚨 Critical: Retention Rate at ${retentionData.currentRetentionRate.toFixed(1)}%`;
            priority = "urgent";
            message = `URGENT: Your retention rate has dropped to ${retentionData.currentRetentionRate.toFixed(1)}%, which is below the healthy threshold of 70%.\n\n`;
        } else if (retentionData.trend === 'declining' && retentionChange < -5) {
            title = `⚠️ Retention Alert: Down to ${retentionData.currentRetentionRate.toFixed(1)}%`;
            priority = "high";
            message = `Your retention rate has declined to ${retentionData.currentRetentionRate.toFixed(1)}% (${changeText} this period).\n\n`;
        } else if (retentionData.trend === 'improving') {
            title = `📈 Retention Improving: ${retentionData.currentRetentionRate.toFixed(1)}%`;
            priority = "normal";
            message = `Great news! Your retention rate has improved to ${retentionData.currentRetentionRate.toFixed(1)}% (${changeText} this period).\n\n`;
        } else {
            title = `📊 Monthly Retention Report: ${retentionData.currentRetentionRate.toFixed(1)}%`;
            priority = "normal";
            message = `Your current retention rate is ${retentionData.currentRetentionRate.toFixed(1)}% (${changeText} from last period).\n\n`;
        }

        message += `KEY METRICS:\n`;
        message += `• Overall Retention: ${retentionData.currentRetentionRate.toFixed(1)}%\n`;
        message += `• 30-Day New Member Retention: ${retentionData.thirtyDayRetention.toFixed(1)}%\n`;
        message += `• New Member Retention: ${retentionData.newMemberRetention.toFixed(1)}%\n`;
        message += `• Athletes at Risk: ${retentionData.atRiskCount}\n`;
        message += `• Trend: ${retentionData.trend === 'improving' ? '📈' : retentionData.trend === 'declining' ? '📉' : '➡️'} ${retentionData.trend}\n\n`;

        if (retentionData.recommendations.length > 0) {
            message += `RECOMMENDED ACTIONS:\n`;
            retentionData.recommendations.slice(0, 4).forEach(rec => {
                message += `• ${rec}\n`;
            });
            message += `\n`;
        }

        if (retentionData.atRiskCount > 0) {
            message += `💡 TIP: Focus on the ${retentionData.atRiskCount} at-risk athletes first - they have the highest impact potential.`;
        } else {
            message += `💡 TIP: Retention drives sustainable growth. Small improvements compound over time.`;
        }

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: ownerId,
            type: "retention_insights",
            category: "retention",
            priority,
            title,
            message,
            actionUrl: `/owner/analytics/retention`,
            actionLabel: "View Detailed Analytics",
            channels: ["in_app", "email"],
            data: {
                currentRetentionRate: retentionData.currentRetentionRate,
                previousRetentionRate: retentionData.previousRetentionRate,
                trend: retentionData.trend,
                atRiskCount: retentionData.atRiskCount,
                newMemberRetention: retentionData.newMemberRetention,
                thirtyDayRetention: retentionData.thirtyDayRetention,
                criticalThreshold: retentionData.criticalThreshold,
                recommendations: retentionData.recommendations,
            },
            deduplicationKey: `retention_insights_${ownerId}_${this.getMonthIdentifier()}`,
        });
    }

    /**
     * Send business metrics alert to owners
     */
    async sendBusinessMetricsAlert(
        boxId: string,
        ownerId: string,
        alerts: BusinessMetricAlert[]
    ) {
        const context = await this.getCoachContext(boxId, ownerId);
        if (!context) return null;

        const criticalAlerts = alerts.filter(a => a.severity === 'critical');
        const highPriorityAlerts = alerts.filter(a => a.severity === 'high');
        const actionRequiredCount = alerts.filter(a => a.actionRequired).length;

        let title = "";
        let priority: "normal" | "high" | "urgent" = "normal";

        if (criticalAlerts.length > 0) {
            title = `🚨 Critical Business Alert${criticalAlerts.length > 1 ? 's' : ''}`;
            priority = "urgent";
        } else if (highPriorityAlerts.length > 0) {
            title = `⚠️ Business Metrics Alert${highPriorityAlerts.length > 1 ? 's' : ''}`;
            priority = "high";
        } else {
            title = `📊 Business Update - ${alerts.length} Item${alerts.length > 1 ? 's' : ''}`;
            priority = "normal";
        }

        let message = `Business metrics update for ${context.box.name}:\n\n`;

        // Group alerts by type
        const alertsByType = alerts.reduce((acc, alert) => {
            if (!acc[alert.type]) acc[alert.type] = [];
            acc[alert.type].push(alert);
            return acc;
        }, {} as Record<string, BusinessMetricAlert[]>);

        Object.entries(alertsByType).forEach(([type, typeAlerts]) => {
            const typeTitle = type.toUpperCase().replace('_', ' ');
            message += `${typeTitle}:\n`;

            typeAlerts.forEach(alert => {
                const urgencyIcon = alert.severity === 'critical' ? '🚨' :
                    alert.severity === 'high' ? '⚠️' :
                        alert.severity === 'medium' ? '📢' : 'ℹ️';
                const actionFlag = alert.actionRequired ? ' [ACTION REQUIRED]' : '';
                message += `${urgencyIcon} ${alert.title}${actionFlag}\n`;
                message += `   ${alert.description}\n`;
                if (alert.dueDate) {
                    const daysUntilDue = Math.ceil((alert.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    message += `   Due: ${daysUntilDue > 0 ? `${daysUntilDue} days` : 'OVERDUE'}\n`;
                }
                message += `\n`;
            });
        });

        if (actionRequiredCount > 0) {
            message += `📋 IMMEDIATE ACTION NEEDED:\n`;
            message += `${actionRequiredCount} alert${actionRequiredCount > 1 ? 's require' : ' requires'} your immediate attention.\n\n`;
        }

        message += `💡 Regular monitoring of these metrics helps you stay ahead of potential issues and capitalize on opportunities.`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: ownerId,
            type: "business_metrics",
            category: "billing",
            priority,
            title,
            message,
            actionUrl: `/owner/analytics/business`,
            actionLabel: "Review Business Metrics",
            channels: ["in_app", "email"],
            data: {
                totalAlerts: alerts.length,
                criticalCount: criticalAlerts.length,
                highPriorityCount: highPriorityAlerts.length,
                actionRequiredCount,
                alerts,
                alertTypes: Object.keys(alertsByType),
            },
            deduplicationKey: `business_metrics_${ownerId}_${new Date().toDateString()}`,
        });
    }

    /**
     * Send coach performance insights
     */
    async sendCoachPerformanceInsights(
        boxId: string,
        coachId: string,
        performanceData: {
            interventionsCompleted: number;
            interventionsWithOutcome: number;
            avgRiskScoreImprovement: number;
            athletesManaged: number;
            retentionRate: number;
            benchmarkComparison: {
                betterThanAverage: boolean;
                percentile: number;
            };
            topAchievements: string[];
            improvementAreas: string[];
        }
    ) {
        const context = await this.getCoachContext(boxId, coachId);
        if (!context) return null;

        const successRate = performanceData.interventionsCompleted > 0
            ? (performanceData.interventionsWithOutcome / performanceData.interventionsCompleted) * 100
            : 0;

        const title = performanceData.benchmarkComparison.betterThanAverage
            ? `📈 Great Coaching Performance!`
            : `📊 Your Coaching Performance Update`;

        let message = `Here's how your coaching performance has been this month:\n\n`;

        message += `PERFORMANCE SUMMARY:\n`;
        message += `• ${performanceData.interventionsCompleted} interventions completed\n`;
        message += `• ${successRate.toFixed(1)}% intervention success rate\n`;
        message += `• ${performanceData.athletesManaged} athletes under your guidance\n`;
        message += `• ${performanceData.retentionRate.toFixed(1)}% athlete retention rate\n`;

        if (performanceData.avgRiskScoreImprovement > 0) {
            message += `• ${performanceData.avgRiskScoreImprovement.toFixed(1)} point average risk score improvement\n`;
        }

        message += `\nBENCHMARK COMPARISON:\n`;
        if (performanceData.benchmarkComparison.betterThanAverage) {
            message += `🎉 You're performing better than average! You're in the top ${100 - performanceData.benchmarkComparison.percentile}% of coaches.\n`;
        } else {
            message += `You're performing at the ${performanceData.benchmarkComparison.percentile}th percentile. There's room for growth!\n`;
        }

        if (performanceData.topAchievements.length > 0) {
            message += `\n🏆 TOP ACHIEVEMENTS:\n`;
            performanceData.topAchievements.slice(0, 3).forEach(achievement => {
                message += `• ${achievement}\n`;
            });
        }

        if (performanceData.improvementAreas.length > 0) {
            message += `\n🎯 GROWTH OPPORTUNITIES:\n`;
            performanceData.improvementAreas.slice(0, 3).forEach(area => {
                message += `• ${area}\n`;
            });
        }

        message += `\n💪 Remember: Every intervention you make has the potential to change an athlete's entire fitness journey. Your coaching matters!`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: coachId,
            type: "coach_performance",
            category: "workflow",
            priority: "normal",
            title,
            message,
            actionUrl: `/coach/analytics/performance`,
            actionLabel: "View Detailed Performance",
            channels: ["in_app", "email"],
            data: {
                interventionsCompleted: performanceData.interventionsCompleted,
                successRate,
                athletesManaged: performanceData.athletesManaged,
                retentionRate: performanceData.retentionRate,
                percentile: performanceData.benchmarkComparison.percentile,
                betterThanAverage: performanceData.benchmarkComparison.betterThanAverage,
                topAchievements: performanceData.topAchievements,
                improvementAreas: performanceData.improvementAreas,
            },
            deduplicationKey: `coach_performance_${coachId}_${this.getMonthIdentifier()}`,
        });
    }

    /**
     * Send milestone celebration for box achievements
     */
    async sendBoxMilestoneCelebration(
        boxId: string,
        recipientIds: string[],
        milestone: {
            type: 'retention' | 'growth' | 'engagement' | 'revenue';
            title: string;
            description: string;
            value: number;
            unit: string;
            previousValue?: number;
            isRecord: boolean;
            celebrationLevel: 'bronze' | 'silver' | 'gold' | 'platinum';
        }
    ) {
        const box = await this.getBoxInfo(boxId);
        if (!box) return [];

        const notifications = [];

        const celebrationEmoji = {
            bronze: '🥉',
            silver: '🥈',
            gold: '🥇',
            platinum: '💎'
        }[milestone.celebrationLevel];

        const title = `${celebrationEmoji} ${milestone.title} Milestone!`;

        let message = `🎉 Congratulations! ${box.name} just achieved an amazing milestone:\n\n`;
        message += `${milestone.description}\n\n`;

        if (milestone.previousValue) {
            const improvement = milestone.value - milestone.previousValue;
            const improvementPercent = ((improvement / milestone.previousValue) * 100).toFixed(1);
            message += `That's an improvement of ${improvement.toFixed(1)}${milestone.unit} (${improvementPercent}%) from your previous best!\n\n`;
        }

        if (milestone.isRecord) {
            message += `🏆 This is a new record for your box!\n\n`;
        }

        switch (milestone.type) {
            case 'retention':
                message += `High retention rates like this show that athletes love training at ${box.name}. Your coaching and community culture are making a real difference!`;
                break;
            case 'growth':
                message += `This growth milestone reflects the strength of your community and the quality of your coaching. Word is spreading about what makes ${box.name} special!`;
                break;
            case 'engagement':
                message += `This engagement milestone shows how connected your athletes are. When people are this engaged, retention and results follow naturally!`;
                break;
            case 'revenue':
                message += `This revenue milestone demonstrates the sustainability and health of your business. Congratulations on building something valuable!`;
                break;
        }

        message += `\n\nKeep up the excellent work - achievements like this don't happen by accident!`;

        // Send to all recipients
        for (const recipientId of recipientIds) {
            const context = await this.getCoachContext(boxId, recipientId);
            if (!context) continue;

            const notification = await this.notificationService.createNotification({
                boxId,
                userId: context.coach.userId,
                membershipId: recipientId,
                type: "box_milestone",
                category: "social",
                priority: milestone.celebrationLevel === 'platinum' ? "high" : "normal",
                title,
                message,
                actionUrl: `/analytics/overview`,
                actionLabel: "View Analytics",
                channels: ["in_app", "email"],
                data: {
                    milestoneType: milestone.type,
                    milestoneValue: milestone.value,
                    milestoneUnit: milestone.unit,
                    previousValue: milestone.previousValue,
                    isRecord: milestone.isRecord,
                    celebrationLevel: milestone.celebrationLevel,
                    achievementDate: new Date().toISOString(),
                },
                deduplicationKey: `box_milestone_${milestone.type}_${milestone.value}_${milestone.unit}`,
            });

            if (notification) {
                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send weekly analytics digest to coaches and owners
     */
    async sendWeeklyAnalyticsDigest(
        boxId: string,
        recipientId: string,
        digestData: {
            recipient: {
                role: 'head_coach' | 'coach' | 'owner';
                name: string;
            };
            summary: {
                newAtRiskAthletes: number;
                interventionsCompleted: number;
                retentionRate: number;
                totalActiveAthletes: number;
                weeklyTrend: 'positive' | 'neutral' | 'concerning';
            };
            highlights: string[];
            priorities: Array<{
                title: string;
                description: string;
                urgency: 'low' | 'medium' | 'high';
                actionUrl?: string;
            }>;
            insights: string[];
        }
    ) {
        const context = await this.getCoachContext(boxId, recipientId);
        if (!context) return null;

        const trendEmoji = {
            positive: '📈',
            neutral: '➡️',
            concerning: '📉'
        }[digestData.summary.weeklyTrend];

        const title = `Weekly Analytics Digest - ${digestData.summary.weeklyTrend === 'positive' ? 'Looking Good!' : digestData.summary.weeklyTrend === 'concerning' ? 'Needs Attention' : 'Steady Progress'}`;

        let message = `Your weekly analytics summary for ${context.box.name}:\n\n`;

        message += `📊 WEEKLY SUMMARY ${trendEmoji}:\n`;
        message += `• ${digestData.summary.totalActiveAthletes} active athletes\n`;
        message += `• ${digestData.summary.retentionRate.toFixed(1)}% retention rate\n`;
        message += `• ${digestData.summary.newAtRiskAthletes} new at-risk athletes\n`;
        message += `• ${digestData.summary.interventionsCompleted} interventions completed\n\n`;

        if (digestData.highlights.length > 0) {
            message += `✨ HIGHLIGHTS:\n`;
            digestData.highlights.forEach(highlight => {
                message += `• ${highlight}\n`;
            });
            message += `\n`;
        }

        if (digestData.priorities.length > 0) {
            message += `🎯 THIS WEEK'S PRIORITIES:\n`;
            const sortedPriorities = digestData.priorities.sort((a, b) => {
                const urgencyOrder = { high: 3, medium: 2, low: 1 };
                return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
            });

            sortedPriorities.slice(0, 4).forEach(priority => {
                const urgencyIcon = priority.urgency === 'high' ? '🔥' : priority.urgency === 'medium' ? '⚡' : '📌';
                message += `${urgencyIcon} ${priority.title}\n`;
                message += `   ${priority.description}\n`;
            });
            message += `\n`;
        }

        if (digestData.insights.length > 0) {
            message += `💡 INSIGHTS:\n`;
            digestData.insights.slice(0, 3).forEach(insight => {
                message += `• ${insight}\n`;
            });
            message += `\n`;
        }

        const encouragement = digestData.summary.weeklyTrend === 'positive'
            ? "Keep up the excellent work! Your attention to athlete retention is paying off."
            : digestData.summary.weeklyTrend === 'concerning'
                ? "This week's data shows opportunities for improvement. Focus on the priorities above to get back on track."
                : "Steady progress is still progress. Small, consistent improvements lead to big results over time.";

        message += encouragement;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: recipientId,
            type: "weekly_analytics_digest",
            category: "retention",
            priority: digestData.summary.weeklyTrend === 'concerning' ? "high" : "normal",
            title,
            message,
            actionUrl: digestData.recipient.role === 'owner' ? `/owner/analytics` : `/coach/analytics`,
            actionLabel: "View Full Analytics",
            channels: ["in_app", "email"],
            data: {
                recipientRole: digestData.recipient.role,
                weeklyTrend: digestData.summary.weeklyTrend,
                summary: digestData.summary,
                highlights: digestData.highlights,
                priorities: digestData.priorities,
                insights: digestData.insights,
                weekIdentifier: this.getWeekIdentifier(),
            },
            deduplicationKey: `weekly_digest_${recipientId}_${this.getWeekIdentifier()}`,
        });
    }

    /**
     * Send urgent capacity warning to owners
     */
    async sendCapacityWarning(
        boxId: string,
        ownerId: string,
        capacityData: {
            currentAthletes: number;
            athleteLimit: number;
            utilizationPercent: number;
            currentCoaches: number;
            coachLimit: number;
            projectedDaysToLimit: number;
            recommendedAction: 'upgrade' | 'add_coaches' | 'optimize_capacity';
        }
    ) {
        const context = await this.getCoachContext(boxId, ownerId);
        if (!context) return null;

        const isUrgent = capacityData.utilizationPercent >= 95;
        const isWarning = capacityData.utilizationPercent >= 85;

        let title = "";
        let priority: "normal" | "high" | "urgent" = "normal";

        if (isUrgent) {
            title = `🚨 URGENT: ${capacityData.utilizationPercent.toFixed(0)}% Capacity Reached`;
            priority = "urgent";
        } else if (isWarning) {
            title = `⚠️ Capacity Warning: ${capacityData.utilizationPercent.toFixed(0)}% Full`;
            priority = "high";
        } else {
            title = `📊 Capacity Update: ${capacityData.utilizationPercent.toFixed(0)}% Utilization`;
            priority = "normal";
        }

        let message = `Capacity alert for ${context.box.name}:\n\n`;

        message += `CURRENT USAGE:\n`;
        message += `• Athletes: ${capacityData.currentAthletes}/${capacityData.athleteLimit} (${capacityData.utilizationPercent.toFixed(1)}%)\n`;
        message += `• Coaches: ${capacityData.currentCoaches}/${capacityData.coachLimit}\n\n`;

        if (capacityData.projectedDaysToLimit > 0 && capacityData.projectedDaysToLimit <= 30) {
            message += `📈 PROJECTION:\n`;
            message += `At current growth rate, you'll reach your athlete limit in approximately ${capacityData.projectedDaysToLimit} days.\n\n`;
        }

        message += `RECOMMENDED ACTION:\n`;
        switch (capacityData.recommendedAction) {
            case 'upgrade':
                message += `• Consider upgrading your subscription plan to accommodate more athletes\n`;
                message += `• This will prevent having to turn away new members\n`;
                message += `• Upgrading now ensures uninterrupted growth\n`;
                break;
            case 'add_coaches':
                message += `• Consider adding more coaches to better support your growing membership\n`;
                message += `• More coaches = better athlete-to-coach ratios = higher retention\n`;
                message += `• This can help justify higher pricing and improve service quality\n`;
                break;
            case 'optimize_capacity':
                message += `• Review class scheduling to optimize capacity utilization\n`;
                message += `• Consider adding class times during off-peak hours\n`;
                message += `• Analyze member attendance patterns for optimization opportunities\n`;
                break;
        }

        if (isUrgent) {
            message += `\n🔥 URGENT: You're at critical capacity. New member signups may be rejected until you upgrade or optimize.`;
        } else if (isWarning) {
            message += `\n⚡ ACT SOON: High capacity utilization can impact service quality and member satisfaction.`;
        }

        message += `\n\n💡 Remember: Growing to capacity is a good problem to have - it means your box is thriving!`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: ownerId,
            type: "capacity_warning",
            category: "billing",
            priority,
            title,
            message,
            actionUrl: `/owner/billing/subscription`,
            actionLabel: capacityData.recommendedAction === 'upgrade' ? "Upgrade Plan" : "Review Options",
            channels: ["in_app", "email"],
            data: {
                currentAthletes: capacityData.currentAthletes,
                athleteLimit: capacityData.athleteLimit,
                utilizationPercent: capacityData.utilizationPercent,
                currentCoaches: capacityData.currentCoaches,
                coachLimit: capacityData.coachLimit,
                projectedDaysToLimit: capacityData.projectedDaysToLimit,
                recommendedAction: capacityData.recommendedAction,
                urgencyLevel: isUrgent ? 'urgent' : isWarning ? 'warning' : 'normal',
            },
            deduplicationKey: `capacity_warning_${ownerId}_${Math.floor(capacityData.utilizationPercent / 10) * 10}`, // Group by 10% increments
        });
    }

    /**
     * Send intervention effectiveness report to coaches
     */
    async sendInterventionEffectivenessReport(
        boxId: string,
        coachId: string,
        effectivenessData: {
            period: string;
            interventionTypes: Array<{
                type: string;
                totalInterventions: number;
                avgRiskScoreChange: number;
                avgAttendanceRateChange: number;
                successRate: number;
                topTactic: string;
            }>;
            overallStats: {
                totalInterventions: number;
                overallSuccessRate: number;
                avgRiskImprovement: number;
                benchmarkComparison: number; // percentile
            };
            insights: string[];
            recommendations: string[];
        }
    ) {
        const context = await this.getCoachContext(boxId, coachId);
        if (!context) return null;

        const title = effectivenessData.overallStats.overallSuccessRate >= 75
            ? `📈 Strong Intervention Results!`
            : `📊 Intervention Effectiveness Report`;

        let message = `Your intervention effectiveness report for ${effectivenessData.period}:\n\n`;

        message += `OVERALL PERFORMANCE:\n`;
        message += `• ${effectivenessData.overallStats.totalInterventions} total interventions\n`;
        message += `• ${effectivenessData.overallStats.overallSuccessRate.toFixed(1)}% success rate\n`;
        message += `• ${effectivenessData.overallStats.avgRiskImprovement.toFixed(1)} point average risk score improvement\n`;
        message += `• ${effectivenessData.overallStats.benchmarkComparison}th percentile performance\n\n`;

        if (effectivenessData.interventionTypes.length > 0) {
            message += `INTERVENTION BREAKDOWN:\n`;
            effectivenessData.interventionTypes
                .sort((a, b) => b.successRate - a.successRate)
                .slice(0, 3)
                .forEach(intervention => {
                    message += `• ${intervention.type}: ${intervention.successRate.toFixed(1)}% success (${intervention.totalInterventions} attempts)\n`;
                    if (intervention.avgRiskScoreChange > 0) {
                        message += `  Risk score improved by ${intervention.avgRiskScoreChange.toFixed(1)} points on average\n`;
                    }
                });
            message += `\n`;
        }

        if (effectivenessData.insights.length > 0) {
            message += `KEY INSIGHTS:\n`;
            effectivenessData.insights.slice(0, 3).forEach(insight => {
                message += `• ${insight}\n`;
            });
            message += `\n`;
        }

        if (effectivenessData.recommendations.length > 0) {
            message += `RECOMMENDATIONS:\n`;
            effectivenessData.recommendations.slice(0, 3).forEach(rec => {
                message += `• ${rec}\n`;
            });
            message += `\n`;
        }

        const encouragement = effectivenessData.overallStats.overallSuccessRate >= 75
            ? "Excellent work! Your interventions are making a real difference in athlete retention."
            : effectivenessData.overallStats.overallSuccessRate >= 50
                ? "Good progress! Focus on the most effective intervention types to improve your success rate."
                : "Every intervention is a learning opportunity. Use these insights to refine your approach.";

        message += encouragement;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.coach.userId,
            membershipId: coachId,
            type: "intervention_effectiveness",
            category: "workflow",
            priority: "normal",
            title,
            message,
            actionUrl: `/coach/analytics/interventions`,
            actionLabel: "View Detailed Report",
            channels: ["in_app", "email"],
            data: {
                period: effectivenessData.period,
                totalInterventions: effectivenessData.overallStats.totalInterventions,
                successRate: effectivenessData.overallStats.overallSuccessRate,
                avgRiskImprovement: effectivenessData.overallStats.avgRiskImprovement,
                benchmarkPercentile: effectivenessData.overallStats.benchmarkComparison,
                interventionTypes: effectivenessData.interventionTypes,
                insights: effectivenessData.insights,
                recommendations: effectivenessData.recommendations,
            },
            deduplicationKey: `intervention_effectiveness_${coachId}_${effectivenessData.period}`,
        });
    }

    /**
     * Helper method to get coach/owner context
     */
    private async getCoachContext(boxId: string, membershipId: string): Promise<AnalyticsNotificationContext | null> {
        const coach = await db
            .select({
                coach: {
                    id: boxMemberships.id,
                    userId: boxMemberships.userId,
                    displayName: boxMemberships.displayName,
                    role: boxMemberships.role,
                },
                box: {
                    id: boxes.id,
                    name: boxes.name,
                    publicId: boxes.publicId,
                }
            })
            .from(boxMemberships)
            .innerJoin(boxes, eq(boxMemberships.boxId, boxes.id))
            .where(
                and(
                    eq(boxMemberships.id, membershipId),
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    inArray(boxMemberships.role, ['head_coach', 'coach', 'owner'])
                )
            )
            .limit(1);

        return coach.length > 0 ? {
            coach: coach[0].coach,
            box: coach[0].box
        } : null;
    }

    /**
     * Helper method to get box info
     */
    private async getBoxInfo(boxId: string) {
        const box = await db
            .select()
            .from(boxes)
            .where(eq(boxes.id, boxId))
            .limit(1);

        return box.length > 0 ? box[0] : null;
    }

    /**
     * Helper method to get week identifier for deduplication
     */
    private getWeekIdentifier(): string {
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
        return startOfWeek.toISOString().split('T')[0];
    }

    /**
     * Helper method to get month identifier for deduplication
     */
    private getMonthIdentifier(): string {
        const now = new Date();
        return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    }

    /**
     * Send bulk analytics notifications
     */
    async sendAnalyticsEventNotifications(events: Array<{
        type: string;
        boxId: string;
        recipientId: string;
        data: any;
    }>) {
        const results = [];

        for (const event of events) {
            try {
                let notification = null;

                switch (event.type) {
                    case 'wellness_crisis':
                        notification = await this.sendWellnessCrisisAlert(
                            event.boxId,
                            event.recipientId,
                            event.data.wellnessAlerts
                        );
                        break;

                    case 'weekly_wellness_insights':
                        notification = await this.sendWeeklyWellnessInsights(
                            event.boxId,
                            event.recipientId,
                            event.data.wellnessData
                        );
                        break;

                    case 'wellness_followup':
                        notification = await this.sendWellnessFollowUpReminder(
                            event.boxId,
                            event.recipientId,
                            event.data.pendingFollowUps
                        );
                        break;

                    case 'box_wellness_trends':
                        notification = await this.sendBoxWellnessTrends(
                            event.boxId,
                            event.recipientId,
                            event.data.trendData
                        );
                        break;

                    case 'at_risk_athletes':
                        notification = await this.sendAtRiskAthletesAlert(
                            event.boxId,
                            event.recipientId,
                            event.data.atRiskGroups
                        );
                        break;

                    case 'intervention_followup':
                        notification = await this.sendInterventionFollowUpReminder(
                            event.boxId,
                            event.recipientId,
                            event.data.overdueInterventions
                        );
                        break;

                    case 'retention_insights':
                        notification = await this.sendRetentionInsightsAlert(
                            event.boxId,
                            event.recipientId,
                            event.data.retentionData
                        );
                        break;

                    case 'business_metrics':
                        notification = await this.sendBusinessMetricsAlert(
                            event.boxId,
                            event.recipientId,
                            event.data.alerts
                        );
                        break;

                    case 'coach_performance':
                        notification = await this.sendCoachPerformanceInsights(
                            event.boxId,
                            event.recipientId,
                            event.data.performanceData
                        );
                        break;

                    case 'weekly_digest':
                        notification = await this.sendWeeklyAnalyticsDigest(
                            event.boxId,
                            event.recipientId,
                            event.data.digestData
                        );
                        break;

                    case 'capacity_warning':
                        notification = await this.sendCapacityWarning(
                            event.boxId,
                            event.recipientId,
                            event.data.capacityData
                        );
                        break;

                    case 'intervention_effectiveness':
                        notification = await this.sendInterventionEffectivenessReport(
                            event.boxId,
                            event.recipientId,
                            event.data.effectivenessData
                        );
                        break;

                    case 'box_milestone':
                        // Special case: box milestone sends to multiple recipients
                        const milestoneNotifications = await this.sendBoxMilestoneCelebration(
                            event.boxId,
                            event.data.recipientIds,
                            event.data.milestone
                        );
                        notification = milestoneNotifications.length > 0 ? milestoneNotifications[0] : null;
                        break;

                    default:
                        console.warn(`Unknown analytics event type: ${event.type}`);
                        continue;
                }

                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    recipientId: event.recipientId,
                    notificationSent: !!notification,
                    success: true,
                });

            } catch (error) {
                console.error(`Failed to send ${event.type} notification for recipient ${event.recipientId}:`, error);
                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    recipientId: event.recipientId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return results;
    }
}
