// routers/box.ts
import {protectedProcedure, router} from "@/lib/trpc";
import {z} from "zod";
import {db} from "@/db";
import {
    approvalQueue,
    athletePrs,
    athleteWellnessCheckins,
    boxes,
    boxInvites,
    boxMemberships,
    boxQrCodes,
    user
} from "@/db/schema";
import {
    checkSubscriptionLimits,
    getUserBoxMemberships,
    requireBoxMembership,
    requireBoxOwner,
    requireCoachOrAbove
} from "@/lib/permissions";
import {and, count, desc, eq, gte, sql} from "drizzle-orm";
import {TRPCError} from "@trpc/server";

export const boxRouter = router({
    // Create a new box (for new owners during signup)
    createBox: protectedProcedure
        .input(z.object({
            name: z.string().min(1).max(100),
            slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/),
            email: z.email(),
            phone: z.string().optional(),
            address: z.string().max(200).optional(),
            city: z.string().max(100).optional(),
            state: z.string().max(50).optional(),
            zipCode: z.string().max(20).optional(),
            country: z.string().max(50).default("US"),
            timezone: z.string().default("America/New_York"),
            website: z.string().url().optional(),
            description: z.string().max(500).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            // Check if user already owns a box (limit for starter tier)
            const existingMemberships = await getUserBoxMemberships(ctx);
            const ownerMemberships = existingMemberships.filter(m => m.membership.role === "owner");

            if (ownerMemberships.length >= 1) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "You can only own one box with your current subscription"
                });
            }

            // Check if slug is available
            const existingBox = await db
                .select()
                .from(boxes)
                .where(eq(boxes.slug, input.slug))
                .limit(1);

            if (existingBox.length > 0) {
                throw new TRPCError({
                    code: "CONFLICT",
                    message: "This box name is already taken"
                });
            }

            const publicId = crypto.randomUUID();
            const trialEndDate = new Date();
            trialEndDate.setDate(trialEndDate.getDate() + 14); // 14-day trial

            // Create the box
            const [box] = await db
                .insert(boxes)
                .values({
                    ...input,
                    publicId,
                    subscriptionStatus: "trial",
                    subscriptionTier: "starter",
                    trialStartsAt: new Date(),
                    trialEndsAt: trialEndDate,
                    status: "active",
                })
                .returning();

            // Create owner membership
            const membershipPublicId = crypto.randomUUID();
            await db
                .insert(boxMemberships)
                .values({
                    publicId: membershipPublicId,
                    boxId: box.id,
                    userId: ctx.session.user.id,
                    role: "owner",
                    isActive: true,
                });

            return box;
        }),

    // Update box settings (owner only)
    updateBox: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            name: z.string().min(1).max(100).optional(),
            description: z.string().max(500).optional(),
            phone: z.string().max(20).optional(),
            address: z.string().max(200).optional(),
            city: z.string().max(100).optional(),
            state: z.string().max(50).optional(),
            zipCode: z.string().max(20).optional(),
            website: z.string().url().optional(),
            timezone: z.string().optional(),
            logo: z.string().url().optional(),
            requireApproval: z.boolean().optional(),
            allowPublicSignup: z.boolean().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);
            await checkSubscriptionLimits(input.boxId);

            const { boxId, ...updates } = input;

            const [updated] = await db
                .update(boxes)
                .set({
                    ...updates,
                    updatedAt: new Date(),
                })
                .where(eq(boxes.id, boxId))
                .returning();

            return updated;
        }),

    // Get box members (coaches and above can view all, athletes see limited info)
    getMembers: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            role: z.enum(["owner", "head_coach", "coach", "athlete"]).optional(),
            isActive: z.boolean().default(true),
            includeStats: z.boolean().default(false),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);

            let whereConditions = and(
                eq(boxMemberships.boxId, input.boxId),
                eq(boxMemberships.isActive, input.isActive)
            );

            if (input.role) {
                whereConditions = and(whereConditions, eq(boxMemberships.role, input.role));
            }

            const isCoachOrAbove = ["owner", "head_coach", "coach"].includes(membership.role);

            // Base query with conditional fields based on permissions
            let query = db
                .select({
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
                    // Conditionally include sensitive information
                    ...(isCoachOrAbove && {
                        emergencyContact: boxMemberships.emergencyContact,
                        emergencyPhone: boxMemberships.emergencyPhone,
                        medicalNotes: boxMemberships.medicalNotes,
                        goals: boxMemberships.goals,
                    }),
                })
                .from(boxMemberships)
                .where(whereConditions);

            const members = await query.orderBy(desc(boxMemberships.joinedAt));

            // Add stats if requested and user has permission
            if (input.includeStats && isCoachOrAbove) {
                return await Promise.all(
                    members.map(async (member) => {
                        const [prCount, recentCheckins] = await Promise.all([
                            db.select({count: count()})
                                .from(athletePrs)
                                .where(eq(athletePrs.membershipId, member.id)),
                            db.select({count: count()})
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
            }

            return members;
        }),

    // Get box statistics (owner and coaches)
    getBoxStats: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            period: z.enum(["week", "month", "quarter", "year"]).default("month"),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            // Calculate date range
            const now = new Date();
            const startDate = new Date();

            switch (input.period) {
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
                    .where(eq(boxMemberships.boxId, input.boxId)),

                db.select({ count: count() })
                    .from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, input.boxId),
                        eq(boxMemberships.isActive, true)
                    )),

                db.select({ count: count() })
                    .from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, input.boxId),
                        gte(boxMemberships.joinedAt, startDate)
                    )),

                db.select({ count: count() })
                    .from(athletePrs)
                    .where(and(
                        eq(athletePrs.boxId, input.boxId),
                        gte(athletePrs.achievedAt, startDate)
                    )),

                db.select({ count: count() })
                    .from(athleteWellnessCheckins)
                    .where(and(
                        eq(athleteWellnessCheckins.boxId, input.boxId),
                        gte(athleteWellnessCheckins.checkinDate, startDate)
                    )),

                db.select({
                    avg: sql<number>`AVG(${boxMemberships.checkinStreak})`
                })
                    .from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, input.boxId),
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
                period: input.period,
                dateRange: {
                    start: startDate,
                    end: now,
                }
            };
        }),

    // Invite member (coaches and above)
    inviteMember: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            email: z.email(),
            role: z.enum(["head_coach", "coach", "athlete"]),
            personalMessage: z.string().max(500).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);
            await checkSubscriptionLimits(input.boxId);

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
                        eq(boxMemberships.boxId, input.boxId),
                        eq(user.email, input.email)
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
                    eq(boxInvites.boxId, input.boxId),
                    eq(boxInvites.email, input.email),
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
                    boxId: input.boxId,
                    email: input.email,
                    role: input.role,
                    token,
                    publicId,
                    invitedByUserId: ctx.session.user.id,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                })
                .returning();

            // TODO: Send invite email with personalMessage

            return invite;
        }),

    // Get pending invites (coaches and above)
    getPendingInvites: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return db
                .select()
                .from(boxInvites)
                .where(and(
                    eq(boxInvites.boxId, input.boxId),
                    eq(boxInvites.status, "pending"),
                    gte(boxInvites.expiresAt, new Date())
                ))
                .orderBy(desc(boxInvites.createdAt));
        }),

    // Cancel invite (coaches and above)
    cancelInvite: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            inviteId: z.uuid(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            const [updatedInvite] = await db
                .update(boxInvites)
                .set({
                    status: "canceled",
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(boxInvites.id, input.inviteId),
                    eq(boxInvites.boxId, input.boxId)
                ))
                .returning();

            if (!updatedInvite) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
            }

            return updatedInvite;
        }),

    // Remove/deactivate member (owner only, or head_coach for athletes/coaches)
    removeMember: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            membershipId: z.uuid(),
            reason: z.string().max(200).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);

            // Get target member info
            const [targetMember] = await db
                .select()
                .from(boxMemberships)
                .where(eq(boxMemberships.id, input.membershipId))
                .limit(1);

            if (!targetMember) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
            }

            // Permission check
            if (membership.role === "owner") {
                // Owners can remove anyone except themselves
                if (targetMember.userId === ctx.session.user.id) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot remove yourself as owner"
                    });
                }
            } else if (membership.role === "head_coach") {
                // Head coaches can remove coaches and athletes, but not owners or other head coaches
                if (["owner", "head_coach"].includes(targetMember.role)) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot remove owner or head coach"
                    });
                }
            } else {
                // Coaches and athletes cannot remove members
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Insufficient permissions"
                });
            }

            // Soft delete (set inactive)
            const [removed] = await db
                .update(boxMemberships)
                .set({
                    isActive: false,
                    leftAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(boxMemberships.id, input.membershipId))
                .returning();

            return removed;
        }),

    // Create QR code for easy signup (owner and head coaches)
    createQrCode: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            name: z.string().min(1).max(50),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);
            await checkSubscriptionLimits(input.boxId);

            const publicId = crypto.randomUUID();
            const code = crypto.randomUUID().slice(0, 8).toUpperCase();

            const [qrCode] = await db
                .insert(boxQrCodes)
                .values({
                    boxId: input.boxId,
                    name: input.name,
                    code,
                    publicId,
                    isActive: true,
                    createdByUserId: ctx.session.user.id,
                })
                .returning();

            return qrCode;
        }),

    // Get QR codes (coaches and above)
    getQrCodes: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            activeOnly: z.boolean().default(true),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            const conditions = [eq(boxQrCodes.boxId, input.boxId)];

            if (input.activeOnly) {
                conditions.push(eq(boxQrCodes.isActive, true));
            }

            return db
                .select()
                .from(boxQrCodes)
                .where(and(...conditions))
                .orderBy(desc(boxQrCodes.createdAt));
        }),

    // Deactivate QR code (coaches and above)
    deactivateQrCode: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            qrCodeId: z.uuid(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            const [updated] = await db
                .update(boxQrCodes)
                .set({
                    isActive: false,
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(boxQrCodes.id, input.qrCodeId),
                    eq(boxQrCodes.boxId, input.boxId)
                ))
                .returning();

            if (!updated) {
                throw new TRPCError({ code: "NOT_FOUND", message: "QR code not found" });
            }

            return updated;
        }),

    // Get approval queue (owner and head coaches)
    getApprovalQueue: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            status: z.enum(["pending", "approved", "rejected"]).default("pending"),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return db
                .select()
                .from(approvalQueue)
                .where(and(
                    eq(approvalQueue.boxId, input.boxId),
                    eq(approvalQueue.status, input.status)
                ))
                .orderBy(desc(approvalQueue.submittedAt));
        }),

    // Approve/reject member request (owner and head coaches)
    processApproval: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            approvalId: z.uuid(),
            decision: z.enum(["approved", "rejected"]),
            notes: z.string().max(500).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);
            await checkSubscriptionLimits(input.boxId);

            // Get the approval request
            const [approval] = await db
                .select()
                .from(approvalQueue)
                .where(and(
                    eq(approvalQueue.id, input.approvalId),
                    eq(approvalQueue.boxId, input.boxId),
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
                    status: input.decision,
                    decidedAt: new Date(),
                    decidedByUserId: ctx.session.user.id,
                    notes: input.notes,
                    updatedAt: new Date(),
                })
                .where(eq(approvalQueue.id, input.approvalId))
                .returning();

            // If approved, create membership
            if (input.decision === "approved") {
                const membershipPublicId = crypto.randomUUID();

                await db
                    .insert(boxMemberships)
                    .values({
                        publicId: membershipPublicId,
                        boxId: input.boxId,
                        userId: approval.userId,
                        role: approval.requestedRole,
                        isActive: true,
                    });
            }

            return updatedApproval;
        }),

    // Get box dashboard data (owner and coaches)
    getDashboard: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
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
                db.select().from(boxes).where(eq(boxes.id, input.boxId)).limit(1),

                // Member counts by role
                db.select({
                    role: boxMemberships.role,
                    count: count()
                })
                    .from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, input.boxId),
                        eq(boxMemberships.isActive, true)
                    ))
                    .groupBy(boxMemberships.role),

                // Recent member activity
                db.select({ count: count() })
                    .from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, input.boxId),
                        gte(boxMemberships.joinedAt, sevenDaysAgo)
                    )),

                // Pending approvals count
                db.select({ count: count() })
                    .from(approvalQueue)
                    .where(and(
                        eq(approvalQueue.boxId, input.boxId),
                        eq(approvalQueue.status, "pending")
                    )),

                // Recent PRs
                db.select({ count: count() })
                    .from(athletePrs)
                    .where(and(
                        eq(athletePrs.boxId, input.boxId),
                        gte(athletePrs.achievedAt, sevenDaysAgo)
                    )),

                // Check-in statistics
                db.select({
                    count: count(),
                    avgStreak: sql<number>`AVG(${boxMemberships.checkinStreak})`
                })
                    .from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, input.boxId),
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
        }),

    // Initialize demo data
    // implement it later
});
