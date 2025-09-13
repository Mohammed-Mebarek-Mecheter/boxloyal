// lib/services/billing/webhook-handler-service.ts - Enhanced with proper business logic
import { db } from "@/db";
import {
    billingEvents,
    subscriptions,
    orders as orderTable,
    checkoutSessions,
    overageBilling,
    boxes,
    customerProfiles,
    subscriptionPlans,
    subscriptionChanges,
    gracePeriods
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { SubscriptionLifecycleService } from "./subscription-lifecycle-service";
import { UsageTrackingService } from "./usage-tracking-service";
import { GracePeriodService } from "./grace-period-service";
import { PlanChangeService } from "./plan-change-service";
import {boxStatusEnum, subscriptionTierEnum} from "@/db/schema/enums";

// Product mapping with environment variable support
const getProductTierMap = () => {
    const { env } = require("cloudflare:workers");
    return {
        [env.POLAR_SEED_PRODUCT_ID]: "seed",
        [env.POLAR_SEED_ANNUAL_PRODUCT_ID]: "seed",
        [env.POLAR_GROW_PRODUCT_ID]: "grow",
        [env.POLAR_GROW_ANNUAL_PRODUCT_ID]: "grow",
        [env.POLAR_SCALE_PRODUCT_ID]: "scale",
        [env.POLAR_SCALE_ANNUAL_PRODUCT_ID]: "scale",
    } as const;
};

// Map Polar subscription status to box status
const POLAR_STATUS_TO_BOX_STATUS: Record<string, string> = {
    "active": "active",
    "trialing": "active",
    "past_due": "active",
    "unpaid": "suspended",
    "canceled": "suspended",
    "incomplete": "suspended",
    "incomplete_expired": "suspended",
};

// Helper functions for type safety
function toSubscriptionTier(tier: string): typeof subscriptionTierEnum.enumValues[number] {
    if (["seed", "grow", "scale"].includes(tier)) {
        return tier as typeof subscriptionTierEnum.enumValues[number];
    }
    return "seed";
}

function toBoxStatus(status: string): typeof boxStatusEnum.enumValues[number] {
    if (["active", "suspended", "trial_expired"].includes(status)) {
        return status as typeof boxStatusEnum.enumValues[number];
    }
    return "active";
}

export class WebhookHandlerService {
    /**
     * Process a webhook event with proper idempotency and business logic separation
     */
    static async handleWebhookEvent(event: any) {
        const eventId = event.id || `${event.type}_${Date.now()}_${Math.random()}`;

        try {
            // Check if event already processed (idempotency)
            const existingEvent = await db.query.billingEvents.findFirst({
                where: eq(billingEvents.polarEventId, eventId)
            });

            if (existingEvent?.processed) {
                console.log(`Event ${eventId} already processed, skipping`);
                return { success: true, alreadyProcessed: true };
            }

            // Store or update the raw event
            const [billingEvent] = await db.insert(billingEvents).values({
                boxId: event.metadata?.boxId || event.data?.metadata?.boxId || null,
                eventType: event.type,
                polarEventId: eventId,
                data: event,
                status: 'pending',
                processed: false,
                retryCount: 0,
                maxRetries: 3
            }).onConflictDoUpdate({
                target: billingEvents.polarEventId,
                set: {
                    status: 'pending',
                    lastAttemptAt: new Date(),
                    retryCount: sql`${billingEvents.retryCount} + 1`
                }
            }).returning();

            // Update status to processing
            await db.update(billingEvents)
                .set({
                    status: "processing",
                    lastAttemptAt: new Date()
                })
                .where(eq(billingEvents.id, billingEvent.id));

            // Process based on event type using our business services
            const result = await this.routeEventToBusinessLogic(event);

            // Mark event as processed
            await db.update(billingEvents)
                .set({
                    processed: true,
                    processedAt: new Date(),
                    status: 'processed'
                })
                .where(eq(billingEvents.id, billingEvent.id));

            return { success: true, result };

        } catch (error) {
            console.error("Error handling webhook event:", error);

            // Update event status to failed
            await db.update(billingEvents)
                .set({
                    status: 'failed',
                    processingError: error instanceof Error ? error.message : String(error),
                    processingStackTrace: error instanceof Error ? error.stack : null,
                    lastAttemptAt: new Date(),
                    retryCount: sql`${billingEvents.retryCount} + 1`
                })
                .where(eq(billingEvents.polarEventId, eventId));

            throw error;
        }
    }

    /**
     * Route events to appropriate business logic handlers
     */
    private static async routeEventToBusinessLogic(event: any) {
        switch (event.type) {
            case 'subscription.created':
                return await this.handleSubscriptionCreated(event.data);
            case 'subscription.updated':
                return await this.handleSubscriptionUpdated(event.data);
            case 'subscription.canceled':
                return await this.handleSubscriptionCanceled(event.data);
            case 'subscription.revoked':
                return await this.handleSubscriptionRevoked(event.data);
            case 'customer.updated':
                return await this.handleCustomerUpdated(event.data);
            case 'invoice.paid':
            case 'order.paid':
                return await this.handlePaymentReceived(event.data);
            case 'invoice.payment_failed':
                return await this.handlePaymentFailed(event.data);
            case 'checkout.session.completed':
                return await this.handleCheckoutCompleted(event.data);
            default:
                console.log(`Unhandled event type: ${event.type}`);
                return { handled: false, eventType: event.type };
        }
    }

    /**
     * Handle subscription creation with full business logic
     */
    private static async handleSubscriptionCreated(subscriptionData: any) {
        const customerProfile = await this.getCustomerProfileByPolarId(subscriptionData.customerId);
        if (!customerProfile) {
            console.warn("Customer profile not found for subscription creation", subscriptionData.id);
            return { error: "Customer profile not found" };
        }

        const productId = subscriptionData.product_id;
        const tierMap = getProductTierMap();
        const tier = tierMap[productId];
        const plan = tier ? await db.query.subscriptionPlans.findFirst({
            where: and(
                eq(subscriptionPlans.tier, tier),
                eq(subscriptionPlans.isCurrentVersion, true)
            )
        }) : null;

        if (!plan) {
            console.error("Subscription plan not found for tier:", tier, "Product ID:", productId);
            return { error: "Plan not found" };
        }

        // Create subscription record
        await db.insert(subscriptions).values({
            polarSubscriptionId: subscriptionData.id,
            boxId: customerProfile.boxId,
            customerProfileId: customerProfile.id,
            polarProductId: productId,
            planId: plan.id,
            planVersion: plan.version ?? 1,
            status: subscriptionData.status,
            currentPeriodStart: new Date(subscriptionData.current_period_start * 1000),
            currentPeriodEnd: new Date(subscriptionData.current_period_end * 1000),
            cancelAtPeriodEnd: subscriptionData.cancel_at_period_end || false,
            canceledAt: subscriptionData.canceled_at ? new Date(subscriptionData.canceled_at * 1000) : null,
            currency: subscriptionData.currency,
            amount: subscriptionData.amount,
            interval: subscriptionData.recurring_interval,
            metadata: subscriptionData.metadata ? JSON.stringify(subscriptionData.metadata) : null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
        }).onConflictDoUpdate({
            target: subscriptions.polarSubscriptionId,
            set: {
                status: subscriptionData.status,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
            }
        });

        // Update box with subscription details
        const effectiveStartDate = subscriptionData.trial_end ?
            new Date(subscriptionData.trial_end * 1000) :
            new Date(subscriptionData.current_period_start * 1000);

        const boxStatus = POLAR_STATUS_TO_BOX_STATUS[subscriptionData.status] || "active";

        await db.update(boxes)
            .set({
                subscriptionStatus: subscriptionData.status,
                subscriptionTier: toSubscriptionTier(tier),
                subscriptionStartsAt: effectiveStartDate,
                subscriptionEndsAt: new Date(subscriptionData.current_period_end * 1000),
                status: toBoxStatus(boxStatus),
                polarSubscriptionId: subscriptionData.id,
                currentAthleteLimit: plan.athleteLimit,
                currentCoachLimit: plan.coachLimit,
                updatedAt: new Date(),
            })
            .where(eq(boxes.id, customerProfile.boxId));

        // Track subscription creation
        await UsageTrackingService.trackEvents(customerProfile.boxId, [{
            eventType: "subscription_created",
            quantity: 1,
            metadata: {
                subscriptionId: subscriptionData.id,
                planId: plan.id,
                tier,
                amount: subscriptionData.amount
            }
        }]);

        return { success: true, subscriptionId: subscriptionData.id, tier, boxId: customerProfile.boxId };
    }

    /**
     * Handle subscription updates using existing services
     */
    private static async handleSubscriptionUpdated(subscriptionData: any) {
        const existingSubscription = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.polarSubscriptionId, subscriptionData.id)
        });

        if (!existingSubscription) {
            console.log("Subscription not found for update, trying to create:", subscriptionData.id);
            return await this.handleSubscriptionCreated(subscriptionData);
        }

        const customerProfile = await this.getCustomerProfileByPolarId(subscriptionData.customerId);
        if (!customerProfile) {
            console.warn("Customer profile not found for subscription update", subscriptionData.id);
            return { error: "Customer profile not found" };
        }

        const productId = subscriptionData.product_id;
        const tierMap = getProductTierMap();
        const tier = tierMap[productId];
        const plan = tier ? await db.query.subscriptionPlans.findFirst({
            where: and(
                eq(subscriptionPlans.tier, tier),
                eq(subscriptionPlans.isCurrentVersion, true)
            )
        }) : null;

        // Update subscription record
        await db.update(subscriptions)
            .set({
                status: subscriptionData.status,
                currentPeriodStart: new Date(subscriptionData.current_period_start * 1000),
                currentPeriodEnd: new Date(subscriptionData.current_period_end * 1000),
                cancelAtPeriodEnd: subscriptionData.cancel_at_period_end || false,
                canceledAt: subscriptionData.canceled_at ? new Date(subscriptionData.canceled_at * 1000) : null,
                amount: subscriptionData.amount,
                polarProductId: productId,
                planId: plan?.id || existingSubscription.planId,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.polarSubscriptionId, subscriptionData.id));

        // Update box status
        const boxStatus = POLAR_STATUS_TO_BOX_STATUS[subscriptionData.status] || "active";
        const updateFields: any = {
            subscriptionStatus: subscriptionData.status,
            subscriptionEndsAt: new Date(subscriptionData.current_period_end * 1000),
            status: toBoxStatus(boxStatus),
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
        };

        if (plan && plan.id !== existingSubscription.planId) {
            updateFields.subscriptionTier = toSubscriptionTier(tier);
            updateFields.currentAthleteLimit = plan.athleteLimit;
            updateFields.currentCoachLimit = plan.coachLimit;
        }

        await db.update(boxes)
            .set(updateFields)
            .where(eq(boxes.id, customerProfile.boxId));

        // Handle status-specific logic using lifecycle service
        if (subscriptionData.status !== existingSubscription.status) {
            await SubscriptionLifecycleService.updateSubscriptionStatus(
                customerProfile.boxId,
                subscriptionData.status,
                subscriptionData
            );
        }

        return { success: true, statusChanged: subscriptionData.status !== existingSubscription.status };
    }

    /**
     * Handle subscription cancellation with proper lifecycle management
     */
    private static async handleSubscriptionCanceled(subscriptionData: any) {
        const subscription = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.polarSubscriptionId, subscriptionData.id)
        });

        if (!subscription) {
            console.warn("Subscription not found for cancellation", subscriptionData.id);
            return { error: "Subscription not found" };
        }

        // Use our subscription lifecycle service for proper cancellation handling
        const cancelAtPeriodEnd = subscriptionData.cancel_at_period_end !== false;

        await SubscriptionLifecycleService.cancelSubscription(subscription.boxId, {
            cancelAtPeriodEnd,
            reason: "polar_webhook_cancellation",
            metadata: {
                polarSubscriptionId: subscriptionData.id,
                polarData: subscriptionData
            }
        });

        return { success: true, cancelAtPeriodEnd };
    }

    /**
     * Handle subscription revocation (immediate access loss)
     */
    private static async handleSubscriptionRevoked(subscriptionData: any) {
        const subscription = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.polarSubscriptionId, subscriptionData.id)
        });

        if (!subscription) {
            console.warn("Subscription not found for revocation", subscriptionData.id);
            return { error: "Subscription not found" };
        }

        // Immediate cancellation with access revocation
        await SubscriptionLifecycleService.cancelSubscription(subscription.boxId, {
            cancelAtPeriodEnd: false,
            reason: "polar_subscription_revoked",
            metadata: {
                polarSubscriptionId: subscriptionData.id,
                revokedAt: new Date().toISOString()
            }
        });

        // Update subscription status to revoked
        await db.update(subscriptions)
            .set({
                status: 'canceled',
                canceledAt: new Date(),
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(subscriptions.polarSubscriptionId, subscriptionData.id));

        return { success: true, revoked: true };
    }

    /**
     * Handle customer profile updates
     */
    private static async handleCustomerUpdated(customerData: any) {
        const customer = customerData.customer || customerData;
        const boxId = customer.metadata?.box_id;

        if (!boxId) {
            console.warn("Cannot link customer to box without box_id in metadata", customer.id);
            return { error: "No box_id in metadata" };
        }

        await db.insert(customerProfiles).values({
            polarCustomerId: customer.id,
            boxId: boxId,
            email: customer.email,
            name: customer.name || customer.email.split('@')[0],
            billingAddress: customer.billing_address ? JSON.stringify(customer.billing_address) : null,
            taxId: customer.tax_id,
            updatedAt: new Date(),
        }).onConflictDoUpdate({
            target: customerProfiles.polarCustomerId,
            set: {
                email: customer.email,
                name: customer.name,
                billingAddress: customer.billing_address ? JSON.stringify(customer.billing_address) : null,
                taxId: customer.tax_id,
                updatedAt: new Date(),
            }
        });

        return { success: true, customerId: customer.id };
    }

    /**
     * Handle successful payments
     */
    private static async handlePaymentReceived(paymentData: any) {
        const order = paymentData.order || paymentData;

        // Find customer profile and related box
        const customerProfile = await this.getCustomerProfileByPolarId(order.customerId || order.customer_id);
        if (!customerProfile) {
            console.warn("Customer profile not found for payment", order.id);
            return { error: "Customer profile not found" };
        }

        // Create/update order record
        const subscriptionId = order.subscription_id ? await this.getSubscriptionId(order.subscription_id) : null;

        await db.insert(orderTable).values({
            polarOrderId: order.id,
            boxId: customerProfile.boxId,
            customerProfileId: customerProfile.id,
            subscriptionId: subscriptionId,
            polarProductId: order.product_id || 'unknown',
            orderType: order.billing_reason === "subscription_create" || order.billing_reason === "subscription_cycle" ? 'subscription' : 'addon',
            description: order.description || `Order ${order.id}`,
            status: "paid",
            amount: order.total_amount || order.amount,
            currency: order.currency || 'USD',
            paidAt: new Date(order.paid_at ? order.paid_at * 1000 : Date.now()),
            metadata: order.metadata ? JSON.stringify(order.metadata) : null,
            updatedAt: new Date(),
        }).onConflictDoUpdate({
            target: orderTable.polarOrderId,
            set: {
                status: "paid",
                paidAt: new Date(order.paid_at ? order.paid_at * 1000 : Date.now()),
                updatedAt: new Date(),
            }
        });

        // If payment failed previously, resolve grace periods
        await GracePeriodService.resolveGracePeriodsForReasons(
            customerProfile.boxId,
            ["payment_failed", "billing_issue"],
            "payment_received"
        );

        // Track payment event
        await UsageTrackingService.trackEvents(customerProfile.boxId, [{
            eventType: "payment_received",
            quantity: 1,
            metadata: {
                orderId: order.id,
                amount: order.total_amount || order.amount,
                billingReason: order.billing_reason
            }
        }]);

        return { success: true, orderId: order.id, amount: order.total_amount || order.amount };
    }

    /**
     * Handle failed payments
     */
    private static async handlePaymentFailed(paymentData: any) {
        const invoice = paymentData.invoice || paymentData;
        const boxId = paymentData.metadata?.boxId;

        if (boxId) {
            // Create grace period for payment failure
            await GracePeriodService.createGracePeriod(boxId, "payment_failed", {
                severity: "critical",
                contextSnapshot: {
                    invoiceId: invoice.id,
                    amount: invoice.amount_due,
                    failureReason: invoice.last_payment_error?.message
                }
            });

            // Track failed payment
            await UsageTrackingService.trackEvents(boxId, [{
                eventType: "payment_failed",
                quantity: 1,
                metadata: {
                    invoiceId: invoice.id,
                    failureReason: invoice.last_payment_error?.message,
                    amount: invoice.amount_due
                }
            }]);
        }

        return { success: true, failed: true, invoiceId: invoice.id };
    }

    /**
     * Handle checkout completion
     */
    private static async handleCheckoutCompleted(checkoutData: any) {
        const checkout = checkoutData.checkout || checkoutData;
        const boxId = checkout.metadata?.boxId;

        if (boxId) {
            await db.update(checkoutSessions)
                .set({
                    status: 'completed',
                    completedAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(checkoutSessions.polarCheckoutId, checkout.id));
        }

        return { success: true, checkoutId: checkout.id };
    }

    /**
     * Helper methods
     */
    private static async getCustomerProfileByPolarId(polarCustomerId: string) {
        return await db.query.customerProfiles.findFirst({
            where: eq(customerProfiles.polarCustomerId, polarCustomerId)
        });
    }

    private static async getSubscriptionId(polarSubscriptionId: string): Promise<string | null> {
        const subscription = await db.query.subscriptions.findFirst({
            where: eq(subscriptions.polarSubscriptionId, polarSubscriptionId)
        });
        return subscription?.id || null;
    }

    /**
     * Retry failed webhook events with exponential backoff
     */
    static async retryFailedEvents(maxRetries: number = 3) {
        const failedEvents = await db.select()
            .from(billingEvents)
            .where(and(
                eq(billingEvents.status, 'failed'),
                sql`${billingEvents.retryCount} < ${maxRetries}`
            ));

        const results = [];

        for (const event of failedEvents) {
            try {
                await this.routeEventToBusinessLogic(event.data);

                await db.update(billingEvents)
                    .set({
                        processed: true,
                        processedAt: new Date(),
                        status: 'processed'
                    })
                    .where(eq(billingEvents.id, event.id));

                results.push({ eventId: event.id, success: true });
            } catch (error) {
                await db.update(billingEvents)
                    .set({
                        status: 'failed',
                        processingError: error instanceof Error ? error.message : String(error),
                        lastAttemptAt: new Date(),
                        retryCount: sql`${billingEvents.retryCount} + 1`
                    })
                    .where(eq(billingEvents.id, event.id));

                results.push({
                    eventId: event.id,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return results;
    }
}
