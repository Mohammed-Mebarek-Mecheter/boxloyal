// lib/billing-utils.ts - Utility functions for billing operations
import { db } from "@/db";
import { subscriptionPlans, gracePeriods, boxes, boxMemberships } from "@/db/schema";
import {eq, and, count, gte} from "drizzle-orm";

export async function updateBoxLimitsFromPlan(boxId: string, planTier: string) {
    const plan = await db.query.subscriptionPlans.findFirst({
        where: and(
            eq(subscriptionPlans.tier, planTier),
            eq(subscriptionPlans.isActive, true)
        ),
    });

    if (!plan) {
        throw new Error(`Plan not found: ${planTier}`);
    }

    await db
        .update(boxes)
        .set({
            subscriptionTier: planTier as any,
            athleteLimit: plan.memberLimit,
            coachLimit: plan.coachLimit,
            updatedAt: new Date(),
        })
        .where(eq(boxes.id, boxId));

    return plan;
}

export async function checkAndEnforceAthleteLimit(boxId: string): Promise<boolean> {
    const box = await db.query.boxes.findFirst({
        where: eq(boxes.id, boxId),
    });

    if (!box) return false;

    const [athleteCount] = await db
        .select({ count: count() })
        .from(boxMemberships)
        .where(
            and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.role, "athlete"),
                eq(boxMemberships.isActive, true)
            )
        );

    const isOverLimit = athleteCount.count > box.athleteLimit;

    if (isOverLimit) {
        // Check for existing grace period
        const existingGracePeriod = await db.query.gracePeriods.findFirst({
            where: and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date())
            ),
        });

        if (!existingGracePeriod) {
            // Create grace period
            const endsAt = new Date();
            endsAt.setDate(endsAt.getDate() + 14); // 14 day grace period

            await db.insert(gracePeriods).values({
                boxId,
                reason: "athlete_limit_exceeded",
                endsAt,
            });

            return false; // Grace period created, but still over limit
        }
    }

    return !isOverLimit;
}

export async function getPlanFeatures(tier: string): Promise<string[]> {
    const plan = await db.query.subscriptionPlans.findFirst({
        where: and(
            eq(subscriptionPlans.tier, tier),
            eq(subscriptionPlans.isActive, true)
        ),
    });

    if (!plan) return [];

    try {
        return JSON.parse(plan.features);
    } catch {
        return [];
    }
}
