// lib/services/billing/polar-integration-service.ts
import { Polar } from "@polar-sh/sdk";
import { db } from "@/db";
import {
    boxes,
    customerProfiles,
    checkoutSessions,
    subscriptions,
    orders as orderTable
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";

// Product mapping based on pricing tiers
const PRODUCT_ID_TO_TIER_MAP: Record<string, "seed" | "grow" | "scale"> = {
    "prod_seed_monthly": "seed",
    "prod_seed_annual": "seed",
    "prod_grow_monthly": "grow",
    "prod_grow_annual": "grow",
    "prod_scale_monthly": "scale",
    "prod_scale_annual": "scale",
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

export class PolarIntegrationService {
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
     * Create a checkout session
     */
    async createCheckoutSession(params: CreateCheckoutParams) {
        try {
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
                polarProductId: params.productIds[0],
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
     * Get billing portal URL for a customer
     */
    async getBillingPortalUrl(customerId: string, returnUrl: string) {
        try {
            const [customer] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, customerId));

            if (!customer || !customer.polarCustomerId) {
                throw new Error("Customer not found or not linked to Polar");
            }

            const portalSession = await this.polar.customerSessions.create({
                externalCustomerId: customer.id
            });

            return portalSession.customerPortalUrl;
        } catch (error) {
            console.error("Error getting Polar billing portal URL:", error);
            throw error;
        }
    }

    /**
     * Update a subscription in Polar
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

            // Update local database record
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
     * Get customer state from Polar
     */
    async getCustomerState(customerId: string) {
        try {
            const [customer] = await db.select().from(customerProfiles).where(eq(customerProfiles.id, customerId));

            if (!customer || !customer.polarCustomerId) {
                throw new Error("Customer not found or not linked to Polar");
            }

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
     * Sync customer with Polar
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
                // Create customer in Polar
                const newCustomer = await this.polar.customers.create({
                    email: customerData.email || customer.email || "",
                    name: customerData.name || customer.name || "",
                    externalId: customerData.externalId || customerId,
                    billingAddress: customerData.billingAddress
                });

                // Update database with Polar customer ID
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
}