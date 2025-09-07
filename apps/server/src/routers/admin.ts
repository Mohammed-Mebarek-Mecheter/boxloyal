// routers/admin.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/permissions";
import { db } from "@/db";
import {boxes, boxMemberships, user} from "@/db/schema";
import {desc, count, eq, gte} from "drizzle-orm";

export const adminRouter = router({
    getPlatformStats: protectedProcedure
        .query(async ({ ctx }) => {
            await requirePlatformAdmin(ctx);

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const [
                totalBoxes,
                activeBoxes,
                totalUsers,
                recentSignups,
                totalMemberships,
                activeMemberships
            ] = await Promise.all([
                db.select({ count: count() }).from(boxes),
                db.select({ count: count() })
                    .from(boxes)
                    .where(eq(boxes.status, "active")),
                db.select({ count: count() }).from(user),
                db.select({ count: count() })
                    .from(user)
                    .where(gte(user.createdAt, thirtyDaysAgo)),
                db.select({ count: count() }).from(boxMemberships),
                db.select({ count: count() })
                    .from(boxMemberships)
                    .where(eq(boxMemberships.isActive, true))
            ]);

            return {
                boxes: {
                    total: totalBoxes[0].count,
                    active: activeBoxes[0].count,
                },
                users: {
                    total: totalUsers[0].count,
                    recentSignups: recentSignups[0].count,
                },
                memberships: {
                    total: totalMemberships[0].count,
                    active: activeMemberships[0].count,
                }
            };
        }),

    // Get all boxes (platform admin only)
    getAllBoxes: protectedProcedure
        .input(z.object({
            limit: z.number().min(1).max(100).default(20),
            offset: z.number().min(0).default(0),
            status: z.enum(["active", "suspended", "trial_expired"]).optional(),
        }))
        .query(async ({ ctx, input }) => {
            await requirePlatformAdmin(ctx);

            const whereConditions = input.status ? eq(boxes.status, input.status) : undefined;

            const boxesData = await db
                .select()
                .from(boxes)
                .where(whereConditions)
                .orderBy(desc(boxes.createdAt))
                .limit(input.limit)
                .offset(input.offset);

            const totalCount = await db
                .select({ count: count() })
                .from(boxes)
                .where(whereConditions);

            return {
                boxes: boxesData,
                pagination: {
                    total: totalCount[0].count,
                    limit: input.limit,
                    offset: input.offset,
                    hasMore: (input.offset + input.limit) < totalCount[0].count,
                }
            };
        }),

    // Suspend/unsuspend box (platform admin only)
    updateBoxStatus: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            status: z.enum(["active", "suspended", "trial_expired"]),
            reason: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requirePlatformAdmin(ctx);

            const [updatedBox] = await db
                .update(boxes)
                .set({
                    status: input.status,
                    updatedAt: new Date(),
                })
                .where(eq(boxes.id, input.boxId))
                .returning();

            return updatedBox;
        }),
});
