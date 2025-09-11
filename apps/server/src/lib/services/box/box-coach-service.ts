// lib/services/box/box-coach-service.ts
import {db} from "@/db";
import type {CoachModerationQueue, InterventionInsight} from "@/lib/services/box/types";
import {athletePrs, athleteWellnessCheckins, boxMemberships} from "@/db/schema";
import {and, count, desc, eq, gte, inArray, sql} from "drizzle-orm";

export class BoxCoachService {
    /**
     * Get coach moderation queue for video content and engagement
     */
    static async getCoachModerationQueue(
        boxId: string,
        coachId: string,
        options: {
            includeAssigned?: boolean;
            priority?: 'low' | 'medium' | 'high' | 'urgent';
            limit?: number;
        } = {}
    ): Promise<CoachModerationQueue[]> {
        const { limit = 20 } = options;
        const queue: CoachModerationQueue[] = [];

        // Get recent PR videos needing coach review
        const recentVideoPrs = await db
            .select({
                pr: athletePrs,
                athlete: {
                    id: boxMemberships.id,
                    displayName: boxMemberships.displayName
                }
            })
            .from(athletePrs)
            .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
            .where(and(
                eq(athletePrs.boxId, boxId),
                sql`${athletePrs.gumletAssetId} IS NOT NULL`,
                eq(athletePrs.videoProcessingStatus, 'ready'),
                sql`${athletePrs.coachNotes} IS NULL OR ${athletePrs.coachNotes} = ''`,
                gte(athletePrs.achievedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
            ))
            .orderBy(desc(athletePrs.achievedAt))
            .limit(limit);

        // Add PR videos to queue
        recentVideoPrs.forEach(({ pr, athlete }) => {
            queue.push({
                id: `pr_${pr.id}`,
                type: 'pr_video',
                priority: 'medium',
                athleteId: athlete.id,
                athleteName: athlete.displayName || 'Athlete',
                title: 'New PR Video to Review',
                description: `${athlete.displayName || 'Athlete'} uploaded a PR video`,
                createdAt: pr.achievedAt,
                requiresAction: true,
                metadata: {
                    prId: pr.id,
                    value: pr.value,
                    unit: pr.unit,
                    thumbnailUrl: pr.thumbnailUrl,
                    videoStatus: pr.videoProcessingStatus
                }
            });
        });

        return queue.sort((a, b) => {
            const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
            const aPriority = priorityOrder[a.priority];
            const bPriority = priorityOrder[b.priority];

            if (aPriority !== bPriority) return bPriority - aPriority;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }

    /**
     * Get intervention insights for at-risk members
     */
    static async getInterventionInsights(boxId: string): Promise<InterventionInsight[]> {
        // Get potentially at-risk members
        const atRiskMembers = await db
            .select({
                member: boxMemberships,
                lastPr: sql<Date>`MAX(${athletePrs.achievedAt})`,
                lastCheckin: sql<Date>`MAX(${athleteWellnessCheckins.checkinDate})`
            })
            .from(boxMemberships)
            .leftJoin(athletePrs, eq(athletePrs.membershipId, boxMemberships.id))
            .leftJoin(athleteWellnessCheckins, eq(athleteWellnessCheckins.membershipId, boxMemberships.id))
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                eq(boxMemberships.role, 'athlete')
            ))
            .groupBy(boxMemberships.id)
            .having(sql`(MAX(${boxMemberships.lastCheckinDate}) < NOW() - INTERVAL '14 days' OR MAX(${boxMemberships.lastCheckinDate}) IS NULL)`)
            .orderBy(desc(sql`COALESCE(MAX(${boxMemberships.lastCheckinDate}), MAX(${athleteWellnessCheckins.checkinDate}), ${boxMemberships.joinedAt})`));

        const insights = await Promise.all(
            atRiskMembers.map(async ({ member, lastPr, lastCheckin }) => {
                const riskFactors = [];
                let riskScore = 0;

                // Analyze check-in patterns
                const daysSinceLastCheckin = member.lastCheckinDate ?
                    Math.floor((Date.now() - member.lastCheckinDate.getTime()) / (1000 * 60 * 60 * 24)) :
                    999;

                if (daysSinceLastCheckin > 21) {
                    riskFactors.push({
                        type: 'declining_checkins' as const,
                        severity: 8,
                        description: 'No wellness check-ins for 3+ weeks',
                        trend: 'declining' as const,
                        lastOccurrence: member.lastCheckinDate || member.joinedAt
                    });
                    riskScore += 40;
                } else if (daysSinceLastCheckin > 14) {
                    riskFactors.push({
                        type: 'declining_checkins' as const,
                        severity: 6,
                        description: 'Declining check-in frequency',
                        trend: 'declining' as const,
                        lastOccurrence: member.lastCheckinDate || member.joinedAt
                    });
                    riskScore += 25;
                }

                // Check video engagement
                const recentVideoPrs = await db
                    .select({ count: count() })
                    .from(athletePrs)
                    .where(and(
                        eq(athletePrs.membershipId, member.id),
                        gte(athletePrs.achievedAt, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)),
                        sql`${athletePrs.gumletAssetId} IS NOT NULL`
                    ));

                const totalRecentPrs = await db
                    .select({ count: count() })
                    .from(athletePrs)
                    .where(and(
                        eq(athletePrs.membershipId, member.id),
                        gte(athletePrs.achievedAt, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000))
                    ));

                if (totalRecentPrs[0].count > 0 && recentVideoPrs[0].count === 0) {
                    riskFactors.push({
                        type: 'no_video_engagement' as const,
                        severity: 4,
                        description: 'Recent PRs without video documentation',
                        trend: 'stable' as const,
                        lastOccurrence: lastPr || new Date()
                    });
                    riskScore += 15;
                }

                // Determine risk level
                let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
                if (riskScore >= 60) riskLevel = 'critical';
                else if (riskScore >= 40) riskLevel = 'high';
                else if (riskScore >= 20) riskLevel = 'medium';

                // Generate recommendations
                const recommendations = [];
                if (daysSinceLastCheckin > 14) {
                    recommendations.push({
                        action: 'Personal Check-in',
                        urgency: daysSinceLastCheckin > 21 ? 'high' as const : 'medium' as const,
                        description: 'Schedule a one-on-one conversation to understand current challenges',
                        estimatedImpact: 'High - personal attention often re-engages members'
                    });
                }

                if (totalRecentPrs[0].count > 0 && recentVideoPrs[0].count === 0) {
                    recommendations.push({
                        action: 'Video Engagement Encouragement',
                        urgency: 'low' as const,
                        description: 'Encourage video documentation of achievements for better progress tracking',
                        estimatedImpact: 'Medium - increases engagement and provides coaching opportunities'
                    });
                }

                return {
                    membershipId: member.id,
                    athleteName: member.displayName || 'Athlete',
                    riskLevel,
                    riskFactors,
                    recommendations,
                    lastInteractionDate: member.lastCheckinDate,
                    suggestedActions: recommendations.map(r => r.action)
                };
            })
        );

