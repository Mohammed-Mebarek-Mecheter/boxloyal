// lib/services/billing/index.ts

// Individual services
import { UsageTrackingService } from "./usage-tracking-service";
import { GracePeriodService } from "./grace-period-service";
import { OverageBillingService } from "./overage-billing-service";
import { PlanChangeService } from "./plan-change-service";
import { SubscriptionLifecycleService } from "./subscription-lifecycle-service";
import { BillingDashboardService } from "./billing-dashboard-service";
import { WebhookHandlerService } from "./webhook-handler-service";

// Main orchestrator services
export { BillingService } from "./billing-service";
export { PolarService, polarService } from "./polar-service";

// Legacy compatibility - these can be imported from the main services
export const BillingServiceLegacy = {
    // Usage tracking
    calculateEnhancedUsage: (boxId: string, plan?: any, box?: any) =>
        UsageTrackingService.calculateUsage(boxId, plan, box),

    checkUsageLimits: async (boxId: string, type: "athlete" | "coach") => {
        const usage = await UsageTrackingService.calculateUsage(boxId);
        const trends = await UsageTrackingService.getUsageTrends(boxId, type);

        const limit = type === "athlete" ? usage.athleteLimit : usage.coachLimit;
        const current = type === "athlete" ? usage.athletes : usage.coaches;
        const overage = type === "athlete" ? usage.athleteOverage : usage.coachOverage;

        return {
            current,
            limit,
            available: Math.max(0, limit - current),
            utilizationPercentage: Math.round((current / limit) * 100),
            isOverLimit: current > limit,
            canAdd: !usage.isAthleteOverLimit || usage.hasOverageEnabled,
            upgradeRequired: current > limit && !usage.hasOverageEnabled,
            trend: trends,
            overage,
            estimatedOverageCost: overage * 100 // Default $1 per overage
        };
    },

    // Grace periods
    triggerGracePeriod: GracePeriodService.createGracePeriod,

    // Usage tracking
    trackUsage: UsageTrackingService.trackEvents,

    // Plan changes
    requestPlanChange: PlanChangeService.requestPlanChange,

    // Subscription management
    cancelSubscription: SubscriptionLifecycleService.cancelSubscription,
    reactivateSubscription: SubscriptionLifecycleService.reactivateSubscription,

    // Dashboard data
    getSubscriptionInfo: BillingDashboardService.getBillingDashboard,
    getRecentBillingActivity: BillingDashboardService.getRecentBillingActivity,
    getRetentionAnalytics: BillingDashboardService.getRetentionAnalytics,

    // Overage
    calculateOverageBilling: OverageBillingService.calculateOverageForPeriod,
    enableOverageBilling: GracePeriodService.enableOverageBilling,

    // Webhook processing
    processBillingEvent: WebhookHandlerService.handleWebhookEvent,

    // Utilities
    resolveGracePeriod: GracePeriodService.resolveGracePeriod,
    getUpcomingGracePeriodExpirations: GracePeriodService.getUpcomingExpirations
};