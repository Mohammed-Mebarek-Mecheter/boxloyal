// lib/services/notifications/billing-notifications-service.ts
import { NotificationService } from "./notification-service";
import { db } from "@/db";
import { boxes, boxMemberships, gracePeriods, overageBilling } from "@/db/schema";
import {eq, and, or} from "drizzle-orm";

export class BillingNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Send trial ending notifications
     */
    async sendTrialEndingNotification(boxId: string, daysRemaining: number) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

        const urgency = daysRemaining <= 1 ? "critical" : daysRemaining <= 3 ? "high" : "normal";

        const title = daysRemaining === 1
            ? "Your trial expires tomorrow!"
            : `Your trial expires in ${daysRemaining} days`;

        const message = `Your BoxLoyal trial ends ${daysRemaining === 1 ? 'tomorrow' : `in ${daysRemaining} days`}. 

To continue using BoxLoyal and keep tracking your athletes' progress:
• Choose a subscription plan that fits your gym
• Keep all your athlete data and analytics
• Maintain access to retention insights

Don't lose momentum with your athletes!`;

        const notifications = [];

        // Send to all owners and head coaches
        for (const membership of box.memberships) {
            if (membership.role === "owner" || membership.role === "head_coach") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "subscription_trial_ending",
                    category: "billing",
                    priority: urgency,
                    title,
                    message,
                    actionUrl: `/billing/upgrade?boxId=${boxId}`,
                    actionLabel: "Choose Your Plan",
                    channels: ["email", "in_app"],
                    data: {
                        daysRemaining,
                        trialEndsAt: box.subscriptionEndsAt,
                        urgency,
                    },
                    deduplicationKey: `trial_ending_${boxId}_${daysRemaining}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send payment failed notifications
     */
    async sendPaymentFailedNotification(boxId: string, amount: number, attemptNumber: number = 1) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

        const title = "Payment Failed - Action Required";
        const formattedAmount = `$${(amount / 100).toFixed(2)}`;

        const message = `We couldn't process your payment of ${formattedAmount} for your BoxLoyal subscription.

${attemptNumber === 1
            ? "We'll automatically retry in 24 hours, but you can update your payment method now to avoid any service interruption."
            : `This is attempt ${attemptNumber}. Please update your payment method immediately to prevent service suspension.`
        }

Your athletes are counting on you to keep their progress tracking active!`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "subscription_payment_failed",
                    category: "billing",
                    priority: "critical",
                    title,
                    message,
                    actionUrl: `/billing/payment-methods?boxId=${boxId}`,
                    actionLabel: "Update Payment Method",
                    channels: ["email", "in_app"],
                    data: {
                        amount,
                        formattedAmount,
                        attemptNumber,
                        nextRetryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
                    },
                    deduplicationKey: `payment_failed_${boxId}_${attemptNumber}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send payment successful notifications
     */
    async sendPaymentSuccessfulNotification(boxId: string, amount: number, invoiceId?: string) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

        const formattedAmount = `$${(amount / 100).toFixed(2)}`;

        const title = "Payment Received - Thank You!";
        const message = `Your payment of ${formattedAmount} has been successfully processed.

Your BoxLoyal subscription is active and your athletes can continue tracking their progress without interruption.

${invoiceId ? `Invoice ID: ${invoiceId}` : ''}

Thank you for choosing BoxLoyal to help retain your athletes!`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "subscription_renewed",
                    category: "billing",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/billing/invoices?boxId=${boxId}`,
                    actionLabel: "View Invoice",
                    channels: ["email", "in_app"],
                    data: {
                        amount,
                        formattedAmount,
                        invoiceId,
                        paidAt: new Date(),
                    },
                    deduplicationKey: `payment_success_${boxId}_${invoiceId || Date.now()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send plan limit approaching notifications
     */
    async sendLimitApproachingNotification(
        boxId: string,
        limitType: "athlete" | "coach",
        currentCount: number,
        limit: number,
        percentage: number
    ) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

        const title = `${limitType === "athlete" ? "Athlete" : "Coach"} Limit Warning`;
        const message = `You're approaching your ${limitType} limit on your ${box.subscriptionTier} plan.

Current: ${currentCount} / ${limit} ${limitType}s (${Math.round(percentage)}% used)

${percentage >= 95
            ? `You're very close to your limit! Consider upgrading your plan to avoid service restrictions.`
            : `Consider upgrading your plan before reaching the limit to ensure uninterrupted service.`
        }

Don't let limits stop your gym's growth!`;

        const urgency = percentage >= 95 ? "high" : percentage >= 90 ? "normal" : "low";

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner" || membership.role === "head_coach") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "plan_limit_approaching",
                    category: "billing",
                    priority: urgency,
                    title,
                    message,
                    actionUrl: `/billing/upgrade?boxId=${boxId}&highlight=${limitType}`,
                    actionLabel: "Upgrade Plan",
                    channels: ["email", "in_app"],
                    data: {
                        limitType,
                        currentCount,
                        limit,
                        percentage,
                        planTier: box.subscriptionTier,
                    },
                    deduplicationKey: `limit_approaching_${boxId}_${limitType}_${Math.floor(percentage / 5) * 5}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send plan limit exceeded notifications
     */
    async sendLimitExceededNotification(
        boxId: string,
        limitType: "athlete" | "coach",
        currentCount: number,
        limit: number,
        overageAmount?: number
    ) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

        const overage = currentCount - limit;
        const title = `${limitType === "athlete" ? "Athlete" : "Coach"} Limit Exceeded`;

        let message = `You've exceeded your ${limitType} limit on your ${box.subscriptionTier} plan.

Current: ${currentCount} / ${limit} ${limitType}s (${overage} over limit)

`;

        if (box.isOverageEnabled && overageAmount) {
            const formattedAmount = `$${(overageAmount / 100).toFixed(2)}`;
            message += `Overage charges apply: ${formattedAmount} for ${overage} additional ${limitType}s.

You can continue adding ${limitType}s and will be billed for overage usage.`;
        } else {
            message += `Please upgrade your plan or remove ${limitType}s to avoid service restrictions.

Consider enabling overage billing to automatically handle capacity needs.`;
        }

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "plan_limit_exceeded",
                    category: "billing",
                    priority: "high",
                    title,
                    message,
                    actionUrl: `/billing/${box.isOverageEnabled ? 'usage' : 'upgrade'}?boxId=${boxId}`,
                    actionLabel: box.isOverageEnabled ? "View Usage" : "Upgrade Plan",
                    channels: ["email", "in_app"],
                    data: {
                        limitType,
                        currentCount,
                        limit,
                        overage,
                        overageAmount,
                        overageEnabled: box.isOverageEnabled,
                    },
                    deduplicationKey: `limit_exceeded_${boxId}_${limitType}_${overage}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send overage charges notification
     */
    async sendOverageChargesNotification(boxId: string, billingPeriodStart: Date, billingPeriodEnd: Date) {
        const [box, overage] = await Promise.all([
            this.getBoxWithOwners(boxId),
            db.query.overageBilling.findFirst({
                where: and(
                    eq(overageBilling.boxId, boxId),
                    eq(overageBilling.billingPeriodStart, billingPeriodStart),
                    eq(overageBilling.billingPeriodEnd, billingPeriodEnd)
                )
            })
        ]);

        if (!box || !overage || overage.totalOverageAmount === 0) return [];

        const totalAmount = `$${(overage.totalOverageAmount / 100).toFixed(2)}`;
        const periodStr = `${billingPeriodStart.toLocaleDateString()} - ${billingPeriodEnd.toLocaleDateString()}`;

        const title = "Overage Charges Applied";

        let message = `Your overage charges for ${periodStr}:

`;

        if (overage.athleteOverage > 0) {
            message += `• Athletes: ${overage.athleteOverage} over limit × $${(overage.athleteOverageRate / 100).toFixed(2)} = $${(overage.athleteOverageAmount / 100).toFixed(2)}\n`;
        }

        if (overage.coachOverage > 0) {
            message += `• Coaches: ${overage.coachOverage} over limit × $${(overage.coachOverageRate / 100).toFixed(2)} = $${(overage.coachOverageAmount / 100).toFixed(2)}\n`;
        }

        message += `
Total overage charges: ${totalAmount}

This reflects your gym's growth! Consider upgrading your plan to reduce future overage costs.`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "overage_charges",
                    category: "billing",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/billing/usage?boxId=${boxId}&period=${billingPeriodStart.getTime()}`,
                    actionLabel: "View Usage Details",
                    channels: ["email", "in_app"],
                    data: {
                        billingPeriodStart,
                        billingPeriodEnd,
                        athleteOverage: overage.athleteOverage,
                        coachOverage: overage.coachOverage,
                        totalAmount: overage.totalOverageAmount,
                        formattedTotal: totalAmount,
                    },
                    deduplicationKey: `overage_charges_${boxId}_${billingPeriodStart.getTime()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send subscription cancelled notification
     */
    async sendSubscriptionCancelledNotification(
        boxId: string,
        cancelAtPeriodEnd: boolean,
        reason?: string,
        accessEndsAt?: Date
    ) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

        const title = "Subscription Cancelled";

        let message = `Your BoxLoyal subscription has been cancelled.

`;

        if (cancelAtPeriodEnd && accessEndsAt) {
            message += `Your access will continue until ${accessEndsAt.toLocaleDateString()}, then your account will be suspended.

You can reactivate your subscription anytime before then to avoid losing access to your athlete data and analytics.`;
        } else {
            message += `Your access has been suspended immediately. 

You can reactivate your subscription anytime to regain access to your athlete data and continue tracking their progress.`;
        }

        if (reason) {
            message += `\n\nReason: ${reason}`;
        }

        message += `\n\nWe're sorry to see you go! Your athletes' progress matters, and we're here if you decide to return.`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "subscription_cancelled",
                    category: "billing",
                    priority: "high",
                    title,
                    message,
                    actionUrl: `/billing/reactivate?boxId=${boxId}`,
                    actionLabel: "Reactivate Subscription",
                    channels: ["email", "in_app"],
                    data: {
                        cancelAtPeriodEnd,
                        accessEndsAt,
                        reason,
                        cancelledAt: new Date(),
                    },
                    deduplicationKey: `subscription_cancelled_${boxId}_${Date.now()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send grace period initiated notification
     */
    async sendGracePeriodNotification(boxId: string, gracePeriodId: string) {
        const [box, gracePeriod] = await Promise.all([
            this.getBoxWithOwners(boxId),
            db.query.gracePeriods.findFirst({
                where: eq(gracePeriods.id, gracePeriodId)
            })
        ]);

        if (!box || !gracePeriod) return [];

        const daysRemaining = Math.ceil((gracePeriod.endsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        // Use Record type with string index signature to fix the TypeScript error
        const reasonMessages: Record<string, string> = {
            athlete_limit_exceeded: "You've exceeded your athlete limit",
            coach_limit_exceeded: "You've exceeded your coach limit",
            trial_ending: "Your trial is ending",
            payment_failed: "Your payment failed",
            subscription_canceled: "Your subscription was cancelled",
            billing_issue: "There's a billing issue with your account",
        };

        const title = "Account Grace Period - Action Required";
        const reasonMessage = reasonMessages[gracePeriod.reason] || "There's an issue with your account";

        const message = `${reasonMessage} and we've placed your account in a ${daysRemaining}-day grace period.

During this time:
• Your current features remain active
• You have ${daysRemaining} days to resolve this issue
• After the grace period, some features may be restricted

${gracePeriod.reason.includes('limit')
            ? "Consider upgrading your plan or enabling overage billing to automatically handle your growing gym."
            : gracePeriod.reason.includes('payment') || gracePeriod.reason.includes('billing')
                ? "Please update your payment method or resolve the billing issue to continue uninterrupted service."
                : "Please take action to avoid any service interruptions."
        }

Don't let this affect your athletes' experience!`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "system_alert",
                    category: "billing",
                    priority: gracePeriod.severity === "critical" ? "critical" : "high",
                    title,
                    message,
                    actionUrl: `/billing/resolve-issue?boxId=${boxId}&gracePeriod=${gracePeriodId}`,
                    actionLabel: "Resolve Issue",
                    channels: ["email", "in_app"],
                    data: {
                        gracePeriodId,
                        reason: gracePeriod.reason,
                        severity: gracePeriod.severity,
                        daysRemaining,
                        endsAt: gracePeriod.endsAt,
                    },
                    deduplicationKey: `grace_period_${gracePeriodId}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send upcoming renewal reminder
     */
    async sendUpcomingRenewalNotification(boxId: string, renewalDate: Date, amount: number) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return;

        const daysUntilRenewal = Math.ceil((renewalDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const formattedAmount = `${(amount / 100).toFixed(2)}`;

        const title = `Subscription Renewal in ${daysUntilRenewal} Days`;
        const message = `Your BoxLoyal subscription will automatically renew on ${renewalDate.toLocaleDateString()} for ${formattedAmount}.

Plan: ${box.subscriptionTier?.toUpperCase()} 
Amount: ${formattedAmount}

Your payment method will be charged automatically. If you need to make any changes to your subscription or payment method, please do so before the renewal date.

Thank you for continuing to help your athletes succeed!`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "subscription_renewed",
                    category: "billing",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/billing/subscription?boxId=${boxId}`,
                    actionLabel: "Manage Subscription",
                    channels: ["email", "in_app"],
                    data: {
                        renewalDate,
                        amount,
                        formattedAmount,
                        planTier: box.subscriptionTier,
                        daysUntilRenewal,
                    },
                    deduplicationKey: `renewal_reminder_${boxId}_${renewalDate.getTime()}`,
                    scheduledFor: new Date(renewalDate.getTime() - (daysUntilRenewal * 24 * 60 * 60 * 1000)),
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send monthly invoice notification
     */
    async sendInvoiceNotification(boxId: string, invoiceId: string, amount: number, dueDate?: Date) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return;

        const formattedAmount = `${(amount / 100).toFixed(2)}`;
        const title = "New Invoice Available";

        const message = `Your monthly BoxLoyal invoice is ready.

Invoice #: ${invoiceId}
Amount: ${formattedAmount}
${dueDate ? `Due: ${dueDate.toLocaleDateString()}` : 'Paid'}

${dueDate
            ? `Please ensure your payment method is up to date to avoid any service interruptions.`
            : 'Thank you for your payment!'
        }

You can view and download your invoice anytime from your billing dashboard.`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "invoice_generated",
                    category: "billing",
                    priority: dueDate ? "normal" : "low",
                    title,
                    message,
                    actionUrl: `/billing/invoices/${invoiceId}?boxId=${boxId}`,
                    actionLabel: "View Invoice",
                    channels: ["email", "in_app"],
                    data: {
                        invoiceId,
                        amount,
                        formattedAmount,
                        dueDate,
                        isPaid: !dueDate,
                    },
                    deduplicationKey: `invoice_${invoiceId}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send subscription reactivated notification
     */
    async sendSubscriptionReactivatedNotification(boxId: string) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return;

        const title = "Subscription Reactivated!";
        const message = `Your BoxLoyal subscription has been successfully reactivated.

Welcome back! Your access to athlete data, analytics, and retention insights is now fully restored.

Thank you for continuing to help your athletes succeed with BoxLoyal!`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "subscription_reactivated",
                    category: "billing",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/billing/subscription?boxId=${boxId}`,
                    actionLabel: "Manage Subscription",
                    channels: ["email", "in_app"],
                    data: {
                        reactivatedAt: new Date(),
                    },
                    deduplicationKey: `subscription_reactivated_${boxId}_${Date.now()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send overage billing enabled notification
     */
    async sendOverageBillingEnabledNotification(boxId: string) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return;

        const title = "Overage Billing Enabled";
        const message = `Overage billing has been successfully enabled for your BoxLoyal account.

This means:
• If you exceed your athlete or coach limits, you can continue adding members.
• You will be charged for overage usage according to your plan rates.
• You will receive notifications about overage charges.

You can manage your overage settings anytime in your billing preferences.`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "overage_billing_enabled",
                    category: "billing",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/billing/settings?boxId=${boxId}`,
                    actionLabel: "Manage Billing Settings",
                    channels: ["email", "in_app"],
                    data: {
                        enabledAt: new Date(),
                    },
                    deduplicationKey: `overage_enabled_${boxId}_${Date.now()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send overage billing disabled notification
     */
    async sendOverageBillingDisabledNotification(boxId: string) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return;

        const title = "Overage Billing Disabled";
        const message = `Overage billing has been disabled for your BoxLoyal account.

Important:
• You will no longer be charged for exceeding your athlete or coach limits.
• If you exceed your limits, you may not be able to add new members.
• Consider upgrading your plan if your gym is growing.

You can re-enable overage billing anytime in your billing preferences.`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "overage_billing_disabled",
                    category: "billing",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/billing/upgrade?boxId=${boxId}`,
                    actionLabel: "Review Plans",
                    channels: ["email", "in_app"],
                    data: {
                        disabledAt: new Date(),
                    },
                    deduplicationKey: `overage_disabled_${boxId}_${Date.now()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send grace period resolved notification
     */
    async sendGracePeriodResolvedNotification(gracePeriodId: string, resolution: string) {
        const gracePeriod = await db.query.gracePeriods.findFirst({
            where: eq(gracePeriods.id, gracePeriodId),
            with: {
                box: {
                    with: {
                        memberships: {
                            where: or(
                                eq(boxMemberships.role, "owner"),
                                eq(boxMemberships.role, "head_coach")
                            ),
                            with: {
                                user: {
                                    columns: {
                                        id: true,
                                        name: true,
                                        email: true,
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!gracePeriod || !gracePeriod.box) {
            console.warn(`Grace period ${gracePeriodId} not found or box data missing for notification.`);
            return null;
        }

        const box = gracePeriod.box;
        const reason = gracePeriod.reason;

        // Map reason to a more user-friendly title/message snippet
        const reasonMessages: Record<string, { title: string; snippet: string }> = {
            athlete_limit_exceeded: { title: "Athlete Limit Issue Resolved", snippet: "athlete limit issue" },
            coach_limit_exceeded: { title: "Coach Limit Issue Resolved", snippet: "coach limit issue" },
            trial_ending: { title: "Trial Expiry Issue Resolved", snippet: "trial expiry issue" },
            payment_failed: { title: "Payment Issue Resolved", snippet: "payment issue" },
            subscription_canceled: { title: "Cancellation Issue Resolved", snippet: "subscription cancellation issue" },
            billing_issue: { title: "Billing Issue Resolved", snippet: "billing issue" },
        };

        const reasonInfo = reasonMessages[reason] || { title: "Issue Resolved", snippet: "issue" };

        const title = reasonInfo.title;
        const message = `The ${reasonInfo.snippet} for your BoxLoyal account has been successfully resolved.

Resolution details: ${resolution}

Your account is now back in good standing. Thank you for taking action!`;

        const notifications = [];

        for (const membership of box.memberships) {
            // Notify Owners and Head Coaches
            if (membership.role === "owner" || membership.role === "head_coach") {
                const notification = await this.notificationService.createNotification({
                    boxId: box.id,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "grace_period_resolved",
                    category: "billing",
                    priority: "normal", // Assuming resolution is generally positive news
                    title,
                    message,
                    actionUrl: `/billing?boxId=${box.id}`, // General billing dashboard
                    actionLabel: "View Billing Details",
                    channels: ["email", "in_app"],
                    data: {
                        gracePeriodId,
                        reason,
                        resolution,
                        resolvedAt: new Date(),
                    },
                    deduplicationKey: `grace_period_resolved_${gracePeriodId}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    // Add these methods inside the BillingNotificationService class

    /**
     * Send plan change confirmed notification
     */
    async sendPlanChangeConfirmedNotification(
        boxId: string,
        fromPlanTier: string,
        toPlanTier: string,
        changeType: string,
        proratedAmount: number,
        effectiveDate: Date,
        planChangeRequestId: string
    ) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return;

        const formattedProratedAmount = `$${(Math.abs(proratedAmount) / 100).toFixed(2)}`;
        const isProrated = proratedAmount !== 0;
        const isUpgrade = changeType === "upgrade";
        const isDowngrade = changeType === "downgrade";

        let title = "";
        let message = "";

        if (isUpgrade) {
            title = `Plan Upgraded to ${toPlanTier.toUpperCase()}!`;
            message = `Your BoxLoyal subscription has been successfully upgraded to the ${toPlanTier.toUpperCase()} plan.`;
            if (isProrated) {
                message += ` A prorated charge of ${formattedProratedAmount} has been applied to your account.`;
            }
        } else if (isDowngrade) {
            title = `Plan Downgraded to ${toPlanTier.toUpperCase()}`;
            message = `Your BoxLoyal subscription has been changed to the ${toPlanTier.toUpperCase()} plan.`;
            if (isProrated) {
                message += ` A prorated credit of ${formattedProratedAmount} has been applied to your account.`;
            }
        } else {
            title = `Plan Changed to ${toPlanTier.toUpperCase()}`;
            message = `Your BoxLoyal subscription plan has been updated to ${toPlanTier.toUpperCase()}.`;
        }

        message += `\n\nEffective Date: ${effectiveDate.toLocaleDateString()}\nPrevious Plan: ${fromPlanTier.toUpperCase()}\nNew Plan: ${toPlanTier.toUpperCase()}`;

        message += `\n\nYour new plan features and limits are now active. Thank you for choosing BoxLoyal!`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "plan_change_confirmed",
                    category: "billing",
                    priority: isUpgrade ? "high" : "normal", // Upgrade might be more significant
                    title,
                    message,
                    actionUrl: `/billing/subscription?boxId=${boxId}`,
                    actionLabel: "View Subscription",
                    channels: ["email", "in_app"],
                    data: {
                        fromPlanTier,
                        toPlanTier,
                        changeType,
                        proratedAmount,
                        formattedProratedAmount,
                        effectiveDate: effectiveDate.toISOString(),
                        isProrated,
                    },
                    deduplicationKey: `plan_change_confirmed_${boxId}_${planChangeRequestId || Date.now()}`, // Use planChangeRequestId if available from calling context, otherwise timestamp
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send plan change canceled notification
     */
    async sendPlanChangeCanceledNotification(
        boxId: string,
        fromPlanTier: string,
        toPlanTier: string,
        changeType: string, // "upgrade", "downgrade", "lateral"
        reason?: string
    ) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return;

        const title = `Plan Change Canceled`;
        let message = `Your requested change from the ${fromPlanTier.toUpperCase()} plan to the ${toPlanTier.toUpperCase()} plan has been canceled.`;

        if (reason) {
            message += `\n\nReason: ${reason}`;
        }

        message += `\n\nYour current plan (${fromPlanTier.toUpperCase()}) remains active. If you have any questions or would like to try changing plans again, please let us know.`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "plan_change_canceled",
                    category: "billing",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/billing/subscription?boxId=${boxId}`,
                    actionLabel: "Manage Subscription",
                    channels: ["email", "in_app"],
                    data: {
                        fromPlanTier,
                        toPlanTier,
                        changeType,
                        cancelReason: reason,
                        canceledAt: new Date().toISOString(),
                    },
                    deduplicationKey: `plan_change_canceled_${boxId}_${Date.now()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send plan change requested notification (Optional but useful)
     */
    async sendPlanChangeRequestedNotification(
        boxId: string,
        fromPlanTier: string,
        toPlanTier: string,
        changeType: string, // "upgrade", "downgrade", "lateral"
        planChangeRequestId: string,
        requestedByUserId?: string,
        effectiveDate?: Date
    ) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return;

        const isUpgrade = changeType === "upgrade";
        const title = `Plan Change Requested: ${isUpgrade ? 'Upgrade' : 'Change'} to ${toPlanTier.toUpperCase()}`;
        let message = `A request has been made to change your BoxLoyal subscription from the ${fromPlanTier.toUpperCase()} plan to the ${toPlanTier.toUpperCase()} plan.`;

        if (effectiveDate) {
            message += `\n\nRequested Effective Date: ${effectiveDate.toLocaleDateString()}`;
        }

        message += `\n\nThis change ${isUpgrade ? 'upgrades' : 'changes'} your plan features and pricing. ${
            isUpgrade
                ? 'Thank you for choosing to upgrade!'
                : 'Please review the details below.'
        }`;

        message += `\n\nIf you did not initiate this request or have any questions, please contact support.`;

        const notifications = [];

        // Notify Owners (and potentially the requester if different)
        for (const membership of box.memberships) {
            if (membership.role === "owner" || membership.userId === requestedByUserId) {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "plan_change_requested",
                    category: "billing",
                    priority: isUpgrade ? "high" : "normal",
                    title,
                    message,
                    actionUrl: `/billing/plan-change/${planChangeRequestId}?boxId=${boxId}`,
                    actionLabel: "Review Request",
                    channels: ["email", "in_app"],
                    data: {
                        fromPlanTier,
                        toPlanTier,
                        changeType,
                        planChangeRequestId,
                        requestedByUserId,
                        effectiveDate: effectiveDate?.toISOString(),
                    },
                    deduplicationKey: `plan_change_requested_${boxId}_${planChangeRequestId}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Helper method to get box with owner memberships
     */
    private async getBoxWithOwners(boxId: string) {
        return await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
            with: {
                memberships: {
                    where: or(
                        eq(boxMemberships.role, "owner"),
                        eq(boxMemberships.role, "head_coach")
                    ),
                    with: {
                        user: {
                            columns: {
                                id: true,
                                name: true,
                                email: true,
                            }
                        }
                    }
                }
            }
        });
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
