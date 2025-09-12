// lib/services/analytics/analytics-service.ts
import { RiskAnalyticsService } from './risk-analytics-service';
import { InterventionService } from './intervention-service';
import { EngagementAnalyticsService } from './engagement-analytics-service';
import { WellnessAnalyticsService } from './wellness-analytics-service';
import { RetentionAnalyticsService } from './retention-analytics-service';
import { BoxAnalyticsService } from './box-analytics-service';

// Re-export types for backward compatibility
export type { RiskLevel, AlertSeverity } from './risk-analytics-service';
export type { InterventionParams } from './intervention-service';
export type { EngagementMetrics, ActivityFeedItem } from './engagement-analytics-service';
export type { WellnessTrend, WellnessCorrelation, WellnessInsights } from './wellness-analytics-service';
export type { RetentionData, SubscriptionHealth, RetentionInsights } from './retention-analytics-service';
export type {
    AnalyticsPeriod,
    BoxHealthMetrics,
    BoxOverview,
    BasicBoxStats,
    BillingAnalytics,
    BillingHistory
} from './box-analytics-service';

/**
 * Main Analytics Service - Orchestrates all analytics sub-services
 *
 * This service acts as a facade pattern, providing a unified interface
 * to all analytics functionality while delegating to specialized services.
 */
export class AnalyticsService {
    // Risk Analytics Methods
    static calculateRetentionRisk = RiskAnalyticsService.calculateRetentionRisk.bind(RiskAnalyticsService);
    static getAtRiskAthletes = RiskAnalyticsService.getAtRiskAthletes.bind(RiskAnalyticsService);
    static getAthleteRiskHistory = RiskAnalyticsService.getAthleteRiskHistory.bind(RiskAnalyticsService);
    static getActiveAlerts = RiskAnalyticsService.getActiveAlerts.bind(RiskAnalyticsService);

    // Intervention Methods
    static logIntervention = InterventionService.logIntervention.bind(InterventionService);
    static getAthleteInterventions = InterventionService.getAthleteInterventions.bind(InterventionService);
    static getRecentInterventions = InterventionService.getRecentInterventions.bind(InterventionService);
    static getInterventionStats = InterventionService.getInterventionStats.bind(InterventionService);
    static getCoachPerformance = InterventionService.getCoachPerformance.bind(InterventionService);
    static updateInterventionOutcome = InterventionService.updateInterventionOutcome.bind(InterventionService);
    static getInterventionsRequiringFollowUp = InterventionService.getInterventionsRequiringFollowUp.bind(InterventionService);
    static getInterventionEffectiveness = InterventionService.getInterventionEffectiveness.bind(InterventionService);
    static getInterventionRecommendations = InterventionService.getInterventionRecommendations.bind(InterventionService);

    // Engagement Analytics Methods
    static calculateAthleteEngagementScore = EngagementAnalyticsService.calculateAthleteEngagementScore.bind(EngagementAnalyticsService);
    static getEngagementLeaderboard = EngagementAnalyticsService.getEngagementLeaderboard.bind(EngagementAnalyticsService);
    static getAthleteProgressTimeline = EngagementAnalyticsService.getAthleteProgressTimeline.bind(EngagementAnalyticsService);
    static getRecentActivityFeed = EngagementAnalyticsService.getRecentActivityFeed.bind(EngagementAnalyticsService);
    static getEngagementTrends = EngagementAnalyticsService.getEngagementTrends.bind(EngagementAnalyticsService);
    static calculateBulkEngagementScores = EngagementAnalyticsService.calculateBulkEngagementScores.bind(EngagementAnalyticsService);
    static getLowEngagementAthletes = EngagementAnalyticsService.getLowEngagementAthletes.bind(EngagementAnalyticsService);
    static getEngagementInsights = EngagementAnalyticsService.getEngagementInsights.bind(EngagementAnalyticsService);

    // Wellness Analytics Methods
    static getWellnessTrends = WellnessAnalyticsService.getWellnessTrends.bind(WellnessAnalyticsService);
    static getWellnessPerformanceCorrelation = WellnessAnalyticsService.getWellnessPerformanceCorrelation.bind(WellnessAnalyticsService);
    static getWellnessInsights = WellnessAnalyticsService.getWellnessInsights.bind(WellnessAnalyticsService);
    static getAthleteWellnessSummary = WellnessAnalyticsService.getAthleteWellnessSummary.bind(WellnessAnalyticsService);
    static getWellnessPatterns = WellnessAnalyticsService.getWellnessPatterns.bind(WellnessAnalyticsService);
    static getWellnessAlerts = WellnessAnalyticsService.getWellnessAlerts.bind(WellnessAnalyticsService);

