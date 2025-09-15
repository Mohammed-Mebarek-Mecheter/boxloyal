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
// Import the BillingNotificationService
import {BillingNotificationService} from "@/lib/services/notifications/billing";

export class SubscriptionLifecycleService {
    // Instantiate the BillingNotificationService
    private static billingNotificationService = new BillingNotificationService();

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

        // --- INTEGRATION: Send Billing Notification for Subscription Cancellation ---
        try {
            await this.billingNotificationService.sendSubscriptionCancelledNotification(
                boxId,
                cancelAtPeriodEnd,
                reason,
                cancelAtPeriodEnd ? activeSubscription.currentPeriodEnd : new Date()
            );
            console.log(`Subscription cancellation notification sent for box ${boxId}`);
        } catch (error) {
            console.error(`Failed to send subscription cancellation notification for box ${boxId}:`, error);
            // Consider alerting or retry logic if notification is critical
        }
        // --- END INTEGRATION ---

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

        // --- INTEGRATION: Send Billing Notification for Subscription Reactivation ---
        try {
            await this.billingNotificationService.sendSubscriptionReactivatedNotification(boxId);
            console.log(`Subscription reactivation notification sent for box ${boxId}`);
        } catch (error) {
            console.error(`Failed to send subscription reactivation notification for box ${boxId}:`, error);
            // Depending on requirements, you might want to alert or retry if this notification is critical
        }
        // --- END INTEGRATION ---

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
        const gracePeriodResult = await GracePeriodService.createGracePeriod(boxId, "payment_failed", {
            severity: "critical",
            contextSnapshot: { polarEvent: eventData }
        });

        await UsageTrackingService.trackEvents(boxId, [{
            eventType: "payment_failed",
            metadata: eventData
        }]);

        // --- INTEGRATION: Send Billing Notification for Payment Failure ---
        // This requires extracting amount and attempt number from eventData.
        // Assuming eventData contains this information based on Polar webhook structure.
        // You might need to adjust the keys based on actual Polar event data.
        try {
            const amount = eventData?.amount_due || eventData?.amount || 0; // Adjust key as needed
            const attemptNumber = eventData?.attempt_count || eventData?.attempt_number || 1; // Adjust key as needed

            await this.billingNotificationService.sendPaymentFailedNotification(
                boxId,
                amount,
                attemptNumber
            );
            console.log(`Payment failed notification sent for box ${boxId}`);
        } catch (error) {
            console.error(`Failed to send payment failed notification for box ${boxId}:`, error);
        }
        // --- END INTEGRATION ---
    }

    /**
     * Handle canceled status
     */
    private static async handleCanceledStatus(boxId: string, eventData?: Record<string, any>) {
        const gracePeriodResult = await GracePeriodService.createGracePeriod(boxId, "subscription_canceled", {
            severity: "blocking",
            contextSnapshot: { polarEvent: eventData }
        });

        await UsageTrackingService.trackEvents(boxId, [{
            eventType: "subscription_canceled",
            metadata: eventData
        }]);

        // --- INTEGRATION: Send Billing Notification for Subscription Cancellation (External) ---
        // This might be redundant if `cancelSubscription` is always called internally,
        // but it covers cases where cancellation is triggered externally (e.g., via Polar dashboard).
        try {
            // Extract reason if possible from eventData
            const reason = eventData?.cancellation_details?.reason || eventData?.reason || "Subscription canceled via external system";
            // Assuming immediate cancellation for external events unless specified otherwise
            const cancelAtPeriodEnd = false;
            const accessEndsAt = new Date(); // Or extract from eventData if available

            await this.billingNotificationService.sendSubscriptionCancelledNotification(
                boxId,
                cancelAtPeriodEnd,
                reason,
                accessEndsAt
            );
            console.log(`External subscription cancellation notification sent for box ${boxId}`);
        } catch (error) {
            console.error(`Failed to send external subscription cancellation notification for box ${boxId}:`, error);
        }
        // --- END INTEGRATION ---
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

        // --- INTEGRATION: Send Billing Notification for Payment Success ---
        // This requires extracting amount and invoice ID from eventData.
        // Assuming eventData contains this information based on Polar webhook structure.
        try {
            const amount = eventData?.amount_paid || eventData?.amount_received || eventData?.amount || 0; // Adjust key as needed
            const invoiceId = eventData?.id || eventData?.invoice_id || undefined; // Adjust key as needed

            await this.billingNotificationService.sendPaymentSuccessfulNotification(
                boxId,
                amount,
                invoiceId
            );
            console.log(`Payment successful notification sent for box ${boxId}`);
        } catch (error) {
            console.error(`Failed to send payment successful notification for box ${boxId}:`, error);
        }
        // --- END INTEGRATION ---
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
        const gracePeriodResult = await GracePeriodService.createGracePeriod(boxId, "trial_ending", {
            severity: "critical",
            contextSnapshot: {
                trialEndedAt: new Date().toISOString(),
                subscriptionId: trialSubscription.id
            }
        });

        // --- INTEGRATION: Send Billing Notification for Trial Ending ---
        // This is handled by the GracePeriodService creating the grace period,
        // and the GracePeriodService should trigger the notification.
        // However, we can also send a direct notification here if needed *before* the grace period.
        // For now, we rely on the grace period notification.
        // If you want a notification *at the moment of expiry* (not just the grace period trigger),
        // you could add it here. But typically, the grace period notification covers this.
        // Example (optional/direct):
        /*
        try {
            // We don't have days remaining here, so we assume 0 or just expired.
            // The grace period notification will likely be more informative.
            // await this.billingNotificationService.sendTrialEndingNotification(boxId, 0);
        } catch (error) {
             console.error(`Failed to send trial expiry notification for box ${boxId}:`, error);
        }
        */
        // --- END INTEGRATION (Handled by GracePeriodService) ---

        return { success: true, subscription: trialSubscription };
    }
}
