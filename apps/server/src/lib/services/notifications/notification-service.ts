// lib/services/notifications/notification-service.ts
import { db } from "@/db";
import {
    notifications,
    notificationDeliveries,
    notificationPreferences,
    notificationTemplates,
    boxes,
    boxMemberships,
} from "@/db/schema";
import { eq, and, or, gte, lte, count, sql } from "drizzle-orm";
import { BrevoService } from "./brevo-service";
import { QueueService } from "./queue-service";
import type {
    NotificationCreateParams,
    NotificationDeliveryOptions,
    NotificationBatch,
    NotificationStats,
} from "./types";

export class NotificationService {
    private brevoService: BrevoService;
    private queueService: QueueService;

    constructor() {
        this.brevoService = new BrevoService();
        this.queueService = new QueueService();
    }

    /**
     * Create and queue a notification
     */
    async createNotification(params: NotificationCreateParams) {
        const {
            boxId,
            userId,
            membershipId,
            type,
            category,
            priority = "normal",
            title,
            message,
            actionUrl,
            actionLabel,
            data,
            templateId,
            templateVariables,
            scheduledFor,
            expiresAt,
            channels = ["in_app"],
            deduplicationKey,
            groupKey,
        } = params;

        // Check for existing notification with same deduplication key
        if (deduplicationKey) {
            const existing = await db.query.notifications.findFirst({
                where: and(
                    eq(notifications.deduplicationKey, deduplicationKey),
                    eq(notifications.status, "pending"),
                    or(
                        eq(notifications.status, "queued"),
                        eq(notifications.status, "sent")
                    )
                ),
            });

            if (existing) {
                console.log(`Notification deduplicated: ${deduplicationKey}`);
                return { notification: existing, deduplicated: true };
            }
        }

        // Create the notification record
        const [notification] = await db
            .insert(notifications)
            .values({
                boxId: boxId,
                userId: userId,
                membershipId: membershipId,
                type: type,
                category: category,
                priority: priority,
                title,
                message,
                actionUrl,
                actionLabel,
                data: data ? JSON.parse(JSON.stringify(data)) : null,
                templateId,
                templateVariables: templateVariables ? JSON.parse(JSON.stringify(templateVariables)) : null,
                scheduledFor,
                expiresAt,
                deduplicationKey,
                groupKey,
                source: "system",
            } as any)
            .returning();

        // Create delivery records for each channel
        const deliveries = [];
        for (const channel of channels) {
            const recipient = await this.getRecipientForChannel(
                notification.id,
                channel,
                userId,
                boxId
            );

            if (recipient) {
                const [delivery] = await db
                    .insert(notificationDeliveries)
                    .values({
                        notificationId: notification.id,
                        channel,
                        recipient,
                        status: "pending",
                    })
                    .returning();

                deliveries.push(delivery);
            }
        }

        // Queue for processing
        if (scheduledFor && scheduledFor > new Date()) {
            // Schedule for future delivery
            await this.queueService.scheduleNotification(notification.id, scheduledFor);
        } else {
            // Queue for immediate processing
            await this.queueService.queueNotification(notification.id);
        }

        return { notification, deliveries, deduplicated: false };
    }

    /**
     * Process a queued notification
     */
    async processNotification(notificationId: string) {
        const notification = await db.query.notifications.findFirst({
            where: eq(notifications.id, notificationId),
            with: {
                deliveries: true,
                box: true,
                user: true,
                membership: {
                    with: {
                        user: true,
                    },
                },
            },
        });

        if (!notification) {
            throw new Error(`Notification not found: ${notificationId}`);
        }

        // Check if expired
        if (notification.expiresAt && notification.expiresAt < new Date()) {
            await this.markNotificationCancelled(notificationId, "expired");
            return { processed: false, reason: "expired" };
        }

        // Update status to processing
        await db
            .update(notifications)
            .set({ status: "queued", updatedAt: new Date() })
            .where(eq(notifications.id, notificationId));

        const results = [];

        // Process each delivery
        for (const delivery of notification.deliveries) {
            try {
                const result = await this.processDelivery(delivery, notification);
                results.push(result);
            } catch (error) {
                console.error(`Failed to process delivery ${delivery.id}:`, error);

                await db
                    .update(notificationDeliveries)
                    .set({
                        status: "failed",
                        failureReason: error instanceof Error ? error.message : String(error),
                        retryCount: delivery.retryCount + 1,
                        nextRetryAt: this.calculateNextRetry(delivery.retryCount),
                        updatedAt: new Date(),
                    })
                    .where(eq(notificationDeliveries.id, delivery.id));

                results.push({ deliveryId: delivery.id, success: false, error });
            }
        }

        // Update notification status
        const allSuccessful = results.every((r) => r.success);
        const anySuccessful = results.some((r) => r.success);

        await db
            .update(notifications)
            .set({
                status: allSuccessful ? "sent" : anySuccessful ? "sent" : "failed",
                sentAt: anySuccessful ? new Date() : null,
                updatedAt: new Date(),
            })
            .where(eq(notifications.id, notificationId));

        return { processed: true, results };
    }

