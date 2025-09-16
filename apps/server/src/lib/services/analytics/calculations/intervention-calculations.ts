// src/lib/services/analytics/calculations/intervention-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteInterventions,
    athleteRiskScores
} from "@/db/schema";
import { eq, and, gte, count, sql, lte } from "drizzle-orm";

export interface InterventionOpportunityData {
    membershipId: string;
    athleteName: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    overallRiskScore: number;
    primaryConcern: string;
    suggestedInterventionType: string;
    suggestedTitle: string;
    suggestedDescription: string;
    urgencyScore: number;
    daysSinceLastIntervention: number | null;
    alertId?: string;
}

export interface InterventionSuggestionResult {
    boxId: string;
    opportunities: InterventionOpportunityData[];
    totalOpportunities: number;
    highPriority: number;
    mediumPriority: number;
    lowPriority: number;
    generatedAt: Date;
}

/**
 * Identify intervention opportunities based on risk scores and behavioral patterns
 */
export async function identifyInterventionOpportunities(
    boxId: string,
    lookbackDays: number = 14
): Promise<InterventionSuggestionResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    // Get athletes with risk scores and recent intervention history
    const athletesWithRisk = await db
        .select({
            membershipId: athleteRiskScores.membershipId,
            athleteName: boxMemberships.displayName,
            riskLevel: athleteRiskScores.riskLevel,
            overallRiskScore: athleteRiskScores.overallRiskScore,
            attendanceScore: athleteRiskScores.attendanceScore,
            wellnessScore: athleteRiskScores.wellnessScore,
            engagementScore: athleteRiskScores.engagementScore,
            performanceScore: athleteRiskScores.performanceScore,
            daysSinceLastVisit: athleteRiskScores.daysSinceLastVisit,
            daysSinceLastCheckin: athleteRiskScores.daysSinceLastCheckin,
            factors: athleteRiskScores.factors,
            calculatedAt: athleteRiskScores.calculatedAt,
        })
        .from(athleteRiskScores)
        .innerJoin(boxMemberships, eq(athleteRiskScores.membershipId, boxMemberships.id))
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.isActive, true),
            eq(boxMemberships.role, 'athlete'),
            gte(athleteRiskScores.validUntil, new Date()) // Only current risk scores
        ));

    // Get recent interventions for each athlete
    const recentInterventions = await db
        .select({
            membershipId: athleteInterventions.membershipId,
            lastInterventionDate: sql<Date>`MAX(${athleteInterventions.interventionDate})`,
            interventionCount: count()
        })
        .from(athleteInterventions)
        .where(and(
            eq(athleteInterventions.boxId, boxId),
            gte(athleteInterventions.interventionDate, cutoffDate)
        ))
        .groupBy(athleteInterventions.membershipId);

    const interventionMap = new Map(
        recentInterventions.map(r => [r.membershipId, r])
    );

    const opportunities: InterventionOpportunityData[] = [];

    for (const athlete of athletesWithRisk) {
        const recentIntervention = interventionMap.get(athlete.membershipId);
        const daysSinceLastIntervention = recentIntervention
            ? Math.floor((new Date().getTime() - recentIntervention.lastInterventionDate.getTime()) / (1000 * 60 * 60 * 24))
            : null;

        // Skip if recent intervention (within 7 days) unless critical risk
        if (daysSinceLastIntervention !== null && daysSinceLastIntervention < 7 && athlete.riskLevel !== 'critical') {
            continue;
        }

        const opportunity = await generateInterventionSuggestion(athlete, daysSinceLastIntervention);
        if (opportunity) {
            opportunities.push(opportunity);
        }
    }

    // Sort by urgency score (highest first)
    opportunities.sort((a, b) => b.urgencyScore - a.urgencyScore);

    // Categorize by priority
    const highPriority = opportunities.filter(o => o.urgencyScore >= 80).length;
    const mediumPriority = opportunities.filter(o => o.urgencyScore >= 50 && o.urgencyScore < 80).length;
    const lowPriority = opportunities.filter(o => o.urgencyScore < 50).length;

    return {
        boxId,
        opportunities,
        totalOpportunities: opportunities.length,
        highPriority,
        mediumPriority,
        lowPriority,
        generatedAt: new Date()
    };
}

