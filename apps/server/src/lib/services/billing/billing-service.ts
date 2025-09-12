// lib/services/billing/billing-service.ts
import { UsageTrackingService } from "./usage-tracking-service";
import { GracePeriodService } from "./grace-period-service";
import { OverageBillingService } from "./overage-billing-service";
import { PlanChangeService } from "./plan-change-service";
import { SubscriptionLifecycleService } from "./subscription-lifecycle-service";
import { BillingDashboardService } from "./billing-dashboard-service";
import { WebhookHandlerService } from "./webhook-handler-service";
import type {
    UsageEventType,
    GracePeriodReason,
    SubscriptionStatus,
    PlanChangeRequest,
    BillingEvent
} from "./types";

/**
 * Main Billing Service - Orchestrates all billing-related operations
 * This service acts as the main entry point for all billing functionality
 */
export class BillingService {
    // Usage Tracking
    static calculateUsage = UsageTrackingService.calculateUsage;
    static trackEvents = UsageTrackingService.trackEvents;
    static updateBoxUsageCounts = UsageTrackingService.updateBoxUsageCounts;
    static checkLimitsAndTriggerActions = UsageTrackingService.checkLimitsAndTriggerActions;
    static getUsageTrends = UsageTrackingService.getUsageTrends;

    // Grace Periods
    static createGracePeriod = GracePeriodService.createGracePeriod;
    static resolveGracePeriod = GracePeriodService.resolveGracePeriod;
    static getActiveGracePeriods = GracePeriodService.getActiveGracePeriods;
    static getUpcomingGracePeriodExpirations = GracePeriodService.getUpcomingExpirations;
    static resolveGracePeriodsForReasons = GracePeriodService.resolveGracePeriodsForReasons;
    static enableOverageBilling = GracePeriodService.enableOverageBilling;

    // Overage Billing
    static calculateOverageForPeriod = OverageBillingService.calculateOverageForPeriod;
    static createOverageBilling = OverageBillingService.createOverageBilling;
    static createOverageOrder = OverageBillingService.createOverageOrder;
    static getOverageBillingSummary = OverageBillingService.getOverageBillingSummary;
    static processMonthlyOverageBilling = OverageBillingService.processMonthlyOverageBilling;
    static markOverageAsPaid = OverageBillingService.markOverageAsPaid;

    // Plan Changes
    static requestPlanChange = PlanChangeService.requestPlanChange;
    static processPlanChangeRequest = PlanChangeService.processPlanChangeRequest;
    static cancelPlanChangeRequest = PlanChangeService.cancelPlanChangeRequest;
    static getPendingPlanChanges = PlanChangeService.getPendingPlanChanges;
    static getPlanChangeHistory = PlanChangeService.getPlanChangeHistory;

    // Subscription Lifecycle
    static cancelSubscription = SubscriptionLifecycleService.cancelSubscription;
    static reactivateSubscription = SubscriptionLifecycleService.reactivateSubscription;
    static updateSubscriptionStatus = SubscriptionLifecycleService.updateSubscriptionStatus;
    static getSubscriptionHistory = SubscriptionLifecycleService.getSubscriptionHistory;
    static isInTrialPeriod = SubscriptionLifecycleService.isInTrialPeriod;
    static expireTrialSubscription = SubscriptionLifecycleService.expireTrialSubscription;

    // Dashboard & Analytics
    static getBillingDashboard = BillingDashboardService.getBillingDashboard;
    static getRecentBillingActivity = BillingDashboardService.getRecentBillingActivity;
    static calculateUpcomingBilling = BillingDashboardService.calculateUpcomingBilling;
    static getRetentionAnalytics = BillingDashboardService.getRetentionAnalytics;
    static getBillingSummary = BillingDashboardService.getBillingSummary;
    static getUpcomingBillingEvents = BillingDashboardService.getUpcomingBillingEvents;

    // Webhook Handling
    static handleWebhookEvent = WebhookHandlerService.handleWebhookEvent;
    static retryFailedEvents = WebhookHandlerService.retryFailedEvents;

    /**
     * High-level method to handle athlete/coach additions with all checks
     */
    static async handleMemberAddition(
        boxId: string,
        memberType: "athlete" | "coach",
        userId: string,
        options: {
            entityId?: string;
            metadata?: Record<string, any>;
        } = {}
    ) {
        // Track the addition event
        const eventType: UsageEventType = memberType === "athlete" ? "athlete_added" : "coach_added";

        await this.trackEvents(boxId, [{
            eventType,
            quantity: 1,
            userId,
            entityId: options.entityId,
            entityType: memberType,
            metadata: options.metadata
        }]);

        // Check limits and trigger any necessary actions (grace periods, overage calculations)
        const usage = await this.checkLimitsAndTriggerActions(boxId, [{ eventType }]);

        return {
            success: true,
            usage,
            eventType
        };
    }

