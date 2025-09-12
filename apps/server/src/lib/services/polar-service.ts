// lib/services/polar-service.ts - Fixed version
import { Polar } from "@polar-sh/sdk";
import { db } from "@/db";
import {
    boxes,
    billingEvents,
    subscriptionPlans,
    customerProfiles,
    subscriptions,
    checkoutSessions,
    orders as orderTable,
    overageBilling,
    gracePeriods,
    usageEvents
} from "@/db/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";

// Product mapping based on your pricing tiers
const PRODUCT_ID_TO_TIER_MAP: Record<string, "seed" | "grow" | "scale"> = {
    "prod_seed_monthly": "seed",
    "prod_seed_annual": "seed",
    "prod_grow_monthly": "grow",
    "prod_grow_annual": "grow",
    "prod_scale_monthly": "scale",
    "prod_scale_annual": "scale",
};

// Overage rates (in cents)
const OVERAGE_RATES = {
    athlete: 100, // $1 per athlete over limit
    coach: 100    // $1 per coach over limit
};

export interface CreateCheckoutParams {
    boxId: string;
    customerId: string;
    productIds: string[];
    successUrl: string;
    cancelUrl: string;
    allowDiscountCodes?: boolean;
    discountId?: string;
    metadata?: Record<string, any>;
}

export interface SubscriptionUpdateParams {
    subscriptionId: string;
    productId?: string;
    discountId?: string | null;
    cancelAtPeriodEnd?: boolean;
    metadata?: Record<string, any>;
}

export interface UsageRecordParams {
    boxId: string;
    name: string;
    customerId?: string;
    quantity?: number;
    metadata?: Record<string, any>;
    timestamp?: string;
}

export interface MeterQueryParams {
    meterId: string;
    startTimestamp: Date;
    endTimestamp: Date;
    interval: 'hour' | 'day' | 'week' | 'month' | 'year';
    customerId?: string;
}

export interface OverageCalculationParams {
    boxId: string;
    subscriptionId: string;
    billingPeriodStart: Date;
    billingPeriodEnd: Date;
}

export class PolarService {
    private polar: Polar;

    constructor() {
        if (!env.POLAR_ACCESS_TOKEN) {
            throw new Error("POLAR_ACCESS_TOKEN is not configured");
        }

        this.polar = new Polar({
            accessToken: env.POLAR_ACCESS_TOKEN
        });
    }

    /**
     * Create a checkout session for subscription or onboarding
     */
    async createCheckoutSession(params: CreateCheckoutParams) {
        try {
            // Get box and customer information
            const [box] = await db.select().from(boxes).where(eq(boxes.id, params.boxId));
            const [customer] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, params.customerId));

            if (!box || !customer) {
                throw new Error("Box or customer not found");
            }

