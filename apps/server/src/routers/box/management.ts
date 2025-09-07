// routers/box/management.ts
import { protectedProcedure, router } from "@/lib/trpc";
import { z } from "zod";
import {
    requireBoxOwner,
    checkSubscriptionLimits, getUserBoxMemberships, requireCoachOrAbove,
} from "@/lib/permissions";
import { BoxService } from "@/lib/services/box-service";
import { TRPCError } from "@trpc/server";
import {db} from "@/db";
import {boxes, boxMemberships} from "@/db/schema";
import {eq} from "drizzle-orm";

export const boxManagementRouter = router({
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

            return BoxService.updateBox(boxId, updates);
        }),

    // Get box dashboard data (owner and coaches)
    getDashboard: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return BoxService.getDashboard(input.boxId);
        }),
});