// lib/services/notifications/billing/plan-change-notifications-service.ts
import { db } from "@/db";
import { boxes, boxMemberships } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import {NotificationService} from "@/lib/services/notifications";

export class PlanChangeNotificationsService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

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
        if (!box) return [];

        const formattedProratedAmount = `${(Math.abs(proratedAmount) / 100).toFixed(2)}`;
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
                    priority: isUpgrade ? "high" : "normal",
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
                    deduplicationKey: `plan_change_confirmed_${boxId}_${planChangeRequestId}`,
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
        changeType: string,
        reason?: string
    ) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

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
     * Send plan change requested notification
     */
    async sendPlanChangeRequestedNotification(
        boxId: string,
        fromPlanTier: string,
        toPlanTier: string,
        changeType: string,
        planChangeRequestId: string,
        requestedByUserId?: string,
        effectiveDate?: Date
    ) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

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
}