            // Ensure customer is synced with Polar
            if (!customer.polarCustomerId) {
                await this.syncCustomer(customer.id, {
                    email: customer.email,
                    billingAddress: customer.billingAddress
                });
                // Refresh customer data
                const [updatedCustomer] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, params.customerId));
                if (!updatedCustomer?.polarCustomerId) {
                    throw new Error("Failed to create Polar customer");
                }
            }

            // Create checkout session in Polar
            const checkout = await this.polar.checkouts.create({
                customerBillingAddress: {
                    country: "US",
                },
                products: params.productIds,
                customerEmail: customer.email,
                customerName: customer.name || undefined,
                successUrl: params.successUrl,
                discountId: params.discountId,
                metadata: {
                    boxId: params.boxId,
                    customerId: params.customerId,
                    ...params.metadata
                }
            });

            // Store checkout session in database
            await db.insert(checkoutSessions).values({
                boxId: params.boxId,
                customerProfileId: params.customerId,
                polarCheckoutId: checkout.id,
                polarProductId: params.productIds[0], // Primary product
                successUrl: params.successUrl,
                cancelUrl: params.cancelUrl,
                allowDiscountCodes: params.allowDiscountCodes,
                discountId: params.discountId,
                status: 'pending',
                expiresAt: checkout.expiresAt ? new Date(checkout.expiresAt) : undefined,
                metadata: params.metadata
            });

            return checkout;
        } catch (error) {
            console.error("Error creating Polar checkout session:", error);
            throw error;
        }
    }

    /**
     * Get a customer's billing portal URL
     */
    async getBillingPortalUrl(customerId: string, returnUrl: string) {
        try {
            const [customer] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, customerId));

            if (!customer || !customer.polarCustomerId) {
                throw new Error("Customer not found or not linked to Polar");
            }

            // Create a customer session for portal access
            const portalSession = await this.polar.customerSessions.create({
                externalCustomerId: customer.id // Use externalCustomerId parameter
            });

            // Return the pre-authenticated portal URL from the response
            return portalSession.customerPortalUrl;
        } catch (error) {
            console.error("Error getting Polar billing portal URL:", error);
            throw error;
        }
    }

    /**
     * Update a subscription (change plan, apply discount, cancel)
     */
    async updateSubscription(params: SubscriptionUpdateParams) {
        try {
            const updateData: any = {};

            if (params.productId) {
                updateData.product = params.productId;
            }

            if (params.discountId !== undefined) {
                updateData.discount = params.discountId;
            }

            if (params.cancelAtPeriodEnd !== undefined) {
                updateData.cancelAtPeriodEnd = params.cancelAtPeriodEnd;
            }

            if (params.metadata) {
                updateData.metadata = params.metadata;
            }

            const result = await this.polar.subscriptions.update({
                id: params.subscriptionId,
                subscriptionUpdate: updateData
            });

            // Update our database record
            if (result.product && result.product.id) {
                const tier = PRODUCT_ID_TO_TIER_MAP[result.product.id];

                await db.update(subscriptions)
                    .set({
                        polarProductId: result.product.id,
                        status: result.status,
                        cancelAtPeriodEnd: result.cancelAtPeriodEnd,
                        currentPeriodStart: result.currentPeriodStart ? new Date(result.currentPeriodStart) : undefined,
                        currentPeriodEnd: result.currentPeriodEnd ? new Date(result.currentPeriodEnd) : undefined,
                        updatedAt: new Date()
                    })
                    .where(eq(subscriptions.polarSubscriptionId, params.subscriptionId));
            }

            return result;
        } catch (error) {
            console.error("Error updating Polar subscription:", error);
            throw error;
        }
    }

    /**
     * Cancel a subscription at period end
     */
    async cancelSubscription(subscriptionId: string) {
        try {
            const result = await this.polar.subscriptions.update({
                id: subscriptionId,
                subscriptionUpdate: {
                    cancelAtPeriodEnd: true
                }
            });

            // Update our database
            await db.update(subscriptions)
                .set({
                    cancelAtPeriodEnd: true,
                    canceledAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(subscriptions.polarSubscriptionId, subscriptionId));

            return result;
        } catch (error) {
            console.error("Error canceling Polar subscription:", error);
            throw error;
        }
    }

    /**
     * Revoke a subscription (immediate cancellation)
     */
    async revokeSubscription(subscriptionId: string) {
        try {
            const result = await this.polar.subscriptions.revoke({
                id: subscriptionId
            });

            // Update our database
            await db.update(subscriptions)
                .set({
                    status: 'canceled',
                    canceledAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(subscriptions.polarSubscriptionId, subscriptionId));

            return result;
        } catch (error) {
            console.error("Error revoking Polar subscription:", error);
            throw error;
        }
    }

    /**
     * Record usage for metered billing
     */
    async recordUsage(params: UsageRecordParams) {
        try {
            // Get box information
            const [box] = await db.select().from(boxes).where(eq(boxes.id, params.boxId));
            const [customer] = params.customerId
                ? await db.select().from(customerProfiles).where(eq(customerProfiles.id, params.customerId))
                : [null];

            if (!box || (!customer && params.customerId)) {
                throw new Error("Box or customer not found");
            }

            // Prepare event data
            const eventData: any = {
                name: params.name,
                quantity: params.quantity || 1,
                metadata: params.metadata || {},
                timestamp: params.timestamp || new Date().toISOString()
            };

            // Add customer identifier
            if (customer && customer.polarCustomerId) {
                eventData.customer_id = customer.polarCustomerId;
            } else if (box.polarCustomerId) {
                eventData.customer_id = box.polarCustomerId;
            }

            // Record the usage event in Polar
            const result = await this.polar.events.ingest({
                events: [eventData]
            });

            // Store usage event in our database
            await db.insert(usageEvents).values({
                boxId: params.boxId,
                eventType: params.name,
                quantity: params.quantity || 1,
                meteringKey: params.name,
                billable: true,
                metadata: params.metadata,
                billingPeriodStart: this.getCurrentBillingPeriodStart(),
                billingPeriodEnd: this.getCurrentBillingPeriodEnd(),
                processed: false
            });

            return result;
        } catch (error) {
            console.error("Error recording Polar usage:", error);
            throw error;
        }
    }

    /**
     * Calculate and create overage invoice using Order API
     * Note: Since Polar doesn't have direct invoice API, we create an order for overage
     */
    async createOverageInvoice(params: OverageCalculationParams) {
        try {
            const [box] = await db.select().from(boxes).where(eq(boxes.id, params.boxId));
            const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, params.subscriptionId));

            if (!box || !subscription || !box.polarCustomerId) {
                throw new Error("Box, subscription, or Polar customer not found");
            }

            // Calculate overage amounts
            const athleteOverage = Math.max(0, box.currentAthleteCount - box.currentAthleteLimit);
            const coachOverage = Math.max(0, box.currentCoachCount - box.currentCoachLimit);

            const athleteOverageAmount = athleteOverage * OVERAGE_RATES.athlete;
            const coachOverageAmount = coachOverage * OVERAGE_RATES.coach;
            const totalOverageAmount = athleteOverageAmount + coachOverageAmount;

            if (totalOverageAmount > 0) {
                // Since Polar doesn't have direct invoice API, we'll create a one-time product/order
                // First create an order record in our system
                const order = await db.insert(orderTable).values({
                    boxId: params.boxId,
                    polarOrderId: `overage_${params.boxId}_${Date.now()}`, // Temporary ID
                    polarProductId: 'overage',
                    orderType: 'overage',
                    description: `Overage fees for ${params.billingPeriodStart.toISOString().split('T')[0]} to ${params.billingPeriodEnd.toISOString().split('T')[0]}`,
                    status: 'pending',
                    amount: totalOverageAmount,
                    currency: 'USD',
                    subtotalAmount: totalOverageAmount,
                    taxAmount: 0,
                    metadata: {
                        type: 'overage',
                        period_start: params.billingPeriodStart.toISOString(),
                        period_end: params.billingPeriodEnd.toISOString(),
                        athleteOverage,
                        coachOverage,
                        athleteOverageRate: OVERAGE_RATES.athlete,
                        coachOverageRate: OVERAGE_RATES.coach
                    }
                }).returning();

                // Store overage billing record
                await db.insert(overageBilling).values({
                    boxId: params.boxId,
                    subscriptionId: params.subscriptionId,
                    billingPeriodStart: params.billingPeriodStart,
                    billingPeriodEnd: params.billingPeriodEnd,
                    athleteLimit: box.currentAthleteLimit,
                    coachLimit: box.currentCoachLimit,
                    athleteCount: box.currentAthleteCount,
                    coachCount: box.currentCoachCount,
                    athleteOverage,
                    coachOverage,
                    athleteOverageRate: OVERAGE_RATES.athlete,
                    coachOverageRate: OVERAGE_RATES.coach,
                    athleteOverageAmount,
                    coachOverageAmount,
                    totalOverageAmount,
                    status: 'calculated', // Will be updated when payment is processed
                    calculationMethod: 'end_of_period',
                    metadata: {
                        athleteOverage,
                        coachOverage,
                        athleteOverageRate: OVERAGE_RATES.athlete,
                        coachOverageRate: OVERAGE_RATES.coach
                    }
                });

                return order[0];
            }

            return null;
        } catch (error) {
            console.error("Error creating overage invoice:", error);
            throw error;
        }
    }

    /**
     * Process monthly billing for all active subscriptions
     */
    async processMonthlyBilling() {
        try {
            const now = new Date();
            const billingPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const billingPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            // Get all active subscriptions
            const activeSubscriptions = await db.select()
                .from(subscriptions)
                .where(eq(subscriptions.status, 'active'));

            const results = [];

            for (const subscription of activeSubscriptions) {
                try {
                    // Check if this subscription has overage enabled
                    const [box] = await db.select().from(boxes).where(eq(boxes.id, subscription.boxId));

                    if (box && box.isOverageEnabled) {
                        // Create overage invoice if applicable
                        const invoice = await this.createOverageInvoice({
                            boxId: subscription.boxId,
                            subscriptionId: subscription.id,
                            billingPeriodStart,
                            billingPeriodEnd
                        });

                        results.push({
                            subscriptionId: subscription.id,
                            boxId: subscription.boxId,
                            success: true,
                            invoiceId: invoice?.id || null,
                            amount: invoice?.amount || 0
                        });
                    } else {
                        results.push({
                            subscriptionId: subscription.id,
                            boxId: subscription.boxId,
                            success: true,
                            invoiceId: null,
                            amount: 0,
                            message: 'Overage billing not enabled'
                        });
                    }
                } catch (error) {
                    console.error(`Error processing billing for subscription ${subscription.id}:`, error);
                    results.push({
                        subscriptionId: subscription.id,
                        boxId: subscription.boxId,
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
            }

            return results;
        } catch (error) {
            console.error("Error processing monthly billing:", error);
            throw error;
        }
    }

    /**
     * Get customer state (subscriptions, benefits, meters)
     */
    async getCustomerState(customerId: string) {
        try {
            const [customer] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, customerId));

            if (!customer || !customer.polarCustomerId) {
                throw new Error("Customer not found or not linked to Polar");
            }

            // Note: Adjust this method name based on actual Polar SDK API
            const state = await this.polar.customers.get({
                id: customer.polarCustomerId
            });

            return state;
        } catch (error) {
            console.error("Error getting Polar customer state:", error);
            throw error;
        }
    }

    /**
     * Sync customer data with Polar
     */
    async syncCustomer(customerId: string, customerData: {
        name?: string;
        email?: string;
        billingAddress?: any;
        externalId?: string;
    }) {
        try {
            const [customer] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, customerId));

            if (!customer) {
                throw new Error("Customer not found");
            }

            if (!customer.polarCustomerId) {
                // Create customer in Polar if not exists
                const newCustomer = await this.polar.customers.create({
                    email: customerData.email || customer.email || "",
                    name: customerData.name || customer.name || "",
                    externalId: customerData.externalId || customerId,
                    billingAddress: customerData.billingAddress
                });

                // Update our database with Polar customer ID
                await db.update(customerProfiles).set({
                    polarCustomerId: newCustomer.id,
                    updatedAt: new Date()
                }).where(eq(customerProfiles.id, customerId));

                return newCustomer;
            } else {
                // Update existing customer in Polar
                const updatedCustomer = await this.polar.customers.update({
                    id: customer.polarCustomerId,
                    customerUpdate: {
                        email: customerData.email,
                        name: customerData.name,
                        billingAddress: customerData.billingAddress
                    }
                });

                return updatedCustomer;
            }
        } catch (error) {
            console.error("Error syncing customer with Polar:", error);
            throw error;
        }
    }

    /**
     * Generate invoice for an order
     */
    async generateInvoice(orderId: string) {
        try {
            await this.polar.orders.generateInvoice({
                id: orderId
            });

            // Update order status in our database
            await db.update(orderTable)
                .set({
                    invoiceGeneratedAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(orderTable.polarOrderId, orderId));

            return { success: true };
        } catch (error) {
            console.error("Error generating Polar invoice:", error);
            throw error;
        }
    }

    /**
     * Get invoice data for an order
     */
    async getInvoice(orderId: string) {
        try {
            const invoice = await this.polar.orders.invoice({
                id: orderId
            });

            return invoice;
        } catch (error) {
            console.error("Error getting Polar invoice:", error);
            throw error;
        }
    }

    /**
     * Handle subscription events from Polar
     */
    private async handleSubscriptionEvent(event: any) {
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
            polarProductId: subscription.items.data[0]?.price.product,
            status: subscription.status,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currency: subscription.currency,
            amount: subscription.items.data[0]?.price.unit_amount || 0,
            interval: subscription.items.data[0]?.price.recurring?.interval || 'month',
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
            const productId = subscription.items.data[0]?.price.product;
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
        const tier = PRODUCT_ID_TO_TIER_MAP[subscription.items.data[0]?.price.product];
        if (tier) {
            await db.update(boxes)
                .set({
                    subscriptionStatus: subscription.status as "trial" | "active" | "past_due" | "canceled" | "incomplete" | "paused" | "churned",
                    subscriptionTier: tier,
                    polarSubscriptionId: subscription.id,
                    updatedAt: new Date()
                })
                .where(eq(boxes.id, boxId));
        }
    }

    /**
     * Handle invoice events from Polar
     */
    private async handleInvoiceEvent(event: any) {
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
            amount: invoice.amountDue,
            currency: invoice.currency,
            subtotalAmount: invoice.subtotal,
            taxAmount: invoice.tax,
            paidAt: invoice.status === 'paid' ? new Date() : undefined,
            updatedAt: new Date()
        };

        if (existingOrder) {
            await db.update(orderTable)
                .set(orderData)
                .where(eq(orderTable.polarInvoiceId, invoice.id));
        } else {
            await db.insert(orderTable).values(orderData);
        }

        // If this is an overage invoice and it was paid, update the overage billing record
        if (event.metadata?.type === 'overage' && invoice.status === 'paid') {
            await db.update(overageBilling)
                .set({
                    status: 'paid',
                    paidAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(overageBilling.polarInvoiceId, invoice.id));
        }
    }

    /**
     * Handle checkout completion
     */
    private async handleCheckoutCompleted(event: any) {
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

        // If this was a subscription checkout, the subscription webhook will handle the rest
    }

    /**
     * Handle subscription deletion
     */
    private async handleSubscriptionDeleted(event: any) {
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

        // Update box status
        await db.update(boxes)
            .set({
                subscriptionStatus: 'canceled',
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId));
    }

    /**
     * Handle Polar webhook events
     */
    async handleWebhookEvent(event: any) {
        try {
            // Store the raw event
            await db.insert(billingEvents).values({
                boxId: event.metadata?.boxId || null,
                eventType: event.type,
                polarEventId: event.id,
                data: event,
                status: 'pending',
                processed: false,
                retryCount: 0,
                maxRetries: 3
            });

            // Process based on event type
            switch (event.type) {
                case 'subscription.created':
                case 'subscription.updated':
                    await this.handleSubscriptionEvent(event);
                    break;
                case 'invoice.created':
                case 'invoice.paid':
                case 'invoice.payment_failed':
                    await this.handleInvoiceEvent(event);
                    break;
                case 'checkout.session.completed':
                    await this.handleCheckoutCompleted(event);
                    break;
                case 'customer.subscription.deleted':
                    await this.handleSubscriptionDeleted(event);
                    break;
                default:
                    console.log(`Unhandled event type: ${event.type}`);
            }

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

            // Update event status to failed
            await db.update(billingEvents)
                .set({
                    status: 'failed',
                    lastAttemptAt: new Date(),
                    retryCount: sql`${billingEvents.retryCount} + 1`
                })
                .where(eq(billingEvents.polarEventId, event.id));

            throw error;
        }
    }

    /**
     * Enable overage protection for a box
     */
    async enableOverageProtection(boxId: string) {
        try {
            await db.update(boxes)
                .set({
                    isOverageEnabled: true,
                    updatedAt: new Date()
                })
                .where(eq(boxes.id, boxId));

            return { success: true };
        } catch (error) {
            console.error("Error enabling overage protection:", error);
            throw error;
        }
    }

    /**
     * Disable overage protection for a box
     */
    async disableOverageProtection(boxId: string) {
        try {
            await db.update(boxes)
                .set({
                    isOverageEnabled: false,
                    updatedAt: new Date()
                })
                .where(eq(boxes.id, boxId));

            return { success: true };
        } catch (error) {
            console.error("Error disabling overage protection:", error);
            throw error;
        }
    }

    /**
     * Helper to get current billing period start
     */
    private getCurrentBillingPeriodStart(): Date {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }

    /**
     * Helper to get current billing period end
     */
    private getCurrentBillingPeriodEnd(): Date {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
}

// Export singleton instance
export const polarService = new PolarService();
