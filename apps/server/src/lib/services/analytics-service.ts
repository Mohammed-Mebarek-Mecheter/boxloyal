// lib/services/analytics-service.ts
import { db } from "@/db";
import {
    athleteRiskScores,
    athleteAlerts,
    athleteInterventions,
    boxAnalytics,
    athleteMilestones,
    athletePrs,
    athleteWellnessCheckins,
    boxMemberships,
    athleteBenchmarks,
    user, userProfiles, wodFeedback, wodAttendance, orders
} from "@/db/schema";
import {
    mvBoxHealthDashboard,
    vwAthleteRiskOverview,
    mvCoachPerformance,
    mvAthleteEngagementScores,
    vwWellnessPerformanceCorrelation,
    mvMonthlyRetention,
    mvAthleteProgress,
    vwBoxSubscriptionHealth,
    mvWellnessTrends
} from "@/db/schema/views";
import {eq, desc, and, gte, count, sql, inArray, avg, sum, lte} from "drizzle-orm";
import type {RiskIndicators} from "@/lib/services/athlete/athlete-service";

// Types for better type safety
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AnalyticsPeriod = "daily" | "weekly" | "monthly";

export interface BoxHealthMetrics {
    riskDistribution: Array<{ riskLevel: string; count: number }>;
    alertStats: Array<{ alertType: string; status: string; count: number }>;
    interventionStats: Array<{ interventionType: string; outcome: string | null; count: number }>;
    wellnessTrends: {
        avgEnergy: number | null;
        avgSleep: number | null;
        avgStress: number | null;
    };
    attendanceTrends: {
        totalCheckins: number;
        uniqueAthletes: number;
    };
    performanceTrends: {
        totalPrs: number;
        avgImprovement: number | null;
    };
}

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

export interface WellnessTrend {
    boxId: string;
    membershipId: string;
    weekStart: Date;
    avgEnergy: number;
    avgSleep: number;
    avgStress: number;
    avgMotivation: number;
    avgReadiness: number;
    checkinCount: number;
}

export class AnalyticsService {
    /**
     * Calculate athlete retention risk score (core SaaS value)
     */
    static async calculateRetentionRisk(
        boxId: string,
        athleteId: string,
        options: {
            lookbackDays?: number;
            includeRecommendations?: boolean;
        } = {}
    ): Promise<RiskIndicators> {
        const { lookbackDays = 30, includeRecommendations = true } = options;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - lookbackDays);

