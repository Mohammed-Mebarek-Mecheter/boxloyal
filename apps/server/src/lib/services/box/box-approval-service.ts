// lib/services/box/box-approval-service.ts
import {db} from "@/db";
import {approvalQueue, boxMemberships, user} from "@/db/schema";
import {and, desc, eq} from "drizzle-orm";
import {TRPCError} from "@trpc/server";

export class BoxApprovalService {
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
}
