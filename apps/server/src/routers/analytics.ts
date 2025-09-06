// routers/analytics.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { db } from "@/db";
import { athleteRiskScores, athleteAlerts } from "@/db/schema";
import { requireCoachOrAbove } from "@/lib/permissions";
import {eq, desc, and} from "drizzle-orm";

export const analyticsRouter = router({
    // Get at-risk athletes (coaches and above only)
    getAtRiskAthletes: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            let query = db
                .select()
                .from(athleteRiskScores)
                .where(eq(athleteRiskScores.boxId, input.boxId));

            if (input.riskLevel) {
                query = query.where(eq(athleteRiskScores.riskLevel, input.riskLevel));
            }

            return query.orderBy(desc(athleteRiskScores.overallRiskScore));
        }),

    // Get active alerts
    getActiveAlerts: protectedProcedure
        .input(z.object({ boxId: z.string() }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return db
                .select()
                .from(athleteAlerts)
                .where(
                    and(
                        eq(athleteAlerts.boxId, input.boxId),
                        eq(athleteAlerts.status, "active")
                    )
                )
                .orderBy(desc(athleteAlerts.createdAt));
        }),
});
