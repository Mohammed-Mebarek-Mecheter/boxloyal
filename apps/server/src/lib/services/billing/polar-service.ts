// lib/services/billing/polar-service.ts
import { PolarIntegrationService } from "./polar-integration-service";
import { WebhookHandlerService } from "./webhook-handler-service";
import { BillingService } from "./billing-service";
import type { CreateCheckoutParams, SubscriptionUpdateParams } from "./polar-integration-service";

/**
 * Polar Service - High-level interface for all Polar.sh operations
 * This service provides a clean API for interacting with Polar while
 * coordinating with other billing services for complete functionality
 */
export class PolarService {
    private integration: PolarIntegrationService;

    constructor() {
        this.integration = new PolarIntegrationService();
    }

    /**
     * Create a checkout session for subscription or upgrade
     */
    async createCheckoutSession(params: CreateCheckoutParams) {
        try {
            const checkout = await this.integration.createCheckoutSession(params);

            // Track the checkout creation
            await BillingService.trackEvents(params.boxId, [{
                eventType: "subscription_created",
                metadata: {
                    polarCheckoutId: checkout.id,
                    productIds: params.productIds,
                    customerId: params.customerId
                }
            }]);

            return checkout;
        } catch (error) {
            console.error("Error in PolarService.createCheckoutSession:", error);
            throw error;
        }
    }

    /**
     * Get billing portal URL for customer
     */
    async getBillingPortalUrl(customerId: string, returnUrl: string) {
        return await this.integration.getBillingPortalUrl(customerId, returnUrl);
    }

    /**
     * Update a subscription with coordination of internal state
     */
    async updateSubscription(params: SubscriptionUpdateParams) {
        try {
            const result = await this.integration.updateSubscription(params);

            // If this is a cancellation, handle it through our lifecycle service
            if (params.cancelAtPeriodEnd !== undefined) {
                // The webhook will handle the detailed lifecycle management
                console.log(`Subscription ${params.subscriptionId} cancellation status updated: ${params.cancelAtPeriodEnd}`);
            }

            return result;
        } catch (error) {
            console.error("Error in PolarService.updateSubscription:", error);
            throw error;
        }
    }

    /**
     * Cancel subscription at period end
     */
    async cancelSubscription(subscriptionId: string, reason?: string, canceledByUserId?: string) {
        try {
            // First update in Polar
            const result = await this.integration.cancelSubscription(subscriptionId);

            // Find the box associated with this subscription
            const subscription = await this.findSubscriptionByPolarId(subscriptionId);
            if (subscription) {
                // Use our lifecycle service to handle the complete cancellation flow
                await BillingService.cancelSubscription(subscription.boxId, {
                    cancelAtPeriodEnd: true,
                    reason,
                    canceledByUserId,
                    metadata: {
                        polarSubscriptionId: subscriptionId,
                        polarResponse: result
                    }
                });
            }

            return result;
        } catch (error) {
            console.error("Error in PolarService.cancelSubscription:", error);
            throw error;
        }
    }

    /**
     * Immediately revoke/cancel subscription
     */
    async revokeSubscription(subscriptionId: string, reason?: string, revokedByUserId?: string) {
        try {
            const result = await this.integration.revokeSubscription(subscriptionId);

            const subscription = await this.findSubscriptionByPolarId(subscriptionId);
            if (subscription) {
                await BillingService.cancelSubscription(subscription.boxId, {
                    cancelAtPeriodEnd: false,
                    reason: reason || "immediate_revocation",
                    canceledByUserId: revokedByUserId,
                    metadata: {
                        polarSubscriptionId: subscriptionId,
                        polarResponse: result
                    }
                });
            }

            return result;
        } catch (error) {
            console.error("Error in PolarService.revokeSubscription:", error);
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
        return await this.integration.syncCustomer(customerId, customerData);
    }

    /**
     * Get customer state from Polar
     */
    async getCustomerState(customerId: string) {
        return await this.integration.getCustomerState(customerId);
    }

    /**
     * Generate invoice for an order
     */
    async generateInvoice(orderId: string) {
        return await this.integration.generateInvoice(orderId);
    }

    /**
     * Get invoice data
     */
    async getInvoice(orderId: string) {
        return await this.integration.getInvoice(orderId);
    }

    /**
     * Handle incoming webhooks from Polar
     */
    async handleWebhook(event: any) {
        try {
            return await WebhookHandlerService.handleWebhookEvent(event);
        } catch (error) {
            console.error("Error handling Polar webhook:", error);
            throw error;
        }
    }

    /**
     * Create overage invoice (using Polar's order system)
     */
    async createOverageInvoice(boxId: string, subscriptionId: string, billingPeriodStart: Date, billingPeriodEnd: Date) {
        try {
            // Calculate overage
            const calculation = await BillingService.calculateOverageForPeriod(
                boxId,
                subscriptionId,
                billingPeriodStart,
                billingPeriodEnd
            );

            if (!calculation || calculation.totalOverageAmount === 0) {
                return null;
            }

            // Create overage order in our system
            const order = await BillingService.createOverageOrder(calculation);

            // Generate invoice through Polar if we have an order
            if (order?.polarOrderId && order.polarOrderId.startsWith('overage_')) {
                // For now, we're creating temporary order IDs
                // In a real implementation, you might create actual products/orders in Polar
                console.log(`Overage calculated for ${boxId}: $${(calculation.totalOverageAmount / 100).toFixed(2)}`);
            }

            return order;
        } catch (error) {
            console.error("Error creating overage invoice:", error);
            throw error;
        }
    }

    /**
     * Process monthly billing (typically called by cron job)
     */
    async processMonthlyBilling() {
        return await BillingService.processMonthlyBilling();
    }

    /**
     * Enable overage protection for a box
     */
    async enableOverageProtection(boxId: string, userId: string) {
        return await BillingService.enableOverageBilling(boxId, userId);
    }

    /**
     * Get billing health status
     */
    async getHealthStatus() {
        return await BillingService.getBillingHealthCheck();
    }

    /**
     * Helper method to find subscription by Polar ID
     */
    private async findSubscriptionByPolarId(polarSubscriptionId: string) {
        const { db } = await import("@/db");
        const { subscriptions } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");

        return await db.query.subscriptions.findFirst({
            where: eq(subscriptions.polarSubscriptionId, polarSubscriptionId)
        });
    }
}

// Export singleton instance
export const polarService = new PolarService();