        return insights.filter(insight => insight.riskLevel !== 'low');
    }

    /**
     * Create coach notification for video review
     */
    static async createVideoReviewNotification(
        boxId: string,
        prId: string,
        coachIds: string[] = []
    ) {
        // Get PR details
        const prDetails = await db
            .select({
                pr: athletePrs,
                athlete: {
                    displayName: boxMemberships.displayName,
                    publicId: boxMemberships.publicId
                }
            })
            .from(athletePrs)
            .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
            .where(eq(athletePrs.id, prId))
            .limit(1);

        if (!prDetails.length) return null;

        // If no specific coaches provided, get all active coaches
        if (coachIds.length === 0) {
            const coaches = await db
                .select({ id: boxMemberships.id })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    inArray(boxMemberships.role, ['owner', 'head_coach', 'coach'])
                ));
            coachIds = coaches.map(c => c.id);
        }

        const { pr, athlete } = prDetails[0];

        // Create notification object (implement your notification system)
        const notification = {
            type: 'video_review_request',
            title: 'New PR Video for Review',
            message: `${athlete.displayName || 'An athlete'} uploaded a PR video that needs coach feedback`,
            data: {
                prId: pr.id,
                athleteName: athlete.displayName,
                prValue: `${pr.value}${pr.unit}`,
                videoReady: pr.videoProcessingStatus === 'ready',
                thumbnailUrl: pr.thumbnailUrl
            },
            recipients: coachIds,
            actionUrl: `/coach/review-pr/${pr.publicId}`,
            createdAt: new Date()
        };

        // TODO: Implement actual notification dispatch
        return notification;
    }
}
