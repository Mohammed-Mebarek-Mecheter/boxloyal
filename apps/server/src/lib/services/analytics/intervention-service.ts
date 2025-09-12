// lib/services/analytics/intervention-service.ts
import { db } from "@/db";
import {
    athleteInterventions,
    athleteAlerts,
} from "@/db/schema";
import {
    mvCoachPerformance,
    mvInterventionEffectiveness
} from "@/db/schema/views";
import { eq, desc, and, count, sql } from "drizzle-orm";

export interface InterventionParams {
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
}

export interface InterventionStats {
    interventionType: string;
    outcome: string | null;
    count: number;
}

export interface InterventionRecommendation {
    type: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    title: string;
    description: string;
    estimatedTime: string;
}

export class InterventionService {
    /**
     * Log a coach intervention
     */
    static async logIntervention(params: InterventionParams) {
        const [intervention] = await db.insert(athleteInterventions).values({
            ...params,
            interventionDate: new Date(),
        }).returning();

        // If there's an associated alert, mark it as resolved
        if (params.alertId) {
            await db.update(athleteAlerts).set({
                status: "resolved",
                resolvedAt: new Date(),
                resolvedById: params.coachId,
                resolutionNotes: `Resolved via intervention: ${params.interventionType}`,
            }).where(eq(athleteAlerts.id, params.alertId));
        }

        return intervention;
    }

    /**
     * Get intervention history for an athlete
     */
    static async getAthleteInterventions(boxId: string, membershipId: string, limit: number = 10) {
        return db.select()
            .from(athleteInterventions)
            .where(and(
                eq(athleteInterventions.boxId, boxId),
                eq(athleteInterventions.membershipId, membershipId)
            ))
            .orderBy(desc(athleteInterventions.interventionDate))
            .limit(limit);
    }

    /**
     * Get recent interventions for a box
     */
    static async getRecentInterventions(
        boxId: string,
        options: {
            limit?: number;
            coachId?: string;
            interventionType?: string;
            includeUnresolved?: boolean;
        } = {}
    ) {
        const { limit = 20, coachId, interventionType, includeUnresolved = true } = options;
        let conditions = [eq(athleteInterventions.boxId, boxId)];

        if (coachId) {
            conditions.push(eq(athleteInterventions.coachId, coachId));
        }

        if (interventionType) {
            conditions.push(eq(athleteInterventions.interventionType, interventionType));
        }

        if (!includeUnresolved) {
            conditions.push(sql`${athleteInterventions.outcome} IS NOT NULL`);
        }

        return db.select()
            .from(athleteInterventions)
            .where(and(...conditions))
            .orderBy(desc(athleteInterventions.interventionDate))
            .limit(limit);
    }

