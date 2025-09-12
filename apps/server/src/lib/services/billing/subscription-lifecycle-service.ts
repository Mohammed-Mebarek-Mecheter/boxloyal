// lib/services/billing/subscription-lifecycle-service.ts
import { db } from "@/db";
import {
    subscriptions,
    subscriptionChanges,
    boxes,
    gracePeriods
} from "@/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import type { SubscriptionStatus } from "./types";
import { GracePeriodService } from "./grace-period-service";
import { UsageTrackingService } from "./usage-tracking-service";

export class SubscriptionLifecycleService {
    /**
     * Cancel a subscription
     */
    static async cancelSubscription(
        boxId: string,
        options: {
            cancelAtPeriodEnd?: boolean;
            reason?: string;
            canceledByUserId?: string;
            metadata?: Record<string, any>;
        } = {}
    ) {
        const { cancelAtPeriodEnd = true, reason, canceledByUserId, metadata } = options;

        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            ),
            with: { plan: true }
        });

        if (!activeSubscription) {
            throw new Error("No active subscription found");
        }

        // Update subscription
        const canceledAt = cancelAtPeriodEnd ? null : new Date();
        const newStatus: SubscriptionStatus = cancelAtPeriodEnd ? "active" : "canceled";

        await db.update(subscriptions)
            .set({
                cancelAtPeriodEnd,
                canceledAt,
                cancelReason: reason,
                canceledByUserId,
                status: newStatus,
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, activeSubscription.id));

        // Create subscription change record
        await db.insert(subscriptionChanges).values({
            subscriptionId: activeSubscription.id,
            boxId,
            changeType: "canceled",
            fromPlanId: activeSubscription.planId,
            effectiveDate: cancelAtPeriodEnd ? activeSubscription.currentPeriodEnd : new Date(),
            reason: reason || "customer_request",
            triggeredByUserId: canceledByUserId,
            metadata: metadata || {}
        });

        // Update box status
        if (!cancelAtPeriodEnd) {
            await db.update(boxes)
                .set({
                    subscriptionStatus: "canceled",
                    updatedAt: new Date()
                })
                .where(eq(boxes.id, boxId));

            // Trigger grace period for immediate cancellation
            await GracePeriodService.createGracePeriod(boxId, "subscription_canceled", {
                severity: "blocking",
                contextSnapshot: {
                    canceledAt: canceledAt?.toISOString(),
                    reason,
                    subscriptionId: activeSubscription.id,
                    accessEndsAt: activeSubscription.currentPeriodEnd
                }
            });
        }

        // Track cancellation event
        await UsageTrackingService.trackEvents(boxId, [{
            eventType: "subscription_canceled",
            quantity: 1,
            userId: canceledByUserId,
            metadata: {
                subscriptionId: activeSubscription.id,
                planId: activeSubscription.planId,
                planName: activeSubscription.plan?.name,
                cancelAtPeriodEnd,
                reason,
                polarSubscriptionId: activeSubscription.polarSubscriptionId,
                ...metadata
            },
        }]);

        return {
            success: true,
            cancelAtPeriodEnd,
            accessEndsAt: cancelAtPeriodEnd
                ? activeSubscription.currentPeriodEnd
                : new Date(),
            subscription: activeSubscription
        };
    }

    /**
     * Reactivate a subscription
     */
    static async reactivateSubscription(
        boxId: string,
        reactivatedByUserId?: string,
        metadata?: Record<string, any>
    ) {
        const canceledSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                or(
                    eq(subscriptions.cancelAtPeriodEnd, true),
                    eq(subscriptions.status, "canceled")
                )
            ),
            with: { plan: true }
        });

        if (!canceledSubscription) {
            throw new Error("No subscription found to reactivate");
        }

        // Update subscription to remove cancellation
        await db.update(subscriptions)
            .set({
                cancelAtPeriodEnd: false,
                canceledAt: null,
                status: "active",
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, canceledSubscription.id));

        // Create subscription change record
        await db.insert(subscriptionChanges).values({
            subscriptionId: canceledSubscription.id,
            boxId,
            changeType: "reactivated",
            toPlanId: canceledSubscription.planId,
            effectiveDate: new Date(),
            reason: "customer_request",
            triggeredByUserId: reactivatedByUserId,
            metadata: metadata || {}
        });

        // Update box status
        await db.update(boxes)
            .set({
                subscriptionStatus: "active",
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        // Track reactivation event
        await UsageTrackingService.trackEvents(boxId, [{
            eventType: "subscription_reactivated",
            quantity: 1,
            userId: reactivatedByUserId,
            metadata: {
                subscriptionId: canceledSubscription.id,
                planId: canceledSubscription.planId,
                planName: canceledSubscription.plan?.name,
                polarSubscriptionId: canceledSubscription.polarSubscriptionId,
                ...metadata
            },
        }]);

        // Resolve related grace periods
        const gracePeriodsResolved = await GracePeriodService.resolveGracePeriodsForReasons(
            boxId,
            ["subscription_canceled", "billing_issue"],
            "subscription_reactivated",
            reactivatedByUserId
        );

        return {
            success: true,
            subscription: canceledSubscription,
            gracePeriodsResolved
        };
    }

    /**
     * Update subscription status from external events
     */
    static async updateSubscriptionStatus(
        boxId: string,
        newStatus: SubscriptionStatus,
        eventData?: Record<string, any>
    ) {
        const subscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            )
        });

        if (!subscription) {
            return { success: false, error: "No active subscription found" };
        }

        // Update subscription status
        await db.update(subscriptions)
            .set({
                status: newStatus,
                lastSyncedAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(subscriptions.id, subscription.id));

        // Update box status
        await db.update(boxes)
            .set({
                subscriptionStatus: newStatus,
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        // Handle specific status changes
        switch (newStatus) {
            case "past_due":
                await this.handlePastDueStatus(boxId, eventData);
                break;
            case "canceled":
                await this.handleCanceledStatus(boxId, eventData);
                break;
            case "active":
                await this.handleActiveStatus(boxId, eventData);
                break;
        }

        return { success: true, newStatus };
    }

    /**
     * Handle past due status
     */
    private static async handlePastDueStatus(boxId: string, eventData?: Record<string, any>) {
        await GracePeriodService.createGracePeriod(boxId, "payment_failed", {
            severity: "critical",
            contextSnapshot: { polarEvent: eventData }
        });

        await UsageTrackingService.trackEvents(boxId, [{
            eventType: "payment_failed",
            metadata: eventData
        }]);
    }

    /**
     * Handle canceled status
     */
    private static async handleCanceledStatus(boxId: string, eventData?: Record<string, any>) {
        await GracePeriodService.createGracePeriod(boxId, "subscription_canceled", {
            severity: "blocking",
            contextSnapshot: { polarEvent: eventData }
        });

        await UsageTrackingService.trackEvents(boxId, [{
            eventType: "subscription_canceled",
            metadata: eventData
        }]);
    }

    /**
     * Handle active status
     */
    private static async handleActiveStatus(boxId: string, eventData?: Record<string, any>) {
        // Resolve payment-related grace periods
        await GracePeriodService.resolveGracePeriodsForReasons(
            boxId,
            ["payment_failed", "billing_issue"],
            "payment_received"
        );

        await UsageTrackingService.trackEvents(boxId, [{
            eventType: "payment_received",
            metadata: eventData
        }]);
    }

    /**
     * Get subscription lifecycle events
     */
    static async getSubscriptionHistory(boxId: string, limit: number = 20) {
        return await db.query.subscriptionChanges.findMany({
            where: eq(subscriptionChanges.boxId, boxId),
            with: {
                fromPlan: true,
                toPlan: true
            },
            orderBy: desc(subscriptionChanges.createdAt),
            limit
        });
    }

    /**
     * Check if subscription is in trial period
     */
    static async isInTrialPeriod(boxId: string): Promise<boolean> {
        const subscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "trial")
            )
        });

        return !!subscription;
    }

    /**
     * Expire trial subscriptions
     */
    static async expireTrialSubscription(boxId: string) {
        const trialSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "trial")
            )
        });

        if (!trialSubscription) {
            throw new Error("No trial subscription found");
        }

        // Update subscription status
        await db.update(subscriptions)
            .set({
                status: "incomplete",
                updatedAt: new Date()
            })
            .where(eq(subscriptions.id, trialSubscription.id));

        // Update box status
        await db.update(boxes)
            .set({
                subscriptionStatus: "incomplete",
                status: "trial_expired",
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));

        // Trigger grace period for trial ending
        await GracePeriodService.createGracePeriod(boxId, "trial_ending", {
            severity: "critical",
            contextSnapshot: {
                trialEndedAt: new Date().toISOString(),
                subscriptionId: trialSubscription.id
            }
        });

        return { success: true, subscription: trialSubscription };
    }
}