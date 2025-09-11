// lib/services/box-service.ts
import { db } from "@/db";
import {
    boxes,
    boxMemberships,
    boxInvites,
    boxQrCodes,
    approvalQueue,
    athletePrs,
    athleteWellnessCheckins,
    user, videoConsents
} from "@/db/schema";
import {eq, and, desc, gte, count, sql, inArray} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {prCoachFeedback, videoSocialShares} from "@/db/schema/videos";

export type BoxRole = "owner" | "head_coach" | "coach" | "athlete";

export interface MemberWithStats {
    id: string;
    publicId: string;
    userId: string;
    role: BoxRole;
    isActive: boolean;
    joinedAt: Date;
    checkinStreak: number;
    totalCheckins: number;
    longestCheckinStreak: number;
    lastCheckinDate: Date | null;
    displayName?: string;
    stats?: {
        totalPrs: number;
        videoPrs: number;
        recentCheckins: number;
        coachInteractions: number;
        engagementScore: number;
    };
    riskIndicators?: {
        level: 'low' | 'medium' | 'high' | 'critical';
        factors: string[];
        lastActivity: Date | null;
    };
}

export interface BoxStats {
    members: {
        total: number;
        active: number;
        new: number;
    };
    activity: {
        totalPrs: number;
        totalCheckins: number;
        avgCheckinRate: number;
    };
    period: string;
    dateRange: {
        start: Date;
        end: Date;
    };
}

export interface BoxDashboard {
    box: typeof boxes.$inferSelect;
    members: {
        byRole: Array<{ role: string; count: number }>;
        recentJoins: number;
        atRiskCount: number;
    };
    activity: {
        pendingApprovals: number;
        recentPrs: number;
        videoPrs: number;
        activeCheckins: number;
        avgStreak: number;
        pendingModerations: number;
    };
    videoEngagement: {
        totalVideoUploads: number;
        coachFeedbackRate: number;
        socialSharesCount: number;
        avgVideoVerificationRate: number;
    };
}

export interface CoachModerationQueue {
    id: string;
    type: 'pr_video' | 'social_share' | 'feedback_request';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    athleteId: string;
    athleteName: string;
    title: string;
    description: string;
    createdAt: Date;
    requiresAction: boolean;
    metadata: any;
}

export interface InterventionInsight {
    membershipId: string;
    athleteName: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    riskFactors: Array<{
        type: 'declining_checkins' | 'no_video_engagement' | 'missed_workouts' | 'negative_feedback_pattern';
        severity: number;
        description: string;
        trend: 'improving' | 'stable' | 'declining';
        lastOccurrence: Date;
    }>;
    recommendations: Array<{
        action: string;
        urgency: 'low' | 'medium' | 'high';
        description: string;
        estimatedImpact: string;
    }>;
    lastInteractionDate: Date | null;
    suggestedActions: string[];
}

