// lib/services/box/box-invite-service.ts
import {db} from "@/db";
import type {BoxRole} from "@/lib/services/box/types";
import {boxInvites, boxMemberships, user} from "@/db/schema";
import {and, desc, eq, gte} from "drizzle-orm";
import {TRPCError} from "@trpc/server";

export class BoxInviteService {
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
}
