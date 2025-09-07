// lib/auth.ts
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { env } from "cloudflare:workers";
import { admin } from "better-auth/plugins/admin";
import { polar, checkout, portal, usage, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import {boxStatusEnum, schema, subscriptionTierEnum} from "@/db/schema";
import { eq, and, isNull, lt } from "drizzle-orm";

// Helper functions to ensure type safety
function toSubscriptionTier(tier: string): typeof subscriptionTierEnum.enumValues[number] {
    if (["starter", "performance", "elite"].includes(tier)) {
        return tier as typeof subscriptionTierEnum.enumValues[number];
    }
    return "starter"; // default fallback
}

function toBoxStatus(status: string): typeof boxStatusEnum.enumValues[number] {
    if (["active", "suspended", "trial_expired"].includes(status)) {
        return status as typeof boxStatusEnum.enumValues[number];
    }
    return "active"; // default fallback
}

// --- Constants ---
// Map Polar product IDs to internal tiers (consider making this configurable or derived from DB)
const PRODUCT_ID_TO_TIER_MAP: Record<string, string> = {
    [env.POLAR_STARTER_PRODUCT_ID]: "starter",
    [env.POLAR_STARTER_ANNUAL_PRODUCT_ID]: "starter",
    [env.POLAR_PERFORMANCE_PRODUCT_ID]: "performance",
    [env.POLAR_PERFORMANCE_ANNUAL_PRODUCT_ID]: "performance",
    [env.POLAR_ELITE_PRODUCT_ID]: "elite",
    [env.POLAR_ELITE_ANNUAL_PRODUCT_ID]: "elite",
};
// Map Polar subscription status to internal box status (align with your enums)
const POLAR_STATUS_TO_BOX_STATUS: Record<string, string> = {
    "active": "active",
    "trialing": "active", // During trial, box is active
    "past_due": "active", // Grace period, box is active
    "unpaid": "suspended",
    "canceled": "suspended", // After paid period ends if canceled
    "incomplete": "suspended", // Failed setup
    "incomplete_expired": "suspended", // Expired setup
};

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
            impersonationSessionDuration: 60 * 60, // 1 hour
            defaultBanReason: "Terms of service violation",
            defaultBanExpiresIn: 60 * 60 * 24 * 7, // 1 week
            bannedUserMessage: "Your account has been temporarily suspended. Please contact support if you believe this is an error.",
        }),
        polar({
            client: polarClient,
            createCustomerOnSignUp: true,
            getCustomerCreateParams: async ({ user }, request) => {
                // Find the box associated with this user during signup (likely owner)
                // This assumes user metadata or request context holds box info
                // You might need to refine this based on your signup flow
                const boxId = (user as any).metadata?.boxId || request?.headers?.get('x-box-id'); // Example: pass box ID via header or metadata

                return {
                    email: user.email,
                    name: user.name || user.email.split('@')[0],
                    metadata: {
                        created_via: "boxloyal_signup",
                        user_id: user.id,
                        signup_timestamp: new Date().toISOString(),
                        box_id: boxId || null, // Associate with box if possible
                    },
                };
            },
            use: [
                checkout({
                    products: [
                        { productId: env.POLAR_STARTER_PRODUCT_ID, slug: "starter" },
                        { productId: env.POLAR_STARTER_ANNUAL_PRODUCT_ID, slug: "starter-annual" },
                        { productId: env.POLAR_PERFORMANCE_PRODUCT_ID, slug: "performance" },
                        { productId: env.POLAR_PERFORMANCE_ANNUAL_PRODUCT_ID, slug: "performance-annual" },
                        { productId: env.POLAR_ELITE_PRODUCT_ID, slug: "elite" },
                        { productId: env.POLAR_ELITE_ANNUAL_PRODUCT_ID, slug: "elite-annual" },
                    ],
                    successUrl: `${env.BETTER_AUTH_URL}/success?checkout_id={CHECKOUT_ID}`,
                    authenticatedUsersOnly: true
                }),
                portal(),
                usage(),
                webhooks({
                    secret: env.POLAR_WEBHOOK_SECRET,
                    // --- Enhanced Webhook Handlers ---
                    onCustomerStateChanged: async (payload) => {
                        try {
                            console.log("Customer state changed:", payload);
                            await updateCustomerProfile(payload.data);
                        } catch (error) {
                            console.error("Error handling customer state change:", error);
                        }
                    },
                    onOrderPaid: async (payload) => {
                        try {
                            console.log("Order paid:", payload);
                            await handleOrderPaid(payload.data);
                        } catch (error) {
                            console.error("Error handling order paid:", error);
                        }
                    },
                    // --- Key Subscription Lifecycle Events ---
                    onSubscriptionCreated: async (payload) => {
                        try {
                            console.log("Subscription created:", payload);
                            // This might be for trials or immediate starts
                            // Let onSubscriptionActive handle the main logic for activation
                        } catch (error) {
                            console.error("Error handling subscription created:", error);
                        }
                    },
                    onSubscriptionActive: async (payload) => {
                        try {
                            console.log("Subscription active:", payload);
                            await activateSubscription(payload.data);
                        } catch (error) {
                            console.error("Error handling subscription activation:", error);
                        }
                    },
                    onSubscriptionUpdated: async (payload) => {
                        try {
                            console.log("Subscription updated:", payload);
                            await updateSubscription(payload.data);
                        } catch (error) {
                            console.error("Error handling subscription update:", error);
                        }
                    },
                    onSubscriptionCanceled: async (payload) => {
                        try {
                            console.log("Subscription canceled:", payload);
                            await handleSubscriptionCancellation(payload.data);
                        } catch (error) {
                            console.error("Error handling subscription cancellation:", error);
                        }
                    },
                    // --- Critical: Revoked means immediate access loss ---
                    onSubscriptionRevoked: async (payload) => {
                        try {
                            console.log("Subscription revoked:", payload);
                            await revokeSubscription(payload.data);
                        } catch (error) {
                            console.error("Error handling subscription revocation:", error);
                        }
                    },
                    // --- Handle Trial End ---
                    // Polar might send a specific event or it might transition to 'incomplete'/'canceled'
                    // We'll use onSubscriptionUpdated to catch trial end transitions
                    // Or rely on scheduled checks (see below)
                    // If Polar has a specific trial end event, add it here.
                    // onSubscriptionTrialEnd?: async (payload) => { ... }
                }),
            ],
        })
    ],
};

