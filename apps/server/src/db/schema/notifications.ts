// db/schema/notifications.ts
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    uuid,
    index,
    unique,
    json,
    check,
    pgEnum
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { user } from "@/db/schema/auth";
import { boxes, boxMemberships } from "@/db/schema/core";

// Notification enums
export const notificationChannelEnum = pgEnum("notification_channel", [
    "in_app",
    "email"
]);

export const notificationPriorityEnum = pgEnum("notification_priority", [
    "low",
    "normal",
    "high",
    "critical"
]);

export const notificationStatusEnum = pgEnum("notification_status", [
    "pending",
    "queued",
    "sent",
    "delivered",
    "read",
    "failed",
    "cancelled"
]);

export const notificationTypeEnum = pgEnum("notification_type", [
    // Retention & Risk Alerts
    "athlete_at_risk",
    "athlete_critical_risk",
    "wellness_crisis",
    "attendance_drop",
    "checkin_lapse",
    "pr_stagnation",

    // Business Operations
    "subscription_trial_ending",
    "subscription_payment_failed",
    "subscription_renewed",
    "subscription_cancelled",
    "plan_limit_approaching",
    "plan_limit_exceeded",
    "overage_charges",
    "invoice_generated",

    // Coach Workflow
    "intervention_due",
    "intervention_overdue",
    "pr_video_review_needed",
    "athlete_needs_attention",
    "wellness_summary_daily",
    "new_member_approval",

    // Athlete Engagement
    "streak_reminder",
    "streak_broken",
    "achievement_earned",
    "badge_unlocked",
    "pr_milestone",
    "coach_feedback",
    "community_recognition",
    "progress_report_weekly",
    "goal_approaching",

    // System & Admin
    "system_alert",
    "maintenance_scheduled",
    "feature_announcement",
    "billing_update"
]);

export const notificationCategoryEnum = pgEnum("notification_category", [
    "retention",
    "billing",
    "engagement",
    "workflow",
    "system",
    "social"
]);

// Core notifications table
export const notifications = pgTable("notifications", {
    id: uuid("id").defaultRandom().primaryKey(),

    // Targeting
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }),

    // Notification metadata
    type: notificationTypeEnum("type").notNull(),
    category: notificationCategoryEnum("category").notNull(),
    priority: notificationPriorityEnum("priority").default("normal").notNull(),

    // Content
    title: text("title").notNull(),
    message: text("message").notNull(),
    actionUrl: text("action_url"),
    actionLabel: text("action_label"),

    // Rich content
    data: json("data"),
    templateId: text("template_id"),
    templateVariables: json("template_variables"),

    // Scheduling
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // Status tracking
    status: notificationStatusEnum("status").default("pending").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),

    // Error handling
    failureReason: text("failure_reason"),
    retryCount: integer("retry_count").default(0).notNull(),
    maxRetries: integer("max_retries").default(3).notNull(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),

    // Grouping and deduplication
    groupKey: text("group_key"),
    deduplicationKey: text("deduplication_key"),
    parentId: uuid("parent_id").references((): any => notifications.id),

    // Metadata
    source: text("source").default("system"),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Essential indexes for querying
    userStatusIdx: index("notifications_user_status_idx").on(table.userId, table.status),
    boxStatusIdx: index("notifications_box_status_idx").on(table.boxId, table.status),
    membershipStatusIdx: index("notifications_membership_status_idx").on(table.membershipId, table.status),

    // Scheduling and processing
    scheduledForIdx: index("notifications_scheduled_for_idx").on(table.scheduledFor),
    statusScheduledIdx: index("notifications_status_scheduled_idx").on(table.status, table.scheduledFor),
    retryIdx: index("notifications_retry_idx").on(table.nextRetryAt).where(sql`next_retry_at IS NOT NULL`),

    // Performance optimization
    typeBoxIdx: index("notifications_type_box_idx").on(table.type, table.boxId),
    categoryPriorityIdx: index("notifications_category_priority_idx").on(table.category, table.priority),
    expiresAtIdx: index("notifications_expires_at_idx").on(table.expiresAt),

    // Deduplication and grouping
    deduplicationIdx: index("notifications_deduplication_idx").on(table.deduplicationKey),
    groupKeyIdx: index("notifications_group_key_idx").on(table.groupKey),

    // Constraints
    retryCountPositive: check(
        "notifications_retry_count_positive",
        sql`${table.retryCount} >= 0`
    ),
    maxRetriesPositive: check(
        "notifications_max_retries_positive",
        sql`${table.maxRetries} >= 0`
    ),
}));

