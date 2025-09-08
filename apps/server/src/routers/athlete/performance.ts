// routers/athlete/performance.ts
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

export const athletePerformanceRouter = router({
    // Enhanced PR logging with better validation and features
    logPr: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(), // If not provided, logs for self
            movementId: z.uuid(),
            value: z.number().positive(),
            unit: z.string(),
            reps: z.number().positive().optional(),
            notes: z.string().max(500).optional(),
            coachNotes: z.string().max(500).optional(),
            videoUrl: z.url().optional(),
            videoVisibility: z.enum(["private", "box", "public"]).default("private"),
            achievedAt: z.date().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            // Check subscription limits
            await checkSubscriptionLimits(input.boxId);

            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check - can user manage this athlete?
            if (input.athleteId && input.athleteId !== membership.id) {
                const canManage = await canManageUser(ctx, input.boxId, targetAthleteId);
                if (!canManage) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot log PR for this athlete" });
                }
            }

            // Use AthleteService to log the PR
            const pr = await AthleteService.logPr(
                input.boxId,
                targetAthleteId,
                input.movementId,
                input.value,
                input.unit,
                {
                    reps: input.reps,
                    notes: input.notes,
                    coachNotes: input.coachNotes,
                    videoUrl: input.videoUrl,
                    videoVisibility: input.videoVisibility,
                    achievedAt: input.achievedAt,
                    verifiedByCoach: ["owner", "head_coach", "coach"].includes(membership.role),
                }
            );

            return pr;
        }),

    // Enhanced PR retrieval with filtering and analytics
    getPrs: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            movementId: z.uuid().optional(),
            movementCategory: z.enum(["squat", "deadlift", "press", "olympic", "gymnastics", "cardio", "other"]).optional(),
            dateFrom: z.date().optional(),
            dateTo: z.date().optional(),
            limit: z.number().min(1).max(100).default(20),
            includeAnalytics: z.boolean().default(false),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check for viewing other athletes' PRs
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, targetAthleteId);
                if (!canAccess) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot view other athletes' PRs" });
                }
            }

            // Use AthleteService to get PRs
            const prs = await AthleteService.getRecentPRs(
                input.boxId,
                targetAthleteId,
                input.dateFrom ? Math.ceil((new Date().getTime() - input.dateFrom.getTime()) / (1000 * 60 * 60 * 24)) : 365,
                input.limit
            );

            // Include analytics if requested
            let analytics = undefined;
            if (input.includeAnalytics && prs.length > 0) {
                const performanceSummary = await AthleteService.getPerformanceSummary(
                    input.boxId,
                    targetAthleteId,
                    input.dateFrom ? Math.ceil((new Date().getTime() - input.dateFrom.getTime()) / (1000 * 60 * 60 * 24)) : 30
                );

                analytics = {
                    totalPrs: performanceSummary.personalRecords,
                };
            }

            return { prs, analytics };
        }),

    // Log benchmark WOD result
    logBenchmarkResult: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            benchmarkId: z.uuid(),
            result: z.number().positive(),
            resultType: z.enum(["time", "rounds_reps", "weight"]),
            scaled: z.boolean().default(false),
            scalingNotes: z.string().max(500).optional(),
            notes: z.string().max(500).optional(),
            coachNotes: z.string().max(500).optional(),
            completedAt: z.date().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check for logging for others
            if (input.athleteId && input.athleteId !== membership.id) {
                const canManage = await canManageUser(ctx, input.boxId, targetAthleteId);
                if (!canManage) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot log benchmark for this athlete"
                    });
                }
            }

            // Use AthleteService to log benchmark result
            const result = await AthleteService.logBenchmarkResult(
                input.boxId,
                targetAthleteId,
                input.benchmarkId,
                input.result,
                input.resultType,
                {
                    scaled: input.scaled,
                    scalingNotes: input.scalingNotes,
                    notes: input.notes,
                    coachNotes: input.coachNotes,
                    completedAt: input.completedAt,
                }
            );

            return result;
        }),
});
