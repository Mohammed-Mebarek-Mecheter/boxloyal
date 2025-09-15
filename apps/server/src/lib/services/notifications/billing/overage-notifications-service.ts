// lib/services/notifications/billing/overage-notifications-service.ts
import { db } from "@/db";
import { boxes, boxMemberships, overageBilling } from "@/db/schema";
import { eq, and, or } from "drizzle-orm";
import {NotificationService} from "@/lib/services/notifications";

export class OverageNotificationsService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
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
     * Send overage billing enabled notification
     */
    async sendOverageBillingEnabledNotification(boxId: string) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

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
        if (!box) return [];

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
