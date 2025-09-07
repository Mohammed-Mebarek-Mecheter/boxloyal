// routers/billing.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { requireBoxOwner } from "@/lib/permissions";
import { db } from "@/db";
import {
    subscriptions,
    subscriptionPlans,
    gracePeriods,
    boxes,
    boxMemberships,
    usageEvents,
    orders
} from "@/db/schema";
import {eq, and, desc, gte, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// --- Move Helper Functions Outside the Router ---

// --- Extracted Core Logic for Grace Period Checks ---
// This is a regular async function, not a tRPC procedure
async function checkAndTriggerGracePeriodsCore(boxId: string, limitEvents: Array<{ eventType: string }>) { // Added type for limitEvents
    try {
        const box = await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
        });

        if (!box) {
            console.warn(`Box not found for grace period check: ${boxId}`);
            return;
        }

        const plan = await db.query.subscriptionPlans.findFirst({
            where: eq(subscriptionPlans.tier, box.subscriptionTier),
        });

        if (!plan) {
            console.warn(`Subscription plan not found for box tier ${box.subscriptionTier} during grace period check.`);
            return;
        }

        // --- Refactored Logic to Reduce Duplication ---
        // Define the checks needed: type, count, limit, and reason
        const checks = [
            {
                type: "athlete",
                condition: limitEvents.some(e => e.eventType === "athlete_added"),
                getCount: async () => {
                    const [result] = await db.select({ count: count() }).from(boxMemberships)
                        .where(and(eq(boxMemberships.boxId, boxId), eq(boxMemberships.role, "athlete"), eq(boxMemberships.isActive, true)));
                    return result?.count ?? 0;
                },
                limit: plan.athleteLimit,
                reason: "athlete_limit_exceeded"
            },
            {
                type: "coach",
                condition: limitEvents.some(e => e.eventType === "coach_added"),
                getCount: async () => {
                    const [result] = await db.select({ count: count() }).from(boxMemberships)
                        .where(and(eq(boxMemberships.boxId, boxId), eq(boxMemberships.role, "coach"), eq(boxMemberships.isActive, true)));
                    return result?.count ?? 0;
                },
                limit: plan.coachLimit,
                reason: "coach_limit_exceeded"
            }
        ];

        // Iterate through the checks
        for (const check of checks) {
            if (check.condition) {
                const currentCount = await check.getCount();
                console.log(`Checking ${check.type} limit for box ${boxId}: ${currentCount}/${check.limit}`);

                if (currentCount > check.limit) {
                    const reason = check.reason;
                    console.log(`Triggering grace period for box ${boxId} due to ${reason}`);

                    // Check if there's already an active grace period for this specific reason
                    const existingGracePeriod = await db.query.gracePeriods.findFirst({
                        where: and(
                            eq(gracePeriods.boxId, boxId),
                            eq(gracePeriods.resolved, false),
                            gte(gracePeriods.endsAt, new Date()),
                            eq(gracePeriods.reason, reason)
                        ),
                    });

                    if (!existingGracePeriod) {
                        const gracePeriodDays = 14; // Or use a map like before: { [reason: string]: number }
                        const endsAt = new Date();
                        endsAt.setDate(endsAt.getDate() + gracePeriodDays);

                        const [newGracePeriod] = await db.insert(gracePeriods).values({
                            boxId: boxId,
                            reason: reason,
                            endsAt,
                        }).returning();

                        // Track usage event for grace period creation
                        await db.insert(usageEvents).values({
                            boxId: boxId,
                            eventType: "grace_period_triggered",
                            quantity: 1,
                            metadata: {
                                reason: reason,
                                gracePeriodId: newGracePeriod?.id,
                                endsAt: endsAt.toISOString(),
                            },
                        });
                        console.log(`New grace period created: ${newGracePeriod?.id}`);
                    } else {
                        console.log(`Existing grace period found for reason '${reason}': ${existingGracePeriod.id}`);
                    }
                }
            }
        }
        // --- End Refactored Logic ---

    } catch (error) {
        console.error("Error in checkAndTriggerGracePeriodsCore:", error);
        // Depending on requirements, you might want to throw or handle differently
    }
}

