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
    user
} from "@/db/schema";
import { eq, and, desc, gte, count, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

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
    stats?: {
        totalPrs: number;
        recentCheckins: number;
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
    };
    activity: {
        pendingApprovals: number;
        recentPrs: number;
        activeCheckins: number;
        avgStreak: number;
    };
}

export class BoxService {
    /**
     * Get box members with optional filtering and stats
     */
    static async getMembers(
        boxId: string,
        options: {
            role?: BoxRole;
            isActive?: boolean;
            includeStats?: boolean;
            isCoachOrAbove?: boolean;
        } = {}
    ): Promise<MemberWithStats[]> {
        const { role, isActive = true, includeStats = false, isCoachOrAbove = false } = options;

        let whereConditions = and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.isActive, isActive)
        );

        if (role) {
            whereConditions = and(whereConditions, eq(boxMemberships.role, role));
        }

        // Base query with conditional fields based on permissions
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

        // Add stats if requested and user has permission
        if (includeStats && isCoachOrAbove) {
            const membersWithStats = await Promise.all(
                members.map(async (member) => {
                    const [prCount, recentCheckins] = await Promise.all([
                        db.select({ count: count() })
                            .from(athletePrs)
                            .where(eq(athletePrs.membershipId, member.id)),
                        db.select({ count: count() })
                            .from(athleteWellnessCheckins)
                            .where(and(
                                eq(athleteWellnessCheckins.membershipId, member.id),
                                gte(athleteWellnessCheckins.checkinDate,
                                    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
                            ))
                    ]);

                    return {
                        ...member,
                        stats: {
                            totalPrs: prCount[0].count,
                            recentCheckins: recentCheckins[0].count,
                        }
                    };
                })
            );

            return membersWithStats as MemberWithStats[];
        }

        return members as MemberWithStats[];
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
            const membershipPublicId = crypto.randomUUID();

            await db
                .insert(boxMemberships)
                .values({
                    publicId: membershipPublicId,
                    boxId,
                    userId: approval.userId,
                    role: approval.requestedRole,
                    isActive: true,
                });
        }

        return updatedApproval;
    }

    /**
     * Get box dashboard data
     */
    static async getDashboard(boxId: string): Promise<BoxDashboard> {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Get various dashboard metrics
        const [
            boxInfo,
            memberCounts,
            recentActivity,
            pendingApprovals,
            recentPrs,
            checkinStats
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
                ))
        ]);

        return {
            box: boxInfo[0],
            members: {
                byRole: memberCounts,
                recentJoins: recentActivity[0].count,
            },
            activity: {
                pendingApprovals: pendingApprovals[0].count,
                recentPrs: recentPrs[0].count,
                activeCheckins: checkinStats[0].count,
                avgStreak: Math.round((checkinStats[0].avgStreak || 0) * 10) / 10,
            }
        };
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