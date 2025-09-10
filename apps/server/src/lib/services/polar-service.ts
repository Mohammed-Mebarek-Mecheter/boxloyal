// lib/services/polar-service.ts
import { Polar, type Order, type Subscription, type Customer } from "@polar-sh/sdk";
import { env } from "cloudflare:workers";

export interface CreateCustomerParams {
    email: string;
    name?: string;
    metadata?: Record<string, any>;
    billingAddress?: {
        line1: string;
        line2?: string;
        city: string;
        state?: string;
        postalCode: string;
        country: string;
    };
}

export interface CreateInvoiceParams {
    customerId: string;
    amount: number;
    currency: string;
    description: string;
    dueDate?: Date;
    metadata?: Record<string, any>;
}

export interface UpdateSubscriptionParams {
    subscriptionId: string;
    productId?: string;
    cancelAtPeriodEnd?: boolean;
    metadata?: Record<string, any>;
}

export interface UsageEventParams {
    customerId?: string;
    externalCustomerId?: string;
    name: string;
    organizationId?: string;
    metadata?: Record<string, any>;
    timestamp?: Date;
}

/**
 * Service layer for all Polar API interactions
 * Centralizes Polar SDK usage and provides error handling, retries, and logging
 */
export class PolarService {
    private static client: Polar | null = null;

    /**
     * Get configured Polar client instance
     */
    private static getClient(): Polar {
        if (!this.client) {
            if (!env.POLAR_ACCESS_TOKEN) {
                throw new Error("POLAR_ACCESS_TOKEN environment variable is required");
            }

            this.client = new Polar({
                accessToken: env.POLAR_ACCESS_TOKEN,
                server: env.POLAR_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
            });
        }

        return this.client;
    }

