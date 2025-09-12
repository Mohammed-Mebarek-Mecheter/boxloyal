// lib/services/billing/webhook-handler-service.ts
import { db } from "@/db";
import {
    billingEvents,
    subscriptions,
    orders as orderTable,
    checkoutSessions,
    overageBilling,
    boxes,
    customerProfiles,
    subscriptionPlans
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { SubscriptionLifecycleService } from "./subscription-lifecycle-service";
import { UsageTrackingService } from "./usage-tracking-service";

// Product mapping
const PRODUCT_ID_TO_TIER_MAP: Record<string, "seed" | "grow" | "scale"> = {
    "prod_seed_monthly": "seed",
    "prod_seed_annual": "seed",
    "prod_grow_monthly": "grow",
    "prod_grow_annual": "grow",
    "prod_scale_monthly": "scale",
    "prod_scale_annual": "scale",
};

export class WebhookHandlerService {
    /**
     * Process a webhook event from Polar
     */
    static async handleWebhookEvent(event: any) {
        try {
            // Store the raw event
            const [billingEvent] = await db.insert(billingEvents).values({
                boxId: event.metadata?.boxId || null,
                eventType: event.type,
                polarEventId: event.id,
                data: event,
                status: 'pending',
                processed: false,
                retryCount: 0,
                maxRetries: 3
            }).returning();

            // Update status to processing
            await db.update(billingEvents)
                .set({
                    status: "processing",
                    lastAttemptAt: new Date()
                })
                .where(eq(billingEvents.id, billingEvent.id));

            // Process based on event type
            await this.processEventByType(event);

            // Mark event as processed
            await db.update(billingEvents)
                .set({
                    processed: true,
                    processedAt: new Date(),
                    status: 'processed'
                })
                .where(eq(billingEvents.polarEventId, event.id));

            return { success: true };
        } catch (error) {
            console.error("Error handling webhook event:", error);

            // Update event status to failed and increment retry count
            await db.update(billingEvents)
                .set({
                    status: 'failed',
                    processingError: error instanceof Error ? error.message : String(error),
                    processingStackTrace: error instanceof Error ? error.stack : null,
                    lastAttemptAt: new Date(),
                    retryCount: sql`${billingEvents.retryCount} + 1`
                })
                .where(eq(billingEvents.polarEventId, event.id));

            throw error;
        }
    }

    /**
     * Process event based on type
     */
    private static async processEventByType(event: any) {
        switch (event.type) {
            case 'subscription.created':
            case 'subscription.updated':
                await this.handleSubscriptionEvent(event);
                break;
            case 'subscription.canceled':
            case 'customer.subscription.deleted':
                await this.handleSubscriptionDeleted(event);
                break;
            case 'invoice.created':
            case 'invoice.paid':
            case 'invoice.payment_failed':
                await this.handleInvoiceEvent(event);
                break;
            case 'checkout.session.completed':
                await this.handleCheckoutCompleted(event);
                break;
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }
    }

    /**
     * Handle subscription events (created/updated)
     */
    private static async handleSubscriptionEvent(event: any) {
        const subscription = event.data.object;
        const boxId = event.metadata?.boxId;

        if (!boxId) {
            console.warn("No boxId found in subscription event metadata");
            return;
        }

        // Find or create subscription record
        const [existingSubscription] = await db.select()
            .from(subscriptions)
            .where(eq(subscriptions.polarSubscriptionId, subscription.id));

        const subscriptionData = {
            boxId,
            polarSubscriptionId: subscription.id,
            polarProductId: subscription.items?.data?.[0]?.price?.product || 'unknown',
            status: subscription.status,
            currentPeriodStart: subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : new Date(),
            currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : new Date(),
            cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
            currency: subscription.currency || 'USD',
            amount: subscription.items?.data?.[0]?.price?.unit_amount || 0,
            interval: subscription.items?.data?.[0]?.price?.recurring?.interval || 'month',
            updatedAt: new Date()
        };

        if (existingSubscription) {
            await db.update(subscriptions)
                .set(subscriptionData)
                .where(eq(subscriptions.polarSubscriptionId, subscription.id));
        } else {
            // Get customer profile for this box
            const [customerProfile] = await db.select()
                .from(customerProfiles)
                .where(eq(customerProfiles.boxId, boxId))
                .orderBy(desc(customerProfiles.createdAt))
                .limit(1);

            if (!customerProfile) {
                throw new Error(`No customer profile found for box ${boxId}`);
            }

            // Determine plan based on product ID
            const productId = subscription.items?.data?.[0]?.price?.product;
            const tier = PRODUCT_ID_TO_TIER_MAP[productId];

            if (!tier) {
                throw new Error(`Unknown product ID: ${productId}`);
            }

            // Get the appropriate plan
            const [plan] = await db.select()
                .from(subscriptionPlans)
                .where(and(
                    eq(subscriptionPlans.tier, tier),
                    eq(subscriptionPlans.isCurrentVersion, true)
                ));

            if (!plan) {
                throw new Error(`No plan found for tier: ${tier}`);
            }

            await db.insert(subscriptions).values({
                ...subscriptionData,
                customerProfileId: customerProfile.id,
                planId: plan.id,
                planVersion: plan.version
            });
        }

        // Update box subscription status
        const tier = PRODUCT_ID_TO_TIER_MAP[subscription.items?.data?.[0]?.price?.product];
        if (tier) {
            await db.update(boxes)
                .set({
                    subscriptionStatus: subscription.status,
                    subscriptionTier: tier,
                    polarSubscriptionId: subscription.id,
                    subscriptionStartsAt: subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : undefined,
                    subscriptionEndsAt: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : undefined,
                    nextBillingDate: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : undefined,
                    updatedAt: new Date()
                })
                .where(eq(boxes.id, boxId));

            // Track subscription event
            await UsageTrackingService.trackEvents(boxId, [{
                eventType: event.type === 'subscription.created' ? 'subscription_created' : 'subscription_reactivated',
                metadata: {
                    polarSubscriptionId: subscription.id,
                    planTier: tier,
                    amount: subscription.items?.data?.[0]?.price?.unit_amount || 0
                }
            }]);
        }
    }

    /**
     * Handle subscription deletion
     */
    private static async handleSubscriptionDeleted(event: any) {
        const subscription = event.data.object;
        const boxId = event.metadata?.boxId;

        if (!boxId) return;

        // Update subscription status
        await db.update(subscriptions)
            .set({
                status: 'canceled',
                canceledAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(subscriptions.polarSubscriptionId, subscription.id));

        // Update subscription lifecycle
        await SubscriptionLifecycleService.updateSubscriptionStatus(
            boxId,
            'canceled',
            event.data
        );
    }

    /**
     * Handle invoice events
     */
    private static async handleInvoiceEvent(event: any) {
        const invoice = event.data.object;
        const boxId = event.metadata?.boxId;

        // Create or update order record
        const [existingOrder] = await db.select()
            .from(orderTable)
            .where(eq(orderTable.polarInvoiceId, invoice.id));

        const orderData = {
            boxId: boxId || null,
            polarOrderId: invoice.id,
            polarInvoiceId: invoice.id,
            polarProductId: invoice.lines?.data?.[0]?.price?.product || 'unknown',
            orderType: 'subscription' as const,
            description: invoice.description || 'Invoice payment',
            status: invoice.status,
            amount: invoice.amount_due || invoice.amount_paid || 0,
            currency: invoice.currency || 'USD',
            subtotalAmount: invoice.subtotal || 0,
            taxAmount: invoice.tax || 0,
            paidAt: invoice.status === 'paid' ? new Date(invoice.status_transitions?.paid_at || Date.now()) : undefined,
            updatedAt: new Date()
        };

        if (existingOrder) {
            await db.update(orderTable)
                .set(orderData)
                .where(eq(orderTable.polarInvoiceId, invoice.id));
        } else {
            await db.insert(orderTable).values(orderData);
        }

        // Handle specific invoice events
        if (event.type === 'invoice.paid' && boxId) {
            await this.handleInvoicePaid(boxId, invoice);
        } else if (event.type === 'invoice.payment_failed' && boxId) {
            await this.handlePaymentFailed(boxId, invoice);
        }

        // If this is an overage invoice and it was paid, update the overage billing record
        if (event.metadata?.type === 'overage' && invoice.status === 'paid') {
            await db.update(overageBilling)
                .set({
                    status: 'paid',
                    paidAt: new Date(invoice.status_transitions?.paid_at || Date.now()),
                    updatedAt: new Date()
                })
                .where(eq(overageBilling.polarInvoiceId, invoice.id));
        }
    }

    /**
     * Handle successful payment
     */
    private static async handleInvoicePaid(boxId: string, invoice: any) {
        // Update subscription status to active if it was past_due
        await SubscriptionLifecycleService.updateSubscriptionStatus(
            boxId,
            'active',
            invoice
        );

        // Track payment event
        await UsageTrackingService.trackEvents(boxId, [{
            eventType: "payment_received",
            metadata: {
                invoiceId: invoice.id,
                amount: invoice.amount_paid,
                currency: invoice.currency
            }
        }]);
    }

    /**
     * Handle failed payment
     */
    private static async handlePaymentFailed(boxId: string, invoice: any) {
        // Update subscription status to past_due
        await SubscriptionLifecycleService.updateSubscriptionStatus(
            boxId,
            'past_due',
            invoice
        );

        // Track failed payment event
        await UsageTrackingService.trackEvents(boxId, [{
            eventType: "payment_failed",
            metadata: {
                invoiceId: invoice.id,
                failureReason: invoice.last_payment_error?.message,
                amount: invoice.amount_due,
                currency: invoice.currency
            }
        }]);
    }

    /**
     * Handle checkout completion
     */
    private static async handleCheckoutCompleted(event: any) {
        const checkout = event.data.object;
        const boxId = checkout.metadata?.boxId;

        if (!boxId) return;

        // Update checkout session status
        await db.update(checkoutSessions)
            .set({
                status: 'completed',
                completedAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(checkoutSessions.polarCheckoutId, checkout.id));

        // The subscription webhook will handle the rest
    }

    /**
     * Retry failed webhook events
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
                await this.processEventByType(event.data);

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