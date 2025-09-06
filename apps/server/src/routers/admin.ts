// routers/admin.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/permissions";
import { db } from "@/db";
import { boxes, boxMemberships } from "@/db/schema";
import {desc, count, eq} from "drizzle-orm";

export const adminRouter = router({
    // Platform stats (super admin only)
    getPlatformStats: protectedProcedure
        .query(async ({ ctx }) => {
            await requirePlatformAdmin(ctx);

            const [totalBoxes] = await db
                .select({ count: count() })
                .from(boxes);

            const [totalMembers] = await db
                .select({ count: count() })
                .from(boxMemberships)
                .where(eq(boxMemberships.isActive, true));

            return {
                totalBoxes: totalBoxes.count,
                totalMembers: totalMembers.count,
            };
        }),

    // List all boxes (admin only)
    getAllBoxes: protectedProcedure
        .input(z.object({
            page: z.number().min(1).default(1),
            limit: z.number().min(1).max(100).default(20),
        }))
        .query(async ({ ctx, input }) => {
            await requirePlatformAdmin(ctx);

            const offset = (input.page - 1) * input.limit;

            return db
                .select()
                .from(boxes)
                .orderBy(desc(boxes.createdAt))
                .limit(input.limit)
                .offset(offset);
        }),
});
