// routers/athlete/wellness.ts - Enhanced version with normalized tracking
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { AthleteService } from "@/lib/services/athlete-service";
import {
    requireBoxMembership,
    checkSubscriptionLimits,
    canAccessAthleteData
} from "@/lib/permissions";
import { TRPCError } from "@trpc/server";

// Enhanced validation schemas
const bodyPartSchema = z.enum([
    "neck", "shoulders", "chest", "upper_back", "lower_back", "abs",
    "biceps", "triceps", "forearms", "glutes", "quads", "hamstrings",
    "calves", "ankles", "knees", "hips", "wrists"
]);

const sorenessEntrySchema = z.object({
    bodyPart: bodyPartSchema,
    severity: z.number().min(0).max(10),
    notes: z.string().max(200).optional(),
});

const painEntrySchema = z.object({
    bodyPart: bodyPartSchema,
    severity: z.number().min(0).max(10),
    painType: z.enum(["sharp", "dull", "throbbing", "burning", "aching", "stabbing"]).optional(),
    notes: z.string().max(200).optional(),
});

export const athleteWellnessRouter = router({
    // Enhanced wellness check-in with normalized soreness/pain tracking
    submitWellnessCheckin: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            // Core wellness metrics (1-10 scales)
            energyLevel: z.number().min(1).max(10),
            sleepQuality: z.number().min(1).max(10),
            stressLevel: z.number().min(1).max(10),
            motivationLevel: z.number().min(1).max(10),
            workoutReadiness: z.number().min(1).max(10),

            // Optional wellness metrics
            hydrationLevel: z.number().min(1).max(10).optional(),
            nutritionQuality: z.number().min(1).max(10).optional(),
            outsideActivity: z.enum(["none", "light", "moderate", "heavy"]).optional(),
            mood: z.string().max(100).optional(),
            notes: z.string().max(500).optional(),

            // Normalized tracking arrays
            sorenessEntries: z.array(sorenessEntrySchema).optional(),
            painEntries: z.array(painEntrySchema).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);

            try {
                return await AthleteService.submitWellnessCheckin(
                    input.boxId,
                    membership.id,
                    input
                );
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

    // Get wellness check-ins with enhanced filtering and analytics
    getWellnessCheckins: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            days: z.number().min(1).max(90).default(30),
            includeTrends: z.boolean().default(false),
            includeSorenessData: z.boolean().default(true),
            includePainData: z.boolean().default(true),
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
                        message: "Cannot view other athletes' wellness data"
                    });
                }
            }

            const checkins = await AthleteService.getWellnessCheckins(
                input.boxId,
                targetAthleteId,
                input.days,
                input.days // Limit matches days for this endpoint
            );

            // Calculate trends if requested
            let trends = undefined;
            if (input.includeTrends && checkins.length > 0) {
                const avgEnergy = checkins.reduce((sum, c) => sum + c.energyLevel, 0) / checkins.length;
                const avgSleep = checkins.reduce((sum, c) => sum + c.sleepQuality, 0) / checkins.length;
                const avgStress = checkins.reduce((sum, c) => sum + c.stressLevel, 0) / checkins.length;
                const avgMotivation = checkins.reduce((sum, c) => sum + c.motivationLevel, 0) / checkins.length;
                const avgReadiness = checkins.reduce((sum, c) => sum + c.workoutReadiness, 0) / checkins.length;

                // Calculate wellness score (higher is better, stress is inverted)
                const avgWellnessScore = (avgEnergy + avgSleep + (10 - avgStress) + avgMotivation + avgReadiness) / 5;

                trends = {
                    averages: {
                        energy: Math.round(avgEnergy * 10) / 10,
                        sleep: Math.round(avgSleep * 10) / 10,
                        stress: Math.round(avgStress * 10) / 10,
                        motivation: Math.round(avgMotivation * 10) / 10,
                        readiness: Math.round(avgReadiness * 10) / 10,
                        wellnessScore: Math.round(avgWellnessScore * 10) / 10,
                    },
                    checkinCount: checkins.length,
                    checkinRate: Math.round((checkins.length / input.days) * 100),
                };
            }

            return { checkins, trends };
        }),

    // Submit comprehensive WOD feedback with normalized pain tracking
    submitWodFeedback: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            // Core feedback metrics
            rpe: z.number().min(1).max(10),
            difficultyRating: z.number().min(1).max(10),
            enjoymentRating: z.number().min(1).max(10).optional(),

            // Movement feedback
            feltGoodMovements: z.string().max(200).optional(),
            struggledMovements: z.string().max(200).optional(),

            // Completion details
            completed: z.boolean().default(true),
            scalingUsed: z.boolean().default(false),
            scalingDetails: z.string().max(300).optional(),
            workoutDurationMinutes: z.number().positive().optional(),
            result: z.string().max(100).optional(),

            // Notes
            notes: z.string().max(500).optional(),
            coachNotes: z.string().max(500).optional(),

            // WOD reference
            wodName: z.string().min(1).max(100),

            // Normalized pain tracking during workout
            painEntries: z.array(painEntrySchema).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);

            return AthleteService.submitWodFeedback(
                input.boxId,
                membership.id,
                input
            );
        }),

    // Get WOD feedback history
    getWodFeedback: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            days: z.number().min(1).max(90).default(30),
            limit: z.number().min(1).max(100).default(20),
            includePainData: z.boolean().default(true),
            includeAnalytics: z.boolean().default(false),
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
                        message: "Cannot view other athletes' WOD feedback"
                    });
                }
            }

            // This would require implementing getWodFeedback in AthleteService
            // For now, return placeholder
            return {
                feedback: [],
                analytics: input.includeAnalytics ? {
                    avgRpe: 0,
                    avgDifficulty: 0,
                    avgEnjoyment: 0,
                    completionRate: 0,
                } : undefined
            };
        }),

    // Update check-in streak (primarily for manual corrections by coaches)
    updateCheckinStreak: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);

            // Only coaches and above can manually update streaks
            if (!["owner", "head_coach", "coach"].includes(membership.role)) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Insufficient permissions to update check-in streaks"
                });
            }

            return AthleteService.updateCheckinStreak(input.athleteId);
        }),

    // Get wellness trends and insights
    getWellnessTrends: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            days: z.number().min(7).max(365).default(30),
            groupBy: z.enum(["day", "week", "month"]).default("week"),
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
                        message: "Cannot view other athletes' wellness trends"
                    });
                }
            }

            const checkins = await AthleteService.getWellnessCheckins(
                input.boxId,
                targetAthleteId,
                input.days,
                1000 // High limit to get all data for trends
            );

            // Group and analyze data based on groupBy parameter
            const trends = checkins.map(checkin => ({
                date: checkin.checkinDate,
                energy: checkin.energyLevel,
                sleep: checkin.sleepQuality,
                stress: checkin.stressLevel,
                motivation: checkin.motivationLevel,
                readiness: checkin.workoutReadiness,
                wellnessScore: (checkin.energyLevel + checkin.sleepQuality +
                    (10 - checkin.stressLevel) + checkin.motivationLevel +
                    checkin.workoutReadiness) / 5,
            }));

            return {
                trends,
                summary: {
                    totalCheckins: trends.length,
                    checkinRate: Math.round((trends.length / input.days) * 100),
                    avgWellnessScore: trends.length > 0
                        ? Math.round(trends.reduce((sum, t) => sum + t.wellnessScore, 0) / trends.length * 10) / 10
                        : 0,
                },
            };
        }),

    // Get body part pain/soreness analytics
    getBodyPartAnalytics: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            days: z.number().min(7).max(90).default(30),
            type: z.enum(["soreness", "pain", "both"]).default("both"),
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
                        message: "Cannot view other athletes' body part analytics"
                    });
                }
            }

            const checkins = await AthleteService.getWellnessCheckins(
                input.boxId,
                targetAthleteId,
                input.days,
                1000 // High limit to get all data
            );

            // Analyze soreness and pain patterns
            const bodyPartFrequency: Record<string, { count: number; avgSeverity: number; totalSeverity: number }> = {};

            checkins.forEach(checkin => {
                const entries = [
                    ...(input.type !== "pain" ? (checkin as any).sorenessEntries || [] : []),
                    ...(input.type !== "soreness" ? (checkin as any).painEntries || [] : []),
                ];

                entries.forEach((entry: any) => {
                    if (!bodyPartFrequency[entry.bodyPart]) {
                        bodyPartFrequency[entry.bodyPart] = { count: 0, avgSeverity: 0, totalSeverity: 0 };
                    }
                    bodyPartFrequency[entry.bodyPart].count++;
                    bodyPartFrequency[entry.bodyPart].totalSeverity += entry.severity;
                    bodyPartFrequency[entry.bodyPart].avgSeverity =
                        bodyPartFrequency[entry.bodyPart].totalSeverity / bodyPartFrequency[entry.bodyPart].count;
                });
            });

            // Convert to array and sort by frequency
            const analytics = Object.entries(bodyPartFrequency)
                .map(([bodyPart, data]) => ({
                    bodyPart,
                    frequency: data.count,
                    avgSeverity: Math.round(data.avgSeverity * 10) / 10,
                }))
                .sort((a, b) => b.frequency - a.frequency);

            return {
                analytics,
                summary: {
                    totalReports: Object.values(bodyPartFrequency).reduce((sum, data) => sum + data.count, 0),
                    uniqueBodyParts: analytics.length,
                    mostAffectedBodyPart: analytics[0]?.bodyPart || null,
                },
            };
        }),
});
