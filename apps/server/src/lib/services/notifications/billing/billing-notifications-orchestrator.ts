// lib/services/notifications/billing/billing-notifications-orchestrator.ts
import { SubscriptionNotificationsService } from "./subscription-notifications-service";
import { PaymentNotificationsService } from "./payment-notifications-service";
import { UsageLimitsNotificationsService } from "./usage-limits-notifications-service";
import { OverageNotificationsService } from "./overage-notifications-service";
import { PlanChangeNotificationsService } from "./plan-change-notifications-service";
import { GracePeriodNotificationsService } from "./grace-period-notifications-service";

/**
 * Main orchestrator for all billing-related notifications
 * This service delegates to specialized notification services based on the notification type
 */
export class BillingNotificationsOrchestrator {
    private subscriptionService: SubscriptionNotificationsService;
    private paymentService: PaymentNotificationsService;
    private usageLimitsService: UsageLimitsNotificationsService;
    private overageService: OverageNotificationsService;
    private planChangeService: PlanChangeNotificationsService;
    private gracePeriodService: GracePeriodNotificationsService;

    constructor() {
        this.subscriptionService = new SubscriptionNotificationsService();
        this.paymentService = new PaymentNotificationsService();
        this.usageLimitsService = new UsageLimitsNotificationsService();
        this.overageService = new OverageNotificationsService();
        this.planChangeService = new PlanChangeNotificationsService();
        this.gracePeriodService = new GracePeriodNotificationsService();
    }

    // Subscription-related notifications
    async sendTrialEndingNotification(boxId: string, daysRemaining: number) {
        return await this.subscriptionService.sendTrialEndingNotification(boxId, daysRemaining);
    }

    async sendSubscriptionCancelledNotification(
        boxId: string,
        cancelAtPeriodEnd: boolean,
        reason?: string,
        accessEndsAt?: Date
    ) {
        return await this.subscriptionService.sendSubscriptionCancelledNotification(
            boxId,
            cancelAtPeriodEnd,
            reason,
            accessEndsAt
        );
    }

    async sendSubscriptionReactivatedNotification(boxId: string) {
        return await this.subscriptionService.sendSubscriptionReactivatedNotification(boxId);
    }

    async sendUpcomingRenewalNotification(boxId: string, renewalDate: Date, amount: number) {
        return await this.subscriptionService.sendUpcomingRenewalNotification(boxId, renewalDate, amount);
    }

    // Payment-related notifications
    async sendPaymentFailedNotification(boxId: string, amount: number, attemptNumber: number = 1) {
        return await this.paymentService.sendPaymentFailedNotification(boxId, amount, attemptNumber);
    }

    async sendPaymentSuccessfulNotification(boxId: string, amount: number, invoiceId?: string) {
        return await this.paymentService.sendPaymentSuccessfulNotification(boxId, amount, invoiceId);
    }

    async sendInvoiceNotification(boxId: string, invoiceId: string, amount: number, dueDate?: Date) {
        return await this.paymentService.sendInvoiceNotification(boxId, invoiceId, amount, dueDate);
    }

    // Usage limits notifications
    async sendLimitApproachingNotification(
        boxId: string,
        limitType: "athlete" | "coach",
        currentCount: number,
        limit: number,
        percentage: number
    ) {
        return await this.usageLimitsService.sendLimitApproachingNotification(
            boxId,
            limitType,
            currentCount,
            limit,
            percentage
        );
    }

    async sendLimitExceededNotification(
        boxId: string,
        limitType: "athlete" | "coach",
        currentCount: number,
        limit: number,
        overageAmount?: number
    ) {
        return await this.usageLimitsService.sendLimitExceededNotification(
            boxId,
            limitType,
            currentCount,
            limit,
            overageAmount
        );
    }

    // Overage-related notifications
    async sendOverageChargesNotification(
        boxId: string,
        billingPeriodStart: Date,
        billingPeriodEnd: Date
    ) {
        return await this.overageService.sendOverageChargesNotification(
            boxId,
            billingPeriodStart,
            billingPeriodEnd
        );
    }

    async sendOverageBillingEnabledNotification(boxId: string) {
        return await this.overageService.sendOverageBillingEnabledNotification(boxId);
    }

    async sendOverageBillingDisabledNotification(boxId: string) {
        return await this.overageService.sendOverageBillingDisabledNotification(boxId);
    }