    // Retention Analytics Methods
    static getMonthlyRetention = RetentionAnalyticsService.getMonthlyRetention.bind(RetentionAnalyticsService);
    static getBoxSubscriptionHealth = RetentionAnalyticsService.getBoxSubscriptionHealth.bind(RetentionAnalyticsService);
    static getRetentionInsights = RetentionAnalyticsService.getRetentionInsights.bind(RetentionAnalyticsService);
    static getAthleteMilestones = RetentionAnalyticsService.getAthleteMilestones.bind(RetentionAnalyticsService);
    static calculateMemberLTV = RetentionAnalyticsService.calculateMemberLTV.bind(RetentionAnalyticsService);

    // Box Analytics Methods
    static getBoxAnalytics = BoxAnalyticsService.getBoxAnalytics.bind(BoxAnalyticsService);
    static getBoxAnalyticsSnapshots = BoxAnalyticsService.getBoxAnalyticsSnapshots.bind(BoxAnalyticsService);
    static getBoxHealthDashboard = BoxAnalyticsService.getBoxHealthDashboard.bind(BoxAnalyticsService);
    static getBasicBoxStatistics = BoxAnalyticsService.getBasicBoxStatistics.bind(BoxAnalyticsService);
    static getBoxCoaches = BoxAnalyticsService.getBoxCoaches.bind(BoxAnalyticsService);
    static getBillingAnalytics = BoxAnalyticsService.getBillingAnalytics.bind(BoxAnalyticsService);
    static getBillingHistory = BoxAnalyticsService.getBillingHistory.bind(BoxAnalyticsService);
    static getAnalyticsTrends = BoxAnalyticsService.getAnalyticsTrends.bind(BoxAnalyticsService);

    /**
     * Legacy method mapping for backward compatibility
     * Maps old method names to new service methods
     */
    static calculateAtRiskAthletes = RiskAnalyticsService.getAtRiskAthletes;
    static getAthletesWithRiskScores = RiskAnalyticsService.getAtRiskAthletes;

    /**
     * Get comprehensive analytics dashboard data
     * Combines data from multiple services for a complete overview
     */
    static async getComprehensiveDashboard(
        boxId: string,
        options: {
            period?: 'week' | 'month' | 'quarter';
            includeRisk?: boolean;
            includeWellness?: boolean;
            includeEngagement?: boolean;
            includeRetention?: boolean;
        } = {}
    ) {
        const {
            period = 'month',
            includeRisk = true,
            includeWellness = true,
            includeEngagement = true,
            includeRetention = true
        } = options;

        const days = period === 'week' ? 7 : period === 'month' ? 30 : 90;

        const [
            boxOverview,
            basicStats,
            atRiskAthletes,
            wellnessInsights,
            engagementInsights,
            retentionData
        ] = await Promise.all([
            BoxAnalyticsService.getBoxAnalytics(boxId, { period }),
            BoxAnalyticsService.getBasicBoxStatistics(boxId),
            includeRisk
                ? RiskAnalyticsService.getAtRiskAthletes(boxId, { limit: 10 })
                : Promise.resolve([]),
            includeWellness
                ? WellnessAnalyticsService.getWellnessInsights(boxId, days)
                : Promise.resolve(null),
            includeEngagement
                ? EngagementAnalyticsService.getEngagementInsights(boxId, days)
                : Promise.resolve(null),
            includeRetention
                ? RetentionAnalyticsService.getRetentionInsights(boxId, 6)
                : Promise.resolve(null)
        ]);

        return {
            overview: boxOverview,
            basicStats,
            risk: {
                atRiskAthletes,
                totalAtRisk: atRiskAthletes.length
            },
            wellness: wellnessInsights,
            engagement: engagementInsights,
            retention: retentionData,
            generatedAt: new Date(),
            period: {
                type: period,
                days,
                start: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
                end: new Date()
            }
        };
    }