/**
 * Generate intervention suggestion based on athlete risk profile
 */
async function generateInterventionSuggestion(
    athlete: any,
    daysSinceLastIntervention: number | null
): Promise<InterventionOpportunityData | null> {
    const riskScore = parseFloat(athlete.overallRiskScore);
    const attendanceScore = parseFloat(athlete.attendanceScore);
    const wellnessScore = parseFloat(athlete.wellnessScore);
    const engagementScore = parseFloat(athlete.engagementScore);
    const performanceScore = parseFloat(athlete.performanceScore);

    // Determine primary concern and intervention type
    let primaryConcern = "";
    let interventionType = "";
    let title = "";
    let description = "";
    let urgencyScore = 0;

    // Analyze the lowest scoring area
    const scores = {
        attendance: { score: attendanceScore, label: "Attendance" },
        wellness: { score: wellnessScore, label: "Wellness" },
        engagement: { score: engagementScore, label: "Engagement" },
        performance: { score: performanceScore, label: "Performance" }
    };

    const lowestArea = Object.entries(scores).reduce((min, [key, value]) =>
            value.score < min.score ? { key, ...value } : min
        , { key: "attendance", score: 100, label: "Attendance" });

    // Skip if all scores are reasonably good (low risk)
    if (riskScore < 25 && lowestArea.score > 60) {
        return null;
    }

    // Generate intervention based on primary concern
    switch (lowestArea.key) {
        case "attendance":
            primaryConcern = "Poor Attendance";
            if (athlete.daysSinceLastVisit > 14) {
                interventionType = "re_engagement";
                title = "Member Re-engagement - Extended Absence";
                description = `${athlete.athleteName} hasn't attended in ${athlete.daysSinceLastVisit} days. Reach out to understand barriers and offer support to get them back on track.`;
                urgencyScore = Math.min(95, 60 + (athlete.daysSinceLastVisit * 2));
            } else {
                interventionType = "attendance_check";
                title = "Attendance Pattern Discussion";
                description = `${athlete.athleteName} has been attending less frequently. Schedule a conversation to understand any challenges and adjust their program if needed.`;
                urgencyScore = 70;
            }
            break;

        case "wellness":
            primaryConcern = "Wellness Concerns";
            interventionType = "wellness_check";
            title = "Wellness and Recovery Discussion";
            description = `${athlete.athleteName} has been reporting lower wellness scores. Discuss stress, sleep, and recovery strategies to improve their overall well-being.`;
            urgencyScore = athlete.riskLevel === 'critical' ? 85 : 65;
            break;

        case "engagement":
            primaryConcern = "Low Engagement";
            if (athlete.daysSinceLastCheckin > 7) {
                interventionType = "engagement_boost";
                title = "Member Engagement - Check-in Gap";
                description = `${athlete.athleteName} hasn't been checking in regularly (${athlete.daysSinceLastCheckin} days since last check-in). Connect with them to re-establish engagement.`;
                urgencyScore = 75;
            } else {
                interventionType = "motivation_support";
                title = "Motivation and Goal Setting";
                description = `${athlete.athleteName} seems less engaged lately. Schedule time to revisit their goals and find ways to reignite their motivation.`;
                urgencyScore = 55;
            }
            break;

        case "performance":
            primaryConcern = "Performance Plateau";
            interventionType = "program_review";
            title = "Training Program Review";
            description = `${athlete.athleteName} hasn't been hitting new PRs recently. Review their program and technique to help break through plateaus.`;
            urgencyScore = 50;
            break;
    }

    // Boost urgency for higher risk levels
    if (athlete.riskLevel === 'critical') {
        urgencyScore = Math.max(urgencyScore, 80);
    } else if (athlete.riskLevel === 'high') {
        urgencyScore = Math.max(urgencyScore, 60);
    }

    // Reduce urgency if recent intervention
    if (daysSinceLastIntervention !== null && daysSinceLastIntervention < 14) {
        urgencyScore = Math.max(urgencyScore - 20, 30);
    }

    return {
        membershipId: athlete.membershipId,
        athleteName: athlete.athleteName,
        riskLevel: athlete.riskLevel,
        overallRiskScore: riskScore,
        primaryConcern,
        suggestedInterventionType: interventionType,
        suggestedTitle: title,
        suggestedDescription: description,
        urgencyScore: Math.round(urgencyScore),
        daysSinceLastIntervention
    };
}

