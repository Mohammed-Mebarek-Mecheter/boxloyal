// lib/services/analytics/risk-analytics-service.ts
import { db } from "@/db";
import {
    athleteRiskScores,
    athleteAlerts,
    athleteInterventions,
    athleteWellnessCheckins,
    boxMemberships,
    athletePrs,
    wodFeedback,
    wodAttendance
} from "@/db/schema";
import {
    vwAthleteRiskOverview
} from "@/db/schema/views";
import { eq, desc, and, gte, count, sql, avg } from "drizzle-orm";
import type { RiskIndicators } from "@/lib/services/athlete/athlete-service";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertSeverity = "low" | "medium" | "high" | "critical";

export class RiskAnalyticsService {
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
            recommendations.push(...this.generateRecommendations(riskFactors, riskScore));
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
    static async getAtRiskAthletes(
        boxId: string,
        options: {
            riskThreshold?: number;
            limit?: number;
            sortBy?: 'risk_score' | 'last_checkin' | 'attendance_rate';
            includeLowRisk?: boolean;
            riskLevel?: RiskLevel;
        } = {}
    ) {
        const {
            riskThreshold = 40,
            limit = 50,
            sortBy = 'risk_score',
            includeLowRisk = false,
            riskLevel
        } = options;

        // Use materialized view for performance
        const conditions = [eq(vwAthleteRiskOverview.boxId, boxId)];

        if (riskLevel) {
            conditions.push(eq(vwAthleteRiskOverview.riskLevel, riskLevel));
        }

        if (!includeLowRisk) {
            conditions.push(sql`${vwAthleteRiskOverview.overallRiskScore} >= ${riskThreshold}`);
        }

        return db
            .select()
            .from(vwAthleteRiskOverview)
            .where(and(...conditions))
            .orderBy(desc(vwAthleteRiskOverview.overallRiskScore))
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
     * Generate personalized recommendations based on risk factors
     */
    private static generateRecommendations(
        riskFactors: RiskIndicators['riskFactors'],
        riskScore: number
    ): string[] {
        const recommendations: string[] = [];

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

        return recommendations;
    }
}
