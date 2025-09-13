// lib/auth.ts - Simplified to focus on auth and delegation
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { env } from "cloudflare:workers";
import { admin } from "better-auth/plugins/admin";
import { polar, checkout, portal, usage, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { schema } from "@/db/schema";
import { WebhookHandlerService } from "@/lib/services/billing/webhook-handler-service";

// Initialize Polar client
const polarClient = new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
});

if (!env.POLAR_ACCESS_TOKEN) {
    throw new Error("POLAR_ACCESS_TOKEN environment variable is required");
}
if (!env.POLAR_WEBHOOK_SECRET) {
    throw new Error("POLAR_WEBHOOK_SECRET environment variable is required");
}

const authConfig: BetterAuthOptions = {
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            ...schema,
            user: schema.user,
        },
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
        enabled: true,
        autoSignIn: true,
    },
    socialProviders: {
        facebook: {
            clientId: env.FACEBOOK_CLIENT_ID as string,
            clientSecret: env.FACEBOOK_CLIENT_SECRET as string,
        },
        google: {
            clientId: env.GOOGLE_CLIENT_ID as string,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string,
        },
        linkedin: {
            clientId: env.LINKEDIN_CLIENT_ID as string,
            clientSecret: env.LINKEDIN_CLIENT_SECRET as string,
        },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
        defaultCookieAttributes: {
            sameSite: "none",
            secure: true,
            httpOnly: true,
        },
    },
    plugins: [
        admin({
            defaultRole: "user",
            adminRoles: ["admin", "owner"],
            impersonationSessionDuration: 60 * 60,
            defaultBanReason: "Terms of service violation",
            defaultBanExpiresIn: 60 * 60 * 24 * 7,
            bannedUserMessage: "Your account has been temporarily suspended. Please contact support if you believe this is an error.",
        }),
        polar({
            client: polarClient,
            createCustomerOnSignUp: true,
            getCustomerCreateParams: async ({ user }, request) => {
                const boxId = (user as any).metadata?.boxId || request?.headers?.get('x-box-id');
                return {
                    email: user.email,
                    name: user.name || user.email.split('@')[0],
                    metadata: {
                        created_via: "boxloyal_signup",
                        user_id: user.id,
                        signup_timestamp: new Date().toISOString(),
                        box_id: boxId || null,
                    },
                };
            },
            use: [
                checkout({
                    products: [
                        { productId: env.POLAR_SEED_PRODUCT_ID, slug: "seed" },
                        { productId: env.POLAR_SEED_ANNUAL_PRODUCT_ID, slug: "seed-annual" },
                        { productId: env.POLAR_GROW_PRODUCT_ID, slug: "grow" },
                        { productId: env.POLAR_GROW_ANNUAL_PRODUCT_ID, slug: "grow-annual" },
                        { productId: env.POLAR_SCALE_PRODUCT_ID, slug: "scale" },
                        { productId: env.POLAR_SCALE_ANNUAL_PRODUCT_ID, slug: "scale-annual" },
                    ],
                    successUrl: `${env.BETTER_AUTH_URL}/success?checkout_id={CHECKOUT_ID}`,
                    authenticatedUsersOnly: true
                }),
                portal(),
                usage(),
                webhooks({
                    secret: env.POLAR_WEBHOOK_SECRET,
                    // Simplified webhook handlers that delegate to services
                    onCustomerStateChanged: async (payload) => {
                        try {
                            await WebhookHandlerService.handleWebhookEvent({
                                type: 'customer.updated',
                                id: `customer_${Date.now()}`,
                                data: payload.data,
                                metadata: { source: 'polar_adapter' }
                            });
                        } catch (error) {
                            console.error("Error handling customer state change:", error);
                            throw error; // Let Better Auth handle retry logic
                        }
                    },
                    onOrderPaid: async (payload) => {
                        try {
                            await WebhookHandlerService.handleWebhookEvent({
                                type: 'invoice.paid',
                                id: `order_${payload.data.id}`,
                                data: payload.data,
                                metadata: { source: 'polar_adapter' }
                            });
                        } catch (error) {
                            console.error("Error handling order paid:", error);
                            throw error;
                        }
                    },
                    onSubscriptionCreated: async (payload) => {
                        try {
                            await WebhookHandlerService.handleWebhookEvent({
                                type: 'subscription.created',
                                id: `sub_created_${payload.data.id}`,
                                data: payload.data,
                                metadata: { source: 'polar_adapter' }
                            });
                        } catch (error) {
                            console.error("Error handling subscription created:", error);
                            throw error;
                        }
                    },
                    onSubscriptionActive: async (payload) => {
                        try {
                            await WebhookHandlerService.handleWebhookEvent({
                                type: 'subscription.updated',
                                id: `sub_active_${payload.data.id}`,
                                data: payload.data,
                                metadata: { source: 'polar_adapter', status: 'active' }
                            });
                        } catch (error) {
                            console.error("Error handling subscription activation:", error);
                            throw error;
                        }
                    },
                    onSubscriptionUpdated: async (payload) => {
                        try {
                            await WebhookHandlerService.handleWebhookEvent({
                                type: 'subscription.updated',
                                id: `sub_updated_${payload.data.id}`,
                                data: payload.data,
                                metadata: { source: 'polar_adapter' }
                            });
                        } catch (error) {
                            console.error("Error handling subscription update:", error);
                            throw error;
                        }
                    },
                    onSubscriptionCanceled: async (payload) => {
                        try {
                            await WebhookHandlerService.handleWebhookEvent({
                                type: 'subscription.canceled',
                                id: `sub_canceled_${payload.data.id}`,
                                data: payload.data,
                                metadata: { source: 'polar_adapter' }
                            });
                        } catch (error) {
                            console.error("Error handling subscription cancellation:", error);
                            throw error;
                        }
                    },
                    onSubscriptionRevoked: async (payload) => {
                        try {
                            await WebhookHandlerService.handleWebhookEvent({
                                type: 'subscription.revoked',
                                id: `sub_revoked_${payload.data.id}`,
                                data: payload.data,
                                metadata: { source: 'polar_adapter' }
                            });
                        } catch (error) {
                            console.error("Error handling subscription revocation:", error);
                            throw error;
                        }
                    },
                }),
            ],
        })
    ],
};

export const auth = betterAuth(authConfig) as unknown as ReturnType<typeof betterAuth>;