    /**
     * Get intervention statistics for a box
     */
    static async getInterventionStats(boxId: string, days: number = 30): Promise<InterventionStats[]> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return db.select({
            interventionType: athleteInterventions.interventionType,
            outcome: athleteInterventions.outcome,
            count: count()
        })
            .from(athleteInterventions)
            .where(and(
                eq(athleteInterventions.boxId, boxId),
                sql`${athleteInterventions.interventionDate} >= ${startDate}`,
                sql`${athleteInterventions.outcome} IS NOT NULL`
            ))
            .groupBy(athleteInterventions.interventionType, athleteInterventions.outcome);
    }

    /**
     * Get coach performance metrics - Using mv_coach_performance
     */
    static async getCoachPerformance(boxId: string) {
        return db.select()
            .from(mvCoachPerformance)
            .where(eq(mvCoachPerformance.boxId, boxId))
            .orderBy(desc(mvCoachPerformance.interventionsCompleted));
    }

    /**
     * Update intervention outcome
     */
    static async updateInterventionOutcome(
        interventionId: string,
        params: {
            outcome: string;
            athleteResponse?: string;
            coachNotes?: string;
            followUpRequired?: boolean;
            followUpAt?: Date;
        }
    ) {
        const [updatedIntervention] = await db
            .update(athleteInterventions)
            .set({
                ...params,
                updatedAt: new Date(),
            })
            .where(eq(athleteInterventions.id, interventionId))
            .returning();

        return updatedIntervention;
    }

    /**
     * Get interventions requiring follow-up
     */
    static async getInterventionsRequiringFollowUp(
        boxId: string,
        options: {
            coachId?: string;
            overdue?: boolean;
        } = {}
    ) {
        const { coachId, overdue = false } = options;
        let conditions = [
            eq(athleteInterventions.boxId, boxId),
            eq(athleteInterventions.followUpRequired, true)
        ];

        if (coachId) {
            conditions.push(eq(athleteInterventions.coachId, coachId));
        }

        if (overdue) {
            conditions.push(sql`${athleteInterventions.followUpAt} < NOW()`);
        }

        return db.select()
            .from(athleteInterventions)
            .where(and(...conditions))
            .orderBy(athleteInterventions.followUpAt);
    }

    /**
     * Get intervention effectiveness metrics - Using mv_intervention_effectiveness
     */
    static async getInterventionEffectiveness(boxId: string, days: number = 90) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const effectivenessData = await db.select()
            .from(mvInterventionEffectiveness)
            .where(eq(mvInterventionEffectiveness.boxId, boxId));

        return effectivenessData.map(item => ({
            interventionType: item.interventionType,
            totalInterventions: item.totalInterventionsInPeriod || 0,
            avgRiskScoreChange: item.avgRiskScoreChange ? parseFloat(item.avgRiskScoreChange.toString()) : 0,
            avgAttendanceRateChange: item.avgAttendanceRateChange ? parseFloat(item.avgAttendanceRateChange.toString()) : 0,
            avgCheckinRateChange: item.avgCheckinRateChange ? parseFloat(item.avgCheckinRateChange.toString()) : 0,
            avgWellnessScoreChange: item.avgWellnessScoreChange ? parseFloat(item.avgWellnessScoreChange.toString()) : 0,
            successRate: item.interventionsWithOutcome && item.totalInterventionsInPeriod ?
                Math.round((item.interventionsWithOutcome / item.totalInterventionsInPeriod) * 100) : 0
        }));
    }

    /**
     * Get intervention recommendations based on risk factors
     */
    static getInterventionRecommendations(
        riskFactors: Array<{ type: string; severity: string }>
    ): InterventionRecommendation[] {
        const recommendations: InterventionRecommendation[] = [];

        for (const factor of riskFactors) {
            switch (factor.type) {
                case 'low_checkin_frequency':
                    recommendations.push({
                        type: 'checkin_conversation',
                        priority: factor.severity === 'critical' ? 'urgent' : 'high',
                        title: 'Schedule Check-in Conversation',
                        description: 'Discuss barriers to daily engagement and wellness tracking',
                        estimatedTime: '15-20 minutes'
                    });
                    break;
                case 'poor_attendance':
                    recommendations.push({
                        type: 'schedule_review',
                        priority: factor.severity === 'critical' ? 'urgent' : 'high',
                        title: 'Review Class Schedule',
                        description: 'Discuss scheduling conflicts and preferred class times',
                        estimatedTime: '10-15 minutes'
                    });
                    break;
                case 'low_energy_wellness':
                    recommendations.push({
                        type: 'recovery_consultation',
                        priority: 'medium',
                        title: 'Recovery Strategy Discussion',
                        description: 'Review sleep habits, nutrition, and recovery protocols',
                        estimatedTime: '20-30 minutes'
                    });
                    break;
                case 'high_stress_levels':
                    recommendations.push({
                        type: 'stress_management',
                        priority: 'medium',
                        title: 'Stress Management Techniques',
                        description: 'Discuss workout scaling and stress reduction strategies',
                        estimatedTime: '15-25 minutes'
                    });
                    break;
                case 'no_recent_prs':
                    recommendations.push({
                        type: 'goal_setting',
                        priority: 'medium',
                        title: 'Goal Setting Session',
                        description: 'Establish achievable PR targets and training focus',
                        estimatedTime: '20-30 minutes'
                    });
                    break;
                case 'low_workout_enjoyment':
                    recommendations.push({
                        type: 'program_modification',
                        priority: 'high',
                        title: 'Program Customization',
                        description: 'Explore workout modifications and movement preferences',
                        estimatedTime: '15-20 minutes'
                    });
                    break;
                case 'new_member_risk':
                    recommendations.push({
                        type: 'onboarding_support',
                        priority: 'high',
                        title: 'Enhanced Onboarding',
                        description: 'Increase coaching touchpoints and community integration',
                        estimatedTime: '10-15 minutes'
                    });
                    break;
            }
        }

        // Sort by priority using a properly typed priority order object
        const priorityOrder: { [key in 'urgent' | 'high' | 'medium' | 'low']: number } = {
            urgent: 4,
            high: 3,
            medium: 2,
            low: 1
        };

        return recommendations.sort((a, b) => {
            return priorityOrder[b.priority] - priorityOrder[a.priority];
        });
    }
}