// --- Helper Functions for Webhook Handlers ---

async function getCustomerProfileByPolarId(polarCustomerId: string) {
    return await db.query.customerProfiles.findFirst({
        where: eq(schema.customerProfiles.polarCustomerId, polarCustomerId)
    });
}

async function getCustomerProfileId(polarCustomerId: string): Promise<string | null> {
    const profile = await getCustomerProfileByPolarId(polarCustomerId);
    return profile?.id || null;
}

async function getSubscriptionId(polarSubscriptionId: string): Promise<string | null> {
    const subscription = await db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.polarSubscriptionId, polarSubscriptionId)
    });
    return subscription?.id || null;
}

// --- Core Logic Functions ---

async function updateCustomerProfile(customerState: any) {
    const customer = customerState.customer;
    // Assume box_id is in metadata or find another way to link customer to box
    const boxId = customer.metadata?.box_id;
    if (!boxId) {
        console.warn("Cannot link customer to box without box_id in metadata", customer.id);
        return;
    }

    await db.insert(schema.customerProfiles).values({
        polarCustomerId: customer.id,
        boxId: boxId,
        email: customer.email,
        name: customer.name || customer.email.split('@')[0],
        billingAddress: customer.billing_address ? JSON.stringify(customer.billing_address) : null, // Ensure JSON if needed
        taxId: customer.tax_id,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: schema.customerProfiles.polarCustomerId,
        set: {
            email: customer.email,
            name: customer.name,
            billingAddress: customer.billing_address ? JSON.stringify(customer.billing_address) : null,
            taxId: customer.tax_id,
            updatedAt: new Date(),
        }
    });
}

