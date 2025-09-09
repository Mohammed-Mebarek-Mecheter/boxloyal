// routers/billing.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { requireBoxOwner, requireBoxAccess } from "@/lib/permissions";
import { BillingService } from "@/lib/services/billing-service";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { subscriptionPlans } from "@/db/schema";
import { eq } from "drizzle-orm";

export const billingRouter = router({
    // Get comprehensive subscription dashboard
    getSubscription: protectedProcedure
        .input(z.object({ boxId: z.string() }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const dashboard = await BillingService.getSubscriptionInfo(input.boxId);
                return {
                    success: true,
                    data: dashboard
                };
            } catch (error) {
                console.error("Error fetching subscription info:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to fetch subscription information"
                });
            }
        }),

    // Get available subscription plans
    getPlans: protectedProcedure
        .query(async () => {
            try {
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

                    // --- Fix: Handle potentially non-string or null features ---
                    let parsedFeatures: any[] = [];
                    if (typeof plan.features === 'string') {
                        try {
                            parsedFeatures = JSON.parse(plan.features);
                        } catch (e) {
                            console.warn(`Failed to parse features for plan ${plan.id}:`, e);
                            parsedFeatures = []; // Default to empty array on parse error
                        }
                    } else if (Array.isArray(plan.features)) {
                        // If it's already an array (e.g., from Drizzle ORM processing), use it directly
                        parsedFeatures = plan.features;
                    }
                    // If plan.features is null/undefined or not a string/array, parsedFeatures remains []

                    return {
                        ...plan,
                        // Use the parsed/corrected features array
                        features: parsedFeatures,
                        annualSavings,
                        annualSavingsPercentage,
                        monthlyPriceFormatted: `$${(plan.monthlyPrice / 100).toFixed(2)}`,
                        annualPriceFormatted: plan.annualPrice ?
                            `$${(plan.annualPrice / 100).toFixed(2)}` : null,
                    };
                });
            } catch (error) {
                console.error("Error fetching plans:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to fetch subscription plans"
                });
            }
        }),

    // Check usage limits with predictive analytics
    checkUsageLimits: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            type: z.enum(["athlete", "coach"]),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxAccess(ctx, input.boxId);

            try {
                const usageLimit = await BillingService.checkUsageLimits(input.boxId, input.type);
                return {
                    success: true,
                    data: usageLimit
                };
            } catch (error) {
                console.error("Error checking usage limits:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to check usage limits"
                });
            }
        }),

    // Trigger grace period with enhanced options
    triggerGracePeriod: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            reason: z.enum([
                "athlete_limit_exceeded",
                "coach_limit_exceeded",
                "trial_ending",
                "payment_failed",
                "subscription_canceled",
                "billing_issue"
            ]),
            customMessage: z.string().optional(),
            severity: z.enum(["info", "warning", "critical", "blocking"]).optional(),
            autoResolve: z.boolean().optional(),
            contextSnapshot: z.record(z.string(), z.any()).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.triggerGracePeriod(
                    input.boxId,
                    input.reason,
                    {
                        customMessage: input.customMessage,
                        severity: input.severity,
                        autoResolve: input.autoResolve,
                        contextSnapshot: input.contextSnapshot
                    }
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error triggering grace period:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to trigger grace period"
                });
            }
        }),

    // Track usage events with billing context
    trackUsage: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            events: z.array(z.object({
                eventType: z.enum([
                    "athlete_added", "athlete_removed", "checkin_logged",
                    "pr_logged", "wod_completed", "coach_added",
                    "coach_removed", "subscription_created", "subscription_canceled",
                    "subscription_reactivated", "grace_period_triggered", "plan_upgraded",
                    "plan_downgraded", "overage_billed", "payment_failed", "payment_received",
                    "grace_period_resolved"
                ]),
                quantity: z.number().default(1),
                metadata: z.record(z.string(), z.any()).optional(),
                entityId: z.string().optional(),
                entityType: z.string().optional(),
                userId: z.string().optional(),
                billable: z.boolean().optional(),
            }))
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxAccess(ctx, input.boxId);

            try {
                const result = await BillingService.trackUsage(input.boxId, input.events);
                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error tracking usage:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to track usage"
                });
            }
        }),

    // Get billing history and invoices
    getBillingHistory: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            limit: z.number().min(1).max(50).default(20),
            offset: z.number().min(0).default(0),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const recentActivity = await BillingService.getRecentBillingActivity(input.boxId, input.limit);
                return {
                    success: true,
                    data: {
                        orders: recentActivity,
                        pagination: {
                            total: recentActivity.length,
                            limit: input.limit,
                            offset: input.offset,
                            hasMore: false // Would need proper pagination implementation
                        }
                    }
                };
            } catch (error) {
                console.error("Error fetching billing history:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to fetch billing history"
                });
            }
        }),

    // Cancel subscription with proper handling
    cancelSubscription: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            cancelAtPeriodEnd: z.boolean().default(true),
            reason: z.string().optional(),
            metadata: z.record(z.string(), z.any()).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.cancelSubscription(input.boxId, {
                    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
                    reason: input.reason,
                    canceledByUserId: ctx.session.user.id,
                    metadata: input.metadata
                });

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error canceling subscription:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to cancel subscription"
                });
            }
        }),

    // Reactivate canceled subscription
    reactivateSubscription: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            metadata: z.record(z.string(), z.any()).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.reactivateSubscription(
                    input.boxId,
                    ctx.session.user.id,
                    input.metadata
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error reactivating subscription:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to reactivate subscription"
                });
            }
        }),

    // Request plan change
    requestPlanChange: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            toPlanId: z.string(),
            effectiveDate: z.date().optional(),
            prorationType: z.enum(["immediate", "next_billing_cycle", "end_of_period"]).optional(),
            metadata: z.record(z.string(), z.any()).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.requestPlanChange(
                    input.boxId,
                    input.toPlanId,
                    {
                        requestedByUserId: ctx.session.user.id,
                        effectiveDate: input.effectiveDate,
                        prorationType: input.prorationType,
                        metadata: input.metadata
                    }
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error requesting plan change:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to request plan change"
                });
            }
        }),

    // Enable overage billing
    enableOverageBilling: protectedProcedure
        .input(z.object({
            boxId: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.enableOverageBilling(
                    input.boxId,
                    ctx.session.user.id
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error enabling overage billing:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to enable overage billing"
                });
            }
        }),

    // Get retention analytics
    getRetentionAnalytics: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            timeframe: z.enum(["7d", "30d", "90d", "365d"]).default("30d"),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.getRetentionAnalytics(
                    input.boxId,
                    input.timeframe
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error fetching retention analytics:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to fetch retention analytics"
                });
            }
        }),

    // Get customer profile
    getCustomerProfile: protectedProcedure
        .input(z.object({
            boxId: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.getBoxCustomerProfile(input.boxId);

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error fetching customer profile:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to fetch customer profile"
                });
            }
        }),

    // Update customer preferences
    updateCustomerPreferences: protectedProcedure
        .input(z.object({
            customerProfileId: z.string(),
            preferences: z.object({
                emailNotifications: z.boolean().optional(),
                invoiceReminders: z.boolean().optional(),
                marketingEmails: z.boolean().optional(),
                preferredPaymentMethod: z.string().nullable().optional(),
                billingEmail: z.string().nullable().optional(),
            })
        }))
        .mutation(async ({ ctx, input }) => {
            try {
                const result = await BillingService.updateCustomerProfilePreferences(
                    input.customerProfileId,
                    input.preferences
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error updating customer preferences:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to update customer preferences"
                });
            }
        }),

    // List payment methods
    listPaymentMethods: protectedProcedure
        .input(z.object({
            customerProfileId: z.string(),
            boxId: z.string(),
            options: z.object({
                includeInactive: z.boolean().optional(),
                sortBy: z.enum(['createdAt', 'lastUsedAt', 'expiryYear']).optional(),
                sortOrder: z.enum(['asc', 'desc']).optional(),
            }).optional()
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.listPaymentMethods(
                    input.customerProfileId,
                    input.boxId,
                    input.options
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error listing payment methods:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to list payment methods"
                });
            }
        }),

    // Set default payment method
    setDefaultPaymentMethod: protectedProcedure
        .input(z.object({
            paymentMethodId: z.string(),
            customerProfileId: z.string(),
            boxId: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.setDefaultPaymentMethod(
                    input.paymentMethodId,
                    input.customerProfileId,
                    input.boxId
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error setting default payment method:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to set default payment method"
                });
            }
        }),

    // Get overage billing summary
    getOverageBillingSummary: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            billingPeriodStart: z.date(),
            billingPeriodEnd: z.date(),
        }))
        .query(async ({ ctx, input }) => {
            await requireBoxOwner(ctx, input.boxId);

            try {
                const result = await BillingService.getOverageBillingSummary(
                    input.boxId,
                    input.billingPeriodStart,
                    input.billingPeriodEnd
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error fetching overage billing summary:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to fetch overage billing summary"
                });
            }
        }),

    // Resolve grace period
    resolveGracePeriod: protectedProcedure
        .input(z.object({
            gracePeriodId: z.string(),
            resolution: z.string(),
            resolvedByUserId: z.string().optional(),
            autoResolved: z.boolean().default(false),
        }))
        .mutation(async ({ ctx, input }) => {
            try {
                const result = await BillingService.resolveGracePeriod(
                    input.gracePeriodId,
                    input.resolution,
                    input.resolvedByUserId,
                    input.autoResolved
                );

                return {
                    success: true,
                    data: result
                };
            } catch (error) {
                console.error("Error resolving grace period:", error);
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Failed to resolve grace period"
                });
            }
        }),
});
