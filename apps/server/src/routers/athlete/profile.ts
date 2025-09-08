// routers/athlete/profile.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { AthleteService } from "@/lib/services/athlete-service";
import { requireBoxMembership, canAccessAthleteData } from "@/lib/permissions";
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
                const canAccess = await canAccessAthleteData(ctx, input.boxId, targetAthleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' badges"
                    });
                }
            }

            // Use AthleteService to get badges
            return AthleteService.getAthleteBadges(input.boxId, targetAthleteId);
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

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, targetAthleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' profiles"
                    });
                }
            }

            // Use AthleteService to get profile
            const profile = await AthleteService.getAthleteProfile(
                input.boxId,
                targetAthleteId,
                {
                    includePrs: input.includePrs,
                    includeRecentActivity: input.includeRecentActivity
                }
            );

            if (!profile) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Athlete not found" });
            }

            return profile;
        }),
});