async function handleOrderPaid(order: any) {
    const customerProfile = await getCustomerProfileByPolarId(order.customerId);
    if (!customerProfile) {
        console.warn("Customer profile not found for paid order", order.id);
        return;
    }

    const subscriptionId = order.subscription_id ? await getSubscriptionId(order.subscription_id) : null;
    const productId = order.product_id;
    const tier = PRODUCT_ID_TO_TIER_MAP[productId] || "starter"; // Default fallback

    // Insert order record
    await db.insert(schema.orders).values({
        polarOrderId: order.id,
        boxId: customerProfile.boxId,
        customerProfileId: customerProfile.id,
        subscriptionId: subscriptionId,
        polarProductId: productId,
        status: "paid",
        amount: order.total_amount,
        currency: order.currency,
        paidAt: new Date(order.paid_at),
        metadata: order.metadata ? JSON.stringify(order.metadata) : null,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: schema.orders.polarOrderId,
        set: {
            status: "paid",
            paidAt: new Date(order.paid_at),
            updatedAt: new Date(),
        }
    });

    // If this is the initial subscription order, ensure the subscription is activated
    // This might happen if the subscription webhook arrives slightly after the order webhook
    if (order.billing_reason === "subscription_create" && subscriptionId) {
        const subscription = await db.query.subscriptions.findFirst({
            where: eq(schema.subscriptions.id, subscriptionId)
        });
        if (subscription && subscription.status !== 'active') {
            // Fetch latest subscription data from Polar if needed, or just activate based on order
            // For simplicity, assume activation logic handles this correctly
            console.log("Triggering activation for subscription linked to paid order", subscriptionId);
        }
    }
    // For one-time purchases, you might handle differently if needed
}

async function activateSubscription(subscriptionData: any) {
    const customerProfile = await getCustomerProfileByPolarId(subscriptionData.customerId);
    if (!customerProfile) {
        console.warn("Customer profile not found for subscription activation", subscriptionData.id);
        return;
    }

    const productId = subscriptionData.product_id;
    const tier = PRODUCT_ID_TO_TIER_MAP[productId];
    const plan = tier ? await db.query.subscriptionPlans.findFirst({ where: eq(schema.subscriptionPlans.tier, tier) }) : null;

    if (!plan) {
        console.error("Subscription plan not found for tier:", tier, "Product ID:", productId);
        return; // Or handle error appropriately
    }

    // Insert or Update Subscription Record
    await db.insert(schema.subscriptions).values({
        polarSubscriptionId: subscriptionData.id,
        boxId: customerProfile.boxId,
        customerProfileId: customerProfile.id,
        polarProductId: productId,
        status: subscriptionData.status,
        currentPeriodStart: new Date(subscriptionData.current_period_start * 1000), // Assuming Polar uses Unix timestamps
        currentPeriodEnd: new Date(subscriptionData.current_period_end * 1000),
        cancelAtPeriodEnd: subscriptionData.cancel_at_period_end || false,
        canceledAt: subscriptionData.canceled_at ? new Date(subscriptionData.canceled_at * 1000) : null,
        currency: subscriptionData.currency,
        amount: subscriptionData.amount,
        interval: subscriptionData.recurring_interval,
        metadata: subscriptionData.metadata ? JSON.stringify(subscriptionData.metadata) : null,
        planTier: tier, // Store the tier for easy lookup
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: schema.subscriptions.polarSubscriptionId,
        set: {
            status: subscriptionData.status,
            currentPeriodStart: new Date(subscriptionData.current_period_start * 1000),
            currentPeriodEnd: new Date(subscriptionData.current_period_end * 1000),
            cancelAtPeriodEnd: subscriptionData.cancel_at_period_end || false,
            canceledAt: subscriptionData.canceled_at ? new Date(subscriptionData.canceled_at * 1000) : null,
            amount: subscriptionData.amount,
            planTier: tier,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
        }
    });

    // --- Update Box Status and Limits ---
    // Determine the effective start date (trial end or current period start)
    const effectiveStartDate = subscriptionData.trial_end ?
        new Date(subscriptionData.trial_end * 1000) :
        new Date(subscriptionData.current_period_start * 1000);

    const boxStatus = POLAR_STATUS_TO_BOX_STATUS[subscriptionData.status] || "active"; // Default to active if unknown

    await db.update(schema.boxes)
        .set({
            subscriptionStatus: subscriptionData.status,
            subscriptionTier: toSubscriptionTier(tier),
            subscriptionStartsAt: effectiveStartDate,
            subscriptionEndsAt: new Date(subscriptionData.current_period_end * 1000),
            status: toBoxStatus(boxStatus),
            polarSubscriptionId: subscriptionData.id,
            updatedAt: new Date(),
        })
        .where(eq(schema.boxes.id, customerProfile.boxId));
}

