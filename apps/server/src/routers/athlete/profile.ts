// routers/athlete/profile.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { db } from "@/db";
import {
    athleteBadges,
    boxMemberships,
    athletePrs,
    athleteWellnessCheckins,
    movements
} from "@/db/schema";
import { requireBoxMembership } from "@/lib/permissions";
import { eq, and, desc, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const athleteProfileRouter = router({
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