/**
 * Create intervention record
 */
export async function createIntervention(
    boxId: string,
    membershipId: string,
    coachMembershipId: string,
    interventionData: {
        interventionType: string;
        title: string;
        description: string;
        alertId?: string;
    }
) {
    return await db.insert(athleteInterventions).values({
        boxId,
        membershipId,
        coachId: coachMembershipId,
        alertId: interventionData.alertId || null,
        interventionType: interventionData.interventionType,
        title: interventionData.title,
        description: interventionData.description,
        interventionDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
    });
}

/**
 * Update intervention outcome
 */
export async function updateInterventionOutcome(
    interventionId: string,
    outcome: {
        outcome: string;
        athleteResponse?: string;
        coachNotes?: string;
        followUpRequired?: boolean;
        followUpAt?: Date;
    }
) {
    return db.update(athleteInterventions)
        .set({
            outcome: outcome.outcome,
            athleteResponse: outcome.athleteResponse || null,
            coachNotes: outcome.coachNotes || null,
            followUpRequired: outcome.followUpRequired || false,
            followUpAt: outcome.followUpAt || null,
            updatedAt: new Date()
        })
        .where(eq(athleteInterventions.id, interventionId));
}

/**
 * Get pending follow-ups for a coach
 */

export async function getPendingFollowUps(
    boxId: string,
    coachMembershipId?: string
) {
    const conditions = [
        eq(athleteInterventions.boxId, boxId),
        eq(athleteInterventions.followUpRequired, true),
        eq(athleteInterventions.followUpCompleted, false),
        lte(athleteInterventions.followUpAt ?? sql`NOW()`, new Date()),
    ];

    if (coachMembershipId) {
        conditions.push(eq(athleteInterventions.coachId, coachMembershipId));
    }

    return db
        .select({
            id: athleteInterventions.id,
            membershipId: athleteInterventions.membershipId,
            athleteName: boxMemberships.displayName,
            title: athleteInterventions.title,
            interventionType: athleteInterventions.interventionType,
            followUpAt: athleteInterventions.followUpAt,
            interventionDate: athleteInterventions.interventionDate,
            outcome: athleteInterventions.outcome,
        })
        .from(athleteInterventions)
        .innerJoin(
            boxMemberships,
            eq(athleteInterventions.membershipId, boxMemberships.id)
        )
        .where(and(...conditions))
        .orderBy(athleteInterventions.followUpAt);
}

/**
 * Mark follow-up as completed
 */
export async function completeFollowUp(interventionId: string, coachNotes?: string) {
    return db.update(athleteInterventions)
        .set({
            followUpCompleted: true,
            coachNotes: coachNotes || null,
            updatedAt: new Date()
        })
        .where(eq(athleteInterventions.id, interventionId));
}

/**
 * Process intervention suggestions for a box (creates suggested interventions)
 */
export async function processInterventionSuggestions(boxId: string) {
    try {
        console.log(`[Analytics] Identifying intervention opportunities for box ${boxId}`);

        const suggestions = await identifyInterventionOpportunities(boxId);

        console.log(`[Analytics] Found ${suggestions.totalOpportunities} intervention opportunities for box ${boxId}`);
        console.log(`[Analytics] Priority breakdown - High: ${suggestions.highPriority}, Medium: ${suggestions.mediumPriority}, Low: ${suggestions.lowPriority}`);

        // Log high-priority opportunities for monitoring
        const highPriorityOpportunities = suggestions.opportunities.filter(o => o.urgencyScore >= 80);
        for (const opportunity of highPriorityOpportunities) {
            console.log(`[Analytics] HIGH PRIORITY: ${opportunity.athleteName} - ${opportunity.primaryConcern} (Risk: ${opportunity.riskLevel}, Urgency: ${opportunity.urgencyScore})`);
        }

        return {
            boxId,
            opportunities: suggestions.opportunities,
            totalOpportunities: suggestions.totalOpportunities,
            highPriority: suggestions.highPriority,
            mediumPriority: suggestions.mediumPriority,
            lowPriority: suggestions.lowPriority,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing intervention suggestions for box ${boxId}:`, error);
        throw error;
    }
}
