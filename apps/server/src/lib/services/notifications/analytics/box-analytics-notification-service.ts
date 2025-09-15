// lib/services/notifications/analytics/box-analytics-notification-service.ts
import {NotificationService} from "@/lib/services/notifications";
import {boxes, boxMemberships} from "@/db/schema";
import type {AnalyticsNotificationContext} from "@/lib/services/notifications/analytics-notifications-service";
import {db} from "@/db";
import {and, eq, inArray} from "drizzle-orm";

export class BoxAnalyticsNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
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

    /**
     * Helper method to get month identifier for deduplication
     */
    private getMonthIdentifier(): string {
        const now = new Date();
        return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
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

    private getTrendEmoji(trend: 'improving' | 'stable' | 'declining'): string {
        switch (trend) {
            case 'improving': return '📈';
            case 'declining': return '📉';
            case 'stable': return '➡️';
            default: return '➡️';
        }
    }
}