// Notification delivery channels - tracks multi-channel delivery
export const notificationDeliveries = pgTable("notification_deliveries", {
    id: uuid("id").defaultRandom().primaryKey(),
    notificationId: uuid("notification_id").references(() => notifications.id, { onDelete: "cascade" }).notNull(),

    // Channel details
    channel: notificationChannelEnum("channel").notNull(),
    recipient: text("recipient").notNull(),

    // Delivery tracking
    status: notificationStatusEnum("status").default("pending").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),

    // Channel-specific data
    externalId: text("external_id"),
    channelResponse: json("channel_response"),

    // Error handling
    failureReason: text("failure_reason"),
    retryCount: integer("retry_count").default(0).notNull(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),

    // Cost tracking
    cost: integer("cost"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Essential indexes
    notificationChannelIdx: index("notification_deliveries_notification_channel_idx").on(table.notificationId, table.channel),
    statusIdx: index("notification_deliveries_status_idx").on(table.status),
    channelRecipientIdx: index("notification_deliveries_channel_recipient_idx").on(table.channel, table.recipient),

    // Processing queues
    retryIdx: index("notification_deliveries_retry_idx").on(table.nextRetryAt).where(sql`next_retry_at IS NOT NULL`),

    // External tracking
    externalIdIdx: index("notification_deliveries_external_id_idx").on(table.externalId),

    // Unique constraint for deduplication
    notificationChannelUnique: unique("notification_deliveries_notification_channel_unique")
        .on(table.notificationId, table.channel, table.recipient),
}));

// User notification preferences
export const notificationPreferences = pgTable("notification_preferences", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }).notNull(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }),

    // Channel preferences
    enableInApp: boolean("enable_in_app").default(true).notNull(),
    enableEmail: boolean("enable_email").default(true).notNull(),

    // Category preferences
    enableRetention: boolean("enable_retention").default(true).notNull(),
    enableBilling: boolean("enable_billing").default(true).notNull(),
    enableEngagement: boolean("enable_engagement").default(true).notNull(),
    enableWorkflow: boolean("enable_workflow").default(true).notNull(),
    enableSystem: boolean("enable_system").default(false).notNull(),
    enableSocial: boolean("enable_social").default(true).notNull(),

    // Timing preferences
    quietHoursStart: integer("quiet_hours_start"),
    quietHoursEnd: integer("quiet_hours_end"),
    timezone: text("timezone").default("America/New_York").notNull(),

    // Frequency controls
    maxDailyNotifications: integer("max_daily_notifications").default(10),
    digestFrequency: text("digest_frequency").default("daily"),
    digestTime: integer("digest_time").default(9),

    // Contact methods
    emailAddress: text("email_address"),
    phoneNumber: text("phone_number"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    userBoxIdx: index("notification_preferences_user_box_idx").on(table.userId, table.boxId),
    userBoxUnique: unique("notification_preferences_user_box_unique").on(table.userId, table.boxId),

    // Constraints
    quietHoursValid: check(
        "notification_preferences_quiet_hours_valid",
        sql`(${table.quietHoursStart} IS NULL AND ${table.quietHoursEnd} IS NULL) OR 
            (${table.quietHoursStart} >= 0 AND ${table.quietHoursStart} <= 23 AND
            ${table.quietHoursEnd} >= 0 AND ${table.quietHoursEnd} <= 23)`
    ),
    digestTimeValid: check(
        "notification_preferences_digest_time_valid",
        sql`${table.digestTime} >= 0 AND ${table.digestTime} <= 23`
    ),
    maxNotificationsPositive: check(
        "notification_preferences_max_notifications_positive",
        sql`${table.maxDailyNotifications} >= 0`
    ),
}));

// Templates for consistent messaging
export const notificationTemplates = pgTable("notification_templates", {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: text("template_id").notNull().unique(),

    // Categorization
    type: notificationTypeEnum("type").notNull(),
    channel: notificationChannelEnum("channel").notNull(),

    // Content
    subject: text("subject"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    actionUrl: text("action_url"),
    actionLabel: text("action_label"),

    // Template metadata
    variables: json("variables"),
    isActive: boolean("is_active").default(true).notNull(),
    version: integer("version").default(1).notNull(),

    // Personalization
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    templateIdIdx: index("notification_templates_template_id_idx").on(table.templateId),
    typeChannelIdx: index("notification_templates_type_channel_idx").on(table.type, table.channel),
    boxActiveIdx: index("notification_templates_box_active_idx").on(table.boxId, table.isActive),
}));

