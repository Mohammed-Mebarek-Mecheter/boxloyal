// routers/athlete/performance.ts - Enhanced version aligned with new schema
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { AthleteService } from "@/lib/services/athlete-service";
import {
    requireBoxMembership,
    canManageUser,
    checkSubscriptionLimits,
    canAccessAthleteData
} from "@/lib/permissions";
import { TRPCError } from "@trpc/server";

// Enhanced validation schemas
const videoUploadSchema = z.object({
    gumletAssetId: z.string(),
    consentTypes: z.array(z.enum(["coaching", "box_visibility", "public"])),
    thumbnailUrl: z.string().url().optional(),
    videoDuration: z.number().positive().optional(),
    collectionId: z.string().optional(),
    gumletMetadata: z.any().optional(),
});

const bodyPartSchema = z.enum([
    "neck", "shoulders", "chest", "upper_back", "lower_back", "abs",
    "biceps", "triceps", "forearms", "glutes", "quads", "hamstrings",
    "calves", "ankles", "knees", "hips", "wrists"
]);

export const athletePerformanceRouter = router({
    // Enhanced PR logging with video support and better validation
    logPr: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            movementId: z.uuid(),
            value: z.number().positive(),
            unit: z.string().min(1).max(20),
            reps: z.number().positive().optional(),
            notes: z.string().max(500).optional(),
            coachNotes: z.string().max(500).optional(),
            achievedAt: z.date().optional(),
            videoData: videoUploadSchema.optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canManage = await canManageUser(ctx, input.boxId, input.athleteId);
                if (!canManage) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot log PR for this athlete"
                    });
                }
            }

            return AthleteService.logPr(
                input.boxId,
                targetAthleteId,
                input.movementId,
                input.value,
                input.unit,
                {
                    reps: input.reps,
                    notes: input.notes,
                    coachNotes: input.coachNotes,
                    achievedAt: input.achievedAt,
                    verifiedByCoach: ["owner", "head_coach", "coach"].includes(membership.role),
                    videoData: input.videoData,
                }
            );
        }),

    // Enhanced PR retrieval with filtering and analytics
    getPrs: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            movementId: z.uuid().optional(),
            movementCategory: z.enum([
                "squat", "deadlift", "press", "olympic", "gymnastics", "cardio", "other"
            ]).optional(),
            dateFrom: z.date().optional(),
            dateTo: z.date().optional(),
            limit: z.number().min(1).max(100).default(20),
            includeVideo: z.boolean().default(false),
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
                        message: "Cannot view other athletes' PRs"
                    });
                }
            }

            const days = input.dateFrom
                ? Math.ceil((new Date().getTime() - input.dateFrom.getTime()) / (1000 * 60 * 60 * 24))
                : 365;

            return AthleteService.getRecentPRs(
                input.boxId,
                targetAthleteId,
                days,
                input.limit
            );
        }),

    // Log benchmark WOD result with enhanced validation
    logBenchmarkResult: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            benchmarkId: z.uuid(),
            value: z.number().positive(),
            valueType: z.enum(["time", "rounds_reps", "weight"]),
            scaled: z.boolean().default(false),
            scalingNotes: z.string().max(500).optional(),
            notes: z.string().max(500).optional(),
            coachNotes: z.string().max(500).optional(),
            achievedAt: z.date().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canManage = await canManageUser(ctx, input.boxId, input.athleteId);
                if (!canManage) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot log benchmark for this athlete"
                    });
                }
            }

            return AthleteService.logBenchmarkResult(
                input.boxId,
                targetAthleteId,
                input.benchmarkId,
                input.value,
                input.valueType,
                {
                    scaled: input.scaled,
                    scalingNotes: input.scalingNotes,
                    notes: input.notes,
                    coachNotes: input.coachNotes,
                    achievedAt: input.achievedAt,
                }
            );
        }),

    // Get benchmark results
    getBenchmarks: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            benchmarkId: z.uuid().optional(),
            category: z.enum(["girls", "hero", "open", "games", "custom"]).optional(),
            dateFrom: z.date().optional(),
            dateTo: z.date().optional(),
            limit: z.number().min(1).max(100).default(20),
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
                        message: "Cannot view other athletes' benchmarks"
                    });
                }
            }

            const days = input.dateFrom
                ? Math.ceil((new Date().getTime() - input.dateFrom.getTime()) / (1000 * 60 * 60 * 24))
                : 365;

            return AthleteService.getRecentBenchmarks(
                input.boxId,
                targetAthleteId,
                days,
                input.limit
            );
        }),

    // Process video webhook from Gumlet
    processVideoWebhook: protectedProcedure
        .input(z.object({
            asset_id: z.string(),
            status: z.string(),
            progress: z.number().min(0).max(100).optional(),
            webhook_id: z.string().optional(),
            metadata: z.any().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            // This endpoint should be called by Gumlet webhooks
            // You might want to add webhook signature verification here

            return AthleteService.processGumletWebhook(input);
        }),

    // Award achievement badges
    awardBadge: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid(),
            badgeType: z.enum([
                "checkin_streak", "pr_achievement", "benchmark_completion",
                "attendance", "consistency", "community"
            ]),
            title: z.string().min(1).max(100),
            description: z.string().max(500).optional(),
            icon: z.string().max(100).optional(),
            achievedValue: z.string().max(100).optional(),
            tier: z.number().min(1).max(10).default(1),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);

            // Only coaches and above can award badges
            if (!["owner", "head_coach", "coach"].includes(membership.role)) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Insufficient permissions to award badges"
                });
            }

            return AthleteService.awardBadge(
                input.boxId,
                input.athleteId,
                {
                    badgeType: input.badgeType,
                    title: input.title,
                    description: input.description,
                    icon: input.icon,
                    achievedValue: input.achievedValue,
                    tier: input.tier,
                }
            );
        }),

    // Get performance statistics
    getPerformanceStats: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            days: z.number().min(1).max(365).default(30),
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
                        message: "Cannot view other athletes' stats"
                    });
                }
            }

            return AthleteService.getAthleteStats(
                input.boxId,
                targetAthleteId,
                input.days
            );
        }),
});