        // Fetch comprehensive athlete data for analysis
        const [
            membership,
            recentCheckins,
            recentWods,
            recentAttendance,
            wellnessAvg,
            performanceData
        ] = await Promise.all([
            db.select()
                .from(boxMemberships)
                .where(eq(boxMemberships.id, athleteId))
                .limit(1),

            db.select({ count: count() })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.membershipId, athleteId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),

            db.select({
                count: count(),
                avgRpe: avg(wodFeedback.rpe),
                avgDifficulty: avg(wodFeedback.difficultyRating),
                avgEnjoyment: avg(wodFeedback.enjoymentRating)
            })
                .from(wodFeedback)
                .where(and(
                    eq(wodFeedback.membershipId, athleteId),
                    gte(wodFeedback.wodDate, startDate)
                )),

            db.select({
                attended: sql<number>`COUNT(*) FILTER (WHERE ${wodAttendance.status} = 'attended')`,
                total: count()
            })
                .from(wodAttendance)
                .where(and(
                    eq(wodAttendance.membershipId, athleteId),
                    gte(wodAttendance.attendanceDate, sql`${startDate}::date`)
                )),

            db.select({
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
            })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.membershipId, athleteId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),

            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.membershipId, athleteId),
                    gte(athletePrs.achievedAt, startDate)
                ))
        ]);

        if (!membership.length) {
            throw new Error("Athlete membership not found");
        }

        const member = membership[0];
        const riskFactors: RiskIndicators['riskFactors'] = [];
        let riskScore = 0;

        // Analyze check-in frequency (20% weight)
        const checkinRate = recentCheckins[0].count / lookbackDays;
        if (checkinRate < 0.3) {
            riskFactors.push({
                type: 'low_checkin_frequency',
                severity: checkinRate < 0.1 ? 'critical' : 'high',
                description: `Only ${(checkinRate * 100).toFixed(0)}% check-in rate in last ${lookbackDays} days`,
                value: checkinRate,
                trend: 'declining'
            });
            riskScore += checkinRate < 0.1 ? 25 : 15;
        }

        // Analyze attendance (25% weight)
        const attendanceRate = recentAttendance[0].total > 0
            ? recentAttendance[0].attended / recentAttendance[0].total
            : 0;

        if (attendanceRate < 0.5) {
            riskFactors.push({
                type: 'poor_attendance',
                severity: attendanceRate < 0.3 ? 'critical' : 'high',
                description: `Only ${(attendanceRate * 100).toFixed(0)}% attendance rate`,
                value: attendanceRate,
                trend: 'declining'
            });
            riskScore += attendanceRate < 0.3 ? 30 : 20;
        }

        // Analyze wellness trends (20% weight)
        if (wellnessAvg[0].avgEnergy && Number(wellnessAvg[0].avgEnergy) < 5) {
            riskFactors.push({
                type: 'low_energy_wellness',
                severity: Number(wellnessAvg[0].avgEnergy) < 3 ? 'critical' : 'medium',
                description: `Average energy level: ${Number(wellnessAvg[0].avgEnergy).toFixed(1)}/10`,
                value: Number(wellnessAvg[0].avgEnergy),
                trend: 'declining'
            });
            riskScore += Number(wellnessAvg[0].avgEnergy) < 3 ? 25 : 15;
        }

        // Analyze stress levels
        if (wellnessAvg[0].avgStress && Number(wellnessAvg[0].avgStress) > 7) {
            riskFactors.push({
                type: 'high_stress_levels',
                severity: Number(wellnessAvg[0].avgStress) > 8 ? 'high' : 'medium',
                description: `Average stress level: ${Number(wellnessAvg[0].avgStress).toFixed(1)}/10`,
                value: Number(wellnessAvg[0].avgStress),
                trend: 'stable'
            });
            riskScore += Number(wellnessAvg[0].avgStress) > 8 ? 15 : 10;
        }

        // Analyze performance stagnation (15% weight)
        if (performanceData[0].count === 0) {
            riskFactors.push({
                type: 'no_recent_prs',
                severity: 'medium',
                description: `No PRs achieved in last ${lookbackDays} days`,
                value: 0,
                trend: 'declining'
            });
            riskScore += 10;
        }

        // Analyze workout feedback (10% weight)
        if (recentWods[0].avgEnjoyment && Number(recentWods[0].avgEnjoyment) < 6) {
            riskFactors.push({
                type: 'low_workout_enjoyment',
                severity: Number(recentWods[0].avgEnjoyment) < 4 ? 'high' : 'medium',
                description: `Average workout enjoyment: ${Number(recentWods[0].avgEnjoyment).toFixed(1)}/10`,
                value: Number(recentWods[0].avgEnjoyment),
                trend: 'declining'
            });
            riskScore += Number(recentWods[0].avgEnjoyment) < 4 ? 15 : 8;
        }

        // Analyze membership tenure (10% weight)
        const membershipDays = Math.floor((new Date().getTime() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (membershipDays < 90) {
            riskFactors.push({
                type: 'new_member_risk',
                severity: 'medium',
                description: `New member (${membershipDays} days)`,
                value: membershipDays,
                trend: 'stable'
            });
            riskScore += 10;
        }

        // Cap risk score at 100
        riskScore = Math.min(riskScore, 100);

        const recommendations: string[] = [];

        if (includeRecommendations) {
            // Generate personalized recommendations based on risk factors
            if (riskFactors.some(f => f.type === 'low_checkin_frequency')) {
                recommendations.push("Schedule a check-in conversation to understand barriers to daily engagement");
            }

            if (riskFactors.some(f => f.type === 'poor_attendance')) {
                recommendations.push("Review class schedule preferences and potential scheduling conflicts");
            }

            if (riskFactors.some(f => f.type === 'low_energy_wellness')) {
                recommendations.push("Discuss sleep habits and recovery strategies");
            }

            if (riskFactors.some(f => f.type === 'high_stress_levels')) {
                recommendations.push("Consider stress management techniques and workout scaling");
            }

            if (riskFactors.some(f => f.type === 'no_recent_prs')) {
                recommendations.push("Review goals and create achievable PR targets");
            }

            if (riskFactors.some(f => f.type === 'low_workout_enjoyment')) {
                recommendations.push("Explore workout modifications and movement preferences");
            }

            if (riskFactors.some(f => f.type === 'new_member_risk')) {
                recommendations.push("Increase coaching touchpoints and community integration activities");
            }

            // Add general recommendations based on risk level
            if (riskScore > 70) {
                recommendations.push("URGENT: Schedule immediate one-on-one coaching session");
                recommendations.push("Consider temporary training program adjustment");
            } else if (riskScore > 40) {
                recommendations.push("Schedule check-in within next week");
                recommendations.push("Monitor progress closely over next 2 weeks");
            }
        }

        return {
            membershipId: athleteId,
            riskScore,
            riskFactors,
            recommendations,
            lastUpdated: new Date()
        };
    }

    /**
     * Get athletes at risk of churning (core SaaS dashboard feature)
     */
    static async calculateAtRiskAthletes(
        boxId: string,
        options: {
            riskThreshold?: number;
            limit?: number;
            sortBy?: 'risk_score' | 'last_checkin' | 'attendance_rate';
            includeLowRisk?: boolean;
        } = {}
    ) {
        const {
            riskThreshold = 40,
            limit = 50,
            sortBy = 'risk_score',
            includeLowRisk = false
        } = options;

        // Get all active memberships for the box
        const memberships = await db
            .select()
            .from(boxMemberships)
            .where(
                and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                )
            )
            .limit(limit);

        // Calculate risk scores for each athlete
        const athleteRisks = await Promise.all(
            memberships.map(async (membership) => {
                const riskData = await this.calculateRetentionRisk(boxId, membership.id);
                return {
                    membership,
                    ...riskData
                };
            })
        );

        // Filter based on risk threshold
        const filteredAthletes = includeLowRisk
            ? athleteRisks
            : athleteRisks.filter(athlete => athlete.riskScore >= riskThreshold);

        // Sort based on specified criteria
        filteredAthletes.sort((a, b) => {
            switch (sortBy) {
                case 'risk_score':
                    return b.riskScore - a.riskScore;
                case 'last_checkin':
                    return (a.membership.lastCheckinDate?.getTime() || 0) -
                        (b.membership.lastCheckinDate?.getTime() || 0);
                case 'attendance_rate':
                    // This would require additional attendance calculation
                    return b.riskScore - a.riskScore; // Fallback to risk score
                default:
                    return b.riskScore - a.riskScore;
            }
        });

        return filteredAthletes;
    }

    /**
     * Get at-risk athletes for a box - Using vw_athlete_risk_overview (uses materialized view)
     */
    static async getAtRiskAthletes(
        boxId: string,
        riskLevel?: RiskLevel,
        limit: number = 20
    ) {
        const conditions = [eq(vwAthleteRiskOverview.boxId, boxId)];

        if (riskLevel) {
            conditions.push(eq(vwAthleteRiskOverview.riskLevel, riskLevel));
        }

        return db
            .select()
            .from(vwAthleteRiskOverview)
            .where(and(...conditions))
            .orderBy(desc(vwAthleteRiskOverview.overallRiskScore))
            .limit(limit);
    }

    /**
     * Get box analytics snapshots (pre-computed snapshots)
     */
    static async getBoxAnalyticsSnapshots(
        boxId: string,
        period: AnalyticsPeriod = "weekly",
        limit: number = 12
    ) {
        return db
            .select()
            .from(boxAnalytics)
            .where(and(
                eq(boxAnalytics.boxId, boxId),
                eq(boxAnalytics.period, period)
            ))
            .orderBy(desc(boxAnalytics.periodStart))
            .limit(limit);
    }

    /**
     * Get comprehensive box analytics (owner dashboard)
     */
    static async getBoxAnalytics(
        boxId: string,
        options: {
            period?: 'week' | 'month' | 'quarter' | 'year';
            includeComparisons?: boolean;
        } = {}
    ) {
        const { period = 'month', includeComparisons = true } = options;

        const daysMap = {
            week: 7,
            month: 30,
            quarter: 90,
            year: 365
        };

        const days = daysMap[period];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [
            totalAthletes,
            activeAthletes,
            avgWellness,
            retentionMetrics,
            performanceMetrics
        ] = await Promise.all([
            db.select({ count: count() })
                .from(boxMemberships)
                .where(eq(boxMemberships.boxId, boxId)),

            db.select({ count: count() })
                .from(boxMemberships)
                .where(
                    and(
                        eq(boxMemberships.boxId, boxId),
                        eq(boxMemberships.isActive, true),
                        gte(boxMemberships.lastCheckinDate || sql`'1970-01-01'::timestamp`, startDate)
                    )
                ),

            db.select({
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness),
                totalCheckins: count()
            })
                .from(athleteWellnessCheckins)
                .where(
                    and(
                        eq(athleteWellnessCheckins.boxId, boxId),
                        gte(athleteWellnessCheckins.checkinDate, startDate)
                    )
                ),

            db.select({
                checkinStreak: avg(boxMemberships.checkinStreak),
                avgTotalCheckins: avg(boxMemberships.totalCheckins)
            })
                .from(boxMemberships)
                .where(
                    and(
                        eq(boxMemberships.boxId, boxId),
                        eq(boxMemberships.isActive, true)
                    )
                ),

            Promise.all([
                db.select({ count: count() })
                    .from(athletePrs)
                    .where(
                        and(
                            eq(athletePrs.boxId, boxId),
                            gte(athletePrs.achievedAt, startDate)
                        )
                    ),
                db.select({ count: count() })
                    .from(athleteBenchmarks)
                    .where(
                        and(
                            eq(athleteBenchmarks.boxId, boxId),
                            gte(athleteBenchmarks.achievedAt, startDate)
                        )
                    )
            ])
        ]);

        const [totalPrs, totalBenchmarks] = performanceMetrics;

        return {
            period,
            summary: {
                totalAthletes: totalAthletes[0].count,
                activeAthletes: activeAthletes[0].count,
                retentionRate: totalAthletes[0].count > 0
                    ? Math.round((activeAthletes[0].count / totalAthletes[0].count) * 100)
                    : 0,
                avgCheckinStreak: Math.round(Number(retentionMetrics[0].checkinStreak || 0)),
            },
            wellness: {
                avgEnergyLevel: Math.round(Number(avgWellness[0].avgEnergy || 0) * 10) / 10,
                avgStressLevel: Math.round(Number(avgWellness[0].avgStress || 0) * 10) / 10,
                avgWorkoutReadiness: Math.round(Number(avgWellness[0].avgReadiness || 0) * 10) / 10,
                totalCheckins: avgWellness[0].totalCheckins,
                checkinRate: totalAthletes[0].count > 0
                    ? Math.round((avgWellness[0].totalCheckins / (totalAthletes[0].count * days)) * 100)
                    : 0
            },
            performance: {
                totalPrs: totalPrs[0].count,
                totalBenchmarks: totalBenchmarks[0].count,
                avgPrsPerAthlete: activeAthletes[0].count > 0
                    ? Math.round((totalPrs[0].count / activeAthletes[0].count) * 10) / 10
                    : 0
            },
            generatedAt: new Date()
        };
    }

    /**
     * Get active alerts for a box
     */
    static async getActiveAlerts(
        boxId: string,
        severity?: AlertSeverity,
        limit: number = 20
    ) {
        let whereConditions = and(
            eq(athleteAlerts.boxId, boxId),
            eq(athleteAlerts.status, "active")
        );

        if (severity) {
            whereConditions = and(whereConditions, eq(athleteAlerts.severity, severity));
        }

        return db
            .select()
            .from(athleteAlerts)
            .where(whereConditions)
            .orderBy(desc(athleteAlerts.createdAt))
            .limit(limit);
    }

    /**
     * Get athlete risk score history
     */
    static async getAthleteRiskHistory(
        boxId: string,
        membershipId: string,
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return db
            .select()
            .from(athleteRiskScores)
            .where(and(
                eq(athleteRiskScores.boxId, boxId),
                eq(athleteRiskScores.membershipId, membershipId),
                gte(athleteRiskScores.calculatedAt, startDate)
            ))
            .orderBy(desc(athleteRiskScores.calculatedAt));
    }

    /**
     * Get intervention history for an athlete
     */
    static async getAthleteInterventions(
        boxId: string,
        membershipId: string,
        limit: number = 10
    ) {
        return db
            .select()
            .from(athleteInterventions)
            .where(and(
                eq(athleteInterventions.boxId, boxId),
                eq(athleteInterventions.membershipId, membershipId)
            ))
            .orderBy(desc(athleteInterventions.interventionDate))
            .limit(limit);
    }

    /**
     * Get detailed athlete information with risk scores - Using vw_athlete_risk_overview
     */
    static async getAthletesWithRiskScores(
        boxId: string,
        riskLevel?: RiskLevel,
        limit: number = 50
    ) {
        const conditions = [eq(vwAthleteRiskOverview.boxId, boxId)];

        if (riskLevel) {
            conditions.push(eq(vwAthleteRiskOverview.riskLevel, riskLevel));
        }

        return db
            .select()
            .from(vwAthleteRiskOverview)
            .where(and(...conditions))
            .orderBy(desc(vwAthleteRiskOverview.overallRiskScore))
            .limit(limit);
    }

    /**
     * Get athlete engagement leaderboard for a box - Using mv_athlete_engagement_scores
     */
    static async getEngagementLeaderboard(
        boxId: string,
        days: number = 30,
        limit: number = 20
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return db
            .select()
            .from(mvAthleteEngagementScores)
            .where(and(
                eq(mvAthleteEngagementScores.boxId, boxId),
                gte(mvAthleteEngagementScores.calculatedAt, startDate)
            ))
            .orderBy(desc(mvAthleteEngagementScores.engagementScore))
            .limit(limit);
    }

    /**
     * Get coach information for a box
     */
    static async getBoxCoaches(boxId: string) {
        return db
            .select({
                membership: boxMemberships,
                user: user,
                profile: userProfiles,
            })
            .from(boxMemberships)
            .innerJoin(user, eq(boxMemberships.userId, user.id))
            .leftJoin(userProfiles, eq(user.id, userProfiles.userId))
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                inArray(boxMemberships.role, ['head_coach', 'coach'])
            ));
    }

    /**
     * Get coach performance metrics - Using mv_coach_performance
     */
    static async getCoachPerformance(boxId: string) {
        return db
            .select()
            .from(mvCoachPerformance)
            .where(eq(mvCoachPerformance.boxId, boxId))
            .orderBy(desc(mvCoachPerformance.interventionsCompleted));
    }

    /**
     * Log a coach intervention
     */
    static async logIntervention(params: {
        boxId: string;
        membershipId: string;
        coachId: string;
        alertId?: string;
        interventionType: string;
        title: string;
        description: string;
        outcome?: string;
        athleteResponse?: string;
        coachNotes?: string;
        followUpRequired?: boolean;
        followUpAt?: Date;
    }) {
        const [intervention] = await db
            .insert(athleteInterventions)
            .values({
                ...params,
                interventionDate: new Date(),
            })
            .returning();

        // If there's an associated alert, mark it as resolved
        if (params.alertId) {
            await db
                .update(athleteAlerts)
                .set({
                    status: "resolved",
                    resolvedAt: new Date(),
                    resolvedById: params.coachId,
                    resolutionNotes: `Resolved via intervention: ${params.interventionType}`,
                })
                .where(eq(athleteAlerts.id, params.alertId));
        }

        return intervention;
    }

    /**
     * Get athlete milestones and celebrations
     */
    static async getAthleteMilestones(
        boxId: string,
        membershipId?: string,
        milestoneType?: string,
        limit: number = 10
    ) {
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
     * Get comprehensive box health dashboard - Using mv_box_health_dashboard
     */
    static async getBoxHealthDashboard(
        boxId: string,
        days: number = 30
    ): Promise<BoxHealthMetrics & { dateRange: { start: Date; end: Date } }> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get the latest dashboard data
        const dashboardData = await db
            .select()
            .from(mvBoxHealthDashboard)
            .where(and(
                eq(mvBoxHealthDashboard.boxId, boxId),
                gte(mvBoxHealthDashboard.periodStart, startDate)
            ))
            .orderBy(desc(mvBoxHealthDashboard.periodStart))
            .limit(1);

        if (!dashboardData[0]) {
            // Return empty metrics if no data found
            return {
                riskDistribution: [],
                alertStats: [],
                interventionStats: [],
                wellnessTrends: { avgEnergy: null, avgSleep: null, avgStress: null },
                attendanceTrends: { totalCheckins: 0, uniqueAthletes: 0 },
                performanceTrends: { totalPrs: 0, avgImprovement: null },
                dateRange: { start: startDate, end: new Date() }
            };
        }

        const data = dashboardData[0];

        // Get additional stats that aren't in the materialized view
        const [riskDistribution, alertStats, interventionStats] = await Promise.all([
            // Risk distribution
            db
                .select({
                    riskLevel: athleteRiskScores.riskLevel,
                    count: count()
                })
                .from(athleteRiskScores)
                .where(and(
                    eq(athleteRiskScores.boxId, boxId),
                    gte(athleteRiskScores.calculatedAt, startDate)
                ))
                .groupBy(athleteRiskScores.riskLevel),

            // Alert statistics
            db
                .select({
                    alertType: athleteAlerts.alertType,
                    status: athleteAlerts.status,
                    count: count()
                })
                .from(athleteAlerts)
                .where(and(
                    eq(athleteAlerts.boxId, boxId),
                    gte(athleteAlerts.createdAt, startDate)
                ))
                .groupBy(athleteAlerts.alertType, athleteAlerts.status),

            // Intervention statistics - Filter out null outcomes
            db
                .select({
                    interventionType: athleteInterventions.interventionType,
                    outcome: athleteInterventions.outcome,
                    count: count()
                })
                .from(athleteInterventions)
                .where(and(
                    eq(athleteInterventions.boxId, boxId),
                    gte(athleteInterventions.interventionDate, startDate),
                    sql`${athleteInterventions.outcome} IS NOT NULL`
                ))
                .groupBy(athleteInterventions.interventionType, athleteInterventions.outcome),
        ]);

        return {
            riskDistribution,
            alertStats,
            interventionStats,
            wellnessTrends: {
                avgEnergy: data.avgEnergy ? parseFloat(data.avgEnergy) : null,
                avgSleep: data.avgSleep ? parseFloat(data.avgSleep) : null,
                avgStress: data.avgStress ? parseFloat(data.avgStress) : null,
            },
            attendanceTrends: {
                totalCheckins: data.totalCheckins || 0,
                uniqueAthletes: data.uniqueAthletes || 0,
            },
            performanceTrends: {
                totalPrs: data.totalPrs || 0,
                avgImprovement: data.avgImprovement ? parseFloat(data.avgImprovement) : null,
            },
            dateRange: {
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Calculate athlete engagement score - Using mv_athlete_engagement_scores
     */
    static async calculateAthleteEngagementScore(
        boxId: string,
        membershipId: string,
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get engagement data from materialized view
        const engagementData = await db
            .select()
            .from(mvAthleteEngagementScores)
            .where(and(
                eq(mvAthleteEngagementScores.boxId, boxId),
                eq(mvAthleteEngagementScores.membershipId, membershipId),
                gte(mvAthleteEngagementScores.calculatedAt, startDate)
            ))
            .orderBy(desc(mvAthleteEngagementScores.calculatedAt))
            .limit(1);

        if (!engagementData[0]) {
            return {
                score: 0,
                metrics: { checkins: 0, prs: 0, attendance: 0, benchmarks: 0 },
                breakdown: { checkinScore: 0, prScore: 0, attendanceScore: 0, benchmarkScore: 0 },
                period: { days, start: startDate, end: new Date() }
            };
        }

        const data = engagementData[0];

        // Provide default values for potentially null fields
        const checkinCount = data.checkinCount || 0;
        const prCount = data.prCount || 0;
        const attendanceCount = data.attendanceCount || 0;
        const benchmarkCount = data.benchmarkCount || 0;
        const engagementScore = data.engagementScore || 0;

        return {
            score: engagementScore,
            metrics: {
                checkins: checkinCount,
                prs: prCount,
                attendance: attendanceCount,
                benchmarks: benchmarkCount,
            },
            breakdown: {
                checkinScore: Math.round((checkinCount / days) * 30),
                prScore: Math.round(Math.min(prCount / 5, 1) * 25),
                attendanceScore: Math.round((attendanceCount / days) * 35),
                benchmarkScore: Math.round(Math.min(benchmarkCount / 3, 1) * 10),
            },
            period: {
                days,
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Get correlation between wellness and performance - Using vw_wellness_performance_correlation
     */
    static async getWellnessPerformanceCorrelation(
        boxId: string,
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const correlationData = await db
            .select()
            .from(vwWellnessPerformanceCorrelation)
            .where(and(
                eq(vwWellnessPerformanceCorrelation.boxId, boxId)
            ));

        // Handle potential null values
        const energyCorrelation = correlationData[0]?.energyPrCorrelation ?
            parseFloat(correlationData[0].energyPrCorrelation) : 0;
        const sleepCorrelation = correlationData[0]?.sleepPrCorrelation ?
            parseFloat(correlationData[0].sleepPrCorrelation) : 0;
        const stressCorrelation = correlationData[0]?.stressPrCorrelation ?
            parseFloat(correlationData[0].stressPrCorrelation) : 0;
        const dataPoints = correlationData[0]?.dataPoints || 0;

        return {
            energyCorrelation,
            sleepCorrelation,
            stressCorrelation,
            sampleSize: dataPoints,
            period: {
                days,
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Calculate simple Pearson correlation coefficient
     */
    private static calculateSimpleCorrelation(x: number[], y: number[]): number {
        if (x.length !== y.length || x.length === 0) return 0;

        const xMean = x.reduce((a, b) => a + b, 0) / x.length;
        const yMean = y.reduce((a, b) => a + b, 0) / y.length;

        let numerator = 0;
        let denominatorX = 0;
        let denominatorY = 0;

        for (let i = 0; i < x.length; i++) {
            numerator += (x[i] - xMean) * (y[i] - yMean);
            denominatorX += Math.pow(x[i] - xMean, 2);
            denominatorY += Math.pow(y[i] - yMean, 2);
        }

        return numerator / Math.sqrt(denominatorX * denominatorY);
    }

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
     * Get athlete progress timeline - Using mv_athlete_progress
     */
    static async getAthleteProgressTimeline(
        boxId: string,
        membershipId: string,
        limit: number = 50
    ) {
        return db
            .select()
            .from(mvAthleteProgress)
            .where(and(
                eq(mvAthleteProgress.boxId, boxId),
                eq(mvAthleteProgress.membershipId, membershipId)
            ))
            .orderBy(desc(mvAthleteProgress.eventDate))
            .limit(limit);
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
     * Get wellness trends over time - Using mv_wellness_trends
     */
    static async getWellnessTrends(
        boxId: string,
        membershipId: string,
        weeks: number = 12
    ): Promise<WellnessTrend[]> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (weeks * 7));

        const wellnessData = await db
            .select()
            .from(mvWellnessTrends)
            .where(and(
                eq(mvWellnessTrends.boxId, boxId),
                eq(mvWellnessTrends.membershipId, membershipId),
                gte(mvWellnessTrends.weekStart, startDate)
            ))
            .orderBy(desc(mvWellnessTrends.weekStart));

        // Transform the data to ensure no null values
        return wellnessData.map(item => ({
            boxId: item.boxId || boxId,
            membershipId: item.membershipId || membershipId,
            weekStart: item.weekStart || new Date(),
            avgEnergy: item.avgEnergy ? parseFloat(item.avgEnergy) : 0,
            avgSleep: item.avgSleep ? parseFloat(item.avgSleep) : 0,
            avgStress: item.avgStress ? parseFloat(item.avgStress) : 0,
            avgMotivation: item.avgMotivation ? parseFloat(item.avgMotivation) : 0,
            avgReadiness: item.avgReadiness ? parseFloat(item.avgReadiness) : 0,
            checkinCount: item.totalCheckins || 0
        }));
    }

    /**
     * Get recent activity feed (simple query - no view needed)
     */
    static async getRecentActivityFeed(
        boxId: string,
        limit: number = 50
    ) {
        const prs = await db
            .select({
                type: sql`'pr'`.as('type'),
                date: athletePrs.achievedAt,
                membershipId: athletePrs.membershipId,
                boxId: athletePrs.boxId,
                description: sql`'PR Set'`.as('description')
            })
            .from(athletePrs)
            .where(eq(athletePrs.boxId, boxId))
            .orderBy(desc(athletePrs.achievedAt))
            .limit(limit);

        const benchmarks = await db
            .select({
                type: sql`'benchmark'`.as('type'),
                date: athleteBenchmarks.updatedAt,
                membershipId: athleteBenchmarks.membershipId,
                boxId: athleteBenchmarks.boxId,
                description: sql`'Benchmark Completed'`.as('description')
            })
            .from(athleteBenchmarks)
            .where(eq(athleteBenchmarks.boxId, boxId))
            .orderBy(desc(athleteBenchmarks.updatedAt))
            .limit(limit);

        const checkins = await db
            .select({
                type: sql`'checkin'`.as('type'),
                date: athleteWellnessCheckins.checkinDate,
                membershipId: athleteWellnessCheckins.membershipId,
                boxId: athleteWellnessCheckins.boxId,
                description: sql`'Wellness Checkin'`.as('description')
            })
            .from(athleteWellnessCheckins)
            .where(eq(athleteWellnessCheckins.boxId, boxId))
            .orderBy(desc(athleteWellnessCheckins.checkinDate))
            .limit(limit);

        // Combine and sort all activities
        const allActivities = [...prs, ...benchmarks, ...checkins];
        allActivities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return allActivities.slice(0, limit);
    }

    /**
     * Get basic box statistics (simple query - no view needed)
     */
    static async getBasicBoxStatistics(boxId: string) {
        const stats = await db
            .select({
                activeAthletes: sql<number>`
                    COUNT(CASE 
                        WHEN ${boxMemberships.role} = 'athlete' 
                        AND ${boxMemberships.isActive} = true 
                        THEN 1 
                    END)`
                ,
                activeCoaches: sql<number>`
                    COUNT(CASE 
                        WHEN ${boxMemberships.role} IN ('head_coach', 'coach') 
                        AND ${boxMemberships.isActive} = true 
                        THEN 1 
                    END)`
                ,
                newMembers30d: sql<number>`
                    COUNT(CASE 
                        WHEN ${boxMemberships.joinedAt} >= NOW() - INTERVAL '30 days' 
                        THEN 1 
                    END)`
                ,
                avgCheckinStreak: sql<number>`
                    COALESCE(AVG(
                        CASE 
                            WHEN ${boxMemberships.role} = 'athlete'
                    THEN ${boxMemberships.checkinStreak}
                    END
                    ), 0)`
            })
            .from(boxMemberships)
            .where(eq(boxMemberships.boxId, boxId));

        return {
            activeAthletes: stats[0]?.activeAthletes || 0,
            activeCoaches: stats[0]?.activeCoaches || 0,
            newMembers30d: stats[0]?.newMembers30d || 0,
            avgCheckinStreak: stats[0]?.avgCheckinStreak || 0
        };
    }

    /**
     * Get recent interventions (simple query - no view needed)
     */
    static async getRecentInterventions(
        boxId: string,
        limit: number = 20
    ) {
        return db
            .select()
            .from(athleteInterventions)
            .where(eq(athleteInterventions.boxId, boxId))
            .orderBy(desc(athleteInterventions.interventionDate))
            .limit(limit);
    }

    /**
     * Get billing analytics and insights
     */
    static async getBillingAnalytics(boxId: string, timeframe: "30d" | "90d" | "12m" = "30d") {
        const endDate = new Date();
        const startDate = new Date();

        switch (timeframe) {
            case "30d":
                startDate.setDate(endDate.getDate() - 30);
                break;
            case "90d":
                startDate.setDate(endDate.getDate() - 90);
                break;
            case "12m":
                startDate.setFullYear(endDate.getFullYear() - 1);
                break;
        }

        const [totalSpentResult, orderCountResult, averageOrderResult] = await Promise.all([
            db
                .select({ total: sum(orders.amount) })
                .from(orders)
                .where(and(
                    eq(orders.boxId, boxId),
                    eq(orders.status, "paid"),
                    gte(orders.createdAt, startDate),
                    lte(orders.createdAt, endDate)
                )),
            db
                .select({ count: count() })
                .from(orders)
                .where(and(
                    eq(orders.boxId, boxId),
                    eq(orders.status, "paid"),
                    gte(orders.createdAt, startDate),
                    lte(orders.createdAt, endDate)
                )),
            db
                .select({ average: sql<number>`AVG(${orders.amount})` })
                .from(orders)
                .where(and(
                    eq(orders.boxId, boxId),
                    eq(orders.status, "paid"),
                    gte(orders.createdAt, startDate),
                    lte(orders.createdAt, endDate)
                ))
        ]);

        const totalSpent = totalSpentResult[0]?.total ?? 0;
        const orderCount = orderCountResult[0]?.count ?? 0;
        const averageOrder = averageOrderResult[0]?.average ?? 0;

        return {
            timeframe,
            period: { start: startDate, end: endDate },
            summary: {
                totalSpent,
                totalSpentFormatted: `$${(Number(totalSpent) / 100).toFixed(2)}`,
                orderCount,
                averageOrderValue: Math.round(Number(averageOrder)),
                averageOrderValueFormatted: `$${(Number(averageOrder) / 100).toFixed(2)}`
            }
        };
    }

    /**
     * Enhanced billing history with comprehensive filtering
     */
    static async getBillingHistory(
        boxId: string,
        options: {
            limit?: number;
            offset?: number;
            orderType?: string;
            status?: string;
            dateRange?: { start: Date; end: Date };
        } = {}
    ) {
        const { limit = 20, offset = 0, orderType, status, dateRange } = options;

        // Build where conditions
        let whereConditions = [eq(orders.boxId, boxId)];

        if (orderType) {
            whereConditions.push(eq(orders.orderType, orderType));
        }

        if (status) {
            whereConditions.push(eq(orders.status, status));
        }

        if (dateRange) {
            whereConditions.push(
                gte(orders.createdAt, dateRange.start),
                lte(orders.createdAt, dateRange.end)
            );
        }

        const [ordersData, totalCountResult] = await Promise.all([
            db.query.orders.findMany({
                where: and(...whereConditions),
                orderBy: desc(orders.createdAt),
                limit,
                offset,
                with: {
                    subscription: {
                        with: {
                            plan: true
                        }
                    },
                    customerProfile: true,
                },
            }),
            db
                .select({ count: count() })
                .from(orders)
                .where(and(...whereConditions))
        ]);

        const totalCount = totalCountResult[0]?.count ?? 0;

        // Enhanced financial calculations
        const paidOrders = ordersData.filter(order => order.status === "paid");
        const totalSpent = paidOrders.reduce((sum, order) => sum + (order.amount ?? 0), 0);
        const totalRefunded = ordersData
            .filter(order => order.refundedAmount && order.refundedAmount > 0)
            .reduce((sum, order) => sum + (order.refundedAmount ?? 0), 0);

        // Monthly spend calculation
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const monthlySpend = ordersData
            .filter(order => {
                const orderDate = new Date(order.createdAt);
                return orderDate >= thirtyDaysAgo && order.status === "paid";
            })
            .reduce((sum, order) => sum + (order.amount ?? 0), 0);

        // Category breakdown
        const categoryBreakdown = ordersData.reduce((acc, order) => {
            const type = order.orderType || "unknown";
            if (!acc[type]) {
                acc[type] = { count: 0, amount: 0 };
            }
            acc[type].count++;
            if (order.status === "paid") {
                acc[type].amount += order.amount ?? 0;
            }
            return acc;
        }, {} as Record<string, { count: number; amount: number }>);

        return {
            orders: ordersData.map(order => ({
                ...order,
                amountFormatted: `${((order.amount ?? 0) / 100).toFixed(2)}`,
                refundedAmountFormatted: order.refundedAmount
                    ? `${(order.refundedAmount / 100).toFixed(2)}`
                    : null,
            })),
            pagination: {
                total: totalCount,
                limit,
                offset,
                hasMore: (offset + limit) < totalCount,
                page: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit)
            },
            summary: {
                totalSpent,
                totalSpentFormatted: `${(totalSpent / 100).toFixed(2)}`,
                totalRefunded,
                totalRefundedFormatted: `${(totalRefunded / 100).toFixed(2)}`,
                monthlySpend,
                monthlySpendFormatted: `${(monthlySpend / 100).toFixed(2)}`,
                averageOrderValue: paidOrders.length > 0
                    ? Math.round(totalSpent / paidOrders.length)
                    : 0,
                categoryBreakdown
            },
        };
    }
}