// Notification rules for automated triggering
export const notificationRules = pgTable("notification_rules", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }),

    // Rule definition
    name: text("name").notNull(),
    description: text("description"),
    type: notificationTypeEnum("type").notNull(),

    // Trigger conditions
    triggerConditions: json("trigger_conditions").notNull(),
    targetRoles: json("target_roles"),

    // Scheduling
    isActive: boolean("is_active").default(true).notNull(),
    scheduleExpression: text("schedule_expression"),
    delayMinutes: integer("delay_minutes").default(0),

    // Rate limiting
    maxTriggersPerHour: integer("max_triggers_per_hour").default(10),
    maxTriggersPerDay: integer("max_triggers_per_day").default(100),

    // Template association
    templateId: text("template_id"),

    // Metadata
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    triggerCount: integer("trigger_count").default(0).notNull(),

    createdByUserId: text("created_by_user_id").references(() => user.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxActiveIdx: index("notification_rules_box_active_idx").on(table.boxId, table.isActive),
    typeIdx: index("notification_rules_type_idx").on(table.type),
    lastTriggeredIdx: index("notification_rules_last_triggered_idx").on(table.lastTriggeredAt),

    // Constraints
    delayMinutesPositive: check(
        "notification_rules_delay_minutes_positive",
        sql`${table.delayMinutes} >= 0`
    ),
    triggerLimitsPositive: check(
        "notification_rules_trigger_limits_positive",
        sql`${table.maxTriggersPerHour} > 0 AND ${table.maxTriggersPerDay} > 0`
    ),
}));

// Track notification rule executions and rate limiting
export const notificationRuleExecutions = pgTable("notification_rule_executions", {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id").references(() => notificationRules.id, { onDelete: "cascade" }).notNull(),

    // Execution context
    triggerData: json("trigger_data"),
    conditionResults: json("condition_results"),

    // Results
    notificationsCreated: integer("notifications_created").default(0).notNull(),
    executionTimeMs: integer("execution_time_ms"),
    success: boolean("success").notNull(),
    errorMessage: text("error_message"),

    executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    ruleExecutedIdx: index("notification_rule_executions_rule_executed_idx").on(table.ruleId, table.executedAt),
    successIdx: index("notification_rule_executions_success_idx").on(table.success),
}));

// Relations
export const notificationsRelations = relations(notifications, ({ one, many }) => ({
    box: one(boxes, {
        fields: [notifications.boxId],
        references: [boxes.id],
        relationName: "box_notifications"
    }),
    user: one(user, {
        fields: [notifications.userId],
        references: [user.id],
        relationName: "user_notifications"
    }),
    membership: one(boxMemberships, {
        fields: [notifications.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_notifications"
    }),
    createdBy: one(user, {
        fields: [notifications.createdByUserId],
        references: [user.id],
        relationName: "user_created_notifications"
    }),
    parent: one(notifications, {
        fields: [notifications.parentId],
        references: [notifications.id],
        relationName: "notification_thread"
    }),
    deliveries: many(notificationDeliveries, { relationName: "notification_deliveries" }),
    children: many(notifications, { relationName: "notification_thread" }),
}));

export const notificationDeliveriesRelations = relations(notificationDeliveries, ({ one }) => ({
    notification: one(notifications, {
        fields: [notificationDeliveries.notificationId],
        references: [notifications.id],
        relationName: "notification_deliveries"
    }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
    user: one(user, {
        fields: [notificationPreferences.userId],
        references: [user.id],
        relationName: "user_notification_preferences"
    }),
    box: one(boxes, {
        fields: [notificationPreferences.boxId],
        references: [boxes.id],
        relationName: "box_notification_preferences"
    }),
}));

export const notificationTemplatesRelations = relations(notificationTemplates, ({ one }) => ({
    box: one(boxes, {
        fields: [notificationTemplates.boxId],
        references: [boxes.id],
        relationName: "box_notification_templates"
    }),
}));

export const notificationRulesRelations = relations(notificationRules, ({ one, many }) => ({
    box: one(boxes, {
        fields: [notificationRules.boxId],
        references: [boxes.id],
        relationName: "box_notification_rules"
    }),
    createdBy: one(user, {
        fields: [notificationRules.createdByUserId],
        references: [user.id],
        relationName: "user_created_notification_rules"
    }),
    executions: many(notificationRuleExecutions, { relationName: "rule_executions" }),
}));

export const notificationRuleExecutionsRelations = relations(notificationRuleExecutions, ({ one }) => ({
    rule: one(notificationRules, {
        fields: [notificationRuleExecutions.ruleId],
        references: [notificationRules.id],
        relationName: "rule_executions"
    }),
}));