    /**
     * Process individual delivery
     */
    private async processDelivery(delivery: any, notification: any) {
        // Check user preferences
        const canDeliver = await this.checkDeliveryPermissions(
            delivery,
            notification
        );

        if (!canDeliver.allowed) {
            await db
                .update(notificationDeliveries)
                .set({
                    status: "cancelled",
                    failureReason: canDeliver.reason,
                    updatedAt: new Date(),
                })
                .where(eq(notificationDeliveries.id, delivery.id));

            return { deliveryId: delivery.id, success: false, reason: canDeliver.reason };
        }

        // Update status to processing
        await db
            .update(notificationDeliveries)
            .set({ status: "queued", updatedAt: new Date() })
            .where(eq(notificationDeliveries.id, delivery.id));

        let result;

        switch (delivery.channel) {
            case "email":
                result = await this.sendEmailNotification(delivery, notification);
                break;
            case "in_app":
                result = await this.sendInAppNotification(delivery, notification);
                break;
            default:
                throw new Error(`Unsupported channel: ${delivery.channel}`);
        }

        // Update delivery record
        await db
            .update(notificationDeliveries)
            .set({
                status: result.success ? "sent" : "failed",
                sentAt: result.success ? new Date() : null,
                externalId: result.externalId || null,
                channelResponse: result.response ? JSON.parse(JSON.stringify(result.response)) : null,
                failureReason: result.error || null,
                cost: result.cost || 0,
                updatedAt: new Date(),
            })
            .where(eq(notificationDeliveries.id, delivery.id));

        const { success, ...rest } = result;
        return { deliveryId: delivery.id, success, ...rest };
    }

    /**
     * Send email notification via Brevo
     */
    private async sendEmailNotification(delivery: any, notification: any) {
        try {
            const emailData = {
                to: [{ email: delivery.recipient, name: notification.user?.name || "User" }],
                subject: notification.title,
                htmlContent: await this.generateEmailContent(notification),
                textContent: this.stripHtml(notification.message),
                sender: {
                    name: notification.box?.name || "BoxLoyal",
                    email: "no-reply@mail.boxloyal.com",
                },
                replyTo: notification.box?.email
                    ? { email: notification.box.email, name: notification.box.name }
                    : undefined,
                headers: {
                    "X-Box-ID": notification.boxId || "",
                    "X-Notification-ID": notification.id,
                    "X-Notification-Type": notification.type,
                },
                tags: [notification.type, notification.category],
            };

            const response = await this.brevoService.sendTransactionalEmail(emailData);

            return {
                success: true,
                externalId: response.messageId,
                response,
                cost: 1, // Approximate cost in cents
                error: undefined // Explicitly set error to undefined
            };
        } catch (error) {
            return {
                success: false,
                externalId: undefined,
                response: undefined,
                error: error instanceof Error ? error.message : String(error),
                cost: 0
            };
        }
    }

    /**
     * Send in-app notification (just mark as delivered since it's stored in DB)
     */
    private async sendInAppNotification(delivery: any, notification: any) {
        // In-app notifications are "delivered" when created in the database
        return {
            success: true,
            externalId: notification.id,
            response: { method: "database" },
            cost: 0,
            error: undefined
        };
    }

