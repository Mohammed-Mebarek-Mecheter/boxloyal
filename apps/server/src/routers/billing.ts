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
    customerProfiles,
    orders,
    billingEvents,
} from "@/db/schema";
import { eq, and, desc, gte, count, sql, lt, isNull, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { env } from "cloudflare:workers";

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
            const [athleteCount, coachCount] = await Promise.all([
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
            const athleteLimit = currentPlan?.memberLimit || box.athleteLimit || 0;
            const coachLimit = currentPlan?.coachLimit || box.coachLimit || 0;

            const usage = {
                athletes: athleteCount[0].count,
                coaches: coachCount[0].count,
                athletesPercentage: athleteLimit > 0 ? Math.round((athleteCount[0].count / athleteLimit) * 100) : 0,
                coachesPercentage: coachLimit > 0 ? Math.round((coachCount[0].count / coachLimit) * 100) : 0,
                isAthleteOverLimit: athleteCount[0].count > athleteLimit,
                isCoachOverLimit: coachCount[0].count > coachLimit,
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
    getPlans: protectedProcedure.query(async () => {
        const plans = await db.query.subscriptionPlans.findMany({
            where: eq(subscriptionPlans.isActive, true),
            orderBy: subscriptionPlans.monthlyPrice,
        });

        // Add calculated savings for annual plans
        return plans.map(plan => {
            const annualSavings = plan.annualPrice ?
                (plan.monthlyPrice * 12) - plan.annualPrice : 0;
            const annualSavingsPercentage = annualSavings > 0 ?
                Math.round((annualSavings / (plan.monthlyPrice * 12)) * 100) : 0;

            return {
                ...plan,
                features: JSON.parse(plan.features),
                annualSavings,
                annualSavingsPercentage,
                monthlyPriceFormatted: `$${(plan.monthlyPrice / 100).toFixed(2)}`,
                annualPriceFormatted: plan.annualPrice ? `$${(plan.annualPrice / 100).toFixed(2)}` : null,
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
            const userBoxes = ctx.userBoxes || [];
            const hasAccess = userBoxes.some(ub => ub.box.id === input.boxId);

            if (!hasAccess) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Not a member of this box",
                });
            }

            const [box, currentCount] = await Promise.all([
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

            if (!box) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Box not found" });
            }

            const plan = await db.query.subscriptionPlans.findFirst({
                where: eq(subscriptionPlans.tier, box.subscriptionTier),
            });

            if (!plan) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Subscription plan not found" });
            }

            const limit = input.type === "athlete" ? plan.memberLimit : plan.coachLimit;
            const current = currentCount[0].count;
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

            const [recentAdditions] = await db
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
                    recentAdditions: recentAdditions.count,
                    projectedMonthly: Math.round(recentAdditions.count * (30 / 30)), // Normalize to monthly
                    willExceedSoon: !isOverLimit && (current + recentAdditions.count) >= limit,
                },
            };
        }),

    // Enhanced grace period with notification tracking
    triggerGracePeriod: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            reason: z.enum(["athlete_limit_exceeded", "coach_limit_exceeded", "trial_ending", "payment_failed"]),
            customMessage: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            // Check if there's already an active grace period
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
            const gracePeriodDays = {
                "athlete_limit_exceeded": 14,
                "coach_limit_exceeded": 14,
                "trial_ending": 7,
                "payment_failed": 3,
            };

            const endsAt = new Date();
            endsAt.setDate(endsAt.getDate() + gracePeriodDays[input.reason]);

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
                    gracePeriodId: gracePeriod.id,
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
                await this.checkAndTriggerGracePeriods(input.boxId, limitEvents);
            }

            return {
                success: true,
                eventsTracked: eventsToTrack.length,
                timestamp: new Date().toISOString(),
            };
        }),

    // Enhanced usage analytics with trend analysis
    getUsageAnalytics: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            startDate: z.date().optional(),
            endDate: z.date().optional(),
            eventTypes: z.array(z.string()).optional(),
            groupBy: z.enum(["day", "week", "month"]).default("day"),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            const startDate = input.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
            const endDate = input.endDate || new Date();

            let whereConditions = [
                eq(usageEvents.boxId, input.boxId),
                gte(usageEvents.createdAt, startDate),
                lt(usageEvents.createdAt, endDate)
            ];

            if (input.eventTypes && input.eventTypes.length > 0) {
                whereConditions.push(
                    sql`${usageEvents.eventType} = ANY(${input.eventTypes})`
                );
            }

            const usageData = await db.query.usageEvents.findMany({
                where: and(...whereConditions),
                orderBy: desc(usageEvents.createdAt),
            });

            // Aggregate by event type
            const aggregated = usageData.reduce((acc, event) => {
                if (!acc[event.eventType]) {
                    acc[event.eventType] = 0;
                }
                acc[event.eventType] += event.quantity;
                return acc;
            }, {} as Record<string, number>);

            // Group by time period for trend analysis
            const timeGrouped = usageData.reduce((acc, event) => {
                let key: string;
                const date = new Date(event.createdAt);

                switch (input.groupBy) {
                    case "day":
                        key = date.toISOString().split('T')[0];
                        break;
                    case "week":
                        const weekStart = new Date(date);
                        weekStart.setDate(date.getDate() - date.getDay());
                        key = weekStart.toISOString().split('T')[0];
                        break;
                    case "month":
                        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                        break;
                    default:
                        key = date.toISOString().split('T')[0];
                }

                if (!acc[key]) {
                    acc[key] = {};
                }
                if (!acc[key][event.eventType]) {
                    acc[key][event.eventType] = 0;
                }
                acc[key][event.eventType] += event.quantity;
                return acc;
            }, {} as Record<string, Record<string, number>>);

            // Calculate trends and growth rates
            const eventTypes = Object.keys(aggregated);
            const trends = eventTypes.map(eventType => {
                const eventData = usageData.filter(e => e.eventType === eventType);
                const midPoint = Math.floor(eventData.length / 2);
                const firstHalf = eventData.slice(0, midPoint);
                const secondHalf = eventData.slice(midPoint);

                const firstHalfSum = firstHalf.reduce((sum, e) => sum + e.quantity, 0);
                const secondHalfSum = secondHalf.reduce((sum, e) => sum + e.quantity, 0);

                const growthRate = firstHalfSum > 0
                    ? ((secondHalfSum - firstHalfSum) / firstHalfSum) * 100
                    : 0;

                return {
                    eventType,
                    total: aggregated[eventType],
                    growthRate: Math.round(growthRate * 100) / 100,
                    trend: growthRate > 0 ? "increasing" : growthRate < 0 ? "decreasing" : "stable",
                };
            });

            return {
                events: usageData,
                aggregated,
                timeGrouped,
                trends,
                totalEvents: usageData.length,
                dateRange: { startDate, endDate },
                summary: {
                    mostActiveEventType: eventTypes.reduce((a, b) =>
                        aggregated[a] > aggregated[b] ? a : b, eventTypes[0]
                    ),
                    averageEventsPerDay: Math.round(usageData.length /
                        Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
                    ),
                },
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

            const [ordersData, totalCount] = await Promise.all([
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

            // Calculate totals and statistics
            const totalSpent = ordersData
                .filter(order => order.status === "paid")
                .reduce((sum, order) => sum + order.amount, 0);

            const monthlySpend = ordersData
                .filter(order => {
                    const orderDate = new Date(order.createdAt);
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    return orderDate >= thirtyDaysAgo && order.status === "paid";
                })
                .reduce((sum, order) => sum + order.amount, 0);

            return {
                orders: ordersData.map(order => ({
                    ...order,
                    amountFormatted: `${(order.amount / 100).toFixed(2)}`,
                })),
                pagination: {
                    total: totalCount[0].count,
                    limit: input.limit,
                    offset: input.offset,
                    hasMore: (input.offset + input.limit) < totalCount[0].count,
                },
                summary: {
                    totalSpent,
                    totalSpentFormatted: `${(totalSpent / 100).toFixed(2)}`,
                    monthlySpend,
                    monthlySpendFormatted: `${(monthlySpend / 100).toFixed(2)}`,
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
                    status: input.cancelAtPeriodEnd ? "active" : "canceled",
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

            // If immediate cancellation, trigger grace period
            if (!input.cancelAtPeriodEnd) {
                await this.triggerGracePeriod({
                    boxId: input.boxId,
                    reason: "subscription_canceled",
                    customMessage: input.reason,
                });
            }

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

            const canceledSubscription = await db.query.subscriptions.findFirst({
                where: and(
                    eq(subscriptions.boxId, input.boxId),
                    eq(subscriptions.cancelAtPeriodEnd, true),
                    or(
                        eq(subscriptions.status, "active"),
                        eq(subscriptions.status, "canceled")
                    )
                ),
            });

            if (!canceledSubscription) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "No subscription to reactivate found",
                });
            }

            // Update subscription
            await db.update(subscriptions)
                .set({
                    cancelAtPeriodEnd: false,
                    canceledAt: null,
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

            return {
                success: true,
                subscription: canceledSubscription,
            };
        }),

    // Helper method for checking and triggering grace periods
    checkAndTriggerGracePeriods: async (boxId: string, limitEvents: any[]) => {
        const box = await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
        });

        if (!box) return;

        const plan = await db.query.subscriptionPlans.findFirst({
            where: eq(subscriptionPlans.tier, box.subscriptionTier),
        });

        if (!plan) return;

        // Check athlete limit
        if (limitEvents.some(e => e.eventType === "athlete_added")) {
            const [athleteCount] = await db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, "athlete"),
                    eq(boxMemberships.isActive, true)
                ));

            if (athleteCount.count > plan.memberLimit) {
                await billingRouter.triggerGracePeriod({
                    boxId,
                    reason: "athlete_limit_exceeded",
                });
            }
        }

        // Check coach limit
        if (limitEvents.some(e => e.eventType === "coach_added")) {
            const [coachCount] = await db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.role, "coach"),
                    eq(boxMemberships.isActive, true)
                ));

            if (coachCount.count > plan.coachLimit) {
                await billingRouter.triggerGracePeriod({
                    boxId,
                    reason: "coach_limit_exceeded",
                });
            }
        }
    },
});

