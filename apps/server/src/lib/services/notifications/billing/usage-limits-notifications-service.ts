// lib/services/notifications/billing/usage-limits-notifications-service.ts
import { db } from "@/db";
import { boxes, boxMemberships } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import {NotificationService} from "@/lib/services/notifications";

export class UsageLimitsNotificationsService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
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
