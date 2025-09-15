// lib/services/notifications/billing/subscription-notifications-service.ts
import { db } from "@/db";
import { boxes, boxMemberships } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import {NotificationService} from "@/lib/services/notifications";

export class SubscriptionNotificationsService {
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
     * Send subscription reactivated notification
     */
    async sendSubscriptionReactivatedNotification(boxId: string) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

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
     * Send upcoming renewal reminder
     */
    async sendUpcomingRenewalNotification(boxId: string, renewalDate: Date, amount: number) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

        const daysUntilRenewal = Math.ceil((renewalDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const formattedAmount = `$${(amount / 100).toFixed(2)}`;

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
}
