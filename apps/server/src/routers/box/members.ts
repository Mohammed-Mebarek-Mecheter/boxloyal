// routers/box/members.ts
import { protectedProcedure, router } from "@/lib/trpc";
import { z } from "zod";
import {
    requireBoxMembership,
    requireCoachOrAbove,
    checkSubscriptionLimits,
} from "@/lib/permissions";
import { BoxService } from "@/lib/services/box-service";
import { TRPCError } from "@trpc/server";
import { boxMemberships } from "@/db/schema";
import { db } from "@/db";
import { eq } from "drizzle-orm";

export const boxMembersRouter = router({
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
            const isCoachOrAbove = ["owner", "head_coach", "coach"].includes(membership.role);

            return BoxService.getMembers(input.boxId, {
                role: input.role,
                isActive: input.isActive,
                includeStats: input.includeStats,
                isCoachOrAbove,
            });
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

            return BoxService.createInvitation({
                boxId: input.boxId,
                email: input.email,
                role: input.role,
                invitedByUserId: ctx.session.user.id,
                personalMessage: input.personalMessage,
            });
        }),

    // Get pending invites (coaches and above)
    getPendingInvites: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return BoxService.getPendingInvites(input.boxId);
        }),

    // Cancel invite (coaches and above)
    cancelInvite: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            inviteId: z.uuid(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return BoxService.cancelInvite(input.boxId, input.inviteId);
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

            return BoxService.removeMember(input.membershipId, input.reason);
        }),

    // Get approval queue (owner and head coaches)
    getApprovalQueue: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            status: z.enum(["pending", "approved", "rejected"]).default("pending"),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return BoxService.getApprovalQueue(input.boxId, input.status);
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

            return BoxService.processApproval({
                boxId: input.boxId,
                approvalId: input.approvalId,
                decision: input.decision,
                decidedByUserId: ctx.session.user.id,
                notes: input.notes,
            });
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

            return BoxService.createQrCode({
                boxId: input.boxId,
                name: input.name,
                createdByUserId: ctx.session.user.id,
            });
        }),

    // Get QR codes (coaches and above)
    getQrCodes: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            activeOnly: z.boolean().default(true),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return BoxService.getQrCodes(input.boxId, input.activeOnly);
        }),

    // Deactivate QR code (coaches and above)
    deactivateQrCode: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            qrCodeId: z.uuid(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return BoxService.deactivateQrCode(input.boxId, input.qrCodeId);
        }),
});
