// routers/box.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { db } from "@/db";
import { boxes, boxMemberships, boxInvites } from "@/db/schema";
import {
    requireBoxOwner,
    requireBoxMembership,
    requireCoachOrAbove
} from "@/lib/permissions";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const boxRouter = router({
    // Get box details (any member can view)
    getBox: protectedProcedure
        .input(z.object({ boxId: z.string() }))
        .query(async ({ ctx, input }) => {
            await requireBoxMembership(ctx, input.boxId);

            const box = await db
                .select()
                .from(boxes)
                .where(eq(boxes.id, input.boxId))
                .limit(1);

            if (!box.length) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Box not found" });
            }

            return box[0];
        }),

    // Update box settings (owner only)
    updateBox: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            name: z.string().min(1).optional(),
            description: z.string().optional(),
            timezone: z.string().optional(),
            requireApproval: z.boolean().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

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
            boxId: z.string(),
            role: z.enum(["owner", "head_coach", "coach", "athlete"]).optional(),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);

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
                    // Only include personal info for coaches and above
                    ...(["owner", "head_coach", "coach"].includes(membership.role) && {
                        emergencyContact: boxMemberships.emergencyContact,
                        emergencyPhone: boxMemberships.emergencyPhone,
                        goals: boxMemberships.goals,
                    }),
                })
                .from(boxMemberships)
                .where(eq(boxMemberships.boxId, input.boxId));

            if (input.role) {
                query = query.where(eq(boxMemberships.role, input.role));
            }

            return await query.orderBy(desc(boxMemberships.joinedAt));
        }),

    // Invite member (coaches and above)
    inviteMember: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            email: z.string().email(),
            role: z.enum(["head_coach", "coach", "athlete"]),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            // Generate secure token and public ID
            const token = crypto.randomUUID();
            const publicId = crypto.randomUUID(); // Use CUID2 in production

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

            // TODO: Send invite email

            return invite;
        }),

    // Remove member (owner only, or head_coach for athletes/coaches)
    removeMember: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            membershipId: z.string(),
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
                // Owners can remove anyone
            } else if (membership.role === "head_coach") {
                // Head coaches can remove coaches and athletes, but not owners
                if (targetMember.role === "owner") {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot remove owner" });
                }
            } else {
                // Coaches and athletes cannot remove members
                throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
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
});
