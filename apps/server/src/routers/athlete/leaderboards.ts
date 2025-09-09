// routers/athlete/leaderboards.ts - New router for leaderboard management
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { AthleteService } from "@/lib/services/athlete-service";
import {
    requireBoxMembership,
    checkSubscriptionLimits,
    requireCoachOrAbove
} from "@/lib/permissions";

export const athleteLeaderboardsRouter = router({
    // Create a new leaderboard
    createLeaderboard: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            name: z.string().min(1).max(100),
            type: z.enum(["benchmark", "pr", "streak", "custom"]),
            category: z.enum(["rx", "scaled", "all"]).optional(),
            movementId: z.uuid().optional(),
            benchmarkId: z.uuid().optional(),
            periodStart: z.date().optional(),
            periodEnd: z.date().optional(),
            maxEntries: z.number().min(1).max(100).default(10),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireCoachOrAbove(ctx, input.boxId);

            return AthleteService.createLeaderboard(
                input.boxId,
                membership.id,
                {
                    name: input.name,
                    type: input.type,
                    category: input.category,
                    movementId: input.movementId,
                    benchmarkId: input.benchmarkId,
                    periodStart: input.periodStart,
                    periodEnd: input.periodEnd,
                    maxEntries: input.maxEntries,
                }
            );
        }),

    // Get all leaderboards for a box
    getBoxLeaderboards: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            includeInactive: z.boolean().default(false),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxMembership(ctx, input.boxId);
            return AthleteService.getBoxLeaderboards(input.boxId);
        }),

    // Get a specific leaderboard with entries
    getLeaderboard: protectedProcedure
        .input(z.object({
            leaderboardId: z.uuid(),
        }))
        .query(async ({ ctx, input }) => {
            // Basic auth check - specific box access will be validated by the service
            const leaderboard = await AthleteService.getLeaderboard(input.leaderboardId);

            if (leaderboard.length === 0) {
                throw new Error("Leaderboard not found");
            }

            // Check if user has access to this leaderboard's box
            await requireBoxMembership(ctx, leaderboard[0].leaderboards.boxId);

            return leaderboard;
        }),

    // Add entry to leaderboard
    addLeaderboardEntry: protectedProcedure
        .input(z.object({
            leaderboardId: z.uuid(),
            membershipId: z.uuid(),
            value: z.number().positive(),
            rank: z.number().positive(),
            prId: z.uuid().optional(),
            benchmarkId: z.uuid().optional(),
            achievedAt: z.date(),
        }))
        .mutation(async ({ ctx, input }) => {
            // This would require getting the leaderboard first to check box access
            const leaderboard = await AthleteService.getLeaderboard(input.leaderboardId);

            if (leaderboard.length === 0) {
                throw new Error("Leaderboard not found");
            }

            // Check if user has coach permissions for this leaderboard's box
            await requireCoachOrAbove(ctx, leaderboard[0].leaderboards.boxId);

            return AthleteService.addLeaderboardEntry(
                input.leaderboardId,
                input.membershipId,
                {
                    value: input.value,
                    rank: input.rank,
                    prId: input.prId,
                    benchmarkId: input.benchmarkId,
                    achievedAt: input.achievedAt,
                }
            );
        }),

    // Update leaderboard entry rank
    updateLeaderboardEntryRank: protectedProcedure
        .input(z.object({
            entryId: z.uuid(),
            newRank: z.number().positive(),
        }))
        .mutation(async ({ ctx, input }) => {
            // Would need to get entry details to check box permissions
            // For now, require auth
            return AthleteService.updateLeaderboardEntryRank(
                input.entryId,
                input.newRank
            );
        }),

    // Remove entry from leaderboard
    removeLeaderboardEntry: protectedProcedure
        .input(z.object({
            entryId: z.uuid(),
        }))
        .mutation(async ({ ctx, input }) => {
            // Would need to get entry details to check box permissions
            return AthleteService.removeLeaderboardEntry(input.entryId);
        }),

    // Deactivate leaderboard
    deactivateLeaderboard: protectedProcedure
        .input(z.object({
            leaderboardId: z.uuid(),
        }))
        .mutation(async ({ ctx, input }) => {
            const leaderboard = await AthleteService.getLeaderboard(input.leaderboardId);

            if (leaderboard.length === 0) {
                throw new Error("Leaderboard not found");
            }

            // Check if user has coach permissions
            await requireCoachOrAbove(ctx, leaderboard[0].leaderboards.boxId);

            return AthleteService.deactivateLeaderboard(input.leaderboardId);
        }),
});
