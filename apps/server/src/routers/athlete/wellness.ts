// routers/athlete/wellness.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { db } from "@/db";
import {
    athleteWellnessCheckins,
    wodFeedback,
    boxMemberships
} from "@/db/schema";
import {
    requireBoxMembership,
    checkSubscriptionLimits
} from "@/lib/permissions";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const athleteWellnessRouter = router({
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
});