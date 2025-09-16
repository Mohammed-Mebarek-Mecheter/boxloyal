// src/lib/services/analytics/calculations/box-count-calculations.ts
import { db } from "@/db";
import { boxMemberships, boxes } from "@/db/schema";
import { eq, and, count, inArray } from "drizzle-orm";

/**
 * Update box current counts for subscription and billing purposes
 * This function calculates current athlete and coach counts and updates overage tracking
 */
export async function updateBoxCurrentCounts(boxId: string) {
    try {
        console.log(`[Analytics] Updating current counts for box ${boxId}`);

        const [athleteCount, coachCount] = await Promise.all([
            // Count active athletes
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, 'athlete'),
                    eq(boxMemberships.isActive, true)
                )),
            // Count active coaches (including head_coach and owner roles)
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    inArray(boxMemberships.role, ['coach', 'head_coach', 'owner']),
                    eq(boxMemberships.isActive, true)
                ))
        ]);

        const currentAthleteCount = athleteCount[0]?.count ?? 0;
        const currentCoachCount = coachCount[0]?.count ?? 0;

        // Get current limits to calculate overages
        const boxInfo = await db.select({
            currentAthleteLimit: boxes.currentAthleteLimit,
            currentCoachLimit: boxes.currentCoachLimit
        })
            .from(boxes)
            .where(eq(boxes.id, boxId))
            .limit(1);

        if (!boxInfo[0]) {
            throw new Error(`Box ${boxId} not found`);
        }

        const { currentAthleteLimit, currentCoachLimit } = boxInfo[0];

        // Calculate overages (how many over the limit they are)
        const athleteOverage = Math.max(0, currentAthleteCount - currentAthleteLimit);
        const coachOverage = Math.max(0, currentCoachCount - currentCoachLimit);

        // Update box with current counts and overages
        await db.update(boxes)
            .set({
                currentAthleteCount,
                currentCoachCount,
                currentAthleteOverage: athleteOverage,
                currentCoachOverage: coachOverage,
                lastActivityAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        console.log(`[Analytics] Updated box ${boxId} counts: ${currentAthleteCount} athletes (${athleteOverage} over), ${currentCoachCount} coaches (${coachOverage} over)`);

        return {
            boxId,
            athleteCount: currentAthleteCount,
            coachCount: currentCoachCount,
            athleteOverage,
            coachOverage,
            isOverAthleteLimit: athleteOverage > 0,
            isOverCoachLimit: coachOverage > 0
        };
    } catch (error) {
        console.error(`[Analytics] Error updating box counts for ${boxId}:`, error);
        throw error;
    }
}