export class BoxService {
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
     * Get box statistics for a given period
     */
    static async getBoxStats(
        boxId: string,
        period: "week" | "month" | "quarter" | "year" = "month"
    ): Promise<BoxStats> {
        // Calculate date range
        const now = new Date();
        const startDate = new Date();

        switch (period) {
            case "week":
                startDate.setDate(now.getDate() - 7);
                break;
            case "month":
                startDate.setMonth(now.getMonth() - 1);
                break;
            case "quarter":
                startDate.setMonth(now.getMonth() - 3);
                break;
            case "year":
                startDate.setFullYear(now.getFullYear() - 1);
                break;
        }

        // Get various statistics
        const [
            totalMembers,
            activeMembers,
            newMembers,
            totalPrs,
            totalCheckins,
            avgCheckinRate
        ] = await Promise.all([
            db.select({ count: count() })
                .from(boxMemberships)
                .where(eq(boxMemberships.boxId, boxId)),

            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                )),

            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    gte(boxMemberships.joinedAt, startDate)
                )),

            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, startDate)
                )),

            db.select({ count: count() })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),

            db.select({
                avg: sql<number>`AVG(${boxMemberships.checkinStreak})`
            })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                ))
        ]);

        return {
            members: {
                total: totalMembers[0].count,
                active: activeMembers[0].count,
                new: newMembers[0].count,
            },
            activity: {
                totalPrs: totalPrs[0].count,
                totalCheckins: totalCheckins[0].count,
                avgCheckinRate: Math.round((avgCheckinRate[0].avg || 0) * 10) / 10,
            },
            period,
            dateRange: {
                start: startDate,
                end: now,
            }
        };
    }

    /**
     * Create an invitation for a user to join the box
     */
    static async createInvitation(params: {
        boxId: string;
        email: string;
        role: BoxRole;
        invitedByUserId: string;
        personalMessage?: string;
    }) {
        const { boxId, email, role, invitedByUserId, personalMessage } = params;

        // Check if user is already a member
        const existingMember = await db
            .select({
                membershipId: boxMemberships.id,
                userEmail: user.email,
            })
            .from(boxMemberships)
            .innerJoin(user, eq(boxMemberships.userId, user.id))
            .where(
                and(
                    eq(boxMemberships.boxId, boxId),
                    eq(user.email, email)
                )
            )
            .limit(1);

        if (existingMember.length > 0) {
            throw new TRPCError({
                code: "CONFLICT",
                message: "User is already a member of this box"
            });
        }

        // Check if there's already a pending invite
        const existingInvite = await db
            .select()
            .from(boxInvites)
            .where(and(
                eq(boxInvites.boxId, boxId),
                eq(boxInvites.email, email),
                eq(boxInvites.status, "pending")
            ))
            .limit(1);

        if (existingInvite.length > 0) {
            throw new TRPCError({
                code: "CONFLICT",
                message: "There is already a pending invite for this email"
            });
        }

        // Generate secure token and public ID
        const token = crypto.randomUUID();
        const publicId = crypto.randomUUID();

        const [invite] = await db
            .insert(boxInvites)
            .values({
                boxId,
                email,
                role,
                token,
                publicId,
                invitedByUserId,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            })
            .returning();

        // TODO: Send invite email with personalMessage
        // You could call an email service here

        return invite;
    }

    /**
     * Get pending invites for a box
     */
    static async getPendingInvites(boxId: string) {
        return db
            .select()
            .from(boxInvites)
            .where(and(
                eq(boxInvites.boxId, boxId),
                eq(boxInvites.status, "pending"),
                gte(boxInvites.expiresAt, new Date())
            ))
            .orderBy(desc(boxInvites.createdAt));
    }

    /**
     * Cancel an invitation
     */
    static async cancelInvite(boxId: string, inviteId: string) {
        const [updatedInvite] = await db
            .update(boxInvites)
            .set({
                status: "canceled",
                updatedAt: new Date(),
            })
            .where(and(
                eq(boxInvites.id, inviteId),
                eq(boxInvites.boxId, boxId)
            ))
            .returning();

        if (!updatedInvite) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
        }

        return updatedInvite;
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

    /**
     * Create QR code for easy signup
     */
    static async createQrCode(params: {
        boxId: string;
        name: string;
        createdByUserId: string;
    }) {
        const { boxId, name, createdByUserId } = params;

        const publicId = crypto.randomUUID();
        const code = crypto.randomUUID().slice(0, 8).toUpperCase();

        const [qrCode] = await db
            .insert(boxQrCodes)
            .values({
                boxId,
                name,
                code,
                publicId,
                isActive: true,
                createdByUserId,
            })
            .returning();

        return qrCode;
    }

    /**
     * Get QR codes for a box
     */
    static async getQrCodes(boxId: string, activeOnly: boolean = true) {
        const conditions = [eq(boxQrCodes.boxId, boxId)];

        if (activeOnly) {
            conditions.push(eq(boxQrCodes.isActive, true));
        }

        return db
            .select()
            .from(boxQrCodes)
            .where(and(...conditions))
            .orderBy(desc(boxQrCodes.createdAt));
    }

    /**
     * Deactivate a QR code
     */
    static async deactivateQrCode(boxId: string, qrCodeId: string) {
        const [updated] = await db
            .update(boxQrCodes)
            .set({
                isActive: false,
                updatedAt: new Date(),
            })
            .where(and(
                eq(boxQrCodes.id, qrCodeId),
                eq(boxQrCodes.boxId, boxId)
            ))
            .returning();

        if (!updated) {
            throw new TRPCError({ code: "NOT_FOUND", message: "QR code not found" });
        }

        return updated;
    }

    /**
     * Get approval queue for a box
     */
    static async getApprovalQueue(
        boxId: string,
        status: "pending" | "approved" | "rejected" = "pending"
    ) {
        return db
            .select()
            .from(approvalQueue)
            .where(and(
                eq(approvalQueue.boxId, boxId),
                eq(approvalQueue.status, status)
            ))
            .orderBy(desc(approvalQueue.submittedAt));
    }

    /**
     * Process an approval request
     */
    static async processApproval(params: {
        boxId: string;
        approvalId: string;
        decision: "approved" | "rejected";
        decidedByUserId: string;
        notes?: string;
    }) {
        const { boxId, approvalId, decision, decidedByUserId, notes } = params;

        // Get the approval request
        const [approval] = await db
            .select()
            .from(approvalQueue)
            .where(and(
                eq(approvalQueue.id, approvalId),
                eq(approvalQueue.boxId, boxId),
                eq(approvalQueue.status, "pending")
            ))
            .limit(1);

        if (!approval) {
            throw new TRPCError({
                code: "NOT_FOUND",
                message: "Approval request not found"
            });
        }

        // Update approval status
        const [updatedApproval] = await db
            .update(approvalQueue)
            .set({
                status: decision,
                decidedAt: new Date(),
                decidedByUserId,
                notes,
                updatedAt: new Date(),
            })
            .where(eq(approvalQueue.id, approvalId))
            .returning();

        // If approved, create membership
        if (decision === "approved") {
            const userInfo = await db
                .select({ name: user.name, email: user.email })
                .from(user)
                .where(eq(user.id, approval.userId))
                .limit(1);

            const displayName = userInfo[0]?.name || userInfo[0]?.email || 'New Member';
            const membershipPublicId = crypto.randomUUID();

            await db
                .insert(boxMemberships)
                .values({
                    publicId: membershipPublicId,
                    boxId,
                    userId: approval.userId,
                    role: approval.requestedRole,
                    displayName,
                    isActive: true,
                });
        }

        return updatedApproval;
    }

    /**
     * Get enhanced box dashboard with video metrics
     */
    static async getDashboard(boxId: string): Promise<BoxDashboard> {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [
            boxInfo,
            memberCounts,
            recentActivity,
            pendingApprovals,
            recentPrs,
            videoPrs,
            checkinStats,
            videoEngagementMetrics,
            atRiskMembers
        ] = await Promise.all([
            // Box basic info
            db.select().from(boxes).where(eq(boxes.id, boxId)).limit(1),

            // Member counts by role
            db.select({
                role: boxMemberships.role,
                count: count()
            })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                ))
                .groupBy(boxMemberships.role),

            // Recent member activity
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    gte(boxMemberships.joinedAt, sevenDaysAgo)
                )),

            // Pending approvals count
            db.select({ count: count() })
                .from(approvalQueue)
                .where(and(
                    eq(approvalQueue.boxId, boxId),
                    eq(approvalQueue.status, "pending")
                )),

            // Recent PRs
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, sevenDaysAgo)
                )),

            // Recent video PRs
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, sevenDaysAgo),
                    sql`${athletePrs.gumletAssetId} IS NOT NULL`
                )),

            // Check-in statistics
            db.select({
                count: count(),
                avgStreak: sql<number>`AVG(${boxMemberships.checkinStreak})`
            })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    gte(boxMemberships.lastCheckinDate, sevenDaysAgo)
                )),

            // Video engagement metrics
            this.getVideoEngagementMetrics(boxId, thirtyDaysAgo),

            // At-risk members count
            this.getAtRiskMembersCount(boxId)
        ]);

        return {
            box: boxInfo[0],
            members: {
                byRole: memberCounts,
                recentJoins: recentActivity[0].count,
                atRiskCount: atRiskMembers
            },
            activity: {
                pendingApprovals: pendingApprovals[0].count,
                recentPrs: recentPrs[0].count,
                videoPrs: videoPrs[0].count,
                activeCheckins: checkinStats[0].count,
                avgStreak: Math.round((checkinStats[0].avgStreak || 0) * 10) / 10,
                pendingModerations: 0 // To be implemented with moderation queue
            },
            videoEngagement: videoEngagementMetrics
        };
    }

    /**
     * Get video engagement metrics for dashboard
     */
    private static async getVideoEngagementMetrics(boxId: string, since: Date) {
        const [totalVideoUploads, totalPrs, coachFeedbackCount, socialShares] = await Promise.all([
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    sql`${athletePrs.gumletAssetId} IS NOT NULL`,
                    gte(athletePrs.achievedAt, since)
                )),

            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, since)
                )),

            db.select({ count: count() })
                .from(prCoachFeedback)
                .innerJoin(athletePrs, eq(prCoachFeedback.prId, athletePrs.id))
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(prCoachFeedback.createdAt, since)
                )),

            db.select({ count: count() })
                .from(videoSocialShares)
                .innerJoin(athletePrs, eq(videoSocialShares.prId, athletePrs.id))
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(videoSocialShares.sharedAt, since)
                ))
        ]);

        const coachFeedbackRate = totalVideoUploads[0].count > 0 ?
            (coachFeedbackCount[0].count / totalVideoUploads[0].count) * 100 : 0;

        const videoVerificationRate = totalPrs[0].count > 0 ?
            (totalVideoUploads[0].count / totalPrs[0].count) * 100 : 0;

        return {
            totalVideoUploads: totalVideoUploads[0].count,
            coachFeedbackRate: Math.round(coachFeedbackRate),
            socialSharesCount: socialShares[0].count,
            avgVideoVerificationRate: Math.round(videoVerificationRate)
        };
    }

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

    /**
     * Get video celebration candidates for social sharing
     */
    static async getVideoCelebrationCandidates(
        boxId: string,
        days: number = 7
    ) {
        const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const candidates = await db
            .select({
                pr: athletePrs,
                athlete: {
                    displayName: boxMemberships.displayName,
                    publicId: boxMemberships.publicId
                }
            })
            .from(athletePrs)
            .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
            .innerJoin(videoConsents, and(
                eq(videoConsents.prId, athletePrs.id),
                sql`'box_visibility' = ANY(${videoConsents.consentTypes})`,
                sql`${videoConsents.revokedAt} IS NULL`
            ))
            .leftJoin(videoSocialShares, eq(videoSocialShares.prId, athletePrs.id))
            .where(and(
                eq(athletePrs.boxId, boxId),
                sql`${athletePrs.gumletAssetId} IS NOT NULL`,
                eq(athletePrs.videoProcessingStatus, 'ready'),
                gte(athletePrs.achievedAt, dateFrom),
                sql`${videoSocialShares.id} IS NULL` // Not already shared
            ))
            .orderBy(desc(athletePrs.achievedAt))
            .limit(10);

        return candidates.map(({ pr, athlete }) => ({
            prId: pr.id,
            athleteName: athlete.displayName || 'Athlete',
            athletePublicId: athlete.publicId,
            achievement: `${pr.value}${pr.unit}${pr.reps ? ` for ${pr.reps} reps` : ''}`,
            videoReady: true,
            thumbnailUrl: pr.thumbnailUrl,
            celebrationScore: this.calculateCelebrationScore(pr),
            achievedAt: pr.achievedAt
        }));
    }

    /**
     * Calculate celebration score for prioritizing social shares
     */
    private static calculateCelebrationScore(pr: typeof athletePrs.$inferSelect): number {
        let score = 50; // Base score

        // Higher scores for milestone weights
        if (pr.unit === 'lbs' || pr.unit === 'kg') {
            const weight = parseFloat(pr.value);
            const milestones = pr.unit === 'lbs' ? [135, 185, 225, 275, 315, 405] : [60, 85, 100, 125, 140, 185];
            if (milestones.some(m => Math.abs(weight - m) < (pr.unit === 'lbs' ? 5 : 2.5))) {
                score += 30;
            }
        }

        // Recent achievements get higher priority
        const daysOld = Math.floor((Date.now() - pr.achievedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOld <= 1) score += 20;
        else if (daysOld <= 3) score += 10;

        // PRs with notes show more engagement
        if (pr.notes && pr.notes.length > 10) score += 10;

        return score;
    }

    /**
     * Get count of at-risk members
     */
    private static async getAtRiskMembersCount(boxId: string): Promise<number> {
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

        const atRiskMembers = await db
            .select({ count: count() })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                sql`(${boxMemberships.lastCheckinDate} < ${twoWeeksAgo} OR ${boxMemberships.lastCheckinDate} IS NULL)`
            ));

        return atRiskMembers[0].count;
    }

    /**
     * Update box settings
     */
    static async updateBox(boxId: string, updates: Partial<{
        name: string;
        description: string;
        phone: string;
        address: string;
        city: string;
        state: string;
        zipCode: string;
        website: string;
        timezone: string;
        logo: string;
        requireApproval: boolean;
        allowPublicSignup: boolean;
    }>) {
        const [updated] = await db
            .update(boxes)
            .set({
                ...updates,
                updatedAt: new Date(),
            })
            .where(eq(boxes.id, boxId))
            .returning();

        return updated;
    }
}
