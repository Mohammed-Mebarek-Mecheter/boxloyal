// db/schema/billing.ts - Enhanced version with consistency fixes and proper constraints
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    uuid,
    index,
    json,
    check,
    unique
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { boxes } from "./core";

// ENHANCED: Billing events from Polar with better error handling
export const billingEvents = pgTable("billing_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Event details
    eventType: text("event_type").notNull(), // "subscription.created", "subscription.updated", etc.
    polarEventId: text("polar_event_id").notNull().unique(),
    data: json("data").notNull(), // Raw event data from Polar (changed from text to json)

    // Processing status - enhanced
    processed: boolean("processed").default(false).notNull(),
    processingError: text("processing_error"),
    retryCount: integer("retry_count").default(0).notNull(),
    maxRetries: integer("max_retries").default(3).notNull(),

    // Timestamps - consistent naming
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
}, (table) => ({
    boxIdIdx: index("billing_events_box_id_idx").on(table.boxId),
    eventTypeIdx: index("billing_events_event_type_idx").on(table.eventType),
    polarEventIdx: index("billing_events_polar_event_idx").on(table.polarEventId),
    processedIdx: index("billing_events_processed_idx").on(table.processed),
    createdAtIdx: index("billing_events_created_at_idx").on(table.createdAt),
    retryCountIdx: index("billing_events_retry_count_idx").on(table.retryCount),
    nextRetryAtIdx: index("billing_events_next_retry_at_idx").on(table.nextRetryAt),
    // Composite indexes for processing
    unprocessedIdx: index("billing_events_unprocessed_idx").on(table.processed, table.createdAt)
        .where(sql`processed = false`),
    retryableIdx: index("billing_events_retryable_idx").on(table.processed, table.retryCount, table.nextRetryAt)
        .where(sql`processed = false AND retry_count < max_retries AND next_retry_at <= NOW()`),
    // Constraints
    retryCountPositive: check(
        "billing_events_retry_count_positive",
        sql`${table.retryCount} >= 0`
    ),
    maxRetriesPositive: check(
        "billing_events_max_retries_positive",
        sql`${table.maxRetries} >= 1`
    ),
    retryCountWithinMax: check(
        "billing_events_retry_count_within_max",
        sql`${table.retryCount} <= ${table.maxRetries}`
    ),
}));

// ENHANCED: Subscription plans and pricing
export const subscriptionPlans = pgTable("subscription_plans", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    tier: text("tier").notNull(), // "seed", "grow", "scale"

    // Limits - enhanced with proper constraints
    athleteLimit: integer("athlete_limit").notNull(), // Athletes limit
    coachLimit: integer("coach_limit").notNull(),

    // Pricing in cents - enhanced
    monthlyPrice: integer("monthly_price").notNull(), // in cents
    annualPrice: integer("annual_price").notNull(), // in cents
    annualDiscount: integer("annual_discount_percent"), // e.g., 20 for 20% off
    athleteOveragePrice: integer("athlete_overage_price").default(100), // $1 in cents
    coachOveragePrice: integer("coach_overage_price").default(100), // $1 in cents
    onboardingPrice: integer("onboarding_price").default(29900), // $299 in cents

    // Features
    features: json("features").notNull(), // JSON array of features (changed from text)

    // Status
    isActive: boolean("is_active").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),

    // Display order
    displayOrder: integer("display_order").default(0).notNull(),

    // Polar integration
    polarProductId: text("polar_product_id").unique(), // Monthly product ID
    polarAnnualProductId: text("polar_annual_product_id").unique(), // Annual product ID

    // Timestamps - consistent naming
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    tierIdx: index("subscription_plans_tier_idx").on(table.tier),
    activeIdx: index("subscription_plans_active_idx").on(table.isActive),
    defaultIdx: index("subscription_plans_default_idx").on(table.isDefault),
    displayOrderIdx: index("subscription_plans_display_order_idx").on(table.displayOrder),
    polarProductIdx: index("subscription_plans_polar_product_idx").on(table.polarProductId),
    polarAnnualProductIdx: index("subscription_plans_polar_annual_product_idx").on(table.polarAnnualProductId),
    // Composite indexes
    activeTierIdx: index("subscription_plans_active_tier_idx").on(table.isActive, table.tier),
    activeDisplayIdx: index("subscription_plans_active_display_idx").on(table.isActive, table.displayOrder),
    // Constraints
    athleteLimitPositive: check(
        "subscription_plans_athlete_limit_positive",
        sql`${table.athleteLimit} > 0`
    ),
    coachLimitPositive: check(
        "subscription_plans_coach_limit_positive",
        sql`${table.coachLimit} > 0`
    ),
    monthlyPricePositive: check(
        "subscription_plans_monthly_price_positive",
        sql`${table.monthlyPrice} >= 0`
    ),
    annualPricePositive: check(
        "subscription_plans_annual_price_positive",
        sql`${table.annualPrice} >= 0`
    ),
    annualDiscountRange: check(
        "subscription_plans_annual_discount_range",
        sql`${table.annualDiscount} >= 0 AND ${table.annualDiscount} <= 100`
    ),
    displayOrderPositive: check(
        "subscription_plans_display_order_positive",
        sql`${table.displayOrder} >= 0`
    ),
    // Ensure only one default plan
    uniqueDefaultPlan: unique("subscription_plans_unique_default").on(table.isDefault),
}));