async function updateSubscription(subscriptionData: any) {
    // This handles updates like status changes, plan changes, period changes
    const existingSubscription = await db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.polarSubscriptionId, subscriptionData.id)
    });

    if (!existingSubscription) {
        console.warn("Subscription not found for update", subscriptionData.id);
        // Might be a new subscription that arrived out of order, try activate
        await activateSubscription(subscriptionData);
        return;
    }

    const customerProfile = await getCustomerProfileByPolarId(subscriptionData.customerId);
    if (!customerProfile) {
        console.warn("Customer profile not found for subscription update", subscriptionData.id);
        return;
    }

    const productId = subscriptionData.product_id;
    let tier = PRODUCT_ID_TO_TIER_MAP[productId];
    let plan = tier ? await db.query.subscriptionPlans.findFirst({ where: eq(schema.subscriptionPlans.tier, tier) }) : null;

    // If plan changed or tier not found from product ID, try to infer from subscription metadata or existing record
    if (!plan && existingSubscription.planTier) {
        tier = existingSubscription.planTier;
        plan = await db.query.subscriptionPlans.findFirst({ where: eq(schema.subscriptionPlans.tier, tier) });
    }

    // Update subscription record
    await db.update(schema.subscriptions)
        .set({
            status: subscriptionData.status,
            currentPeriodStart: new Date(subscriptionData.current_period_start * 1000),
            currentPeriodEnd: new Date(subscriptionData.current_period_end * 1000),
            cancelAtPeriodEnd: subscriptionData.cancel_at_period_end || false,
            canceledAt: subscriptionData.canceled_at ? new Date(subscriptionData.canceled_at * 1000) : null,
            amount: subscriptionData.amount,
            polarProductId: productId,
            planTier: tier || existingSubscription.planTier, // Keep existing if not changed/unknown
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(schema.subscriptions.polarSubscriptionId, subscriptionData.id));

    // --- Update Box Status ---
    // Determine the effective start date (should ideally be set once on activation)
    // For updates, mainly focus on end date and status
    const boxStatus = POLAR_STATUS_TO_BOX_STATUS[subscriptionData.status] || "active";

    const updateFields: any = {
        subscriptionStatus: subscriptionData.status,
        subscriptionEndsAt: new Date(subscriptionData.current_period_end * 1000),
        status: boxStatus,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
    };

    // If plan/tier changed, update limits
    if (plan && tier && tier !== existingSubscription.planTier) {
        updateFields.subscriptionTier = tier;
        updateFields.athleteLimit = plan.athleteLimit;
        updateFields.coachLimit = plan.coachLimit;
    }

    await db.update(schema.boxes)
        .set(updateFields)
        .where(eq(schema.boxes.id, customerProfile.boxId));
}

