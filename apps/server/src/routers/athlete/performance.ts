// routers/athlete/performance.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { db } from "@/db";
import {
    athletePrs,
    athleteBenchmarks,
    movements,
    benchmarkWods,
    boxMemberships
} from "@/db/schema";
import {
    requireBoxMembership,
    canManageUser,
    checkSubscriptionLimits
} from "@/lib/permissions";
import { eq, and, desc, gte, lte, sql, count, avg } from "drizzle-orm";
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
            videoUrl: z.string().url().optional(),
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
                const targetMembership = await db
                    .select()
                    .from(boxMemberships)
                    .where(eq(boxMemberships.id, input.athleteId))
                    .limit(1);

                if (!targetMembership.length) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "Athlete not found" });
                }

                const canManage = await canManageUser(ctx, input.boxId, targetMembership[0].userId);
                if (!canManage) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot log PR for this athlete" });
                }
            }

            // Validate movement exists
            const movement = await db
                .select()
                .from(movements)
                .where(eq(movements.id, input.movementId))
                .limit(1);

            if (!movement.length) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Movement not found" });
            }

            // Generate public ID for shareable PRs
            const publicId = crypto.randomUUID();

            const [pr] = await db
                .insert(athletePrs)
                .values({
                    boxId: input.boxId,
                    membershipId: targetAthleteId,
                    movementId: input.movementId,
                    value: input.value.toString(),
                    unit: input.unit,
                    reps: input.reps,
                    notes: input.notes,
                    coachNotes: input.coachNotes,
                    videoUrl: input.videoUrl,
                    videoVisibility: input.videoVisibility,
                    achievedAt: input.achievedAt || new Date(),
                    publicId,
                    verifiedByCoach: ["owner", "head_coach", "coach"].includes(membership.role),
                })
                .returning();

            // Update athlete's streak and total check-ins if this is a self-log
            if (!input.athleteId || input.athleteId === membership.id) {
                await db
                    .update(boxMemberships)
                    .set({
                        totalCheckins: sql`${boxMemberships.totalCheckins} + 1`,
                        updatedAt: new Date()
                    })
                    .where(eq(boxMemberships.id, membership.id));
            }

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
                const targetMembership = await db
                    .select()
                    .from(boxMemberships)
                    .where(eq(boxMemberships.id, input.athleteId))
                    .limit(1);

                if (!targetMembership.length) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "Athlete not found" });
                }

                // Coaches can view any athlete's PRs, athletes can only view their own
                if (!["owner", "head_coach", "coach"].includes(membership.role)) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot view other athletes' PRs" });
                }
            }

            // Build conditions
            const conditions = [
                eq(athletePrs.boxId, input.boxId),
                eq(athletePrs.membershipId, targetAthleteId),
            ];

            if (input.movementId) {
                conditions.push(eq(athletePrs.movementId, input.movementId));
            }
            if (input.dateFrom) {
                conditions.push(gte(athletePrs.achievedAt, input.dateFrom));
            }
            if (input.dateTo) {
                conditions.push(lte(athletePrs.achievedAt, input.dateTo));
            }
            if (input.movementCategory) {
                conditions.push(eq(movements.category, input.movementCategory));
            }

            // Query PRs with movement info
            const prs = await db
                .select({
                    pr: athletePrs,
                    movement: movements,
                })
                .from(athletePrs)
                .innerJoin(movements, eq(athletePrs.movementId, movements.id))
                .where(and(...conditions))
                .orderBy(desc(athletePrs.achievedAt))
                .limit(input.limit);

            // Include analytics if requested
            let analytics = undefined;
            if (input.includeAnalytics && prs.length > 0) {
                const totalPrs = await db
                    .select({ count: count() })
                    .from(athletePrs)
                    .where(and(...conditions));

                const avgValue = await db
                    .select({ avg: avg(sql`CAST(${athletePrs.value} AS DECIMAL)`) })
                    .from(athletePrs)
                    .where(and(...conditions));

                analytics = {
                    totalPrs: totalPrs[0].count,
                    averageValue: avgValue[0].avg,
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
                const canManage = await canManageUser(ctx, input.boxId, input.athleteId);
                if (!canManage) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot log benchmark for this athlete"
                    });
                }
            }

            // Validate benchmark exists
            const benchmark = await db
                .select()
                .from(benchmarkWods)
                .where(eq(benchmarkWods.id, input.benchmarkId))
                .limit(1);

            if (!benchmark.length) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Benchmark WOD not found" });
            }

            const publicId = crypto.randomUUID();

            const [result] = await db
                .insert(athleteBenchmarks)
                .values({
                    boxId: input.boxId,
                    membershipId: targetAthleteId,
                    benchmarkId: input.benchmarkId,
                    result: input.result.toString(),
                    resultType: input.resultType,
                    scaled: input.scaled,
                    scalingNotes: input.scalingNotes,
                    notes: input.notes,
                    coachNotes: input.coachNotes,
                    completedAt: input.completedAt || new Date(),
                    publicId,
                })
                .returning();

            return result;
        }),
});