    /**
     * High-level method to handle member removal
     */
    static async handleMemberRemoval(
        boxId: string,
        memberType: "athlete" | "coach",
        userId: string,
        options: {
            entityId?: string;
            metadata?: Record<string, any>;
        } = {}
    ) {
        const eventType: UsageEventType = memberType === "athlete" ? "athlete_removed" : "coach_removed";

        await this.trackEvents(boxId, [{
            eventType,
            quantity: 1,
            userId,
            entityId: options.entityId,
            entityType: memberType,
            metadata: options.metadata
        }]);

        // Update usage counts
        const usage = await this.updateBoxUsageCounts(boxId);

        return {
            success: true,
            usage,
            eventType
        };
    }

    /**
     * Comprehensive subscription upgrade flow
     */
    static async upgradeSubscription(
        boxId: string,
        toPlanId: string,
        upgradedByUserId: string,
        options: {
            effectiveDate?: Date;
            prorationType?: "immediate" | "next_billing_cycle" | "end_of_period";
            metadata?: Record<string, any>;
        } = {}
    ) {
        // Create plan change request
        const planChangeRequest = await this.requestPlanChange(boxId, toPlanId, {
            requestedByUserId: upgradedByUserId,
            effectiveDate: options.effectiveDate,
            prorationType: options.prorationType,
            metadata: options.metadata
        });

        // Process the request immediately for upgrades
        const result = await this.processPlanChangeRequest(planChangeRequest.id, upgradedByUserId);

        // Resolve any limit-related grace periods
        const gracePeriodsResolved = await this.resolveGracePeriodsForReasons(
            boxId,
            ["athlete_limit_exceeded", "coach_limit_exceeded"],
            "plan_upgraded",
            upgradedByUserId
        );

        // Track the upgrade
        await this.trackEvents(boxId, [{
            eventType: "plan_upgraded",
            quantity: 1,
            userId: upgradedByUserId,
            metadata: {
                planChangeRequestId: planChangeRequest.id,
                fromPlanId: planChangeRequest.fromPlanId,
                toPlanId: planChangeRequest.toPlanId,
                proratedAmount: result.proratedAmount,
                gracePeriodsResolved
            }
        }]);

        return {
            success: true,
            planChangeRequest,
            proratedAmount: result.proratedAmount,
            gracePeriodsResolved
        };
    }

    /**
     * Handle trial expiration with grace period
     */
    static async handleTrialExpiration(boxId: string) {
        const result = await this.expireTrialSubscription(boxId);

        await this.trackEvents(boxId, [{
            eventType: "grace_period_triggered",
            quantity: 1,
            metadata: {
                reason: "trial_ending",
                subscriptionId: result.subscription?.id
            }
        }]);

        return result;
    }

    /**
     * Process monthly billing for all boxes
     */
    static async processMonthlyBilling() {
        try {
            console.log("Starting monthly billing process...");

            // Process overage billing
            const overageResults = await this.processMonthlyOverageBilling();

            // Get upcoming billing events for monitoring
            const upcomingBilling = await this.getUpcomingBillingEvents(7); // Next 7 days

            console.log(`Monthly billing completed: ${overageResults.length} subscriptions processed`);

            return {
                success: true,
                overageResults,
                upcomingBilling,
                processedAt: new Date()
            };
        } catch (error) {
            console.error("Error in monthly billing process:", error);
            throw error;
        }
    }

    /**
     * Health check for billing system
     */
    static async getBillingHealthCheck() {
        try {
            // Check for failed events that need retry
            const failedEvents = await this.retryFailedEvents();

            // Get upcoming grace period expirations
            const upcomingExpirations = await this.getUpcomingGracePeriodExpirations(3); // Next 3 days

            // Get upcoming billing events
            const upcomingBilling = await this.getUpcomingBillingEvents(7); // Next 7 days

            return {
                status: "healthy",
                failedEventsRetried: failedEvents.length,
                upcomingGracePeriodExpirations: upcomingExpirations.length,
                upcomingBillingEvents: upcomingBilling.length,
                checkedAt: new Date()
            };
        } catch (error) {
            return {
                status: "unhealthy",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date()
            };
        }
    }
}