    // Plan change notifications
    async sendPlanChangeConfirmedNotification(
        boxId: string,
        fromPlanTier: string,
        toPlanTier: string,
        changeType: string,
        proratedAmount: number,
        effectiveDate: Date,
        planChangeRequestId: string
    ) {
        return await this.planChangeService.sendPlanChangeConfirmedNotification(
            boxId,
            fromPlanTier,
            toPlanTier,
            changeType,
            proratedAmount,
            effectiveDate,
            planChangeRequestId
        );
    }

    async sendPlanChangeCanceledNotification(
        boxId: string,
        fromPlanTier: string,
        toPlanTier: string,
        changeType: string,
        reason?: string
    ) {
        return await this.planChangeService.sendPlanChangeCanceledNotification(
            boxId,
            fromPlanTier,
            toPlanTier,
            changeType,
            reason
        );
    }

    async sendPlanChangeRequestedNotification(
        boxId: string,
        fromPlanTier: string,
        toPlanTier: string,
        changeType: string,
        planChangeRequestId: string,
        requestedByUserId?: string,
        effectiveDate?: Date
    ) {
        return await this.planChangeService.sendPlanChangeRequestedNotification(
            boxId,
            fromPlanTier,
            toPlanTier,
            changeType,
            planChangeRequestId,
            requestedByUserId,
            effectiveDate
        );
    }

    // Grace period notifications
    async sendGracePeriodNotification(boxId: string, gracePeriodId: string) {
        return await this.gracePeriodService.sendGracePeriodNotification(boxId, gracePeriodId);
    }

    async sendGracePeriodResolvedNotification(gracePeriodId: string, resolution: string) {
        return await this.gracePeriodService.sendGracePeriodResolvedNotification(gracePeriodId, resolution);
    }

    /**
     * Send batch notifications for billing events
     */
    async sendBillingEventNotifications(events: Array<{
        type: string;
        boxId: string;
        data: any;
    }>) {
        const results = [];

        for (const event of events) {
            try {
                let notifications = [];

                switch (event.type) {
                    case 'trial_ending':
                        notifications = await this.sendTrialEndingNotification(
                            event.boxId,
                            event.data.daysRemaining
                        );
                        break;

                    case 'payment_failed':
                        notifications = await this.sendPaymentFailedNotification(
                            event.boxId,
                            event.data.amount,
                            event.data.attemptNumber
                        );
                        break;

                    case 'payment_successful':
                        notifications = await this.sendPaymentSuccessfulNotification(
                            event.boxId,
                            event.data.amount,
                            event.data.invoiceId
                        );
                        break;

                    case 'limit_approaching':
                        notifications = await this.sendLimitApproachingNotification(
                            event.boxId,
                            event.data.limitType,
                            event.data.currentCount,
                            event.data.limit,
                            event.data.percentage
                        );
                        break;

                    case 'limit_exceeded':
                        notifications = await this.sendLimitExceededNotification(
                            event.boxId,
                            event.data.limitType,
                            event.data.currentCount,
                            event.data.limit,
                            event.data.overageAmount
                        );
                        break;

                    case 'overage_charges':
                        notifications = await this.sendOverageChargesNotification(
                            event.boxId,
                            event.data.billingPeriodStart,
                            event.data.billingPeriodEnd
                        );
                        break;

                    case 'subscription_cancelled':
                        notifications = await this.sendSubscriptionCancelledNotification(
                            event.boxId,
                            event.data.cancelAtPeriodEnd,
                            event.data.reason,
                            event.data.accessEndsAt
                        );
                        break;

                    case 'grace_period_initiated':
                        notifications = await this.sendGracePeriodNotification(
                            event.boxId,
                            event.data.gracePeriodId
                        );
                        break;

                    case 'plan_change_confirmed':
                        notifications = await this.sendPlanChangeConfirmedNotification(
                            event.boxId,
                            event.data.fromPlanTier,
                            event.data.toPlanTier,
                            event.data.changeType,
                            event.data.proratedAmount,
                            event.data.effectiveDate,
                            event.data.planChangeRequestId
                        );
                        break;

                    default:
                        console.warn(`Unknown billing event type: ${event.type}`);
                        continue;
                }

                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    notificationCount: notifications?.length || 0,
                    success: true,
                });

            } catch (error) {
                console.error(`Failed to send ${event.type} notification for box ${event.boxId}:`, error);
                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return results;
    }
}

// For backward compatibility - export as BillingNotificationService
export { BillingNotificationsOrchestrator as BillingNotificationService };