// ENHANCED: Customer billing profiles (link to Polar customers)
export const customerProfiles = pgTable("customer_profiles", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Polar customer details
    polarCustomerId: text("polar_customer_id").notNull().unique(),
    email: text("email").notNull(),
    name: text("name"),

    // Billing details
    billingAddress: json("billing_address"), // Address object
    taxId: text("tax_id"),

    // Enhanced fields
    currency: text("currency").default("USD").notNull(),
    timezone: text("timezone"),

    // Status
    isActive: boolean("is_active").default(true).notNull(),

    // Timestamps - consistent naming
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("customer_profiles_box_id_idx").on(table.boxId),
    polarCustomerIdx: index("customer_profiles_polar_customer_idx").on(table.polarCustomerId),
    emailIdx: index("customer_profiles_email_idx").on(table.email),
    isActiveIdx: index("customer_profiles_is_active_idx").on(table.isActive),
    // Composite indexes
    boxActiveIdx: index("customer_profiles_box_active_idx").on(table.boxId, table.isActive),
}));

// ENHANCED: Subscription records (sync from Polar) with proper foreign key to plans
export const subscriptions = pgTable("subscriptions", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    customerProfileId: uuid("customer_profile_id").references(() => customerProfiles.id, { onDelete: "cascade" }).notNull(),

    // Polar subscription details
    polarSubscriptionId: text("polar_subscription_id").notNull().unique(),
    polarProductId: text("polar_product_id").notNull(),

    // Subscription state - FIXED: reference plan ID instead of tier text
    planId: uuid("plan_id").references(() => subscriptionPlans.id).notNull(),
    status: text("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"), // Enhanced: track cancellation reason

    // Pricing
    currency: text("currency").notNull(),
    amount: integer("amount").notNull(), // in cents
    interval: text("interval").notNull(), // "month", "year"

    // Enhanced trial handling
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    isInTrial: boolean("is_in_trial").default(false).notNull(),

    // Metadata
    metadata: json("metadata"),

    // Sync tracking
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).defaultNow().notNull(),

    // Timestamps - consistent naming
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("subscriptions_box_id_idx").on(table.boxId),
    polarSubscriptionIdx: index("subscriptions_polar_subscription_idx").on(table.polarSubscriptionId),
    statusIdx: index("subscriptions_status_idx").on(table.status),
    currentPeriodEndIdx: index("subscriptions_current_period_end_idx").on(table.currentPeriodEnd),
    planIdIdx: index("subscriptions_plan_id_idx").on(table.planId),
    cancelAtPeriodEndIdx: index("subscriptions_cancel_at_period_end_idx").on(table.cancelAtPeriodEnd),
    customerProfileIdIdx: index("subscriptions_customer_profile_id_idx").on(table.customerProfileId),
    isInTrialIdx: index("subscriptions_is_in_trial_idx").on(table.isInTrial),
    intervalIdx: index("subscriptions_interval_idx").on(table.interval),
    lastSyncedAtIdx: index("subscriptions_last_synced_at_idx").on(table.lastSyncedAt),
    trialEndIdx: index("subscriptions_trial_end_idx").on(table.trialEnd),
    // Composite indexes for common queries
    boxStatusIdx: index("subscriptions_box_status_idx").on(table.boxId, table.status),
    activeCancellingIdx: index("subscriptions_active_cancelling_idx").on(
        table.status, table.cancelAtPeriodEnd).where(sql`status = 'active' AND cancel_at_period_end = true`),
    expiringTrialsIdx: index("subscriptions_expiring_trials_idx").on(table.trialEnd, table.isInTrial)
        .where(sql`is_in_trial = true AND trial_end <= NOW() + INTERVAL '7 days'`),
    // Constraints
    amountPositive: check(
        "subscriptions_amount_positive",
        sql`${table.amount} > 0`
    ),
}));

