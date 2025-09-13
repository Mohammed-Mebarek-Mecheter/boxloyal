// lib/services/billing/billing-service.ts
import { UsageTrackingService } from "./usage-tracking-service";
import { GracePeriodService } from "./grace-period-service";
import { OverageBillingService } from "./overage-billing-service";
import { PlanChangeService } from "./plan-change-service";
import { SubscriptionLifecycleService } from "./subscription-lifecycle-service";
import { BillingDashboardService } from "./billing-dashboard-service";
import { WebhookHandlerService } from "./webhook-handler-service";
import { AccessControlService } from "@/lib/middleware/access-control";
import type {
    UsageEventType
} from "./types";

/**
 * Main Billing Service - Orchestrates all billing-related operations
 * This is the primary interface that your application should use for all billing operations
 */
export class BillingService {
    // Direct service delegates (no changes needed)
    static calculateUsage = UsageTrackingService.calculateUsage;
    static trackEvents = UsageTrackingService.trackEvents;
    static updateBoxUsageCounts = UsageTrackingService.updateBoxUsageCounts;
    static checkLimitsAndTriggerActions = UsageTrackingService.checkLimitsAndTriggerActions;
    static getUsageTrends = UsageTrackingService.getUsageTrends;

    static createGracePeriod = GracePeriodService.createGracePeriod;
    static resolveGracePeriod = GracePeriodService.resolveGracePeriod;
    static getActiveGracePeriods = GracePeriodService.getActiveGracePeriods;
    static getUpcomingGracePeriodExpirations = GracePeriodService.getUpcomingExpirations;
    static resolveGracePeriodsForReasons = GracePeriodService.resolveGracePeriodsForReasons;
    static enableOverageBilling = GracePeriodService.enableOverageBilling;

    static calculateOverageForPeriod = OverageBillingService.calculateOverageForPeriod;
    static createOverageBilling = OverageBillingService.createOverageBilling;
    static createOverageOrder = OverageBillingService.createOverageOrder;
    static getOverageBillingSummary = OverageBillingService.getOverageBillingSummary;
    static processMonthlyOverageBilling = OverageBillingService.processMonthlyOverageBilling;
    static markOverageAsPaid = OverageBillingService.markOverageAsPaid;

    static requestPlanChange = PlanChangeService.requestPlanChange;
    static processPlanChangeRequest = PlanChangeService.processPlanChangeRequest;
    static cancelPlanChangeRequest = PlanChangeService.cancelPlanChangeRequest;
    static getPendingPlanChanges = PlanChangeService.getPendingPlanChanges;
    static getPlanChangeHistory = PlanChangeService.getPlanChangeHistory;

    static cancelSubscription = SubscriptionLifecycleService.cancelSubscription;
    static reactivateSubscription = SubscriptionLifecycleService.reactivateSubscription;
    static updateSubscriptionStatus = SubscriptionLifecycleService.updateSubscriptionStatus;
    static getSubscriptionHistory = SubscriptionLifecycleService.getSubscriptionHistory;
    static isInTrialPeriod = SubscriptionLifecycleService.isInTrialPeriod;
    static expireTrialSubscription = SubscriptionLifecycleService.expireTrialSubscription;

    static getBillingDashboard = BillingDashboardService.getBillingDashboard;
    static getRecentBillingActivity = BillingDashboardService.getRecentBillingActivity;
    static calculateUpcomingBilling = BillingDashboardService.calculateUpcomingBilling;
    static getRetentionAnalytics = BillingDashboardService.getRetentionAnalytics;
    static getBillingSummary = BillingDashboardService.getBillingSummary;
    static getUpcomingBillingEvents = BillingDashboardService.getUpcomingBillingEvents;

    static handleWebhookEvent = WebhookHandlerService.handleWebhookEvent;
    static retryFailedEvents = WebhookHandlerService.retryFailedEvents;

    // Access Control Integration (NEW)
    static checkBoxAccess = AccessControlService.checkBoxAccess;
    static checkFeatureAccess = AccessControlService.checkFeatureAccess;

    /**
     * Enhanced member addition with proper access gating
     */
    static async handleMemberAddition(
        boxId: string,
        memberType: "athlete" | "coach",
        userId: string,
        options: {
            entityId?: string;
            metadata?: Record<string, any>;
            enforceLimit?: boolean;
        } = {}
    ) {
        const { enforceLimit = true } = options;

        // Check if addition is allowed
        if (enforceLimit) {
            const featureCheck = await this.checkFeatureAccess(
                boxId,
                memberType === "athlete" ? "add_athlete" : "add_coach"
            );

            if (!featureCheck.hasAccess) {
                return {
                    success: false,
                    error: featureCheck.reason,
                    upgradeRequired: featureCheck.upgradeRequired,
                    billingIssue: featureCheck.billingIssue
                };
            }
        }

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

        // Check limits and trigger any necessary actions
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
     * Upgrade subscription flow with proper access restoration
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
        try {
            // Check current access status
            const accessCheck = await this.checkBoxAccess(boxId);

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

            // If there were billing issues, try to resolve them
            if (accessCheck.billingIssue) {
                await this.resolveGracePeriodsForReasons(
                    boxId,
                    ["payment_failed", "billing_issue"],
                    "plan_upgraded",
                    upgradedByUserId
                );
            }

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
                    gracePeriodsResolved,
                    hadBillingIssue: accessCheck.billingIssue
                }
            }]);

            return {
                success: true,
                planChangeRequest,
                proratedAmount: result.proratedAmount,
                gracePeriodsResolved,
                accessRestored: accessCheck.billingIssue || !accessCheck.hasAccess
            };

        } catch (error) {
            console.error("Error upgrading subscription:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : "Upgrade failed"
            };
        }
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
     * Process all monthly billing operations
     */
    static async processMonthlyBilling() {
        try {
            console.log("Starting comprehensive monthly billing process...");

            // Process overage billing
            const overageResults = await this.processMonthlyOverageBilling();

            // Check for upcoming expirations
            const upcomingExpirations = await this.getUpcomingGracePeriodExpirations(7);

            // Get upcoming billing events for monitoring
            const upcomingBilling = await this.getUpcomingBillingEvents(7);

            // Retry any failed webhook events
            const retryResults = await this.retryFailedEvents();

            console.log(`Monthly billing completed: 
                - ${overageResults.length} overage billing processed
                - ${upcomingExpirations.length} upcoming grace period expirations
                - ${upcomingBilling.length} upcoming billing events
                - ${retryResults.length} webhook events retried`);

            return {
                success: true,
                overageResults,
                upcomingExpirations,
                upcomingBilling,
                retryResults,
                processedAt: new Date()
            };
        } catch (error) {
            console.error("Error in monthly billing process:", error);
            throw error;
        }
    }

    /**
     * Enhanced health check with detailed status
     */
    static async getBillingHealthCheck() {
        try {
            // Check for failed events that need retry
            const failedEvents = await this.retryFailedEvents();

            // Get upcoming grace period expirations
            const upcomingExpirations = await this.getUpcomingGracePeriodExpirations(3);

            // Get upcoming billing events
            const upcomingBilling = await this.getUpcomingBillingEvents(7);

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