    /**
     * Generate HTML email content
     */
    private async generateEmailContent(notification: any): Promise<string> {
        if (notification.templateId) {
            const template = await db.query.notificationTemplates.findFirst({
                where: eq(notificationTemplates.templateId, notification.templateId),
            });

            if (template) {
                return this.processTemplate(
                    template.body,
                    notification.templateVariables || {}
                );
            }
        }

        // Default email template
        return `
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h2 style="color: #333; margin: 0 0 10px 0;">${notification.title}</h2>
                <p style="color: #666; margin: 0;">From ${notification.box?.name || "BoxLoyal"}</p>
            </div>
            
            <div style="line-height: 1.6; color: #333;">
                ${notification.message.replace(/\n/g, '<br>')}
            </div>
            
            ${notification.actionUrl ? `
            <div style="margin: 30px 0; text-align: center;">
                <a href="${notification.actionUrl}" 
                   style="background: #007bff; color: white; padding: 12px 24px; 
                          text-decoration: none; border-radius: 4px; display: inline-block;">
                    ${notification.actionLabel || "View Details"}
                </a>
            </div>
            ` : ''}
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; 
                        font-size: 12px; color: #999; text-align: center;">
                <p>This email was sent by ${notification.box?.name || "BoxLoyal"}.</p>
                <p>To manage your notification preferences, visit your account settings.</p>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Process template variables
     */
    private processTemplate(template: string, variables: Record<string, any>): string {
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return variables[key] || match;
        });
    }

    /**
     * Strip HTML tags for text content
     */
    private stripHtml(html: string): string {
        return html.replace(/<[^>]*>/g, '').replace(/\n\s+/g, '\n').trim();
    }

    /**
     * Check if delivery is allowed based on user preferences
     */
    private async checkDeliveryPermissions(delivery: any, notification: any) {
        // Get user preferences
        const preferences = await db.query.notificationPreferences.findFirst({
            where: and(
                eq(notificationPreferences.userId, notification.userId),
                eq(notificationPreferences.boxId, notification.boxId)
            ),
        });

        if (!preferences) {
            // Default: allow all notifications
            return { allowed: true };
        }

        // Check channel preferences
        if (delivery.channel === "email" && !preferences.enableEmail) {
            return { allowed: false, reason: "email_disabled" };
        }

        if (delivery.channel === "in_app" && !preferences.enableInApp) {
            return { allowed: false, reason: "in_app_disabled" };
        }

        // Check category preferences
        const categoryMap: Record<string, keyof typeof preferences> = {
            retention: "enableRetention",
            billing: "enableBilling",
            engagement: "enableEngagement",
            workflow: "enableWorkflow",
            system: "enableSystem",
            social: "enableSocial",
        };

        const categoryPref = categoryMap[notification.category];
        if (categoryPref && !preferences[categoryPref]) {
            return { allowed: false, reason: `${notification.category}_disabled` };
        }

        // Check quiet hours
        if (preferences.quietHoursStart !== null && preferences.quietHoursEnd !== null) {
            const now = new Date();
            const currentHour = now.getHours();

            if (this.isInQuietHours(currentHour, preferences.quietHoursStart, preferences.quietHoursEnd)) {
                return { allowed: false, reason: "quiet_hours" };
            }
        }

        // Check daily notification limit
        if (preferences.maxDailyNotifications) {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const [todayCount] = await db
                .select({ count: count() })
                .from(notificationDeliveries)
                .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
                .where(and(
                    eq(notifications.userId, notification.userId),
                    eq(notifications.boxId, notification.boxId),
                    eq(notificationDeliveries.channel, delivery.channel),
                    eq(notificationDeliveries.status, "sent"),
                    gte(notificationDeliveries.sentAt, todayStart)
                ));

            if (todayCount.count >= preferences.maxDailyNotifications) {
                return { allowed: false, reason: "daily_limit_exceeded" };
            }
        }

        return { allowed: true };
    }

    /**
     * Check if current time is in quiet hours
     */
    private isInQuietHours(currentHour: number, startHour: number, endHour: number): boolean {
        if (startHour <= endHour) {
            return currentHour >= startHour && currentHour <= endHour;
        } else {
            // Quiet hours span midnight
            return currentHour >= startHour || currentHour <= endHour;
        }
    }

    /**
     * Get recipient for specific channel
     */
    private async getRecipientForChannel(
        notificationId: string,
        channel: string,
        userId?: string | null,
        boxId?: string | null
    ): Promise<string | null> {
        if (channel === "in_app") {
            return userId || "system";
        }

        if (channel === "email" && userId) {
            // Check user preferences for custom email
            const preferences = await db.query.notificationPreferences.findFirst({
                where: and(
                    eq(notificationPreferences.userId, userId),
                    boxId ? eq(notificationPreferences.boxId, boxId) : sql`true`
                ),
            });

            if (preferences?.emailAddress) {
                return preferences.emailAddress;
            }

            // Fall back to user's auth email
            const { user } = await import("@/db/schema/auth");
            const userRecord = await db.query.user.findFirst({
                where: eq(user.id, userId),
            });

            return userRecord?.email || null;
        }

        return null;
    }

    /**
     * Calculate next retry time with exponential backoff
     */
    private calculateNextRetry(retryCount: number): Date {
        const baseDelay = 60 * 1000; // 1 minute
        const maxDelay = 60 * 60 * 1000; // 1 hour
        const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);

        return new Date(Date.now() + delay);
    }

    /**
     * Mark notification as cancelled
     */
    async markNotificationCancelled(notificationId: string, reason: string) {
        await db
            .update(notifications)
            .set({
                status: "cancelled",
                failureReason: reason,
                updatedAt: new Date(),
            })
            .where(eq(notifications.id, notificationId));

        // Cancel all pending deliveries
        await db
            .update(notificationDeliveries)
            .set({
                status: "cancelled",
                failureReason: reason,
                updatedAt: new Date(),
            })
            .where(and(
                eq(notificationDeliveries.notificationId, notificationId),
                or(
                    eq(notificationDeliveries.status, "pending"),
                    eq(notificationDeliveries.status, "queued")
                )
            ));
    }

    /**
     * Retry failed notifications
     */
    async retryFailedNotifications(maxRetries: number = 3) {
        const failedDeliveries = await db.query.notificationDeliveries.findMany({
            where: and(
                eq(notificationDeliveries.status, "failed"),
                sql`${notificationDeliveries.retryCount} < ${maxRetries}`,
                or(
                    sql`${notificationDeliveries.nextRetryAt} IS NULL`,
                    lte(notificationDeliveries.nextRetryAt, new Date())
                )
            ),
            with: {
                notification: true,
            },
            limit: 100,
        });

        const results = [];

        for (const delivery of failedDeliveries) {
            try {
                const result = await this.processDelivery(delivery, delivery.notification);
                results.push({ deliveryId: delivery.id, success: result.success });
            } catch (error) {
                results.push({ deliveryId: delivery.id, success: false, error });
            }
        }

        return results;
    }

    /**
     * Get notification statistics
     */
    async getNotificationStats(
        boxId?: string,
        timeframe: "24h" | "7d" | "30d" = "24h"
    ): Promise<NotificationStats> {
        const startDate = new Date();

        switch (timeframe) {
            case "24h":
                startDate.setDate(startDate.getDate() - 1);
                break;
            case "7d":
                startDate.setDate(startDate.getDate() - 7);
                break;
            case "30d":
                startDate.setDate(startDate.getDate() - 30);
                break;
        }

        const baseWhere = boxId
            ? and(
                eq(notifications.boxId, boxId),
                gte(notifications.createdAt, startDate)
            )
            : gte(notifications.createdAt, startDate);

        const [
            totalStats,
            byStatus,
            byCategory,
            byChannel,
        ] = await Promise.all([
            // Total notifications
            db
                .select({
                    total: count(),
                })
                .from(notifications)
                .where(baseWhere),

            // By status
            db
                .select({
                    status: notifications.status,
                    count: count(),
                })
                .from(notifications)
                .where(baseWhere)
                .groupBy(notifications.status),

            // By category
            db
                .select({
                    category: notifications.category,
                    count: count(),
                })
                .from(notifications)
                .where(baseWhere)
                .groupBy(notifications.category),

            // By channel
            db
                .select({
                    channel: notificationDeliveries.channel,
                    count: count(),
                })
                .from(notificationDeliveries)
                .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
                .where(baseWhere)
                .groupBy(notificationDeliveries.channel),
        ]);

        return {
            timeframe,
            total: totalStats[0]?.total || 0,
            byStatus: byStatus.reduce((acc, item) => ({
                ...acc,
                [item.status]: item.count,
            }), {}),
            byCategory: byCategory.reduce((acc, item) => ({
                ...acc,
                [item.category]: item.count,
            }), {}),
            byChannel: byChannel.reduce((acc, item) => ({
                ...acc,
                [item.channel]: item.count,
            }), {}),
        };
    }

    /**
     * Bulk create notifications (for batch operations)
     */
    async createBulkNotifications(batch: NotificationBatch) {
        const notifications = [];

        for (const params of batch.notifications) {
            const result = await this.createNotification(params);
            notifications.push(result.notification);
        }

        return { notifications, batchId: batch.batchId };
    }

    /**
     * Clean up old notifications
     */
    async cleanupOldNotifications(retentionDays: number = 90) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        // Delete old notifications (cascades to deliveries)
        const result = await db
            .delete(notifications)
            .where(
                and(
                    lte(notifications.createdAt, cutoffDate),
                    or(
                        eq(notifications.status, "sent"),
                        eq(notifications.status, "failed"),
                        eq(notifications.status, "cancelled")
                    )
                )
            );

        return { deletedCount: result.rowCount || 0 };
    }
}
