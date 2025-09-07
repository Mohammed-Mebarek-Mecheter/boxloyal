// routers/athlete.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { db } from "@/db";
import {
    athletePrs,
    athleteWellnessCheckins,
    athleteBenchmarks,
    wodFeedback,
    athleteBadges,
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

export const athleteRouter = router({
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

    // Enhanced wellness check-in with validation
    submitWellnessCheckin: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            energyLevel: z.number().min(1).max(10),
            sleepQuality: z.number().min(1).max(10),
            stressLevel: z.number().min(1).max(10),
            motivationLevel: z.number().min(1).max(10),
            workoutReadiness: z.number().min(1).max(10),
            soreness: z.record(z.string(), z.number().min(0).max(10)).optional(),
            painAreas: z.record(z.string(), z.number().min(0).max(10)).optional(),
            hydrationLevel: z.number().min(1).max(10).optional(),
            nutritionQuality: z.number().min(1).max(10).optional(),
            outsideActivity: z.enum(["none", "light", "moderate", "heavy"]).optional(),
            mood: z.string().max(100).optional(),
            notes: z.string().max(500).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);

            // Check if already checked in today
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const existingCheckin = await db
                .select()
                .from(athleteWellnessCheckins)
                .where(
                    and(
                        eq(athleteWellnessCheckins.boxId, input.boxId),
                        eq(athleteWellnessCheckins.membershipId, membership.id),
                        gte(athleteWellnessCheckins.checkinDate, today),
                        lte(athleteWellnessCheckins.checkinDate, tomorrow)
                    )
                )
                .limit(1);

            if (existingCheckin.length > 0) {
                throw new TRPCError({
                    code: "CONFLICT",
                    message: "You have already checked in today"
                });
            }

            const [checkin] = await db
                .insert(athleteWellnessCheckins)
                .values({
                    boxId: input.boxId,
                    membershipId: membership.id,
                    energyLevel: input.energyLevel,
                    sleepQuality: input.sleepQuality,
                    stressLevel: input.stressLevel,
                    motivationLevel: input.motivationLevel,
                    workoutReadiness: input.workoutReadiness,
                    soreness: input.soreness ? JSON.stringify(input.soreness) : null,
                    painAreas: input.painAreas ? JSON.stringify(input.painAreas) : null,
                    hydrationLevel: input.hydrationLevel,
                    nutritionQuality: input.nutritionQuality,
                    outsideActivity: input.outsideActivity,
                    mood: input.mood,
                    notes: input.notes,
                    checkinDate: new Date(),
                })
                .returning();

            // Calculate and update check-in streak
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const yesterdayCheckin = await db
                .select()
                .from(athleteWellnessCheckins)
                .where(
                    and(
                        eq(athleteWellnessCheckins.boxId, input.boxId),
                        eq(athleteWellnessCheckins.membershipId, membership.id),
                        gte(athleteWellnessCheckins.checkinDate, yesterday),
                        lte(athleteWellnessCheckins.checkinDate, today)
                    )
                )
                .limit(1);

            const newStreak = yesterdayCheckin.length > 0 ? membership.checkinStreak + 1 : 1;
            const newLongestStreak = Math.max(membership.longestCheckinStreak, newStreak);

            await db
                .update(boxMemberships)
                .set({
                    lastCheckinDate: new Date(),
                    totalCheckins: membership.totalCheckins + 1,
                    checkinStreak: newStreak,
                    longestCheckinStreak: newLongestStreak,
                    updatedAt: new Date(),
                })
                .where(eq(boxMemberships.id, membership.id));

            return checkin;
        }),

    // Get wellness check-ins with trend analysis
    getWellnessCheckins: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            days: z.number().min(1).max(90).default(30),
            includeTrends: z.boolean().default(false),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                if (!["owner", "head_coach", "coach"].includes(membership.role)) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' check-ins"
                    });
                }
            }

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - input.days);

            const checkins = await db
                .select()
                .from(athleteWellnessCheckins)
                .where(
                    and(
                        eq(athleteWellnessCheckins.boxId, input.boxId),
                        eq(athleteWellnessCheckins.membershipId, targetAthleteId),
                        gte(athleteWellnessCheckins.checkinDate, startDate)
                    )
                )
                .orderBy(desc(athleteWellnessCheckins.checkinDate));

            let trends = undefined;
            if (input.includeTrends && checkins.length > 0) {
                const avgEnergy = checkins.reduce((sum, c) => sum + c.energyLevel, 0) / checkins.length;
                const avgSleep = checkins.reduce((sum, c) => sum + c.sleepQuality, 0) / checkins.length;
                const avgStress = checkins.reduce((sum, c) => sum + c.stressLevel, 0) / checkins.length;
                const avgMotivation = checkins.reduce((sum, c) => sum + c.motivationLevel, 0) / checkins.length;
                const avgReadiness = checkins.reduce((sum, c) => sum + c.workoutReadiness, 0) / checkins.length;

                trends = {
                    averages: {
                        energy: Math.round(avgEnergy * 10) / 10,
                        sleep: Math.round(avgSleep * 10) / 10,
                        stress: Math.round(avgStress * 10) / 10,
                        motivation: Math.round(avgMotivation * 10) / 10,
                        readiness: Math.round(avgReadiness * 10) / 10,
                    },
                    checkinCount: checkins.length,
                    checkinRate: Math.round((checkins.length / input.days) * 100),
                };
            }

            return { checkins, trends };
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

    // Submit WOD feedback
    submitWodFeedback: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            rpe: z.number().min(1).max(10),
            difficultyRating: z.number().min(1).max(10),
            enjoymentRating: z.number().min(1).max(10).optional(),
            painDuringWorkout: z.record(z.string(), z.number().min(0).max(10)).optional(),
            feltGoodMovements: z.string().max(200).optional(),
            struggledMovements: z.string().max(200).optional(),
            completed: z.boolean().default(true),
            scalingUsed: z.boolean().default(false),
            scalingDetails: z.string().max(300).optional(),
            workoutTime: z.number().positive().optional(), // in minutes
            result: z.string().max(100).optional(),
            notes: z.string().max(500).optional(),
            wodName: z.string().max(100).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);

            const [feedback] = await db
                .insert(wodFeedback)
                .values({
                    boxId: input.boxId,
                    membershipId: membership.id,
                    rpe: input.rpe,
                    difficultyRating: input.difficultyRating,
                    enjoymentRating: input.enjoymentRating,
                    painDuringWorkout: input.painDuringWorkout ? JSON.stringify(input.painDuringWorkout) : null,
                    feltGoodMovements: input.feltGoodMovements,
                    struggledMovements: input.struggledMovements,
                    completed: input.completed,
                    scalingUsed: input.scalingUsed,
                    scalingDetails: input.scalingDetails,
                    workoutTime: input.workoutTime,
                    result: input.result,
                    notes: input.notes,
                    wodName: input.wodName,
                    wodDate: new Date(),
                })
                .returning();

            return feedback;
        }),

    // Get athlete's badges and achievements
    getBadges: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                if (!["owner", "head_coach", "coach"].includes(membership.role)) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' badges"
                    });
                }
            }

            return db
                .select()
                .from(athleteBadges)
                .where(
                    and(
                        eq(athleteBadges.boxId, input.boxId),
                        eq(athleteBadges.membershipId, targetAthleteId),
                        eq(athleteBadges.isHidden, false)
                    )
                )
                .orderBy(desc(athleteBadges.awardedAt));
        }),

    // Get athlete profile with comprehensive data
    getAthleteProfile: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            includePrs: z.boolean().default(true),
            includeRecentActivity: z.boolean().default(true),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Get target athlete membership
            const targetMembership = await db
                .select()
                .from(boxMemberships)
                .where(eq(boxMemberships.id, targetAthleteId))
                .limit(1);

            if (!targetMembership.length) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Athlete not found" });
            }

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                if (!["owner", "head_coach", "coach"].includes(membership.role)) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' profiles"
                    });
                }
            }

            const profile = targetMembership[0];
            let recentPrs: {
                pr: typeof athletePrs.$inferSelect;
                movement: typeof movements.$inferSelect;
            }[] = [];

            let recentActivity: typeof athleteWellnessCheckins.$inferSelect[] = [];

            if (input.includePrs) {
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                recentPrs = await db
                    .select({
                        pr: athletePrs,
                        movement: movements,
                    })
                    .from(athletePrs)
                    .innerJoin(movements, eq(athletePrs.movementId, movements.id))
                    .where(
                        and(
                            eq(athletePrs.boxId, input.boxId),
                            eq(athletePrs.membershipId, targetAthleteId),
                            gte(athletePrs.achievedAt, thirtyDaysAgo)
                        )
                    )
                    .orderBy(desc(athletePrs.achievedAt))
                    .limit(10);
            }

            if (input.includeRecentActivity) {
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                recentActivity = await db
                    .select()
                    .from(athleteWellnessCheckins)
                    .where(
                        and(
                            eq(athleteWellnessCheckins.boxId, input.boxId),
                            eq(athleteWellnessCheckins.membershipId, targetAthleteId),
                            gte(athleteWellnessCheckins.checkinDate, sevenDaysAgo)
                        )
                    )
                    .orderBy(desc(athleteWellnessCheckins.checkinDate))
                    .limit(7);
            }

            return {
                profile,
                recentPrs,
                recentActivity,
                stats: {
                    checkinStreak: profile.checkinStreak,
                    totalCheckins: profile.totalCheckins,
                    longestStreak: profile.longestCheckinStreak,
                    memberSince: profile.joinedAt,
                }
            };
        }),
});
