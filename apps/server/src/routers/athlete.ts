// routers/athlete.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { db } from "@/db";
import {
    athletePrs,
    athleteWellnessCheckins,
    movements,
    boxMemberships
} from "@/db/schema";
import {
    requireBoxMembership,
    canManageUser
} from "@/lib/permissions";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const athleteRouter = router({
    // Log PR (any athlete for themselves, coaches can log for others)
    logPr: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            athleteId: z.string().optional(), // If not provided, logs for self
            movementId: z.string(),
            value: z.number().positive(),
            unit: z.string(),
            reps: z.number().optional(),
            notes: z.string().optional(),
            achievedAt: z.date().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
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

            const publicId = crypto.randomUUID(); // Use CUID2 in production

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
                    achievedAt: input.achievedAt || new Date(),
                    publicId,
                })
                .returning();

            return pr;
        }),

    // Get athlete PRs
    getPrs: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            athleteId: z.string().optional(),
            movementId: z.string().optional(),
            limit: z.number().min(1).max(100).default(20),
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

            let query = db
                .select({
                    pr: athletePrs,
                    movement: movements,
                })
                .from(athletePrs)
                .innerJoin(movements, eq(athletePrs.movementId, movements.id))
                .where(
                    and(
                        eq(athletePrs.boxId, input.boxId),
                        eq(athletePrs.membershipId, targetAthleteId)
                    )
                );

            if (input.movementId) {
                query = query.where(eq(athletePrs.movementId, input.movementId));
            }

            return query
                .orderBy(desc(athletePrs.achievedAt))
                .limit(input.limit);
        }),

    // Daily wellness check-in
    submitWellnessCheckin: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            energyLevel: z.number().min(1).max(10),
            sleepQuality: z.number().min(1).max(10),
            stressLevel: z.number().min(1).max(10),
            motivationLevel: z.number().min(1).max(10),
            workoutReadiness: z.number().min(1).max(10),
            soreness: z.record(z.number()).optional(),
            hydrationLevel: z.number().min(1).max(10).optional(),
            nutritionQuality: z.number().min(1).max(10).optional(),
            notes: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);

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
                    hydrationLevel: input.hydrationLevel,
                    nutritionQuality: input.nutritionQuality,
                    notes: input.notes,
                    checkinDate: new Date(),
                })
                .returning();

            // Update streak counter
            await db
                .update(boxMemberships)
                .set({
                    lastCheckinDate: new Date(),
                    totalCheckins: membership.totalCheckins + 1,
                    // TODO: Calculate streak properly
                    updatedAt: new Date(),
                })
                .where(eq(boxMemberships.id, membership.id));

            return checkin;
        }),

    // Get wellness check-ins (with proper permissions)
    getWellnessCheckins: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            athleteId: z.string().optional(),
            days: z.number().min(1).max(90).default(30),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                if (!["owner", "head_coach", "coach"].includes(membership.role)) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot view other athletes' check-ins" });
                }
            }

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - input.days);

            return db
                .select()
                .from(athleteWellnessCheckins)
                .where(
                    and(
                        eq(athleteWellnessCheckins.boxId, input.boxId),
                        eq(athleteWellnessCheckins.membershipId, targetAthleteId),
                        // Add date filter
                    )
                )
                .orderBy(desc(athleteWellnessCheckins.checkinDate));
        }),
});
