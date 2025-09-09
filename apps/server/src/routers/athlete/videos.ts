// routers/athlete/videos.ts - New router for video management and consent
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { AthleteService } from "@/lib/services/athlete-service";
import {
    requireBoxMembership,
    checkSubscriptionLimits,
    canAccessAthleteData,
    requireCoachOrAbove
} from "@/lib/permissions";
import { TRPCError } from "@trpc/server";

export const athleteVideosRouter = router({
    // Update video consent for a PR
    updateVideoConsent: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            prId: z.uuid(),
            consentTypes: z.array(z.enum(["coaching", "box_visibility", "public"])),
            revoke: z.boolean().default(false),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);

            // This would require implementing video consent management in AthleteService
            // For now, return placeholder
            return {
                success: true,
                message: input.revoke ? "Video consent revoked" : "Video consent updated",
                consentTypes: input.revoke ? [] : input.consentTypes,
            };
        }),

    // Get video processing status
    getVideoProcessingStatus: protectedProcedure
        .input(z.object({
            prId: z.uuid(),
        }))
        .query(async ({ ctx, input }) => {
            // Would need to implement this in AthleteService
            return {
                status: "ready" as const,
                progress: 100,
                thumbnailUrl: null,
                videoDuration: null,
                processingEvents: [],
            };
        }),

    // Process Gumlet webhook (this would typically be called by Gumlet, not through tRPC)
    processGumletWebhook: protectedProcedure
        .input(z.object({
            asset_id: z.string(),
            status: z.string(),
            progress: z.number().min(0).max(100).optional(),
            webhook_id: z.string().optional(),
            metadata: z.any().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            // In a real implementation, you'd want to verify the webhook signature
            return AthleteService.processGumletWebhook(input);
        }),

    // Get video processing events for a PR
    getVideoProcessingEvents: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            prId: z.uuid(),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);

            // Would need to check if user can access this PR's athlete data
            // For now, return placeholder
            return {
                events: [],
                currentStatus: "ready" as const,
                latestProgress: 100,
            };
        }),

    // Get videos by athlete (for coaches to review)
    getAthleteVideos: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid(),
            limit: z.number().min(1).max(50).default(20),
            status: z.enum(["pending", "upload_pending", "processing", "ready", "error"]).optional(),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);

            // Permission check - only coaches can view other athletes' videos
            if (input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' videos"
                    });
                }
            }

            // This would require implementing getAthleteVideos in AthleteService
            return {
                videos: [],
                totalCount: 0,
            };
        }),
});
