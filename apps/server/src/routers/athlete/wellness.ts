// routers/athlete/wellness.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { AthleteService } from "@/lib/services/athlete-service";
import {
    requireBoxMembership,
    checkSubscriptionLimits,
    canAccessAthleteData
} from "@/lib/permissions";
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

            // Use AthleteService to submit wellness checkin
            try {
                const checkin = await AthleteService.submitWellnessCheckin(
                    input.boxId,
                    membership.id,
                    input
                );
                return checkin;
            } catch (error) {
                if (error instanceof Error && error.message === "You have already checked in today") {
                    throw new TRPCError({
                        code: "CONFLICT",
                        message: "You have already checked in today"
                    });
                }
                throw error;
            }
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
                const canAccess = await canAccessAthleteData(ctx, input.boxId, targetAthleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' check-ins"
                    });
                }
            }

            // Use AthleteService to get checkins
            const checkins = await AthleteService.getWellnessCheckins(
                input.boxId,
                targetAthleteId,
                input.days
            );

            // Include trends if requested
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

            // Use AthleteService to submit WOD feedback
            const feedback = await AthleteService.submitWodFeedback(
                input.boxId,
                membership.id,
                input
            );

            return feedback;
        }),
});
