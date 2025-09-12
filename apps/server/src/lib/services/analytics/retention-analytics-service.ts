// lib/services/analytics/retention-analytics-service.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteMilestones
} from "@/db/schema";
import {
    mvMonthlyRetention,
    vwBoxSubscriptionHealth
} from "@/db/schema/views";
import { eq, desc, and, gte, count, sql } from "drizzle-orm";

export interface RetentionData {
    boxId: string;
    cohortMonth: Date;
    cohortSize: number;
    activityMonth: Date;
    activeMembers: number;
    retentionRate: number;
    monthsSinceJoin: number;
}

export interface SubscriptionHealth {
    boxId: string;
    boxName: string;
    subscriptionStatus: string;
    subscriptionTier: string;
    trialEndsAt: Date | null;
    subscriptionEndsAt: Date | null;
    polarSubscriptionStatus: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean | null;
    activeAthletes: number;
    activeCoaches: number;
    athleteLimit: number | null;
    coachLimit: number | null;
    healthStatus: string;
}

export interface RetentionInsights {
    overview: {
        currentRetentionRate: number;
        avgRetentionRate: number;
        retentionTrend: 'improving' | 'stable' | 'declining';
        atRiskMembers: number;
        newMemberRetention: number;
    };
    cohortAnalysis: RetentionData[];
    milestones: {
        thirtyDayRetention: number;
        sixtyDayRetention: number;
        ninetyDayRetention: number;
    };
    recommendations: string[];
    period: {
        months: number;
        start: Date;
        end: Date;
    };
}

export class RetentionAnalyticsService {
    /**
     * Get monthly retention cohort analysis - Using mv_monthly_retention
     */
    static async getMonthlyRetention(
        boxId: string,
        months: number = 12
    ): Promise<RetentionData[]> {
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);

        const retentionData = await db
            .select()
            .from(mvMonthlyRetention)
            .where(and(
                eq(mvMonthlyRetention.boxId, boxId),
                gte(mvMonthlyRetention.cohortMonth, startDate)
            ))
            .orderBy(desc(mvMonthlyRetention.cohortMonth), desc(mvMonthlyRetention.activityMonth));

