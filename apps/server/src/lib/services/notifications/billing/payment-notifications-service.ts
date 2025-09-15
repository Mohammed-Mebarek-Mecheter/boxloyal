// lib/services/notifications/billing/payment-notifications-service.ts
import { db } from "@/db";
import { boxes, boxMemberships } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import {NotificationService} from "@/lib/services/notifications";

export class PaymentNotificationsService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
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
     * Send monthly invoice notification
     */
    async sendInvoiceNotification(boxId: string, invoiceId: string, amount: number, dueDate?: Date) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

        const formattedAmount = `$${(amount / 100).toFixed(2)}`;
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