// ENHANCED: Orders/payments tracking
export const orders = pgTable("orders", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    customerProfileId: uuid("customer_profile_id").references(() => customerProfiles.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),

    // Polar order details
    polarOrderId: text("polar_order_id").notNull().unique(),
    polarProductId: text("polar_product_id").notNull(),

    // Order state
    status: text("status").notNull(), // "paid", "refunded", "failed", etc.
    amount: integer("amount").notNull(), // in cents
    currency: text("currency").notNull(),

    // Enhanced payment details
    paymentMethod: text("payment_method"), // "card", "bank_transfer", etc.
    paymentProvider: text("payment_provider"), // "stripe", "paypal", etc.

    // Timestamps - enhanced and consistent naming
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),

    // Metadata
    metadata: json("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("orders_box_id_idx").on(table.boxId),
    polarOrderIdx: index("orders_polar_order_idx").on(table.polarOrderId),
    statusIdx: index("orders_status_idx").on(table.status),
    paidAtIdx: index("orders_paid_at_idx").on(table.paidAt),
    customerProfileIdIdx: index("orders_customer_profile_id_idx").on(table.customerProfileId),
    subscriptionIdIdx: index("orders_subscription_id_idx").on(table.subscriptionId),
    paymentMethodIdx: index("orders_payment_method_idx").on(table.paymentMethod),
    createdAtIdx: index("orders_created_at_idx").on(table.createdAt),
    // Composite indexes for reporting
    boxStatusDateIdx: index("orders_box_status_date_idx").on(table.boxId, table.status, table.createdAt),
    subscriptionStatusIdx: index("orders_subscription_status_idx").on(table.subscriptionId, table.status),
    // Constraints
    amountPositive: check(
        "orders_amount_positive",
        sql`${table.amount} > 0`
    ),
}));

// ENHANCED: Grace period tracking for over-limit scenarios
export const gracePeriods = pgTable("grace_periods", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Grace period details
    reason: text("reason").notNull(), // "athlete_limit_exceeded", "trial_ending", etc.
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),

    // Enhanced tracking
    warningsSent: integer("warnings_sent").default(0).notNull(),
    lastWarningSentAt: timestamp("last_warning_sent_at", { withTimezone: true }),

    // Resolution
    resolved: boolean("resolved").default(false).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"), // "upgraded", "downgraded", "athletes_removed", etc.

    // Enhanced metadata
    metadata: json("metadata"), // Additional context
    autoResolved: boolean("auto_resolved").default(false).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("grace_periods_box_id_idx").on(table.boxId),
    endsAtIdx: index("grace_periods_ends_at_idx").on(table.endsAt),
    resolvedIdx: index("grace_periods_resolved_idx").on(table.resolved),
    reasonIdx: index("grace_periods_reason_idx").on(table.reason),
    notifiedAtIdx: index("grace_periods_notified_at_idx").on(table.notifiedAt),
    // Composite indexes for processing
    unresolvedExpiringIdx: index("grace_periods_unresolved_expiring_idx").on(
        table.resolved, table.endsAt).where(sql`resolved = false AND ends_at <= NOW() + INTERVAL '1 day'`),
    boxActiveIdx: index("grace_periods_box_active_idx").on(table.boxId, table.resolved)
        .where(sql`resolved = false`),
    // Constraints
    warningsSentPositive: check(
        "grace_periods_warnings_sent_positive",
        sql`${table.warningsSent} >= 0`
    ),
}));