    /**
     * Create a new customer in Polar
     */
    static async createCustomer(params: CreateCustomerParams): Promise<Customer> {
        const client = this.getClient();

        try {
            console.log(`Creating Polar customer for email: ${params.email}`);

            const customer = await client.customers.create({
                email: params.email,
                name: params.name || params.email.split('@')[0],
                metadata: params.metadata || {},
                billingAddress: params.billingAddress,
            });

            console.log(`Successfully created Polar customer: ${customer.id}`);
            return customer;
        } catch (error) {
            console.error("Failed to create Polar customer:", error);
            throw new Error(`Failed to create customer: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get customer by external ID
     */
    static async getCustomerByExternalId(externalId: string): Promise<Customer | null> {
        const client = this.getClient();

        try {
            const customerState = await client.customers.getByExternalId({
                externalId,
            });

            return customerState.customer;
        } catch (error) {
            console.error(`Failed to get customer by external ID ${externalId}:`, error);
            return null;
        }
    }

    /**
     * Update customer information
     */
    static async updateCustomer(
        customerId: string,
        updates: Partial<CreateCustomerParams>
    ): Promise<Customer> {
        const client = this.getClient();

        try {
            console.log(`Updating Polar customer: ${customerId}`);

            const customer = await client.customers.update({
                customerId,
                ...updates,
            });

            console.log(`Successfully updated Polar customer: ${customerId}`);
            return customer;
        } catch (error) {
            console.error(`Failed to update customer ${customerId}:`, error);
            throw new Error(`Failed to update customer: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Create an invoice for overage billing
     */
    static async createInvoice(params: CreateInvoiceParams): Promise<any> {
        const client = this.getClient();

        try {
            console.log(`Creating Polar invoice for customer: ${params.customerId}, amount: ${params.amount}`);

            // Note: This assumes Polar has an invoice creation endpoint
            // You may need to adjust based on actual Polar API
            const invoice = await client.orders.create({
                customerId: params.customerId,
                amount: params.amount,
                currency: params.currency,
                description: params.description,
                metadata: params.metadata || {},
            });

            console.log(`Successfully created Polar invoice: ${invoice.id}`);
            return invoice;
        } catch (error) {
            console.error(`Failed to create invoice for customer ${params.customerId}:`, error);
            throw new Error(`Failed to create invoice: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get subscription details
     */
    static async getSubscription(subscriptionId: string): Promise<Subscription | null> {
        const client = this.getClient();

        try {
            const subscription = await client.subscriptions.get({
                subscriptionId,
            });

            return subscription;
        } catch (error) {
            console.error(`Failed to get subscription ${subscriptionId}:`, error);
            return null;
        }
    }

    /**
     * Update subscription
     */
    static async updateSubscription(params: UpdateSubscriptionParams): Promise<Subscription> {
        const client = this.getClient();

        try {
            console.log(`Updating Polar subscription: ${params.subscriptionId}`);

            const subscription = await client.subscriptions.update({
                subscriptionId: params.subscriptionId,
                productId: params.productId,
                cancel: params.cancelAtPeriodEnd,
                metadata: params.metadata,
            });

            console.log(`Successfully updated Polar subscription: ${params.subscriptionId}`);
            return subscription;
        } catch (error) {
            console.error(`Failed to update subscription ${params.subscriptionId}:`, error);
            throw new Error(`Failed to update subscription: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Cancel subscription
     */
    static async cancelSubscription(
        subscriptionId: string,
        cancelAtPeriodEnd: boolean = true,
        reason?: string
    ): Promise<Subscription> {
        const client = this.getClient();

        try {
            console.log(`Canceling Polar subscription: ${subscriptionId}, at period end: ${cancelAtPeriodEnd}`);

            const subscription = await client.subscriptions.update({
                subscriptionId,
                cancel: cancelAtPeriodEnd,
                reason,
            });

            console.log(`Successfully canceled Polar subscription: ${subscriptionId}`);
            return subscription;
        } catch (error) {
            console.error(`Failed to cancel subscription ${subscriptionId}:`, error);
            throw new Error(`Failed to cancel subscription: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Ingest usage events for metering
     */
    static async ingestUsageEvent(event: UsageEventParams): Promise<void> {
        const client = this.getClient();

        try {
            console.log(`Ingesting usage event: ${event.name} for customer: ${event.customerId || event.externalCustomerId}`);

            const eventPayload = event.customerId
                ? {
                    name: event.name,
                    customerId: event.customerId,
                    organizationId: event.organizationId,
                    metadata: event.metadata || {},
                    timestamp: event.timestamp?.toISOString() || new Date().toISOString(),
                }
                : {
                    name: event.name,
                    externalCustomerId: event.externalCustomerId!,
                    organizationId: event.organizationId,
                    metadata: event.metadata || {},
                    timestamp: event.timestamp?.toISOString() || new Date().toISOString(),
                };

            await client.events.ingest({
                events: [eventPayload],
            });

            console.log(`Successfully ingested usage event: ${event.name}`);
        } catch (error) {
            console.error(`Failed to ingest usage event ${event.name}:`, error);
            throw new Error(`Failed to ingest usage event: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Batch ingest multiple usage events
     */
    static async ingestUsageEvents(events: UsageEventParams[]): Promise<void> {
        const client = this.getClient();

        try {
            console.log(`Batch ingesting ${events.length} usage events`);

            const eventPayloads = events.map(event =>
                event.customerId
                    ? {
                        name: event.name,
                        customerId: event.customerId,
                        organizationId: event.organizationId,
                        metadata: event.metadata || {},
                        timestamp: event.timestamp?.toISOString() || new Date().toISOString(),
                    }
                    : {
                        name: event.name,
                        externalCustomerId: event.externalCustomerId!,
                        organizationId: event.organizationId,
                        metadata: event.metadata || {},
                        timestamp: event.timestamp?.toISOString() || new Date().toISOString(),
                    }
            );

            await client.events.ingest({
                events: eventPayloads,
            });

            console.log(`Successfully ingested ${events.length} usage events`);
        } catch (error) {
            console.error(`Failed to batch ingest ${events.length} usage events:`, error);
            throw new Error(`Failed to batch ingest usage events: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get customer meters and usage
     */
    static async getCustomerMeters(customerId: string): Promise<any[]> {
        const client = this.getClient();

        try {
            const meters = await client.customerMeters.list({
                customerId,
            });

            return meters.items || [];
        } catch (error) {
            console.error(`Failed to get customer meters for ${customerId}:`, error);
            return [];
        }
    }

    /**
     * Get orders for a customer
     */
    static async getCustomerOrders(
        customerId: string,
        options?: {
            page?: number;
            limit?: number;
            productBillingType?: string;
        }
    ): Promise<Order[]> {
        const client = this.getClient();

        try {
            const orders = await client.orders.list({
                customerId,
                page: options?.page || 1,
                limit: options?.limit || 10,
                productBillingType: options?.productBillingType,
            });

            return orders.items || [];
        } catch (error) {
            console.error(`Failed to get orders for customer ${customerId}:`, error);
            return [];
        }
    }

    /**
     * Create a checkout session
     */
    static async createCheckoutSession(params: {
        productId: string;
        customerId?: string;
        successUrl: string;
        metadata?: Record<string, any>;
    }): Promise<{ checkoutUrl: string; checkoutId: string }> {
        const client = this.getClient();

        try {
            console.log(`Creating checkout session for product: ${params.productId}`);

            // Note: This depends on your checkout flow implementation
            // You may need to adjust based on how you've set up the better-auth integration
            const checkout = await client.checkouts.create({
                productId: params.productId,
                customerId: params.customerId,
                successUrl: params.successUrl,
                metadata: params.metadata || {},
            });

            console.log(`Successfully created checkout session: ${checkout.id}`);
            return {
                checkoutUrl: checkout.url,
                checkoutId: checkout.id,
            };
        } catch (error) {
            console.error(`Failed to create checkout session:`, error);
            throw new Error(`Failed to create checkout session: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Generate customer portal session
     */
    static async createPortalSession(customerId: string): Promise<{ portalUrl: string }> {
        const client = this.getClient();

        try {
            console.log(`Creating portal session for customer: ${customerId}`);

            const portal = await client.customerPortal.create({
                customerId,
            });

            console.log(`Successfully created portal session for customer: ${customerId}`);
            return {
                portalUrl: portal.url,
            };
        } catch (error) {
            console.error(`Failed to create portal session for customer ${customerId}:`, error);
            throw new Error(`Failed to create portal session: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Health check - verify Polar API connectivity
     */
    static async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
        try {
            const client = this.getClient();
            // Try a simple API call to verify connectivity
            await client.organizations.list({ limit: 1 });

            return {
                status: 'healthy',
                message: 'Polar API connection successful'
            };
        } catch (error) {
            console.error('Polar API health check failed:', error);
            return {
                status: 'unhealthy',
                message: `Polar API connection failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}