    /**
     * Get quick health check for a box
     * Provides essential metrics for immediate assessment
     */
    static async getBoxHealthCheck(boxId: string) {
        const [
            basicStats,
            criticalAlerts,
            highRiskAthletes,
            recentActivity
        ] = await Promise.all([
            BoxAnalyticsService.getBasicBoxStatistics(boxId),
            RiskAnalyticsService.getActiveAlerts(boxId, 'high', 5),
            RiskAnalyticsService.getAtRiskAthletes(boxId, {
                riskLevel: 'critical',
                limit: 5
            }),
            EngagementAnalyticsService.getRecentActivityFeed(boxId, { limit: 10 })
        ]);

        const healthScore = this.calculateHealthScore({
            activeAthletes: basicStats.activeAthletes,
            criticalAlerts: criticalAlerts.length,
            highRiskAthletes: highRiskAthletes.length,
            avgCheckinStreak: basicStats.avgCheckinStreak
        });

        return {
            healthScore,
            status: this.getHealthStatus(healthScore),
            basicStats,
            alerts: {
                critical: criticalAlerts,
                totalCritical: criticalAlerts.length
            },
            risk: {
                highRiskAthletes,
                totalHighRisk: highRiskAthletes.length
            },
            recentActivity: recentActivity.slice(0, 5),
            recommendations: this.generateHealthRecommendations(healthScore, {
                criticalAlerts: criticalAlerts.length,
                highRiskAthletes: highRiskAthletes.length,
                avgCheckinStreak: basicStats.avgCheckinStreak
            }),
            generatedAt: new Date()
        };
    }

    /**
     * Calculate overall box health score (0-100)
     */
    private static calculateHealthScore(metrics: {
        activeAthletes: number;
        criticalAlerts: number;
        highRiskAthletes: number;
        avgCheckinStreak: number;
    }): number {
        let score = 100;

        // Deduct points for critical alerts (up to -30 points)
        score -= Math.min(metrics.criticalAlerts * 10, 30);

        // Deduct points for high-risk athletes (up to -25 points)
        if (metrics.activeAthletes > 0) {
            const riskRatio = metrics.highRiskAthletes / metrics.activeAthletes;
            score -= Math.min(riskRatio * 100, 25);
        }

        // Deduct points for low engagement (up to -20 points)
        if (metrics.avgCheckinStreak < 7) {
            score -= Math.min((7 - metrics.avgCheckinStreak) * 3, 20);
        }

        // Bonus points for high engagement
        if (metrics.avgCheckinStreak > 14) {
            score += Math.min((metrics.avgCheckinStreak - 14) * 2, 10);
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    /**
     * Get health status based on score
     */
    private static getHealthStatus(score: number): 'excellent' | 'good' | 'warning' | 'critical' {
        if (score >= 85) return 'excellent';
        if (score >= 70) return 'good';
        if (score >= 50) return 'warning';
        return 'critical';
    }

    /**
     * Generate health recommendations based on metrics
     */
    private static generateHealthRecommendations(
        score: number,
        metrics: {
            criticalAlerts: number;
            highRiskAthletes: number;
            avgCheckinStreak: number;
        }
    ): string[] {
        const recommendations: string[] = [];

        if (metrics.criticalAlerts > 0) {
            recommendations.push(`Address ${metrics.criticalAlerts} critical alerts immediately`);
        }

        if (metrics.highRiskAthletes > 0) {
            recommendations.push(`Schedule interventions for ${metrics.highRiskAthletes} high-risk athletes`);
        }

        if (metrics.avgCheckinStreak < 5) {
            recommendations.push("Focus on improving member engagement and wellness tracking");
        }

        if (score < 50) {
            recommendations.push("Consider implementing comprehensive member retention strategy");
        }

        if (recommendations.length === 0) {
            recommendations.push("Continue monitoring current metrics and maintain engagement strategies");
        }

        return recommendations;
    }

    /**
     * Export analytics data for external analysis
     */
    static async exportAnalyticsData(
        boxId: string,
        options: {
            format?: 'json' | 'csv';
            includePersonalData?: boolean;
            dateRange?: { start: Date; end: Date };
        } = {}
    ) {
        const {
            format = 'json',
            includePersonalData = false,
            dateRange = {
                start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
                end: new Date()
            }
        } = options;

        // This would compile data from various services for export
        // Implementation would depend on specific export requirements
        const exportData = {
            metadata: {
                boxId,
                exportedAt: new Date(),
                dateRange,
                includePersonalData
            },
            // Data would be aggregated from various services here
            // This is a placeholder for the actual implementation
        };

        return exportData;
    }
}
