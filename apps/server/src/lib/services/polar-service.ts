// lib/services/polar-service.ts - Enhanced version
import { Polar } from "@polar-sh/sdk";
import { env } from "cloudflare:workers";
import type {Order} from "@/db/schema";

export interface CreateCustomerParams {
    email: string;
    name?: string;
    externalId?: string;
    metadata?: Record<string, any>;
    billingAddress?: {
        line1: string;
        line2?: string;
        city: string;
        state?: string;
        postalCode: string;
        country: string;
    };
    taxId?: [string, string]; // [value, format] e.g., ["911144442", "us_ein"]
}

export interface CreateOverageInvoiceParams {
    customerId: string;
    subscriptionId: string;
    athleteOverage: number;
    coachOverage: number;
    athleteRate: number; // in cents
    coachRate: number; // in cents
    billingPeriod: {
        start: Date;
        end: Date;
    };
    metadata?: Record<string, any>;
}

export interface UpdateSubscriptionParams {
    subscriptionId: string;
    productId?: string;
    discountId?: string | null;
    cancel?: boolean;
    reason?: string;
    comment?: string;
    prorationBehavior?: 'invoice' | 'prorate';
}

export interface UsageEventParams {
    customerId?: string;
    externalCustomerId?: string;
    name: string;
    organizationId?: string;
    metadata?: Record<string, any>;
    timestamp?: Date;
}

export interface MeterParams {
    name: string;
    organizationId: string;
    filterClauses: Array<{
        property: string;
        operator: 'eq' | 'ne' | 'in' | 'nin';
        value: string | string[];
    }>;
    aggregationFunc: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'unique';
    metadata?: Record<string, any>;
}

export interface CustomerStateResponse {
    id: string;
    email: string;
    activeSubscriptions: Array<{
        id: string;
        status: string;
        productId: string;
        currentPeriodStart: string;
        currentPeriodEnd: string;
        amount: number;
        currency: string;
    }>;
    activeMeters: Array<{
        meterId: string;
        consumedUnits: number;
        creditedUnits: number;
        balance: number;
    }>;
    grantedBenefits: Array<{
        benefitId: string;
        benefitType: string;
        properties: Record<string, any>;
    }>;
}

/**
 * Enhanced service layer for all Polar API interactions
 * Centralizes Polar SDK usage with robust error handling, retries, and logging
 */
export class PolarService {
    private static client: Polar | null = null;
    private static readonly MAX_RETRIES = 3;
    private static readonly RETRY_DELAY_MS = 1000;

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
     * Retry wrapper for API calls with exponential backoff
     */
    private static async withRetry<T>(
        operation: () => Promise<T>,
        operationName: string,
        maxRetries: number = this.MAX_RETRIES
    ): Promise<T> {
        let lastError: Error;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                console.warn(`${operationName} attempt ${attempt}/${maxRetries} failed:`, error);

                if (attempt === maxRetries) {
                    break;
                }

                // Exponential backoff: 1s, 2s, 4s
                const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.error(`${operationName} failed after ${maxRetries} attempts:`, lastError);
        throw new Error(`${operationName} failed after ${maxRetries} attempts: ${lastError.message}`);
    }

