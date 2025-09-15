// lib/services/notifications/billing/grace-period-notifications-service.ts
import { db } from "@/db";
import { boxes, boxMemberships, gracePeriods } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import {NotificationService} from "@/lib/services/notifications";

export class GracePeriodNotificationsService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
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

        // Map reasons to user-friendly messages
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
            return [];
        }

        const box = gracePeriod.box;
        const reason = gracePeriod.reason;

        // Map reason to user-friendly messages
        const reasonMessages: Record<string, { title: string; snippet: string }> = {
            athlete_limit_exceeded: {title: "Athlete Limit Issue Resolved", snippet: "athlete limit issue"},
            coach_limit_exceeded: {title: "Coach Limit Issue Resolved", snippet: "coach limit issue"},
            trial_ending: {title: "Trial Expiry Issue Resolved", snippet: "trial expiry issue"},
            payment_failed: {title: "Payment Issue Resolved", snippet: "payment issue"},
            subscription_canceled: {title: "Cancellation Issue Resolved", snippet: "subscription cancellation issue"},
            billing_issue: {title: "Billing Issue Resolved", snippet: "billing issue"},
        };

        const reasonInfo = reasonMessages[reason] || {title: "Issue Resolved", snippet: "issue"};

        const title = reasonInfo.title;
        const message = `The ${reasonInfo.snippet} for your BoxLoyal account has been successfully resolved.

Resolution details: ${resolution}

Your account is now back in good standing. Thank you for taking action!`;

        const notifications = [];

        for (const membership of box.memberships) {
            if (membership.role === "owner" || membership.role === "head_coach") {
                const notification = await this.notificationService.createNotification({
                    boxId: box.id,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "grace_period_resolved",
                    category: "billing",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/billing?boxId=${box.id}`,
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
