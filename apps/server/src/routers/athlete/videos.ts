// routers/athlete/videos.ts - Complete video management router
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { AthleteService } from "@/lib/services/athlete-service";
import { GumletService } from "@/lib/services/gumlet-service";
import {
    requireBoxMembership,
    canAccessAthleteData,
    requireCoachOrAbove,
    checkSubscriptionLimits
} from "@/lib/permissions";
import { TRPCError } from "@trpc/server";

// Enhanced validation schemas
const videoConsentSchema = z.enum(["coaching", "box_visibility", "public"]);

const videoQualitySchema = z.enum(["standard", "hd", "premium"]);

const analysisDepthSchema = z.enum(["basic", "detailed", "comprehensive"]);

export const athleteVideosRouter = router({
    // Initialize PR video upload
    initializePRVideo: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            movementId: z.uuid(),
            title: z.string().max(100).optional(),
            tags: z.array(z.string().max(50)).max(10).optional(),
            expectedDuration: z.number().min(5).max(300).optional(), // 5 seconds to 5 minutes
            quality: videoQualitySchema.default("standard"),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check - only the athlete or coaches can initialize videos
            if (input.athleteId && input.athleteId !== membership.id) {
                await requireCoachOrAbove(ctx, input.boxId);
            }

            return AthleteService.initializePRVideo(
                input.boxId,
                targetAthleteId,
                input.movementId,
                {
                    title: input.title,
                    tags: input.tags,
                    expectedDuration: input.expectedDuration,
                    quality: input.quality,
                }
            );
        }),

    // Complete PR with video
    completePRWithVideo: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            movementId: z.uuid(),
            prData: z.object({
                value: z.number().positive(),
                unit: z.string().min(1).max(20),
                reps: z.number().positive().optional(),
                notes: z.string().max(500).optional(),
                coachNotes: z.string().max(500).optional(),
                achievedAt: z.date().optional(),
            }),
            videoData: z.object({
                gumletAssetId: z.string(),
                consentTypes: z.array(videoConsentSchema).min(1),
                customThumbnailTime: z.number().min(0).optional(),
                thumbnailUrl: z.string().url().optional(),
                videoDuration: z.number().positive().optional(),
                collectionId: z.string().optional(),
                gumletMetadata: z.any().optional(),
            }),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                await requireCoachOrAbove(ctx, input.boxId);
            }

            return AthleteService.completePRWithVideo(
                input.boxId,
                targetAthleteId,
                input.movementId,
                input.prData,
                input.videoData
            );
        }),

    // Get video processing status
    getVideoStatus: protectedProcedure
        .input(z.object({
            gumletAssetId: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            // Basic auth check - specific access control handled by the service
            return AthleteService.getVideoStatus(input.gumletAssetId);
        }),

    // Get video analytics
    getVideoAnalytics: protectedProcedure
        .input(z.object({
            gumletAssetId: z.string(),
            timeframe: z.enum(["24h", "7d", "30d"]).default("7d"),
        }))
        .query(async ({ ctx, input }) => {
            return AthleteService.getVideoAnalytics(input.gumletAssetId, input.timeframe);
        }),

    // Compare PR videos for form analysis
    comparePRVideos: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            currentPRId: z.uuid(),
            previousPRId: z.uuid().optional(),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);

            return AthleteService.comparePRVideos(
                input.currentPRId,
                input.previousPRId
            );
        }),

    // Update video consent
    updateVideoConsent: protectedProcedure
        .input(z.object({
            prId: z.uuid(),
            consentTypes: z.array(videoConsentSchema).min(1),
        }))
        .mutation(async ({ ctx, input }) => {
            // Get membership for the user making the request
            const membership = ctx.auth.user.memberships?.[0];
            if (!membership) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "No box membership found"
                });
            }

            return AthleteService.updateVideoConsent(
                input.prId,
                membership.id,
                input.consentTypes
            );
        }),

    // Get athlete video history
    getAthleteVideoHistory: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            limit: z.number().min(1).max(50).default(20),
            movementId: z.uuid().optional(),
            includeAnalytics: z.boolean().default(false),
            dateFrom: z.date().optional(),
            dateTo: z.date().optional(),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' video history"
                    });
                }
            }

            return AthleteService.getAthleteVideoHistory(
                input.boxId,
                targetAthleteId,
                {
                    limit: input.limit,
                    movementId: input.movementId,
                    includeAnalytics: input.includeAnalytics,
                    dateFrom: input.dateFrom,
                    dateTo: input.dateTo,
                }
            );
        }),

    // Get box video statistics (coaches only)
    getBoxVideoStats: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            days: z.number().min(1).max(365).default(30),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return AthleteService.getBoxVideoStats(input.boxId, input.days);
        }),

    // Get video consent status
    getVideoConsentStatus: protectedProcedure
        .input(z.object({
            prId: z.uuid(),
        }))
        .query(async ({ ctx, input }) => {
            return AthleteService.getVideoConsentStatus(input.prId);
        }),

    // Create highlight reel
    createHighlightReel: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            prIds: z.array(z.uuid()).min(2).max(10),
            title: z.string().max(100).optional(),
            duration: z.number().min(30).max(300).default(120), // 30 seconds to 5 minutes
            includeComparison: z.boolean().default(false),
            musicTrack: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot create highlight reel for this athlete"
                    });
                }
            }

            return AthleteService.createHighlightReel(
                input.boxId,
                targetAthleteId,
                input.prIds,
                {
                    title: input.title,
                    duration: input.duration,
                    includeComparison: input.includeComparison,
                    musicTrack: input.musicTrack,
                }
            );
        }),

    // Generate technique insights
    generateTechniqueInsights: protectedProcedure
        .input(z.object({
            prId: z.uuid(),
            includeComparison: z.boolean().default(false),
            previousPRId: z.uuid().optional(),
            analysisDepth: analysisDepthSchema.default("basic"),
        }))
        .query(async ({ ctx, input }) => {
            return AthleteService.generateTechniqueInsights(
                input.prId,
                {
                    includeComparison: input.includeComparison,
                    previousPRId: input.previousPRId,
                    analysisDepth: input.analysisDepth,
                }
            );
        }),

    // Update video thumbnail
    updateVideoThumbnail: protectedProcedure
        .input(z.object({
            gumletAssetId: z.string(),
            frameAtSecond: z.number().min(0),
        }))
        .mutation(async ({ ctx, input }) => {
            // Permission check would be handled by verifying the asset belongs to the user
            await GumletService.updateThumbnail(input.gumletAssetId, input.frameAtSecond);

            return { success: true, message: "Thumbnail updated successfully" };
        }),

    // Delete video
    deleteVideo: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            prId: z.uuid(),
            gumletAssetId: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);

            // Additional permission checks would go here to verify ownership

            try {
                await GumletService.deleteAsset(input.gumletAssetId);

                // Update PR record to remove video reference
                // This would require adding a method to AthleteService

                return { success: true, message: "Video deleted successfully" };
            } catch (error: any) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to delete video: ${error.message}`
                });
            }
        }),

    // Batch process video webhooks (internal use)
    processVideoWebhookBatch: protectedProcedure
        .input(z.object({
            webhooks: z.array(z.object({
                asset_id: z.string(),
                status: z.string(),
                progress: z.number().min(0).max(100).optional(),
                webhook_id: z.string().optional(),
                metadata: z.any().optional(),
            })).max(50), // Process up to 50 webhooks at once
        }))
        .mutation(async ({ ctx, input }) => {
            // This would typically be called by an internal service or webhook handler
            return AthleteService.processVideoWebhookBatch(input.webhooks);
        }),

    // Get video recommendations for technique improvement
    getVideoRecommendations: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            movementId: z.uuid(),
            currentSkillLevel: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate"),
            focusAreas: z.array(z.enum(["setup", "execution", "completion", "mobility", "strength"])).optional(),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view recommendations for this athlete"
                    });
                }
            }

            // Mock implementation - in production, this would analyze the athlete's video history
            // and provide personalized recommendations
            return {
                recommendedVideos: [
                    {
                        title: "Perfect Your Setup Position",
                        description: "Focus on consistent foot placement and grip width",
                        duration: 180,
                        difficulty: "beginner",
                        focusArea: "setup"
                    },
                    {
                        title: "Bar Path Optimization",
                        description: "Learn to maintain optimal bar path for maximum efficiency",
                        duration: 240,
                        difficulty: "intermediate",
                        focusArea: "execution"
                    }
                ],
                drillSuggestions: [
                    "Practice pause bench press at 50-60% of max",
                    "Record setup routine from side angle",
                    "Focus on controlled eccentric phase"
                ],
                nextMilestone: {
                    description: "Achieve consistent bar path in 80% of recorded lifts",
                    estimatedTimeframe: "2-4 weeks"
                }
            };
        }),

    // Create video analysis report (coaches only)
    createVideoAnalysisReport: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid(),
            prIds: z.array(z.uuid()).min(1).max(20),
            reportType: z.enum(["progress", "technique", "comparison"]).default("progress"),
            timeframe: z.enum(["month", "quarter", "year"]).default("month"),
            includeRecommendations: z.boolean().default(true),
        }))
        .mutation(async ({ ctx, input }) => {
            const membership = await requireCoachOrAbove(ctx, input.boxId);

            // Mock implementation - in production, this would generate comprehensive analysis
            const report = {
                reportId: crypto.randomUUID(),
                athleteId: input.athleteId,
                reportType: input.reportType,
                timeframe: input.timeframe,
                generatedAt: new Date(),
                generatedBy: membership.id,
                summary: {
                    totalVideosAnalyzed: input.prIds.length,
                    avgTechnicalScore: 82.5,
                    improvementTrend: "positive",
                    keyFindings: [
                        "Consistent improvement in setup phase",
                        "Bar path deviation reduced by 15%",
                        "Strength gains evident in heavier lifts"
                    ]
                },
                recommendations: input.includeRecommendations ? [
                    "Continue focusing on pause work for stability",
                    "Add accessory work for upper back strength",
                    "Record more training sessions for better analysis"
                ] : [],
                detailedAnalysis: {
                    technicalProgression: [],
                    strengthProgression: [],
                    consistencyMetrics: {}
                }
            };

            return report;
        })
});
