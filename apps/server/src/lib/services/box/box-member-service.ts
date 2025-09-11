// lib/services/box/box-member-service.ts
import {db} from "@/db";
import type {BoxRole, MemberWithStats} from "@/lib/services/box/types";
import {and, count, desc, eq, gte, sql} from "drizzle-orm";
import {athletePrs, athleteWellnessCheckins, boxMemberships, prCoachFeedback} from "@/db/schema";

export class BoxMemberService {
    /**
     * Get box members with enhanced video analytics and risk assessment
     */
    static async getMembers(
        boxId: string,
        options: {
            role?: BoxRole;
            isActive?: boolean;
            includeStats?: boolean;
            includeVideoMetrics?: boolean;
            includeRiskAssessment?: boolean;
            isCoachOrAbove?: boolean;
        } = {}
    ): Promise<MemberWithStats[]> {
        const {
            role,
            isActive = true,
            includeStats = false,
            includeVideoMetrics = false,
            includeRiskAssessment = false,
            isCoachOrAbove = false
        } = options;

        let whereConditions = and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.isActive, isActive)
        );

        if (role) {
            whereConditions = and(whereConditions, eq(boxMemberships.role, role));
        }

        const selectFields = {
            id: boxMemberships.id,
            publicId: boxMemberships.publicId,
            userId: boxMemberships.userId,
            role: boxMemberships.role,
            isActive: boxMemberships.isActive,
            joinedAt: boxMemberships.joinedAt,
            checkinStreak: boxMemberships.checkinStreak,
            totalCheckins: boxMemberships.totalCheckins,
            longestCheckinStreak: boxMemberships.longestCheckinStreak,
            lastCheckinDate: boxMemberships.lastCheckinDate,
            displayName: boxMemberships.displayName,
            // Conditionally include sensitive information for coaches
            ...(isCoachOrAbove && {
                emergencyContact: boxMemberships.emergencyContact,
                emergencyPhone: boxMemberships.emergencyPhone,
                medicalNotes: boxMemberships.medicalNotes,
                goals: boxMemberships.goals,
            }),
        };

        const members = await db
            .select(selectFields)
            .from(boxMemberships)
            .where(whereConditions)
            .orderBy(desc(boxMemberships.joinedAt));

        // Enhanced stats with video metrics
        if ((includeStats || includeVideoMetrics || includeRiskAssessment) && isCoachOrAbove) {
            const enhancedMembers = await Promise.all(
                members.map(async (member) => {
                    const memberData: MemberWithStats = { ...member };

                    if (includeStats || includeVideoMetrics) {
                        memberData.stats = await this.getMemberStats(member.id, includeVideoMetrics);
                    }

                    if (includeRiskAssessment) {
                        memberData.riskIndicators = await this.assessMemberRisk(member.id);
                    }

                    return memberData;
                })
            );

            return enhancedMembers;
        }

        return members as MemberWithStats[];
    }

    /**
     * Get comprehensive member statistics including video metrics
     */
    private static async getMemberStats(membershipId: string, includeVideo: boolean = false) {
        const [prCount, recentCheckins, coachInteractions] = await Promise.all([
            db.select({ count: count() })
                .from(athletePrs)
                .where(eq(athletePrs.membershipId, membershipId)),

            db.select({ count: count() })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    gte(athleteWellnessCheckins.checkinDate,
                        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
                )),

            // Count coach feedback interactions
            db.select({ count: count() })
                .from(prCoachFeedback)
                .innerJoin(athletePrs, eq(prCoachFeedback.prId, athletePrs.id))
                .where(eq(athletePrs.membershipId, membershipId))
        ]);

        let videoPrs = 0;
        if (includeVideo) {
            const videoResult = await db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.membershipId, membershipId),
                    sql`${athletePrs.gumletAssetId} IS NOT NULL`
                ));
            videoPrs = videoResult[0].count;
        }

        // Calculate engagement score
        const engagementScore = Math.min(100,
            (recentCheckins[0].count * 10) +
            (coachInteractions[0].count * 15) +
            (videoPrs * 20)
        );

        return {
            totalPrs: prCount[0].count,
            videoPrs,
            recentCheckins: recentCheckins[0].count,
            coachInteractions: coachInteractions[0].count,
            engagementScore
        };
    }

    /**
     * Assess member risk for intervention opportunities
     */
    private static async assessMemberRisk(membershipId: string) {
        const member = await db
            .select({
                lastCheckinDate: boxMemberships.lastCheckinDate,
                checkinStreak: boxMemberships.checkinStreak,
                joinedAt: boxMemberships.joinedAt
            })
            .from(boxMemberships)
            .where(eq(boxMemberships.id, membershipId))
            .limit(1);

        if (!member.length) {
            return { level: 'low' as const, factors: [], lastActivity: null };
        }

        const factors = [];
        let riskScore = 0;

        // Check check-in patterns
        const daysSinceLastCheckin = member[0].lastCheckinDate ?
            Math.floor((Date.now() - member[0].lastCheckinDate.getTime()) / (1000 * 60 * 60 * 24)) :
            999;

        if (daysSinceLastCheckin > 14) {
            factors.push('No check-ins in 2+ weeks');
            riskScore += 30;
        } else if (daysSinceLastCheckin > 7) {
            factors.push('Declining check-in frequency');
            riskScore += 15;
        }

        // Check streak decline
        if (member[0].checkinStreak === 0 && daysSinceLastCheckin > 3) {
            factors.push('Lost check-in streak');
            riskScore += 20;
        }

        // Check video engagement (recent PRs without video)
        const recentPrsWithoutVideo = await db
            .select({ count: count() })
            .from(athletePrs)
            .where(and(
                eq(athletePrs.membershipId, membershipId),
                gte(athletePrs.achievedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
                sql`${athletePrs.gumletAssetId} IS NULL`
            ));

        if (recentPrsWithoutVideo[0].count >= 3) {
            factors.push('Multiple PRs without video verification');
            riskScore += 10;
        }

        // Determine risk level
        let level: 'low' | 'medium' | 'high' | 'critical' = 'low';
        if (riskScore >= 50) level = 'critical';
        else if (riskScore >= 30) level = 'high';
        else if (riskScore >= 15) level = 'medium';

        return {
            level,
            factors,
            lastActivity: member[0].lastCheckinDate
        };
    }

    /**
     * Remove/deactivate a member
     */
    static async removeMember(membershipId: string, reason?: string) {
        const [removed] = await db
            .update(boxMemberships)
            .set({
                isActive: false,
                leftAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(boxMemberships.id, membershipId))
            .returning();

        return removed;
    }
}