    /**
     * Create a new customer in Polar with enhanced error handling
     */
    static async createCustomer(params: CreateCustomerParams): Promise<Customer> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Creating Polar customer for email: ${params.email}`);

            const customer = await client.customers.create({
                email: params.email,
                name: params.name || params.email.split('@')[0],
                externalId: params.externalId,
                metadata: params.metadata || {},
                billingAddress: params.billingAddress,
                taxId: params.taxId,
            });

            console.log(`Successfully created Polar customer: ${customer.id}`);
            return customer;
        }, 'createCustomer');
    }

    /**
     * Get customer by external ID with proper error handling
     */
    static async getCustomerByExternalId(externalId: string): Promise<Customer | null> {
        try {
            const client = this.getClient();

            const customerState = await client.customers.getStateExternal({
                externalId,
            });

            return customerState as any; // The API returns the full customer state
        } catch (error) {
            // 404 is expected when customer doesn't exist
            if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
                console.log(`Customer with external ID ${externalId} not found`);
                return null;
            }

            console.error(`Failed to get customer by external ID ${externalId}:`, error);
            throw error;
        }
    }

    /**
     * Get customer by Polar customer ID
     */
    static async getCustomerById(customerId: string): Promise<Customer | null> {
        try {
            const client = this.getClient();

            const customer = await client.customers.get({
                id: customerId,
            });

            return customer;
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
                console.log(`Customer with ID ${customerId} not found`);
                return null;
            }

            console.error(`Failed to get customer by ID ${customerId}:`, error);
            throw error;
        }
    }

    /**
     * Update customer information with comprehensive field support
     */
    static async updateCustomer(
        customerId: string,
        updates: Partial<CreateCustomerParams>
    ): Promise<Customer> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Updating Polar customer: ${customerId}`);

            const customer = await client.customers.update({
                id: customerId,
                customerUpdate: {
                    email: updates.email,
                    name: updates.name,
                    billingAddress: updates.billingAddress,
                    taxId: updates.taxId,
                    metadata: updates.metadata,
                },
            });

            console.log(`Successfully updated Polar customer: ${customerId}`);
            return customer;
        }, 'updateCustomer');
    }

    /**
     * Get customer's complete state including subscriptions, meters, and benefits
     */
    static async getCustomerState(customerId: string): Promise<CustomerStateResponse | null> {
        try {
            const client = this.getClient();

            const state = await client.customers.getState({
                id: customerId,
            });

            return state as CustomerStateResponse;
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
                console.log(`Customer state for ID ${customerId} not found`);
                return null;
            }

            console.error(`Failed to get customer state for ${customerId}:`, error);
            throw error;
        }
    }

    /**
     * Get customer's complete state by external ID
     */
    static async getCustomerStateByExternalId(externalId: string): Promise<CustomerStateResponse | null> {
        try {
            const client = this.getClient();

            const state = await client.customers.getStateExternal({
                externalId,
            });

            return state as CustomerStateResponse;
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
                console.log(`Customer state for external ID ${externalId} not found`);
                return null;
            }

            console.error(`Failed to get customer state for external ID ${externalId}:`, error);
            throw error;
        }
    }

    /**
     * Create overage invoice for usage-based billing
     */
    static async createOverageInvoice(params: CreateOverageInvoiceParams): Promise<Order> {
        return this.withRetry(async () => {
            const client = this.getClient();

            const totalOverageAmount =
                (params.athleteOverage * params.athleteRate) +
                (params.coachOverage * params.coachRate);

            if (totalOverageAmount <= 0) {
                throw new Error("Overage amount must be greater than 0");
            }

            console.log(`Creating overage invoice for customer: ${params.customerId}, amount: ${totalOverageAmount}`);

            const description = `Overage charges for ${params.billingPeriod.start.toISOString().slice(0, 7)} - ` +
                `${params.athleteOverage} extra athletes, ${params.coachOverage} extra coaches`;

            // Note: Using a generic order creation approach
            // You may need to adjust this based on how your Polar account is configured
            const order = await client.orders.create({
                customerId: params.customerId,
                productId: env.POLAR_OVERAGE_PRODUCT_ID || "default-overage-product-id",
                amount: totalOverageAmount,
                currency: "USD",
                description,
                metadata: {
                    type: "overage_billing",
                    subscriptionId: params.subscriptionId,
                    athleteOverage: params.athleteOverage.toString(),
                    coachOverage: params.coachOverage.toString(),
                    athleteRate: params.athleteRate.toString(),
                    coachRate: params.coachRate.toString(),
                    billingPeriodStart: params.billingPeriod.start.toISOString(),
                    billingPeriodEnd: params.billingPeriod.end.toISOString(),
                    ...params.metadata,
                },
            });

            console.log(`Successfully created overage invoice: ${order.id}`);
            return order;
        }, 'createOverageInvoice');
    }

    /**
     * Get subscription details with enhanced error handling
     */
    static async getSubscription(subscriptionId: string): Promise<Subscription | null> {
        try {
            const client = this.getClient();

            const subscription = await client.subscriptions.get({
                id: subscriptionId,
            });

            return subscription;
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
                console.log(`Subscription ${subscriptionId} not found`);
                return null;
            }

            console.error(`Failed to get subscription ${subscriptionId}:`, error);
            throw error;
        }
    }

    /**
     * Update subscription with comprehensive options
     */
    static async updateSubscription(params: UpdateSubscriptionParams): Promise<Subscription> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Updating Polar subscription: ${params.subscriptionId}`);

            let subscriptionUpdate: any = {};

            if (params.productId) {
                subscriptionUpdate.productId = params.productId;
                if (params.prorationBehavior) {
                    subscriptionUpdate.prorationBehavior = params.prorationBehavior;
                }
            }

            if (params.discountId !== undefined) {
                subscriptionUpdate.discountId = params.discountId;
            }

            if (params.cancel === true) {
                subscriptionUpdate.cancel = true;
                if (params.reason) {
                    subscriptionUpdate.reason = params.reason;
                }
                if (params.comment) {
                    subscriptionUpdate.comment = params.comment;
                }
            }

            const subscription = await client.subscriptions.update({
                id: params.subscriptionId,
                subscriptionUpdate,
            });

            console.log(`Successfully updated Polar subscription: ${params.subscriptionId}`);
            return subscription;
        }, 'updateSubscription');
    }

    /**
     * Cancel subscription immediately
     */
    static async cancelSubscription(
        subscriptionId: string,
        reason?: string,
        comment?: string
    ): Promise<Subscription> {
        return this.updateSubscription({
            subscriptionId,
            cancel: true,
            reason,
            comment,
        });
    }

    /**
     * Revoke subscription immediately (different from cancellation)
     */
    static async revokeSubscription(subscriptionId: string): Promise<Subscription> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Revoking Polar subscription: ${subscriptionId}`);

            const subscription = await client.subscriptions.revoke({
                id: subscriptionId,
            });

            console.log(`Successfully revoked Polar subscription: ${subscriptionId}`);
            return subscription;
        }, 'revokeSubscription');
    }

    /**
     * Create a meter for usage tracking
     */
    static async createMeter(params: MeterParams): Promise<any> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Creating meter: ${params.name}`);

            const meter = await client.meters.create({
                name: params.name,
                organizationId: params.organizationId,
                filter: {
                    conjunction: "and",
                    clauses: params.filterClauses,
                },
                aggregation: {
                    func: params.aggregationFunc,
                },
                metadata: params.metadata || {},
            });

            console.log(`Successfully created meter: ${meter.id}`);
            return meter;
        }, 'createMeter');
    }

    /**
     * Get meter quantities for a specific time period
     */
    static async getMeterQuantities(params: {
        meterId: string;
        startTimestamp: Date;
        endTimestamp: Date;
        interval: 'year' | 'month' | 'week' | 'day' | 'hour';
        customerId?: string;
        externalCustomerId?: string;
        metadata?: Record<string, any>;
    }): Promise<{ quantities: Array<{ timestamp: string; quantity: number }>; total: number }> {
        return this.withRetry(async () => {
            const client = this.getClient();

            const result = await client.meters.quantities({
                id: params.meterId,
                startTimestamp: params.startTimestamp,
                endTimestamp: params.endTimestamp,
                interval: params.interval,
                customerId: params.customerId,
                externalCustomerId: params.externalCustomerId,
                metadata: params.metadata,
            });

            return result;
        }, 'getMeterQuantities');
    }

    /**
     * Get customer meter details
     */
    static async getCustomerMeter(customerMeterId: string): Promise<any> {
        return this.withRetry(async () => {
            const client = this.getClient();

            const customerMeter = await client.meters.get({
                id: customerMeterId,
            });

            return customerMeter;
        }, 'getCustomerMeter');
    }

    /**
     * Ingest usage events for metering with better error handling
     */
    static async ingestUsageEvent(event: UsageEventParams): Promise<void> {
        return this.withRetry(async () => {
            const client = this.getClient();

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
        }, 'ingestUsageEvent');
    }

    /**
     * Batch ingest multiple usage events with better error handling
     */
    static async ingestUsageEvents(events: UsageEventParams[]): Promise<{ inserted: number }> {
        return this.withRetry(async () => {
            const client = this.getClient();

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

            const result = await client.events.ingest({
                events: eventPayloads,
            });

            console.log(`Successfully ingested ${result.inserted} usage events`);
            return result;
        }, 'ingestUsageEvents');
    }

    /**
     * Get event by ID
     */
    static async getEvent(eventId: string): Promise<any> {
        try {
            const client = this.getClient();

            const event = await client.events.get({
                id: eventId,
            });

            return event;
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
                console.log(`Event ${eventId} not found`);
                return null;
            }

            console.error(`Failed to get event ${eventId}:`, error);
            throw error;
        }
    }

    /**
     * Get orders for a customer with enhanced filtering
     */
    static async getCustomerOrders(
        customerId: string,
        options?: {
            page?: number;
            limit?: number;
            productBillingType?: string;
        }
    ): Promise<Order[]> {
        try {
            const client = this.getClient();

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
     * Update order details (billing name and address only)
     */
    static async updateOrder(orderId: string, updates: {
        billingName?: string;
        billingAddress?: {
            line1?: string;
            line2?: string;
            city?: string;
            state?: string;
            postalCode?: string;
            country: string; // Required
        };
    }): Promise<Order> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Updating Polar order: ${orderId}`);

            const order = await client.orders.update({
                id: orderId,
                orderUpdate: {
                    billingName: updates.billingName,
                    billingAddress: updates.billingAddress,
                },
            });

            console.log(`Successfully updated Polar order: ${orderId}`);
            return order;
        }, 'updateOrder');
    }

    /**
     * Generate invoice for an order
     */
    static async generateInvoice(orderId: string): Promise<void> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Generating invoice for order: ${orderId}`);

            await client.orders.generateInvoice({
                id: orderId,
            });

            console.log(`Successfully generated invoice for order: ${orderId}`);
        }, 'generateInvoice');
    }

    /**
     * Create a checkout session with comprehensive options
     */
    static async createCheckoutSession(params: {
        productId: string;
        customerId?: string;
        externalCustomerId?: string;
        successUrl: string;
        cancelUrl?: string;
        metadata?: Record<string, any>;
        discountId?: string;
        allowDiscountCodes?: boolean;
    }): Promise<{ checkoutUrl: string; checkoutId: string }> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Creating checkout session for product: ${params.productId}`);

            const checkout = await client.checkouts.create({
                productId: params.productId,
                customerId: params.customerId,
                externalCustomerId: params.externalCustomerId,
                successUrl: params.successUrl,
                cancelUrl: params.cancelUrl,
                metadata: params.metadata || {},
                discountId: params.discountId,
                allowDiscountCodes: params.allowDiscountCodes,
            });

            console.log(`Successfully created checkout session: ${checkout.id}`);
            return {
                checkoutUrl: checkout.url,
                checkoutId: checkout.id,
            };
        }, 'createCheckoutSession');
    }

    /**
     * Generate customer portal session
     */
    static async createPortalSession(customerId: string): Promise<{ portalUrl: string }> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Creating portal session for customer: ${customerId}`);

            const portal = await client.customerPortal.create({
                customerId,
            });

            console.log(`Successfully created portal session for customer: ${customerId}`);
            return {
                portalUrl: portal.url,
            };
        }, 'createPortalSession');
    }

    /**
     * Health check - verify Polar API connectivity
     */
    static async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string; details?: any }> {
        try {
            const client = this.getClient();

            // Try a simple API call to verify connectivity
            const result = await client.organizations.list({ limit: 1 });

            return {
                status: 'healthy',
                message: 'Polar API connection successful',
                details: {
                    organizationsFound: result.items?.length || 0,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            console.error('Polar API health check failed:', error);
            return {
                status: 'unhealthy',
                message: `Polar API connection failed: ${error instanceof Error ? error.message : String(error)}`,
                details: {
                    timestamp: new Date().toISOString(),
                    error: error instanceof Error ? error.stack : String(error),
                }
            };
        }
    }

    /**
     * Get discount by ID
     */
    static async getDiscount(discountId: string): Promise<any> {
        try {
            const client = this.getClient();

            const discount = await client.discounts.get({
                id: discountId,
            });

            return discount;
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
                console.log(`Discount ${discountId} not found`);
                return null;
            }

            console.error(`Failed to get discount ${discountId}:`, error);
            throw error;
        }
    }

    /**
     * Update discount
     */
    static async updateDiscount(discountId: string, updates: {
        name?: string;
        code?: string;
        startsAt?: Date;
        endsAt?: Date;
        maxRedemptions?: number;
        metadata?: Record<string, any>;
    }): Promise<any> {
        return this.withRetry(async () => {
            const client = this.getClient();

            console.log(`Updating discount: ${discountId}`);

            const discount = await client.discounts.update({
                id: discountId,
                discountUpdate: {
                    name: updates.name,
                    code: updates.code,
                    startsAt: updates.startsAt?.toISOString(),
                    endsAt: updates.endsAt?.toISOString(),
                    maxRedemptions: updates.maxRedemptions,
                    metadata: updates.metadata,
                },
            });

            console.log(`Successfully updated discount: ${discountId}`);
            return discount;
        }, 'updateDiscount');
    }
}
