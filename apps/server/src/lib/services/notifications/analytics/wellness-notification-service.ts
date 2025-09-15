// lib/services/notifications/analytics/wellness-notification-service.ts
import {NotificationService} from "@/lib/services/notifications";
import {boxes, boxMemberships} from "@/db/schema";
import type {AnalyticsNotificationContext} from "@/lib/services/notifications/analytics-notifications-service";
import {db} from "@/db";
import {and, eq, inArray} from "drizzle-orm";

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

export class WellnessNotificationService {
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
     * Helper method to get month identifier for deduplication
     */
    private getMonthIdentifier(): string {
        const now = new Date();
        return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
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
}