async function handleSubscriptionCancellation(subscriptionData: any) {
    // This is for scheduled or immediate cancellations
    const existingSubscription = await db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.polarSubscriptionId, subscriptionData.id)
    });

    if (!existingSubscription) {
        console.warn("Subscription not found for cancellation", subscriptionData.id);
        return;
    }

    const customerProfile = await getCustomerProfileByPolarId(subscriptionData.customerId);
    if (!customerProfile) {
        console.warn("Customer profile not found for subscription cancellation", subscriptionData.id);
        return;
    }

    // Update subscription record
    await db.update(schema.subscriptions)
        .set({
            status: subscriptionData.status, // Should be 'canceled' or 'active' (if scheduled)
            cancelAtPeriodEnd: subscriptionData.cancel_at_period_end,
            canceledAt: subscriptionData.canceled_at ? new Date(subscriptionData.canceled_at * 1000) : new Date(), // Record cancellation time
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(schema.subscriptions.polarSubscriptionId, subscriptionData.id));

    // --- Update Box Status ---
    // If immediate cancellation (cancel_at_period_end is false), revoke access now
    if (!subscriptionData.cancel_at_period_end) {
        await revokeSubscription(subscriptionData); // Reuse revoke logic for immediate access loss
    } else {
        // Scheduled cancellation: Keep box status as 'active' until period end
        // Update subscriptionEndsAt to the cancellation date if it's sooner than current period end
        // (This might already be handled by updateSubscription, but let's be explicit)
        const currentEnd = existingSubscription.currentPeriodEnd.getTime();
        const cancelEnd = subscriptionData.current_period_end * 1000; // Use current_period_end as cancellation effective date
        const newEnd = Math.min(currentEnd, cancelEnd);

        await db.update(schema.boxes)
            .set({
                subscriptionStatus: subscriptionData.status, // 'canceled'
                subscriptionEndsAt: new Date(newEnd),
                updatedAt: new Date(),
            })
            .where(eq(schema.boxes.id, customerProfile.boxId));
    }
}

async function revokeSubscription(subscriptionData: any) {
    // Immediate access revocation (canceled immediately, revoked, expired trial, etc.)
    const existingSubscription = await db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.polarSubscriptionId, subscriptionData.id)
    });

    if (!existingSubscription) {
        console.warn("Subscription not found for revocation", subscriptionData.id);
        return;
    }

    const customerProfile = await getCustomerProfileByPolarId(subscriptionData.customerId);
    if (!customerProfile) {
        console.warn("Customer profile not found for subscription revocation", subscriptionData.id);
        return;
    }

    // Update subscription record to final state
    await db.update(schema.subscriptions)
        .set({
            status: subscriptionData.status, // 'canceled', 'revoked', 'incomplete_expired', etc.
            canceledAt: subscriptionData.canceled_at ? new Date(subscriptionData.canceled_at * 1000) : new Date(),
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(schema.subscriptions.polarSubscriptionId, subscriptionData.id));

    // --- Update Box to Suspended State ---
    await db.update(schema.boxes)
        .set({
            subscriptionStatus: subscriptionData.status,
            status: 'suspended', // Critical: Deny access
            updatedAt: new Date(),
        })
        .where(eq(schema.boxes.id, customerProfile.boxId));
}

// --- Access Control Utility (to be used in your application middleware or route guards) ---
// This function checks if a box should have access based on its current state
export async function checkBoxAccess(boxId: string): Promise<{ hasAccess: boolean; reason?: string }> {
    const box = await db.query.boxes.findFirst({ where: eq(schema.boxes.id, boxId) });

    if (!box) {
        return { hasAccess: false, reason: "Box not found" };
    }

    // 1. Check overall box status
    if (box.status !== 'active') {
        return { hasAccess: false, reason: `Box status is ${box.status}` };
    }

    const now = new Date();

    // 2. Check Trial Status
    if (box.subscriptionStatus === 'trial') {
        if (box.trialEndsAt && now >= box.trialEndsAt) {
            // Trial has expired and no paid subscription started
            if (!box.polarSubscriptionId || box.subscriptionStartsAt === null) {
                // Update box status to trial_expired if not already handled by webhook
                // This is a safety net / scheduled check logic
                await db.update(schema.boxes)
                    .set({ status: 'trial_expired', updatedAt: new Date() })
                    .where(eq(schema.boxes.id, boxId));
                return { hasAccess: false, reason: "Trial expired without subscription" };
            }
            // If there is a polarSubscriptionId, access might be granted based on that subscription's status
            // This case should ideally be handled by subscription webhooks transitioning the box state
        }
        // Trial is still active
        return { hasAccess: true };
    }

    // 3. Check Paid Subscription Status (if not in trial)
    if (box.polarSubscriptionId) {
        const subscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(schema.subscriptions.polarSubscriptionId, box.polarSubscriptionId),
                eq(schema.subscriptions.boxId, boxId)
            )
        });

        if (!subscription) {
            console.warn("Box references Polar subscription ID, but subscription record not found", box.polarSubscriptionId);
            return { hasAccess: false, reason: "Subscription record mismatch" };
        }

        // Check subscription status
        if (['active', 'trialing', 'past_due'].includes(subscription.status)) {
            // Check if the paid period has ended (relevant for canceled subscriptions)
            if (subscription.status === 'canceled' || subscription.status === 'past_due') {
                if (box.subscriptionEndsAt && now >= box.subscriptionEndsAt) {
                    return { hasAccess: false, reason: "Paid subscription period ended" };
                }
            }
            // Subscription is active or in grace period
            return { hasAccess: true };
        } else {
            // Subscription is in a state that denies access (canceled, unpaid, incomplete, etc.)
            // Even if subscriptionEndsAt is in the future, if status is 'canceled' and past period end, deny
            if (box.subscriptionEndsAt && now >= box.subscriptionEndsAt) {
                return { hasAccess: false, reason: `Subscription status is ${subscription.status} and period ended` };
            }
            // If status is 'canceled' but period hasn't ended yet, access might still be granted
            // This depends on your exact business logic for grace periods
            // For now, deny if status is explicitly denying (adjust logic if needed)
            if (['unpaid', 'incomplete', 'incomplete_expired', 'revoked'].includes(subscription.status)) {
                return { hasAccess: false, reason: `Subscription status is ${subscription.status}` };
            }
            // Default deny for other non-active statuses if unsure
            return { hasAccess: false, reason: `Subscription status is ${subscription.status}` };
        }
    } else {
        // No subscription ID, not in trial -> likely no access
        return { hasAccess: false, reason: "No active subscription or trial" };
    }

    // Default deny if logic falls through (shouldn't happen with correct states)
    return { hasAccess: false, reason: "Access denied by default" };
}