// --- The tRPC Router ---
export const billingRouter = router({
    // Enhanced subscription retrieval with better data aggregation
    getSubscription: protectedProcedure
        .input(z.object({ boxId: z.string() }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            const box = await db.query.boxes.findFirst({
                where: eq(boxes.id, input.boxId),
            });

            if (!box) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Box not found" });
            }

            // Get active subscription with customer profile
            const activeSubscription = await db.query.subscriptions.findFirst({
                where: and(
                    eq(subscriptions.boxId, input.boxId),
                    eq(subscriptions.status, "active")
                ),
                with: {
                    customerProfile: true
                },
                orderBy: desc(subscriptions.createdAt),
            });

            // Get current plan based on box tier
            const currentPlan = await db.query.subscriptionPlans.findFirst({
                where: eq(subscriptionPlans.tier, box.subscriptionTier),
            });

            // Get all available plans for upgrade options
            const availablePlans = await db.query.subscriptionPlans.findMany({
                where: eq(subscriptionPlans.isActive, true),
                orderBy: subscriptionPlans.monthlyPrice,
            });

            // Count active members by role
            const [athleteCountResult, coachCountResult] = await Promise.all([
                db
                    .select({ count: count() })
                    .from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, input.boxId),
                        eq(boxMemberships.role, "athlete"),
                        eq(boxMemberships.isActive, true)
                    )),
                db
                    .select({ count: count() })
                    .from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, input.boxId),
                        eq(boxMemberships.role, "coach"),
                        eq(boxMemberships.isActive, true)
                    ))
            ]);

            // Get active grace period
            const activeGracePeriod = await db.query.gracePeriods.findFirst({
                where: and(
                    eq(gracePeriods.boxId, input.boxId),
                    eq(gracePeriods.resolved, false),
                    gte(gracePeriods.endsAt, new Date())
                ),
            });

            // Calculate usage percentages and limits
            const athleteLimit = currentPlan?.athleteLimit ?? 0;
            const coachLimit = currentPlan?.coachLimit ?? 0;

            const usage = {
                athletes: athleteCountResult[0]?.count ?? 0,
                coaches: coachCountResult[0]?.count ?? 0,
                athletesPercentage: athleteLimit > 0 ? Math.round(((athleteCountResult[0]?.count ?? 0) / athleteLimit) * 100) : 0,
                coachesPercentage: coachLimit > 0 ? Math.round(((coachCountResult[0]?.count ?? 0) / coachLimit) * 100) : 0,
                isAthleteOverLimit: (athleteCountResult[0]?.count ?? 0) > athleteLimit,
                isCoachOverLimit: (coachCountResult[0]?.count ?? 0) > coachLimit,
                athleteLimit,
                coachLimit,
            };

            // Get recent billing activity
            const recentOrders = await db.query.orders.findMany({
                where: eq(orders.boxId, input.boxId),
                orderBy: desc(orders.createdAt),
                limit: 5,
            });

            // Calculate next billing date
            const nextBillingDate = activeSubscription?.currentPeriodEnd || box.subscriptionEndsAt;
            const daysUntilBilling = nextBillingDate
                ? Math.ceil((new Date(nextBillingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null;

            return {
                box: {
                    id: box.id,
                    subscriptionStatus: box.subscriptionStatus,
                    subscriptionTier: box.subscriptionTier,
                    trialEndsAt: box.trialEndsAt,
                    subscriptionEndsAt: box.subscriptionEndsAt,
                    status: box.status,
                    nextBillingDate,
                    daysUntilBilling,
                },
                subscription: activeSubscription,
                currentPlan,
                availablePlans,
                usage,
                gracePeriod: activeGracePeriod,
                recentOrders,
                billing: {
                    canAddAthletes: !usage.isAthleteOverLimit || !!activeGracePeriod,
                    canAddCoaches: !usage.isCoachOverLimit || !!activeGracePeriod,
                    needsUpgrade: (usage.isAthleteOverLimit || usage.isCoachOverLimit) && !activeGracePeriod,
                    isTrialActive: box.trialEndsAt && new Date(box.trialEndsAt) > new Date(),
                    trialDaysLeft: box.trialEndsAt
                        ? Math.max(0, Math.ceil((new Date(box.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                        : null,
                },
            };
        }),

    // Enhanced plans retrieval with pricing calculations
    getPlans: protectedProcedure
        .query(async () => {
            const plans = await db.query.subscriptionPlans.findMany({
                where: eq(subscriptionPlans.isActive, true),
                orderBy: subscriptionPlans.monthlyPrice,
            });

            // Add calculated savings for annual plans
            return plans.map(plan => {
                const annualSavings = (plan.annualPrice !== null && plan.annualPrice !== undefined) ?
                    (plan.monthlyPrice * 12) - plan.annualPrice : 0;
                const annualSavingsPercentage = annualSavings > 0 ?
                    Math.round((annualSavings / (plan.monthlyPrice * 12)) * 100) : 0;

                return {
                    ...plan,
                    features: JSON.parse(plan.features || '[]'), // Handle potential null/undefined features string
                    annualSavings,
                    annualSavingsPercentage,
                    monthlyPriceFormatted: `$${(plan.monthlyPrice / 100).toFixed(2)}`,
                    annualPriceFormatted: (plan.annualPrice !== null && plan.annualPrice !== undefined) ? `$${(plan.annualPrice / 100).toFixed(2)}` : null,
                };
            });
        }),

    // Enhanced usage limits checking with predictive analytics
    checkUsageLimits: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            type: z.enum(["athlete", "coach"]),
        }))
        .query(async ({ ctx, input }) => {
            // Note: This procedure might be callable by members, not just owners.
            // The permission check below reflects that.
            const userBoxes = ctx.userBoxes || [];
            const hasAccess = userBoxes.some(ub => ub.box.id === input.boxId);

            if (!hasAccess) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Not a member of this box",
                });
            }

            const [boxResult, currentCountResult] = await Promise.all([
                db.query.boxes.findFirst({
                    where: eq(boxes.id, input.boxId),
                }),
                db
                    .select({ count: count() })
                    .from(boxMemberships)
                    .where(and(
                        eq(boxMemberships.boxId, input.boxId),
                        eq(boxMemberships.role, input.type === "athlete" ? "athlete" : "coach"),
                        eq(boxMemberships.isActive, true)
                    ))
            ]);

            if (!boxResult) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Box not found" });
            }

            const plan = await db.query.subscriptionPlans.findFirst({
                where: eq(subscriptionPlans.tier, boxResult.subscriptionTier),
            });

            if (!plan) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Subscription plan not found" });
            }

            const limit = input.type === "athlete" ? plan.athleteLimit : plan.coachLimit;
            const current = currentCountResult[0]?.count ?? 0;
            const isOverLimit = current >= limit;

            // Check for existing grace period
            const existingGracePeriod = await db.query.gracePeriods.findFirst({
                where: and(
                    eq(gracePeriods.boxId, input.boxId),
                    eq(gracePeriods.resolved, false),
                    gte(gracePeriods.endsAt, new Date())
                ),
            });

            // Get usage trend (members added in last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const [recentAdditionsResult] = await db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, input.boxId),
                    eq(boxMemberships.role, input.type === "athlete" ? "athlete" : "coach"),
                    eq(boxMemberships.isActive, true),
                    gte(boxMemberships.createdAt, thirtyDaysAgo)
                ));

            return {
                current,
                limit,
                available: Math.max(0, limit - current),
                utilizationPercentage: Math.round((current / limit) * 100),
                isOverLimit,
                canAdd: !isOverLimit || !!existingGracePeriod,
                gracePeriod: existingGracePeriod,
                upgradeRequired: isOverLimit && !existingGracePeriod,
                trend: {
                    recentAdditions: recentAdditionsResult?.count ?? 0,
                    projectedMonthly: Math.round((recentAdditionsResult?.count ?? 0) * (30 / 30)), // Normalize to monthly
                    willExceedSoon: !isOverLimit && ((current + (recentAdditionsResult?.count ?? 0)) >= limit),
                },
            };
        }),

    // Enhanced grace period with notification tracking
    triggerGracePeriod: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            reason: z.enum(["athlete_limit_exceeded", "coach_limit_exceeded", "trial_ending", "payment_failed", "subscription_canceled"]),
            customMessage: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            // Check if there's already an active grace period for *any* reason
            const existingGracePeriod = await db.query.gracePeriods.findFirst({
                where: and(
                    eq(gracePeriods.boxId, input.boxId),
                    eq(gracePeriods.resolved, false),
                    gte(gracePeriods.endsAt, new Date())
                ),
            });

            if (existingGracePeriod) {
                return { gracePeriod: existingGracePeriod, wasExisting: true };
            }

            // Create new grace period with dynamic duration based on reason
            const gracePeriodDaysMap: Record<string, number> = {
                "athlete_limit_exceeded": 14,
                "coach_limit_exceeded": 14,
                "trial_ending": 7,
                "payment_failed": 3,
                "subscription_canceled": 0, // Or a small number
            };

            const daysToAdd = gracePeriodDaysMap[input.reason] ?? 7; // Default fallback
            const endsAt = new Date();
            endsAt.setDate(endsAt.getDate() + daysToAdd);

            const [gracePeriod] = await db
                .insert(gracePeriods)
                .values({
                    boxId: input.boxId,
                    reason: input.reason,
                    endsAt,
                })
                .returning();

            // Track usage event for grace period creation
            await db.insert(usageEvents).values({
                boxId: input.boxId,
                eventType: "grace_period_triggered",
                quantity: 1,
                metadata: {
                    reason: input.reason,
                    gracePeriodId: gracePeriod?.id,
                    endsAt: endsAt.toISOString(),
                    customMessage: input.customMessage,
                },
            });

            return { gracePeriod, wasExisting: false };
        }),

    // Enhanced usage tracking with batch operations
    trackUsage: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            events: z.array(z.object({
                eventType: z.enum(["athlete_added", "athlete_removed", "checkin_logged", "pr_logged", "wod_completed", "coach_added", "coach_removed"]),
                quantity: z.number().default(1),
                metadata: z.record(z.string(), z.any()).optional(),
            })).default([]),
            // Support single event for backward compatibility
            eventType: z.enum(["athlete_added", "athlete_removed", "checkin_logged", "pr_logged", "wod_completed", "coach_added", "coach_removed"]).optional(),
            quantity: z.number().default(1).optional(),
            metadata: z.record(z.string(), z.any()).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            // Note: Permission check might depend on who can track usage.
            // Assuming members can track their own actions, owners/coaches for others.
            // The check below is a basic one. Refine as needed.
            const userBoxes = ctx.userBoxes || [];
            const hasAccess = userBoxes.some(ub => ub.box.id === input.boxId);

            if (!hasAccess) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Not a member of this box",
                });
            }

            // Handle single event (backward compatibility)
            let eventsToTrack = input.events;
            if (input.eventType) {
                eventsToTrack = [{
                    eventType: input.eventType,
                    quantity: input.quantity || 1,
                    metadata: input.metadata || {},
                }];
            }

            if (eventsToTrack.length === 0) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "No events to track",
                });
            }

            // Insert events in batch
            const eventsData = eventsToTrack.map(event => ({
                boxId: input.boxId,
                eventType: event.eventType,
                quantity: event.quantity,
                metadata: event.metadata || {},
            }));

            await db.insert(usageEvents).values(eventsData);

            // Check if any limit-related events should trigger grace periods
            const limitEvents = eventsToTrack.filter(e =>
                e.eventType === "athlete_added" || e.eventType === "coach_added"
            );

            if (limitEvents.length > 0) {
                // Check if we need to trigger a grace period
                await checkAndTriggerGracePeriodsCore(input.boxId, limitEvents);
            }

            return {
                success: true,
                eventsTracked: eventsToTrack.length,
                timestamp: new Date().toISOString(),
            };
        }),

    // New: Get billing history and invoices
    getBillingHistory: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            limit: z.number().min(1).max(50).default(20),
            offset: z.number().min(0).default(0),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            const [ordersData, totalCountResult] = await Promise.all([
                db.query.orders.findMany({
                    where: eq(orders.boxId, input.boxId),
                    orderBy: desc(orders.createdAt),
                    limit: input.limit,
                    offset: input.offset,
                    with: {
                        subscription: true,
                        customerProfile: true,
                    },
                }),
                db
                    .select({ count: count() })
                    .from(orders)
                    .where(eq(orders.boxId, input.boxId))
            ]);

            const totalCount = totalCountResult[0]?.count ?? 0;

            // Calculate totals and statistics
            const totalSpent = ordersData
                .filter(order => order.status === "paid")
                .reduce((sum, order) => sum + (order.amount ?? 0), 0); // Handle potential undefined amount

            const monthlySpend = ordersData
                .filter(order => {
                    const orderDate = new Date(order.createdAt);
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    return orderDate >= thirtyDaysAgo && order.status === "paid";
                })
                .reduce((sum, order) => sum + (order.amount ?? 0), 0); // Handle potential undefined amount

            return {
                orders: ordersData.map(order => ({
                    ...order,
                    amountFormatted: `$${((order.amount ?? 0) / 100).toFixed(2)}`, // Handle potential undefined amount
                })),
                pagination: {
                    total: totalCount,
                    limit: input.limit,
                    offset: input.offset,
                    hasMore: (input.offset + input.limit) < totalCount,
                },
                summary: {
                    totalSpent,
                    totalSpentFormatted: `$${(totalSpent / 100).toFixed(2)}`,
                    monthlySpend,
                    monthlySpendFormatted: `$${(monthlySpend / 100).toFixed(2)}`,
                    averageOrderValue: ordersData.length > 0
                        ? Math.round(totalSpent / ordersData.length)
                        : 0,
                },
            };
        }),

    // New: Cancel subscription with proper handling
    cancelSubscription: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            cancelAtPeriodEnd: z.boolean().default(true),
            reason: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            const activeSubscription = await db.query.subscriptions.findFirst({
                where: and(
                    eq(subscriptions.boxId, input.boxId),
                    eq(subscriptions.status, "active")
                ),
            });

            if (!activeSubscription) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "No active subscription found",
                });
            }

            // Update subscription in database
            await db.update(subscriptions)
                .set({
                    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
                    canceledAt: input.cancelAtPeriodEnd ? null : new Date(),
                    status: input.cancelAtPeriodEnd ? "active" : "canceled", // Status update logic
                    updatedAt: new Date(),
                })
                .where(eq(subscriptions.id, activeSubscription.id));

            // Track cancellation event
            await db.insert(usageEvents).values({
                boxId: input.boxId,
                eventType: "subscription_canceled",
                quantity: 1,
                metadata: {
                    subscriptionId: activeSubscription.id,
                    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
                    reason: input.reason,
                    polarSubscriptionId: activeSubscription.polarSubscriptionId,
                },
            });

            // Note: The actual access revocation for immediate cancellation
            // should primarily be handled by the Polar webhook (onSubscriptionRevoked)
            // and the logic in lib/auth.ts. This procedure updates the local state.

            return {
                success: true,
                cancelAtPeriodEnd: input.cancelAtPeriodEnd,
                accessEndsAt: input.cancelAtPeriodEnd
                    ? activeSubscription.currentPeriodEnd
                    : new Date(),
            };
        }),

    // New: Reactivate canceled subscription
    reactivateSubscription: protectedProcedure
        .input(z.object({
            boxId: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            // Find a subscription that is scheduled for cancellation (cancelAtPeriodEnd = true)
            // It might still have status 'active' or already 'canceled' depending on timing.
            const canceledSubscription = await db.query.subscriptions.findFirst({
                where: and(
                    eq(subscriptions.boxId, input.boxId),
                    eq(subscriptions.cancelAtPeriodEnd, true)
                    // Optionally, you might want to check status too, but cancelAtPeriodEnd is key
                    // or(
                    //     eq(subscriptions.status, "active"), // Scheduled cancel, period ongoing
                    //     eq(subscriptions.status, "canceled") // Scheduled cancel, period ended
                    // )
                ),
            });

            if (!canceledSubscription) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "No subscription scheduled for cancellation found to reactivate",
                });
            }

            // Update subscription to cancel the scheduled cancellation
            await db.update(subscriptions)
                .set({
                    cancelAtPeriodEnd: false,
                    canceledAt: null,
                    // The status should ideally be confirmed by a Polar webhook.
                    // If the period hasn't ended, it's likely still 'active'.
                    // If it has ended, reactivation might involve Polar API calls not shown here.
                    // For now, assume it becomes/should become 'active'.
                    status: "active",
                    updatedAt: new Date(),
                })
                .where(eq(subscriptions.id, canceledSubscription.id));

            // Track reactivation event
            await db.insert(usageEvents).values({
                boxId: input.boxId,
                eventType: "subscription_reactivated",
                quantity: 1,
                metadata: {
                    subscriptionId: canceledSubscription.id,
                    polarSubscriptionId: canceledSubscription.polarSubscriptionId,
                },
            });

            // --- Resolve any active grace periods related to the scheduled cancellation ---
            const gracePeriodsToResolve = await db
                .select()
                .from(gracePeriods)
                .where(and(
                    eq(gracePeriods.boxId, input.boxId),
                    eq(gracePeriods.resolved, false),
                    gte(gracePeriods.endsAt, new Date()),
                    eq(gracePeriods.reason, "subscription_canceled") // Match the reason used in triggerGracePeriod
                ));

            for (const gp of gracePeriodsToResolve) {
                await db.update(gracePeriods)
                    .set({
                        resolved: true,
                        resolvedAt: new Date(),
                        resolution: "subscription_reactivated"
                    })
                    .where(eq(gracePeriods.id, gp.id));
                console.log(`Resolved grace period ${gp.id} due to reactivation.`);
            }
            // --- End Grace Period Resolution ---

            return {
                success: true,
                subscription: canceledSubscription,
            };
        }),
});
