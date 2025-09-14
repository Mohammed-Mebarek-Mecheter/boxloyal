// lib/services/billing/grace-period-service.ts
import { db } from "@/db";
import { gracePeriods, boxes } from "@/db/schema";
import { eq, and, gte, lte, asc, desc } from "drizzle-orm";
import type { GracePeriodReason } from "./types";
// Import the BillingNotificationService
import { BillingNotificationService } from "@/lib/services/notifications/billing-notifications-service";

export class GracePeriodService {
    // Instantiate the BillingNotificationService
    private static billingNotificationService = new BillingNotificationService();

    /**
     * Create a grace period
     */
    static async createGracePeriod(
        boxId: string,
        reason: GracePeriodReason,
        options: {
            customMessage?: string;
            severity?: "info" | "warning" | "critical" | "blocking";
            autoResolve?: boolean;
            contextSnapshot?: Record<string, any>;
        } = {}
    ) {
        // Check if there's already an active grace period for this reason
        const existingGracePeriod = await db.query.gracePeriods.findFirst({
            where: and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date()),
                eq(gracePeriods.reason, reason)
            ),
        });

        if (existingGracePeriod) {
            return { gracePeriod: existingGracePeriod, wasExisting: true };
        }

        // Configure grace period based on reason
        const gracePeriodConfig = this.getGracePeriodConfig(reason);
        const endsAt = new Date();
        endsAt.setDate(endsAt.getDate() + gracePeriodConfig.days);

        const [gracePeriod] = await db
            .insert(gracePeriods)
            .values({
                boxId,
                reason,
                endsAt,
                severity: options.severity ?? gracePeriodConfig.severity,
                autoResolve: options.autoResolve ?? false,
                contextSnapshot: options.contextSnapshot ?? {},
            })
            .returning();

        // --- INTEGRATION: Send Grace Period Notification ---
        // After successfully creating a grace period, notify the user.
        try {
            await this.billingNotificationService.sendGracePeriodNotification(boxId, gracePeriod.id);
            console.log(`Grace period notification sent for box ${boxId}, period ${gracePeriod.id}`);
        } catch (error) {
            console.error(`Failed to send grace period notification for box ${boxId}:`, error);
            // Depending on requirements, you might want to alert or retry if this notification is critical
            // Note: Failing to send the notification should not fail the grace period creation itself.
        }
        // --- END INTEGRATION ---

        return { gracePeriod, wasExisting: false };
    }

    /**
     * Resolve a grace period
     */
    static async resolveGracePeriod(
        gracePeriodId: string,
        resolution: string,
        resolvedByUserId?: string,
        autoResolved: boolean = false
    ) {
        const gracePeriod = await db.query.gracePeriods.findFirst({
            where: eq(gracePeriods.id, gracePeriodId)
        });

        if (!gracePeriod) {
            throw new Error("Grace period not found");
        }

        await db.update(gracePeriods)
            .set({
                resolved: true,
                resolvedAt: new Date(),
                resolution,
                resolvedByUserId,
                autoResolved,
                updatedAt: new Date()
            })
            .where(eq(gracePeriods.id, gracePeriodId));

        // --- INTEGRATION: Send Grace Period Resolved Notification ---
        // As determined necessary based on notification system requirements.
        try {
            await this.billingNotificationService.sendGracePeriodResolvedNotification(gracePeriodId, resolution);
            console.log(`Grace period resolved notification sent for period ${gracePeriodId}`);
        } catch (error) {
            console.error(`Failed to send grace period resolved notification for period ${gracePeriodId}:`, error);
            // Depending on requirements, you might want to alert if this notification fails.
        }
        // --- END INTEGRATION ---

        return { success: true, gracePeriod };
    }

    /**
     * Get active grace periods for a box
     */
    static async getActiveGracePeriods(boxId: string) {
        return await db.query.gracePeriods.findMany({
            where: and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date())
            ),
            orderBy: desc(gracePeriods.createdAt)
        });
    }

    /**
     * Get upcoming grace period expirations
     */
    static async getUpcomingExpirations(daysAhead: number = 7) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysAhead);

        return await db.query.gracePeriods.findMany({
            where: and(
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date()),
                lte(gracePeriods.endsAt, futureDate)
            ),
            with: {
                box: {
                    columns: {
                        id: true,
                        name: true,
                        email: true,
                        subscriptionTier: true,
                        subscriptionStatus: true
                    }
                }
            },
            orderBy: asc(gracePeriods.endsAt)
        });
    }

    /**
     * Resolve grace periods for specific reasons (used during subscription changes)
     */
    static async resolveGracePeriodsForReasons(
        boxId: string,
        reasons: GracePeriodReason[],
        resolution: string,
        resolvedByUserId?: string
    ) {
        const gracePeriodsToResolve = await db
            .select()
            .from(gracePeriods)
            .where(and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date())
            ));

        const filteredGracePeriods = gracePeriodsToResolve.filter(gp =>
            reasons.includes(gp.reason as GracePeriodReason)
        );

        for (const gp of filteredGracePeriods) {
            await this.resolveGracePeriod(gp.id, resolution, resolvedByUserId, false);
        }

        return filteredGracePeriods.length;
    }

    /**
     * Enable overage billing for a box (also resolves limit-related grace periods)
     */
    static async enableOverageBilling(boxId: string, userId: string) {
        await db.update(boxes)
            .set({
                isOverageEnabled: true,
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        // Resolve limit-related grace periods
        const resolvedCount = await this.resolveGracePeriodsForReasons(
            boxId,
            ["athlete_limit_exceeded", "coach_limit_exceeded"],
            "overage_enabled",
            userId
        );

        // --- INTEGRATION: Send Notification for Overage Billing Enabled ---
        // As determined necessary based on notification system requirements.
        // This ensures the user gets confirmation even if this specific service method triggers it.
        try {
            await this.billingNotificationService.sendOverageBillingEnabledNotification(boxId);
            console.log(`Overage billing enabled notification sent for box ${boxId} (via GracePeriodService)`);
        } catch (error) {
            console.error(`Failed to send overage billing enabled notification for box ${boxId} (via GracePeriodService):`, error);
            // Depending on requirements, you might want to alert if this notification fails.
        }
        // --- END INTEGRATION ---

        return { success: true, overageEnabled: true, gracePeriodsResolved: resolvedCount };
    }

    /**
     * Get grace period configuration by reason
     */
    private static getGracePeriodConfig(reason: GracePeriodReason) {
        const configs: Record<GracePeriodReason, { days: number; severity: "info" | "warning" | "critical" | "blocking" }> = {
            "athlete_limit_exceeded": { days: 14, severity: "warning" },
            "coach_limit_exceeded": { days: 14, severity: "warning" },
            "trial_ending": { days: 7, severity: "critical" },
            "payment_failed": { days: 3, severity: "critical" },
            "subscription_canceled": { days: 0, severity: "blocking" },
            "billing_issue": { days: 7, severity: "warning" },
        };

        return configs[reason] || { days: 7, severity: "warning" };
    }
}