// --- Scheduled Task Placeholder (e.g., using Cloudflare Cron Triggers or a separate worker) ---
// This function can be run periodically (e.g., daily) to catch edge cases or missed webhooks
export async function enforceSubscriptionRules() {
    const now = new Date();

    // 1. Find boxes whose trial has expired without a subscription starting
    const expiredTrialBoxes = await db.select().from(schema.boxes)
        .where(and(
            eq(schema.boxes.subscriptionStatus, 'trial'),
            lt(schema.boxes.trialEndsAt, now),
            isNull(schema.boxes.polarSubscriptionId) // No paid subscription linked
        ));

    for (const box of expiredTrialBoxes) {
        console.log(`Enforcing trial expiry for box ${box.id}`);
        await db.update(schema.boxes)
            .set({
                status: 'trial_expired',
                updatedAt: new Date()
            })
            .where(eq(schema.boxes.id, box.id));
    }

    // 2. Find boxes whose paid subscription period has ended (for canceled subscriptions)
    // This catches cases where the cancellation webhook might have been missed or processed incorrectly
    const endedSubscriptionBoxes = await db.select({
        box: schema.boxes,
        subscription: schema.subscriptions
    }).from(schema.boxes)
        .innerJoin(schema.subscriptions, eq(schema.boxes.polarSubscriptionId, schema.subscriptions.polarSubscriptionId))
        .where(and(
            eq(schema.boxes.status, 'active'), // Only check active boxes
            eq(schema.subscriptions.status, 'canceled'), // Subscription is canceled
            lt(schema.boxes.subscriptionEndsAt, now) // Paid period has ended
        ));

    for (const { box, subscription } of endedSubscriptionBoxes) {
        console.log(`Enforcing subscription end for box ${box.id}`);
        await db.update(schema.boxes)
            .set({
                status: 'suspended',
                updatedAt: new Date()
            })
            .where(eq(schema.boxes.id, box.id));

        // Ensure subscription record is also marked correctly if needed
        await db.update(schema.subscriptions)
            .set({ lastSyncedAt: new Date(), updatedAt: new Date() }) // Just update sync time, status should be correct
            .where(eq(schema.subscriptions.id, subscription.id));
    }

    // 3. Add checks for other scenarios like past_due -> unpaid transitions if needed
    // ...
}


export const auth = betterAuth(authConfig) as unknown as ReturnType<typeof betterAuth>;
