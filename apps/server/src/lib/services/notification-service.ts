// lib/services/notification-service.ts
import { env } from "cloudflare:workers";

export type NotificationChannel = "email" | "webhook" | "push";
export type NotificationType =
    | "grace_period_warning"
    | "grace_period_expired"
    | "overage_billing"
    | "payment_failed"
    | "subscription_canceled"
    | "subscription_reactivated"
    | "trial_ending"
    | "usage_limit_approaching"
    | "plan_change_approved";

export interface NotificationData {
    type: NotificationType;
    boxId: string;
    boxName: string;
    ownerEmail: string;
    subject: string;
    message: string;
    metadata?: Record<string, any>;
    urgency?: "low" | "medium" | "high" | "critical";
    actionUrl?: string;
    actionText?: string;
}

export interface EmailTemplate {
    subject: string;
    htmlBody: string;
    textBody: string;
}

/**
 * Service for sending notifications via various channels
 * Handles email, webhooks, and push notifications for billing and retention events
 */
export class NotificationService {

    /**
     * Send notification via the appropriate channel(s)
     */
    static async sendNotification(
        data: NotificationData,
        channels: NotificationChannel[] = ["email"]
    ): Promise<{ success: boolean; results: Record<NotificationChannel, any> }> {
        const results: Record<string, any> = {};

        console.log(`Sending ${data.type} notification for box ${data.boxName} via ${channels.join(', ')}`);

        for (const channel of channels) {
            try {
                switch (channel) {
                    case "email":
                        results[channel] = await this.sendEmail(data);
                        break;
                    case "webhook":
                        results[channel] = await this.sendWebhook(data);
                        break;
                    case "push":
                        results[channel] = await this.sendPushNotification(data);
                        break;
                    default:
                        results[channel] = { success: false, error: "Unknown channel" };
                }
            } catch (error) {
                console.error(`Failed to send ${channel} notification:`, error);
                results[channel] = {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        }

        const overallSuccess = Object.values(results).some((result: any) => result.success);

        return {
            success: overallSuccess,
            results
        };
    }

    /**
     * Send email notification
     */
    private static async sendEmail(data: NotificationData): Promise<{ success: boolean; messageId?: string; error?: string }> {
        try {
            const template = this.generateEmailTemplate(data);

            // Here you would integrate with your email service (SendGrid, Resend, etc.)
            // For now, we'll simulate the email sending

            console.log(`Email would be sent to ${data.ownerEmail}:`);
            console.log(`Subject: ${template.subject}`);
            console.log(`Body: ${template.textBody}`);

            // Example integration with a hypothetical email service:
            /*
            const emailResponse = await fetch('https://api.emailservice.com/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.EMAIL_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to: data.ownerEmail,
                    subject: template.subject,
                    html: template.htmlBody,
                    text: template.textBody,
                    tags: [data.type, 'billing', 'notification']
                })
            });

            if (!emailResponse.ok) {
                throw new Error(`Email API error: ${emailResponse.statusText}`);
            }

            const result = await emailResponse.json();
            return { success: true, messageId: result.messageId };
            */

            // Simulated success for development
            return {
                success: true,
                messageId: `sim-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
            };

        } catch (error) {
            console.error("Email sending failed:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Send webhook notification
     */
    private static async sendWebhook(data: NotificationData): Promise<{ success: boolean; error?: string }> {
        try {
            // This would be configured per box or globally
            const webhookUrl = env.NOTIFICATION_WEBHOOK_URL;

            if (!webhookUrl) {
                return { success: false, error: "No webhook URL configured" };
            }

            const payload = {
                event: data.type,
                timestamp: new Date().toISOString(),
                data: {
                    boxId: data.boxId,
                    boxName: data.boxName,
                    message: data.message,
                    urgency: data.urgency || "medium",
                    actionUrl: data.actionUrl,
                    actionText: data.actionText,
                    metadata: data.metadata
                }
            };

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'BoxLoyal-Notifications/1.0',
                    'X-BoxLoyal-Event': data.type,
                    'X-BoxLoyal-Timestamp': payload.timestamp,
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Webhook response error: ${response.status} ${response.statusText}`);
            }

            return { success: true };

        } catch (error) {
            console.error("Webhook sending failed:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Send push notification (placeholder for mobile app integration)
     */
    private static async sendPushNotification(data: NotificationData): Promise<{ success: boolean; error?: string }> {
        try {
            // This would integrate with Firebase Cloud Messaging, Apple Push Notifications, etc.
            console.log(`Push notification would be sent for box ${data.boxName}: ${data.message}`);

            // Simulated success for development
            return { success: true };

        } catch (error) {
            console.error("Push notification sending failed:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Generate email template based on notification type
     */
    private static generateEmailTemplate(data: NotificationData): EmailTemplate {
        const templates: Record<NotificationType, (data: NotificationData) => EmailTemplate> = {
            grace_period_warning: (data) => ({
                subject: `⚠️ Action Required: ${data.boxName} - Account Access Warning`,
                htmlBody: `
                    <h2>Action Required for ${data.boxName}</h2>
                    <p>Your gym's BoxLoyal account needs attention:</p>
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 16px; border-radius: 4px; margin: 16px 0;">
                        <p><strong>Issue:</strong> ${data.message}</p>
                        <p><strong>Grace period ends:</strong> ${data.metadata?.endsAt ? new Date(data.metadata.endsAt).toLocaleDateString() : 'Soon'}</p>
                    </div>
                    <p>Please take action to avoid any interruption to your service:</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Take Action'}</a></p>` : ''}
                    <p>If you have questions, please contact our support team.</p>
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
Action Required for ${data.boxName}

Your gym's BoxLoyal account needs attention:

Issue: ${data.message}
Grace period ends: ${data.metadata?.endsAt ? new Date(data.metadata.endsAt).toLocaleDateString() : 'Soon'}

Please take action to avoid any interruption to your service.
${data.actionUrl ? `Action needed: ${data.actionUrl}` : ''}

If you have questions, please contact our support team.

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            }),

            grace_period_expired: (data) => ({
                subject: `🚨 Urgent: ${data.boxName} - Account Access Suspended`,
                htmlBody: `
                    <h2>Account Access Suspended - ${data.boxName}</h2>
                    <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 16px; border-radius: 4px; margin: 16px 0;">
                        <p><strong>⚠️ Your BoxLoyal account has been suspended:</strong></p>
                        <p>${data.message}</p>
                    </div>
                    <p>To restore access immediately:</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Restore Access'}</a></p>` : ''}
                    <p>If you need assistance, please contact our support team immediately.</p>
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
Account Access Suspended - ${data.boxName}

⚠️ Your BoxLoyal account has been suspended:
${data.message}

To restore access immediately:
${data.actionUrl ? `${data.actionUrl}` : 'Please contact support'}

If you need assistance, please contact our support team immediately.

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            }),

            overage_billing: (data) => ({
                subject: `💰 ${data.boxName} - Usage Overage Invoice`,
                htmlBody: `
                    <h2>Usage Overage Invoice - ${data.boxName}</h2>
                    <p>Your gym has exceeded its plan limits this month:</p>
                    <div style="background: #e7f3ff; border: 1px solid #b8e6ff; padding: 16px; border-radius: 4px; margin: 16px 0;">
                        <p>${data.message}</p>
                        ${data.metadata?.amount ? `<p><strong>Overage amount:</strong> $${(data.metadata.amount / 100).toFixed(2)}</p>` : ''}
                    </div>
                    <p>This overage will be automatically billed to your payment method on file.</p>
                    <p>To avoid future overage charges, consider upgrading your plan:</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Upgrade Plan'}</a></p>` : ''}
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
Usage Overage Invoice - ${data.boxName}

Your gym has exceeded its plan limits this month:
${data.message}
${data.metadata?.amount ? `Overage amount: $${(data.metadata.amount / 100).toFixed(2)}` : ''}

This overage will be automatically billed to your payment method on file.

To avoid future overage charges, consider upgrading your plan:
${data.actionUrl ? data.actionUrl : 'Visit your account settings'}

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            }),

            payment_failed: (data) => ({
                subject: `🚨 Payment Failed: ${data.boxName} - Update Payment Method`,
                htmlBody: `
                    <h2>Payment Failed - ${data.boxName}</h2>
                    <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 16px; border-radius: 4px; margin: 16px 0;">
                        <p><strong>⚠️ We couldn't process your payment:</strong></p>
                        <p>${data.message}</p>
                    </div>
                    <p>Please update your payment method to avoid service interruption:</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Update Payment'}</a></p>` : ''}
                    <p>Your account will remain active for a grace period while you resolve this issue.</p>
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
Payment Failed - ${data.boxName}

⚠️ We couldn't process your payment:
${data.message}

Please update your payment method to avoid service interruption:
${data.actionUrl ? data.actionUrl : 'Visit your billing settings'}

Your account will remain active for a grace period while you resolve this issue.

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            }),

            subscription_canceled: (data) => ({
                subject: `😢 Subscription Canceled: ${data.boxName}`,
                htmlBody: `
                    <h2>Subscription Canceled - ${data.boxName}</h2>
                    <p>Your BoxLoyal subscription has been canceled:</p>
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 16px; border-radius: 4px; margin: 16px 0;">
                        <p>${data.message}</p>
                        ${data.metadata?.accessEndsAt ? `<p><strong>Access ends:</strong> ${new Date(data.metadata.accessEndsAt).toLocaleDateString()}</p>` : ''}
                    </div>
                    <p>We're sorry to see you go! If you'd like to reactivate your account:</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Reactivate Account'}</a></p>` : ''}
                    <p>If you have feedback about your experience, we'd love to hear from you.</p>
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
Subscription Canceled - ${data.boxName}

Your BoxLoyal subscription has been canceled:
${data.message}
${data.metadata?.accessEndsAt ? `Access ends: ${new Date(data.metadata.accessEndsAt).toLocaleDateString()}` : ''}

We're sorry to see you go! If you'd like to reactivate your account:
${data.actionUrl ? data.actionUrl : 'Contact our support team'}

If you have feedback about your experience, we'd love to hear from you.

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            }),

            subscription_reactivated: (data) => ({
                subject: `🎉 Welcome Back: ${data.boxName} - Subscription Reactivated`,
                htmlBody: `
                    <h2>Welcome Back! - ${data.boxName}</h2>
                    <p>Great news! Your BoxLoyal subscription has been reactivated:</p>
                    <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 16px; border-radius: 4px; margin: 16px 0;">
                        <p>${data.message}</p>
                    </div>
                    <p>You now have full access to all BoxLoyal features again.</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Access Dashboard'}</a></p>` : ''}
                    <p>Thanks for being a valued customer!</p>
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
Welcome Back! - ${data.boxName}

Great news! Your BoxLoyal subscription has been reactivated:
${data.message}

You now have full access to all BoxLoyal features again.

${data.actionUrl ? `Access your dashboard: ${data.actionUrl}` : ''}

Thanks for being a valued customer!

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            }),

            trial_ending: (data) => ({
                subject: `Trial Ending Soon: ${data.boxName} - Choose Your Plan`,
                htmlBody: `
                    <h2>Trial Ending Soon - ${data.boxName}</h2>
                    <p>Your BoxLoyal free trial is ending soon:</p>
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 16px; border-radius: 4px; margin: 16px 0;">
                        <p>${data.message}</p>
                        ${data.metadata?.trialEndsAt ? `<p><strong>Trial ends:</strong> ${new Date(data.metadata.trialEndsAt).toLocaleDateString()}</p>` : ''}
                    </div>
                    <p>To continue using BoxLoyal without interruption, please choose a subscription plan:</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Choose Plan'}</a></p>` : ''}
                    <p>Questions about our plans? Our team is here to help you choose the right fit.</p>
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
Trial Ending Soon - ${data.boxName}

Your BoxLoyal free trial is ending soon:
${data.message}
${data.metadata?.trialEndsAt ? `Trial ends: ${new Date(data.metadata.trialEndsAt).toLocaleDateString()}` : ''}

To continue using BoxLoyal without interruption, please choose a subscription plan:
${data.actionUrl ? data.actionUrl : 'Visit your account settings'}

Questions about our plans? Our team is here to help you choose the right fit.

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            }),

            usage_limit_approaching: (data) => ({
                subject: `Usage Limit Approaching: ${data.boxName} - Consider Upgrading`,
                htmlBody: `
                    <h2>Usage Limit Approaching - ${data.boxName}</h2>
                    <p>Your gym is approaching its plan limits:</p>
                    <div style="background: #e7f3ff; border: 1px solid #b8e6ff; padding: 16px; border-radius: 4px; margin: 16px 0;">
                        <p>${data.message}</p>
                        ${data.metadata?.currentUsage ? `<p><strong>Current usage:</strong> ${data.metadata.currentUsage}% of limit</p>` : ''}
                    </div>
                    <p>To avoid any overage charges or service limitations, consider upgrading your plan:</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Upgrade Plan'}</a></p>` : ''}
                    <p>Or enable overage billing to allow unlimited growth with pay-as-you-go pricing.</p>
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
Usage Limit Approaching - ${data.boxName}

Your gym is approaching its plan limits:
${data.message}
${data.metadata?.currentUsage ? `Current usage: ${data.metadata.currentUsage}% of limit` : ''}

To avoid any overage charges or service limitations, consider upgrading your plan:
${data.actionUrl ? data.actionUrl : 'Visit your account settings'}

Or enable overage billing to allow unlimited growth with pay-as-you-go pricing.

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            }),

            plan_change_approved: (data) => ({
                subject: `Plan Change Confirmed: ${data.boxName}`,
                htmlBody: `
                    <h2>Plan Change Confirmed - ${data.boxName}</h2>
                    <p>Your subscription plan change has been processed:</p>
                    <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 16px; border-radius: 4px; margin: 16px 0;">
                        <p>${data.message}</p>
                        ${data.metadata?.newPlan ? `<p><strong>New plan:</strong> ${data.metadata.newPlan}</p>` : ''}
                        ${data.metadata?.effectiveDate ? `<p><strong>Effective date:</strong> ${new Date(data.metadata.effectiveDate).toLocaleDateString()}</p>` : ''}
                    </div>
                    <p>Your new plan features are now available:</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Access Dashboard'}</a></p>` : ''}
                    <p>Thanks for growing with BoxLoyal!</p>
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
Plan Change Confirmed - ${data.boxName}

Your subscription plan change has been processed:
${data.message}
${data.metadata?.newPlan ? `New plan: ${data.metadata.newPlan}` : ''}
${data.metadata?.effectiveDate ? `Effective date: ${new Date(data.metadata.effectiveDate).toLocaleDateString()}` : ''}

Your new plan features are now available:
${data.actionUrl ? data.actionUrl : 'Access your dashboard'}

Thanks for growing with BoxLoyal!

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            })
        };

        const template = templates[data.type];
        if (!template) {
            // Fallback template for unknown notification types
            return {
                subject: `${data.boxName} - ${data.subject}`,
                htmlBody: `
                    <h2>${data.subject}</h2>
                    <p>${data.message}</p>
                    ${data.actionUrl ? `<p><a href="${data.actionUrl}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">${data.actionText || 'Take Action'}</a></p>` : ''}
                    <hr>
                    <p><small>BoxLoyal - CrossFit Performance Analytics</small></p>
                `,
                textBody: `
${data.subject}

${data.message}

${data.actionUrl ? `Action needed: ${data.actionUrl}` : ''}

BoxLoyal - CrossFit Performance Analytics
                `.trim()
            };
        }

        return template(data);
    }

    /**
     * Send grace period warning notification
     */
    static async sendGracePeriodWarning(
        boxId: string,
        boxName: string,
        ownerEmail: string,
        gracePeriod: any
    ): Promise<void> {
        const daysLeft = Math.ceil((new Date(gracePeriod.endsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        await this.sendNotification({
            type: "grace_period_warning",
            boxId,
            boxName,
            ownerEmail,
            subject: "Action Required - Account Access Warning",
            message: `Your account has a ${gracePeriod.reason.replace('_', ' ')} issue that needs attention. You have ${daysLeft} day(s) remaining to resolve this.`,
            metadata: {
                gracePeriodId: gracePeriod.id,
                reason: gracePeriod.reason,
                endsAt: gracePeriod.endsAt,
                daysLeft,
                severity: gracePeriod.severity
            },
            urgency: gracePeriod.severity === "critical" ? "critical" : "high",
            actionUrl: `${env.BETTER_AUTH_URL}/billing/grace-period/${gracePeriod.id}`,
            actionText: "Resolve Issue"
        });
    }

    /**
     * Send overage billing notification
     */
    static async sendOverageBillingNotification(
        boxId: string,
        boxName: string,
        ownerEmail: string,
        overageAmount: number,
        overageDetails: any
    ): Promise<void> {
        await this.sendNotification({
            type: "overage_billing",
            boxId,
            boxName,
            ownerEmail,
            subject: "Usage Overage Invoice",
            message: `Your gym exceeded its plan limits and will be charged ${(overageAmount / 100).toFixed(2)} for additional usage.`,
            metadata: {
                amount: overageAmount,
                athleteOverage: overageDetails.athleteOverage,
                coachOverage: overageDetails.coachOverage,
                billingPeriod: overageDetails.billingPeriod
            },
            urgency: "medium",
            actionUrl: `${env.BETTER_AUTH_URL}/billing/upgrade`,
            actionText: "Upgrade Plan"
        });
    }

    /**
     * Send usage limit approaching notification
     */
    static async sendUsageLimitWarning(
        boxId: string,
        boxName: string,
        ownerEmail: string,
        usageType: "athlete" | "coach",
        currentCount: number,
        limit: number
    ): Promise<void> {
        const percentage = Math.round((currentCount / limit) * 100);

        await this.sendNotification({
            type: "usage_limit_approaching",
            boxId,
            boxName,
            ownerEmail,
            subject: "Usage Limit Approaching",
            message: `Your ${usageType} count (${currentCount}) is approaching your plan limit of ${limit}.`,
            metadata: {
                usageType,
                currentCount,
                limit,
                currentUsage: percentage
            },
            urgency: percentage >= 90 ? "high" : "medium",
            actionUrl: `${env.BETTER_AUTH_URL}/billing/upgrade`,
            actionText: "Upgrade Plan"
        });
    }

    /**
     * Batch send notifications with rate limiting
     */
    static async sendBatchNotifications(
        notifications: Array<{
            data: NotificationData;
            channels?: NotificationChannel[];
        }>,
        batchSize: number = 10,
        delayMs: number = 1000
    ): Promise<{ success: number; failed: number; results: any[] }> {
        const results = [];
        let success = 0;
        let failed = 0;

        for (let i = 0; i < notifications.length; i += batchSize) {
            const batch = notifications.slice(i, i + batchSize);

            const batchResults = await Promise.allSettled(
                batch.map(({ data, channels }) => this.sendNotification(data, channels))
            );

            for (const result of batchResults) {
                if (result.status === 'fulfilled' && result.value.success) {
                    success++;
                } else {
                    failed++;
                }
                results.push(result);
            }

            // Rate limiting delay between batches
            if (i + batchSize < notifications.length && delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        return { success, failed, results };
    }
}
