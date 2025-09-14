// lib/services/notifications/types.ts

export interface NotificationCreateParams {
    boxId?: string | null;
    userId?: string | null;
    membershipId?: string | null;
    type: NotificationType;
    category: NotificationCategory;
    priority?: NotificationPriority;
    title: string;
    message: string;
    actionUrl?: string;
    actionLabel?: string;
    data?: Record<string, any>;
    templateId?: string;
    templateVariables?: Record<string, any>;
    scheduledFor?: Date;
    expiresAt?: Date;
    channels?: NotificationChannel[];
    deduplicationKey?: string;
    groupKey?: string;
}

export interface NotificationDeliveryOptions {
    channel: NotificationChannel;
    recipient: string;
    priority?: NotificationPriority;
    retryCount?: number;
    maxRetries?: number;
}

export interface NotificationBatch {
    batchId: string;
    notifications: NotificationCreateParams[];
    priority?: NotificationPriority;
    scheduledFor?: Date;
}

export interface NotificationStats {
    timeframe: string;
    total: number;
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
    byChannel: Record<string, number>;
}

// Enums matching the database schema
export type NotificationChannel = "in_app" | "email";

export type NotificationPriority = "low" | "normal" | "high" | "critical";

export type NotificationStatus =
    | "pending"
    | "queued"
    | "sent"
    | "delivered"
    | "read"
    | "failed"
    | "cancelled";

export type NotificationType =
// Retention & Risk Alerts
    | "athlete_at_risk"
    | "athlete_critical_risk"
    | "wellness_crisis"
    | "attendance_drop"
    | "checkin_lapse"
    | "pr_stagnation"

    // Business Operations
    | "subscription_reactivated"
    | "overage_billing_enabled"
    | "overage_billing_disabled"
    | "grace_period_resolved"
    | "plan_change_confirmed"
    | "plan_change_canceled"
    | "plan_change_requested"
    | "subscription_trial_ending"
    | "subscription_payment_failed"
    | "subscription_renewed"
    | "subscription_cancelled"
    | "plan_limit_approaching"
    | "plan_limit_exceeded"
    | "overage_charges"
    | "invoice_generated"

    // Coach Workflow
    | "intervention_due"
    | "intervention_overdue"
    | "pr_video_review_needed"
    | "athlete_needs_attention"
    | "wellness_summary_daily"
    | "new_member_approval"

    // Athlete Engagement
    | "streak_reminder"
    | "streak_broken"
    | "achievement_earned"
    | "badge_unlocked"
    | "pr_milestone"
    | "coach_feedback"
    | "community_recognition"
    | "progress_report_weekly"
    | "goal_approaching"

    // System & Admin
    | "system_alert"
    | "maintenance_scheduled"
    | "feature_announcement"
    | "billing_update";

export type NotificationCategory =
    | "retention"
    | "billing"
    | "engagement"
    | "workflow"
    | "system"
    | "social";

// Billing-specific notification data interfaces
export interface BillingNotificationData {
    boxId: string;
    amount?: number;
    formattedAmount?: string;
    dueDate?: Date;
    invoiceId?: string;
    subscriptionId?: string;
    planTier?: string;
    gracePeriodId?: string;
    reason?: string;
}

export interface LimitNotificationData {
    limitType: "athlete" | "coach";
    currentCount: number;
    limit: number;
    percentage: number;
    overage?: number;
    overageAmount?: number;
    planTier: string;
}

export interface PaymentNotificationData {
    amount: number;
    formattedAmount: string;
    invoiceId?: string;
    attemptNumber?: number;
    nextRetryDate?: Date;
    failureReason?: string;
}

// Webhook event interfaces
export interface WebhookEvent {
    id: string;
    type: string;
    data: any;
    timestamp: Date;
    boxId?: string;
}

export interface NotificationProcessingResult {
    notificationId: string;
    success: boolean;
    deliveries: Array<{
        deliveryId: string;
        channel: NotificationChannel;
        success: boolean;
        externalId?: string;
        error?: string;
    }>;
    error?: string;
}

// Template interfaces
export interface NotificationTemplate {
    id: string;
    templateId: string;
    type: NotificationType;
    channel: NotificationChannel;
    subject?: string;
    title: string;
    body: string;
    variables?: string[];
    isActive: boolean;
    boxId?: string;
}

export interface NotificationPreferences {
    userId: string;
    boxId?: string;
    enableInApp: boolean;
    enableEmail: boolean;
    enableRetention: boolean;
    enableBilling: boolean;
    enableEngagement: boolean;
    enableWorkflow: boolean;
    enableSystem: boolean;
    enableSocial: boolean;
    quietHoursStart?: number;
    quietHoursEnd?: number;
    timezone: string;
    maxDailyNotifications?: number;
    digestFrequency: string;
    digestTime: number;
    emailAddress?: string;
}

// Email service interfaces
export interface EmailTemplateData {
    recipientName: string;
    boxName: string;
    title: string;
    message: string;
    actionUrl?: string;
    actionLabel?: string;
    urgency: NotificationPriority;
    unsubscribeUrl?: string;
}

export interface EmailDeliveryResult {
    success: boolean;
    messageId?: string;
    externalId?: string;
    cost?: number;
    error?: string;
    response?: any;
}