        // Transform the data to ensure no null values
        return retentionData.map(item => ({
            boxId: item.boxId || boxId,
            cohortMonth: item.cohortMonth || new Date(),
            cohortSize: item.cohortSize || 0,
            activityMonth: item.activityMonth || new Date(),
            activeMembers: item.activeMembers || 0,
            retentionRate: item.retentionRate ? parseFloat(item.retentionRate) : 0,
            monthsSinceJoin: item.monthsSinceJoin || 0
        }));
    }

    /**
     * Get box subscription health - Using vw_box_subscription_health
     */
    static async getBoxSubscriptionHealth(boxId: string): Promise<SubscriptionHealth | null> {
        const result = await db
            .select()
            .from(vwBoxSubscriptionHealth)
            .where(eq(vwBoxSubscriptionHealth.boxId, boxId))
            .limit(1);

        if (!result[0]) return null;

        const item = result[0];
        return {
            boxId: item.boxId || boxId,
            boxName: item.boxName || '',
            subscriptionStatus: item.subscriptionStatus || 'unknown',
            subscriptionTier: item.subscriptionTier || 'unknown',
            trialEndsAt: item.trialEndsAt,
            subscriptionEndsAt: item.subscriptionEndsAt,
            polarSubscriptionStatus: item.polarSubscriptionStatus,
            currentPeriodEnd: item.currentPeriodEnd,
            cancelAtPeriodEnd: item.cancelAtPeriodEnd,
            activeAthletes: item.activeAthletes || 0,
            activeCoaches: item.activeCoaches || 0,
            athleteLimit: item.athleteLimit,
            coachLimit: item.coachLimit,
            healthStatus: item.healthStatus || 'unknown'
        };
    }

    /**
     * Get comprehensive retention insights
     */
    static async getRetentionInsights(
        boxId: string,
        months: number = 12
    ): Promise<RetentionInsights> {
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);

        const [retentionData, currentStats, membershipStats] = await Promise.all([
            this.getMonthlyRetention(boxId, months),
            this.getCurrentRetentionStats(boxId),
            this.getMembershipStats(boxId)
        ]);

        // Calculate retention trends
        const retentionRates = retentionData
            .filter(item => item.monthsSinceJoin === 1) // First month retention
            .map(item => item.retentionRate)
            .slice(0, 6); // Last 6 months

        const avgRetentionRate = retentionRates.length > 0
            ? Math.round(retentionRates.reduce((sum, rate) => sum + rate, 0) / retentionRates.length)
            : 0;

        const retentionTrend = this.calculateRetentionTrend(retentionRates);

        // Calculate milestone retention rates
        const milestones = this.calculateMilestoneRetention(retentionData);

        // Generate recommendations
        const recommendations = this.generateRetentionRecommendations({
            currentRetentionRate: currentStats.currentRetentionRate,
            avgRetentionRate,
            retentionTrend,
            milestones,
            atRiskMembers: currentStats.atRiskMembers
        });

        return {
            overview: {
                currentRetentionRate: currentStats.currentRetentionRate,
                avgRetentionRate,
                retentionTrend,
                atRiskMembers: currentStats.atRiskMembers,
                newMemberRetention: membershipStats.newMemberRetention
            },
            cohortAnalysis: retentionData,
            milestones,
            recommendations,
            period: {
                months,
                start: startDate,
                end: new Date()
            }
        };
    }

    /**
     * Get current retention statistics
     */
    private static async getCurrentRetentionStats(boxId: string) {
        const [totalMembers, activeMembers, atRiskMembers] = await Promise.all([
            // Total members
            db.select({ count: count() })
                .from(boxMemberships)
                .where(eq(boxMemberships.boxId, boxId)),

            // Active members (checked in within last 30 days)
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    sql`${boxMemberships.lastCheckinDate} >= NOW() - INTERVAL '30 days'`
                )),

            // At-risk members (no check-in for 14+ days but still active)
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    sql`${boxMemberships.lastCheckinDate} < NOW() - INTERVAL '14 days'`
                ))
        ]);

        const currentRetentionRate = totalMembers[0]?.count > 0
            ? Math.round((activeMembers[0]?.count || 0) / totalMembers[0].count * 100)
            : 0;

        return {
            currentRetentionRate,
            atRiskMembers: atRiskMembers[0]?.count || 0
        };
    }

    /**
     * Get membership statistics
     */
    private static async getMembershipStats(boxId: string) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const [newMembers, activeNewMembers] = await Promise.all([
            // New members in last 30 days
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    gte(boxMemberships.joinedAt, thirtyDaysAgo)
                )),

            // New members who are still active
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    gte(boxMemberships.joinedAt, thirtyDaysAgo)
                ))
        ]);

        const newMemberRetention = newMembers[0]?.count > 0
            ? Math.round((activeNewMembers[0]?.count || 0) / newMembers[0].count * 100)
            : 100;

        return { newMemberRetention };
    }

    /**
     * Calculate retention trend
     */
    private static calculateRetentionTrend(retentionRates: number[]): 'improving' | 'stable' | 'declining' {
        if (retentionRates.length < 3) return 'stable';

        const recent = retentionRates.slice(0, 2).reduce((sum, rate) => sum + rate, 0) / 2;
        const older = retentionRates.slice(-2).reduce((sum, rate) => sum + rate, 0) / 2;

        const change = ((recent - older) / older) * 100;

        if (change > 5) return 'improving';
        if (change < -5) return 'declining';
        return 'stable';
    }

    /**
     * Calculate milestone retention rates
     */
    private static calculateMilestoneRetention(retentionData: RetentionData[]) {
        const thirtyDayData = retentionData.filter(item => item.monthsSinceJoin === 1);
        const sixtyDayData = retentionData.filter(item => item.monthsSinceJoin === 2);
        const ninetyDayData = retentionData.filter(item => item.monthsSinceJoin === 3);

        const thirtyDayRetention = thirtyDayData.length > 0
            ? Math.round(thirtyDayData.reduce((sum, item) => sum + item.retentionRate, 0) / thirtyDayData.length)
            : 0;

        const sixtyDayRetention = sixtyDayData.length > 0
            ? Math.round(sixtyDayData.reduce((sum, item) => sum + item.retentionRate, 0) / sixtyDayData.length)
            : 0;

        const ninetyDayRetention = ninetyDayData.length > 0
            ? Math.round(ninetyDayData.reduce((sum, item) => sum + item.retentionRate, 0) / ninetyDayData.length)
            : 0;

        return {
            thirtyDayRetention,
            sixtyDayRetention,
            ninetyDayRetention
        };
    }

    /**
     * Generate retention recommendations
     */
    private static generateRetentionRecommendations(data: {
        currentRetentionRate: number;
        avgRetentionRate: number;
        retentionTrend: 'improving' | 'stable' | 'declining';
        milestones: { thirtyDayRetention: number; sixtyDayRetention: number; ninetyDayRetention: number };
        atRiskMembers: number;
    }): string[] {
        const recommendations: string[] = [];

        // Current retention rate recommendations
        if (data.currentRetentionRate < 70) {
            recommendations.push("URGENT: Current retention rate is critically low. Implement immediate intervention strategies.");
        } else if (data.currentRetentionRate < 80) {
            recommendations.push("Focus on member engagement and satisfaction initiatives to improve retention.");
        }

        // Trend-based recommendations
        if (data.retentionTrend === 'declining') {
            recommendations.push("Retention is declining. Analyze recent changes and implement corrective measures.");
            recommendations.push("Increase coaching touchpoints and member check-ins.");
        } else if (data.retentionTrend === 'improving') {
            recommendations.push("Retention is improving. Document successful strategies for continued implementation.");
        }

        // Milestone-based recommendations
        if (data.milestones.thirtyDayRetention < 80) {
            recommendations.push("Enhance new member onboarding program to improve 30-day retention.");
            recommendations.push("Assign mentors or training partners to new members.");
        }

        if (data.milestones.ninetyDayRetention < 70) {
            recommendations.push("Develop 90-day milestone celebrations and goal-setting sessions.");
            recommendations.push("Create progressive training programs with clear achievement markers.");
        }

        // At-risk member recommendations
        if (data.atRiskMembers > 0) {
            recommendations.push(`${data.atRiskMembers} members are at risk. Schedule wellness check-ins immediately.`);
            recommendations.push("Implement automated alerts for members with declining engagement.");
        }

        // General best practices
        if (recommendations.length === 0) {
            recommendations.push("Maintain current retention strategies while monitoring for any changes.");
            recommendations.push("Consider implementing member loyalty programs or milestone rewards.");
        }

        return recommendations;
    }

    /**
     * Get athlete milestones and celebrations
     */
    static async getAthleteMilestones(
        boxId: string,
        options: {
            membershipId?: string;
            milestoneType?: string;
            limit?: number;
        } = {}
    ) {
        const { membershipId, milestoneType, limit = 10 } = options;

        const conditions = [eq(athleteMilestones.boxId, boxId)];

        if (membershipId) {
            conditions.push(eq(athleteMilestones.membershipId, membershipId));
        }

        if (milestoneType) {
            conditions.push(eq(athleteMilestones.milestoneType, milestoneType));
        }

        return db
            .select()
            .from(athleteMilestones)
            .where(and(...conditions))
            .orderBy(desc(athleteMilestones.achievedAt))
            .limit(limit);
    }

    /**
     * Calculate member lifetime value (LTV) estimates
     */
    static async calculateMemberLTV(boxId: string, membershipId?: string) {
        const conditions = [eq(boxMemberships.boxId, boxId)];

        if (membershipId) {
            conditions.push(eq(boxMemberships.id, membershipId));
        }

        const membershipData = await db
            .select({
                membershipId: boxMemberships.id,
                joinedAt: boxMemberships.joinedAt,
                isActive: boxMemberships.isActive,
                totalCheckins: boxMemberships.totalCheckins,
                checkinStreak: boxMemberships.checkinStreak,
                lastCheckinDate: boxMemberships.lastCheckinDate
            })
            .from(boxMemberships)
            .where(and(...conditions));

        return membershipData.map(member => {
            const membershipDays = Math.floor(
                (new Date().getTime() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24)
            );

            const avgCheckinsPerDay = membershipDays > 0
                ? (member.totalCheckins || 0) / membershipDays
                : 0;

            // Simple LTV calculation based on engagement patterns
            // This would be enhanced with actual pricing data in a real implementation
            const estimatedMonthlyValue = 150; // Average gym membership
            const engagementMultiplier = Math.min(avgCheckinsPerDay * 2, 1.5); // Engaged members worth more
            const loyaltyBonus = member.checkinStreak > 30 ? 1.2 : 1.0;

            const monthlyLTV = estimatedMonthlyValue * engagementMultiplier * loyaltyBonus;
            const estimatedLifespanMonths = this.estimateLifespan(avgCheckinsPerDay, membershipDays);

            return {
                membershipId: member.membershipId,
                membershipDays,
                avgCheckinsPerDay: Math.round(avgCheckinsPerDay * 1000) / 1000,
                estimatedMonthlyValue: Math.round(monthlyLTV),
                estimatedLifespanMonths,
                totalLTV: Math.round(monthlyLTV * estimatedLifespanMonths),
                riskLevel: this.calculateChurnRisk(avgCheckinsPerDay, member.checkinStreak, member.lastCheckinDate)
            };
        });
    }

    /**
     * Estimate member lifespan based on engagement patterns
     */
    private static estimateLifespan(avgCheckinsPerDay: number, membershipDays: number): number {
        // Base lifespan estimates based on engagement levels
        let baseMonths = 12; // Default estimate

        if (avgCheckinsPerDay > 0.5) baseMonths = 24; // Very engaged
        else if (avgCheckinsPerDay > 0.3) baseMonths = 18; // Moderately engaged
        else if (avgCheckinsPerDay > 0.1) baseMonths = 12; // Low engagement
        else baseMonths = 6; // Very low engagement

        // Adjust based on current tenure
        const currentMonths = membershipDays / 30;
        if (currentMonths > 6) {
            baseMonths *= 1.3; // Longevity bonus
        }

        return Math.round(baseMonths);
    }

    /**
     * Calculate churn risk level
     */
    private static calculateChurnRisk(
        avgCheckinsPerDay: number,
        checkinStreak: number,
        lastCheckinDate: Date | null
    ): 'low' | 'medium' | 'high' | 'critical' {
        if (!lastCheckinDate) return 'critical';

        const daysSinceLastCheckin = Math.floor(
            (new Date().getTime() - lastCheckinDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceLastCheckin > 14) return 'critical';
        if (daysSinceLastCheckin > 7) return 'high';
        if (avgCheckinsPerDay < 0.2) return 'medium';
        if (checkinStreak < 7) return 'medium';

        return 'low';
    }
}