// ENHANCED: Usage tracking for potential usage-based billing
export const usageEvents = pgTable("usage_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Event details
    eventType: text("event_type").notNull(), // "athlete_added", "checkin_logged", etc.
    quantity: integer("quantity").default(1).notNull(),

    // Enhanced tracking
    entityId: uuid("entity_id"), // ID of related entity (membershipId, prId, etc.)
    entityType: text("entity_type"), // "membership", "pr", "checkin", etc.

    metadata: json("metadata"),

    // Polar integration
    polarEventId: text("polar_event_id"), // If sent to Polar for usage billing

    // Billing period association
    billingPeriodStart: timestamp("billing_period_start", { withTimezone: true }),
    billingPeriodEnd: timestamp("billing_period_end", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("usage_events_box_id_idx").on(table.boxId),
    eventTypeIdx: index("usage_events_event_type_idx").on(table.eventType),
    createdAtIdx: index("usage_events_created_at_idx").on(table.createdAt),
    entityIdIdx: index("usage_events_entity_id_idx").on(table.entityId),
    entityTypeIdx: index("usage_events_entity_type_idx").on(table.entityType),
    polarEventIdIdx: index("usage_events_polar_event_id_idx").on(table.polarEventId),
    billingPeriodStartIdx: index("usage_events_billing_period_start_idx").on(table.billingPeriodStart),
    // Composite indexes for billing aggregation
    boxEventTypePeriodIdx: index("usage_events_box_event_type_period_idx").on(
        table.boxId, table.eventType, table.billingPeriodStart),
    billingPeriodIdx: index("usage_events_billing_period_idx").on(
        table.billingPeriodStart, table.billingPeriodEnd),
    // Constraints
    quantityPositive: check(
        "usage_events_quantity_positive",
        sql`${table.quantity} > 0`
    ),
}));

// Relations - Enhanced with proper naming and relationship clarification
export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
    box: one(boxes, {
        fields: [billingEvents.boxId],
        references: [boxes.id],
        relationName: "box_billing_events"
    }),
}));

export const subscriptionPlansRelations = relations(subscriptionPlans, ({ many }) => ({
    subscriptions: many(subscriptions, { relationName: "plan_subscriptions" }),
}));

export const customerProfilesRelations = relations(customerProfiles, ({ one, many }) => ({
    box: one(boxes, {
        fields: [customerProfiles.boxId],
        references: [boxes.id],
        relationName: "box_customer_profiles"
    }),
    subscriptions: many(subscriptions, { relationName: "customer_subscriptions" }),
    orders: many(orders, { relationName: "customer_orders" }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
    box: one(boxes, {
        fields: [subscriptions.boxId],
        references: [boxes.id],
        relationName: "box_subscriptions"
    }),
    customerProfile: one(customerProfiles, {
        fields: [subscriptions.customerProfileId],
        references: [customerProfiles.id],
        relationName: "customer_subscriptions"
    }),
    plan: one(subscriptionPlans, {
        fields: [subscriptions.planId],
        references: [subscriptionPlans.id],
        relationName: "plan_subscriptions"
    }),
    orders: many(orders, { relationName: "subscription_orders" }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
    box: one(boxes, {
        fields: [orders.boxId],
        references: [boxes.id],
        relationName: "box_orders"
    }),
    customerProfile: one(customerProfiles, {
        fields: [orders.customerProfileId],
        references: [customerProfiles.id],
        relationName: "customer_orders"
    }),
    subscription: one(subscriptions, {
        fields: [orders.subscriptionId],
        references: [subscriptions.id],
        relationName: "subscription_orders"
    }),
}));

export const gracePeriodsRelations = relations(gracePeriods, ({ one }) => ({
    box: one(boxes, {
        fields: [gracePeriods.boxId],
        references: [boxes.id],
        relationName: "box_grace_periods"
    }),
}));

export const usageEventsRelations = relations(usageEvents, ({ one }) => ({
    box: one(boxes, {
        fields: [usageEvents.boxId],
        references: [boxes.id],
        relationName: "box_usage_events"
    }),
}));