// Enhanced helper function with better error handling
function getProductIdFromSlug(slug: string): string {
    const productMap: Record<string, string> = {
        "starter": env.POLAR_STARTER_PRODUCT_ID,
        "starter-annual": env.POLAR_STARTER_ANNUAL_PRODUCT_ID,
        "performance": env.POLAR_PERFORMANCE_PRODUCT_ID,
        "performance-annual": env.POLAR_PERFORMANCE_ANNUAL_PRODUCT_ID,
        "elite": env.POLAR_ELITE_PRODUCT_ID,
        "elite-annual": env.POLAR_ELITE_ANNUAL_PRODUCT_ID,
    };

    const productId = productMap[slug];

    if (!productId) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid product slug: ${slug}`,
        });
    }

    return productId;
}

// Enhanced helper functions for better data consistency
async function validateBoxAccess(userId: string, boxId: string, requiredRole?: string) {
    const membership = await db.query.boxMemberships.findFirst({
        where: and(
            eq(boxMemberships.userId, userId),
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.isActive, true)
        ),
    });

    if (!membership) {
        throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not a member of this box",
        });
    }

    if (requiredRole && membership.role !== requiredRole && membership.role !== "owner") {
        throw new TRPCError({
            code: "FORBIDDEN",
            message: `Insufficient permissions. Required: ${requiredRole}`,
        });
    }

    return membership;
}
