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

    // Event details - Enhanced
    eventType: text("event_type").notNull(), // "subscription.created", "subscription.updated", etc.
    polarEventId: text("polar_event_id").notNull().unique(),
    data: json("data").notNull(), // Raw event data from Polar

    // NEW: Event processing status with enum
    status: text("status").default("pending").notNull(), // pending, processing, processed, failed, skipped

    // Enhanced processing tracking
    processed: boolean("processed").default(false).notNull(), // Legacy field for backward compatibility
    processingError: text("processing_error"),
    processingStackTrace: text("processing_stack_trace"), // For debugging
    retryCount: integer("retry_count").default(0).notNull(),
    maxRetries: integer("max_retries").default(3).notNull(),

    // Enhanced timing and priority
    priority: integer("priority").default(0).notNull(), // Higher numbers = higher priority
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }), // For delayed processing

    // Timestamps - consistent naming
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
}, (table) => ({
    boxIdIdx: index("billing_events_box_id_idx").on(table.boxId),
    eventTypeIdx: index("billing_events_event_type_idx").on(table.eventType),
    polarEventIdx: index("billing_events_polar_event_idx").on(table.polarEventId),
    statusIdx: index("billing_events_status_idx").on(table.status),
    processedIdx: index("billing_events_processed_idx").on(table.processed),
    createdAtIdx: index("billing_events_created_at_idx").on(table.createdAt),
    retryCountIdx: index("billing_events_retry_count_idx").on(table.retryCount),
    nextRetryAtIdx: index("billing_events_next_retry_at_idx").on(table.nextRetryAt),
    priorityIdx: index("billing_events_priority_idx").on(table.priority),
    scheduledForIdx: index("billing_events_scheduled_for_idx").on(table.scheduledFor),

    // NEW: Critical composite indexes for processing queues
    pendingProcessingIdx: index("billing_events_pending_processing_idx")
        .on(table.status, table.priority, table.scheduledFor)
        .where(sql`status = 'pending' AND (scheduled_for IS NULL OR scheduled_for <= NOW())`),
    retryableIdx: index("billing_events_retryable_idx")
        .on(table.status, table.retryCount, table.nextRetryAt)
        .where(sql`status = 'failed' AND retry_count < max_retries AND next_retry_at <= NOW()`),
    unprocessedIdx: index("billing_events_unprocessed_idx")
        .on(table.processed, table.createdAt)
        .where(sql`processed = false`),

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
    priorityRange: check(
        "billing_events_priority_range",
        sql`${table.priority} >= 0 AND ${table.priority} <= 100`
    ),
}));

// ENHANCED: Subscription plans with comprehensive pricing and limits
export const subscriptionPlans = pgTable("subscription_plans", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    tier: text("tier").notNull(), // "seed", "grow", "scale"

    // NEW: Plan versioning for grandfathering
    version: integer("version").default(1).notNull(),
    isCurrentVersion: boolean("is_current_version").default(true).notNull(),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),

    // Limits - enhanced with proper constraints
    athleteLimit: integer("athlete_limit").notNull(),
    coachLimit: integer("coach_limit").notNull(),

    // NEW: Feature limits
    advancedAnalytics: boolean("advanced_analytics").default(false).notNull(),
    apiAccess: boolean("api_access").default(false).notNull(),
    whiteLabel: boolean("white_label").default(false).notNull(),
    customReports: boolean("custom_reports").default(false).notNull(),
    unlimitedUsers: boolean("unlimited_users").default(false).notNull(),

    // Pricing in cents - enhanced with annual options
    monthlyPrice: integer("monthly_price").notNull(), // in cents
    annualPrice: integer("annual_price").notNull(), // in cents
    annualDiscountPercent: integer("annual_discount_percent").default(20), // e.g., 20 for 20% off

    // NEW: Overage pricing
    athleteOveragePrice: integer("athlete_overage_price").default(100).notNull(), // $1.00 in cents
    coachOveragePrice: integer("coach_overage_price").default(100).notNull(), // $1.00 in cents

    // NEW: One-time fees
    onboardingPrice: integer("onboarding_price").default(29900), // $299 in cents
    setupFee: integer("setup_fee").default(0), // in cents

    // NEW: Trial configuration
    trialDays: integer("trial_days").default(14).notNull(),
    trialRequiresCreditCard: boolean("trial_requires_credit_card").default(false).notNull(),

    // Features - enhanced
    features: json("features").notNull(), // JSON array of feature objects
    featureLimits: json("feature_limits"), // Specific numeric limits per feature

    // Status and visibility
    isActive: boolean("is_active").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    isPublic: boolean("is_public").default(true).notNull(), // Can be shown on pricing page

    // Display and marketing
    displayOrder: integer("display_order").default(0).notNull(),
    marketingCopy: text("marketing_copy"), // "Most popular", "Best value", etc.
    description: text("description"),

    // Polar integration - enhanced
    polarProductId: text("polar_product_id").unique(), // Monthly product ID
    polarAnnualProductId: text("polar_annual_product_id").unique(), // Annual product ID
    polarOnboardingProductId: text("polar_onboarding_product_id").unique(), // One-time onboarding

    // Timestamps - consistent naming
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    tierIdx: index("subscription_plans_tier_idx").on(table.tier),
    versionIdx: index("subscription_plans_version_idx").on(table.version),
    activeIdx: index("subscription_plans_active_idx").on(table.isActive),
    currentVersionIdx: index("subscription_plans_current_version_idx").on(table.isCurrentVersion),
    defaultIdx: index("subscription_plans_default_idx").on(table.isDefault),
    publicIdx: index("subscription_plans_public_idx").on(table.isPublic),
    displayOrderIdx: index("subscription_plans_display_order_idx").on(table.displayOrder),
    polarProductIdx: index("subscription_plans_polar_product_idx").on(table.polarProductId),
    polarAnnualProductIdx: index("subscription_plans_polar_annual_product_idx").on(table.polarAnnualProductId),

    // NEW: Composite indexes for pricing queries
    activeTierIdx: index("subscription_plans_active_tier_idx").on(table.isActive, table.tier),
    activeDisplayIdx: index("subscription_plans_active_display_idx").on(table.isActive, table.displayOrder),
    publicActiveIdx: index("subscription_plans_public_active_idx").on(table.isPublic, table.isActive),
    tierVersionIdx: index("subscription_plans_tier_version_idx").on(table.tier, table.version),

    // Constraints
    athleteLimitPositive: check(
        "subscription_plans_athlete_limit_positive",
        sql`${table.athleteLimit} > 0 OR ${table.unlimitedUsers} = true`
    ),
    coachLimitPositive: check(
        "subscription_plans_coach_limit_positive",
        sql`${table.coachLimit} > 0 OR ${table.unlimitedUsers} = true`
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
        sql`${table.annualDiscountPercent} >= 0 AND ${table.annualDiscountPercent} <= 100`
    ),
    overagePricePositive: check(
        "subscription_plans_overage_price_positive",
        sql`${table.athleteOveragePrice} >= 0 AND ${table.coachOveragePrice} >= 0`
    ),
    versionPositive: check(
        "subscription_plans_version_positive",
        sql`${table.version} >= 1`
    ),
    trialDaysPositive: check(
        "subscription_plans_trial_days_positive",
        sql`${table.trialDays} >= 0`
    ),
    displayOrderPositive: check(
        "subscription_plans_display_order_positive",
        sql`${table.displayOrder} >= 0`
    ),

    // Ensure only one default plan per tier
    uniqueDefaultPerTier: unique("subscription_plans_unique_default_per_tier").on(table.tier, table.isDefault),
}));

// ENHANCED: Customer billing profiles (link to Polar customers)
export const customerProfiles = pgTable("customer_profiles", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Polar customer details
    polarCustomerId: text("polar_customer_id").notNull().unique(),
    email: text("email").notNull(),
    name: text("name"),

    // Billing details - enhanced
    billingAddress: json("billing_address"), // Address object
    taxId: text("tax_id"),

    // NEW: Enhanced billing preferences
    currency: text("currency").default("USD").notNull(),
    timezone: text("timezone").default("America/New_York").notNull(),
    preferredPaymentMethod: text("preferred_payment_method"), // "card", "bank_transfer", etc.
    billingEmail: text("billing_email"), // Different from primary email if needed

    // NEW: Communication preferences
    emailNotifications: boolean("email_notifications").default(true).notNull(),
    invoiceReminders: boolean("invoice_reminders").default(true).notNull(),
    marketingEmails: boolean("marketing_emails").default(true).notNull(),

    // Status and sync tracking
    isActive: boolean("is_active").default(true).notNull(),
    lastPolarSyncAt: timestamp("last_polar_sync_at", { withTimezone: true }),
    polarSyncError: text("polar_sync_error"),

    // Timestamps - consistent naming
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("customer_profiles_box_id_idx").on(table.boxId),
    polarCustomerIdx: index("customer_profiles_polar_customer_idx").on(table.polarCustomerId),
    emailIdx: index("customer_profiles_email_idx").on(table.email),
    isActiveIdx: index("customer_profiles_is_active_idx").on(table.isActive),
    lastSyncIdx: index("customer_profiles_last_sync_idx").on(table.lastPolarSyncAt),

    // Composite indexes
    boxActiveIdx: index("customer_profiles_box_active_idx").on(table.boxId, table.isActive),
}));

// ENHANCED: Subscription records with comprehensive change tracking
export const subscriptions = pgTable("subscriptions", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    customerProfileId: uuid("customer_profile_id").references(() => customerProfiles.id, { onDelete: "cascade" }).notNull(),

    // Polar subscription details
    polarSubscriptionId: text("polar_subscription_id").notNull().unique(),
    polarProductId: text("polar_product_id").notNull(),

    // NEW: Plan reference and versioning
    planId: uuid("plan_id").references(() => subscriptionPlans.id).notNull(),
    planVersion: integer("plan_version").notNull(), // Lock in the plan version when subscribed

    // Subscription state - enhanced
    status: text("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),

    // NEW: Enhanced cancellation tracking
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"), // "customer_request", "payment_failed", etc.
    canceledByUserId: text("canceled_by_user_id"), // Who initiated the cancellation

    // NEW: Pause/resume functionality
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pauseReason: text("pause_reason"),
    resumesAt: timestamp("resumes_at", { withTimezone: true }),

    // Pricing - enhanced
    currency: text("currency").notNull(),
    amount: integer("amount").notNull(), // in cents
    interval: text("interval").notNull(), // "month", "year"
    intervalCount: integer("interval_count").default(1).notNull(), // e.g., 3 for quarterly

    // NEW: Enhanced trial handling
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    isInTrial: boolean("is_in_trial").default(false).notNull(),
    trialExtendedDays: integer("trial_extended_days").default(0).notNull(), // Manual extensions

    // NEW: Billing and usage tracking
    nextBillingDate: timestamp("next_billing_date", { withTimezone: true }),
    lastBilledAt: timestamp("last_billed_at", { withTimezone: true }),
    overageEnabled: boolean("overage_enabled").default(false).notNull(),

    // NEW: Discounts and promotions
    discountCode: text("discount_code"),
    discountAmount: integer("discount_amount"), // in cents
    discountPercent: integer("discount_percent"), // in basis points
    discountEndsAt: timestamp("discount_ends_at", { withTimezone: true }),

    // Metadata and sync tracking
    metadata: json("metadata"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).defaultNow().notNull(),
    syncError: text("sync_error"),

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
    nextBillingDateIdx: index("subscriptions_next_billing_date_idx").on(table.nextBillingDate),
    overageEnabledIdx: index("subscriptions_overage_enabled_idx").on(table.overageEnabled),

    // NEW: Critical composite indexes
    boxStatusIdx: index("subscriptions_box_status_idx").on(table.boxId, table.status),
    activeCancellingIdx: index("subscriptions_active_cancelling_idx")
        .on(table.status, table.cancelAtPeriodEnd)
        .where(sql`status = 'active' AND cancel_at_period_end = true`),
    expiringTrialsIdx: index("subscriptions_expiring_trials_idx")
        .on(table.trialEnd, table.isInTrial)
        .where(sql`is_in_trial = true AND trial_end <= NOW() + INTERVAL '7 days'`),
    upcomingBillingIdx: index("subscriptions_upcoming_billing_idx")
        .on(table.nextBillingDate, table.status)
        .where(sql`status = 'active' AND next_billing_date <= NOW() + INTERVAL '3 days'`),

    // Constraints
    amountPositive: check(
        "subscriptions_amount_positive",
        sql`${table.amount} > 0`
    ),
    intervalCountPositive: check(
        "subscriptions_interval_count_positive",
        sql`${table.intervalCount} >= 1`
    ),
    trialExtendedDaysPositive: check(
        "subscriptions_trial_extended_days_positive",
        sql`${table.trialExtendedDays} >= 0`
    ),
    discountPercentRange: check(
        "subscriptions_discount_percent_range",
        sql`${table.discountPercent} >= 0 AND ${table.discountPercent} <= 10000` // 100% in basis points
    ),
}));

// NEW: Subscription change history for analytics and debugging
export const subscriptionChanges = pgTable("subscription_changes", {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "cascade" }).notNull(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Change details
    changeType: text("change_type").notNull(), // "created", "upgraded", "downgraded", "canceled", etc.
    fromPlanId: uuid("from_plan_id").references(() => subscriptionPlans.id),
    toPlanId: uuid("to_plan_id").references(() => subscriptionPlans.id),

    // Financial impact
    proratedAmount: integer("prorated_amount"), // in cents, can be negative for downgrades
    effectiveDate: timestamp("effective_date", { withTimezone: true }).notNull(),

    // Context
    reason: text("reason"), // Why the change happened
    triggeredByUserId: text("triggered_by_user_id"), // Who made the change
    automatedTrigger: text("automated_trigger"), // e.g., "trial_ended", "payment_failed"

    // Related records
    polarEventId: text("polar_event_id"), // Link to the Polar event that caused this
    relatedOrderId: uuid("related_order_id"), // If an order was created

    // Metadata
    metadata: json("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    subscriptionIdIdx: index("subscription_changes_subscription_id_idx").on(table.subscriptionId),
    boxIdIdx: index("subscription_changes_box_id_idx").on(table.boxId),
    changeTypeIdx: index("subscription_changes_change_type_idx").on(table.changeType),
    effectiveDateIdx: index("subscription_changes_effective_date_idx").on(table.effectiveDate),
    triggeredByIdx: index("subscription_changes_triggered_by_idx").on(table.triggeredByUserId),

    // Composite indexes for reporting
    subscriptionTypeIdx: index("subscription_changes_subscription_type_idx").on(table.subscriptionId, table.changeType),
    boxTypeIdx: index("subscription_changes_box_type_idx").on(table.boxId, table.changeType),
}));

// NEW: Overage billing records - critical for usage-based billing
export const overageBilling = pgTable("overage_billing", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "cascade" }).notNull(),

    // Billing period
    billingPeriodStart: timestamp("billing_period_start", { withTimezone: true }).notNull(),
    billingPeriodEnd: timestamp("billing_period_end", { withTimezone: true }).notNull(),

    // Usage calculations
    athleteLimit: integer("athlete_limit").notNull(), // Plan limit at time of calculation
    coachLimit: integer("coach_limit").notNull(),
    athleteCount: integer("athlete_count").notNull(), // Actual usage
    coachCount: integer("coach_count").notNull(),

    // Overage calculations
    athleteOverage: integer("athlete_overage").default(0).notNull(), // Athletes over limit
    coachOverage: integer("coach_overage").default(0).notNull(), // Coaches over limit
    athleteOverageRate: integer("athlete_overage_rate").notNull(), // Rate per athlete in cents
    coachOverageRate: integer("coach_overage_rate").notNull(), // Rate per coach in cents

    // Financial calculations
    athleteOverageAmount: integer("athlete_overage_amount").default(0).notNull(), // in cents
    coachOverageAmount: integer("coach_overage_amount").default(0).notNull(), // in cents
    totalOverageAmount: integer("total_overage_amount").default(0).notNull(), // in cents

    // Status and processing
    status: text("status").default("calculated").notNull(), // calculated, invoiced, paid, failed, waived

    // Polar integration
    polarInvoiceId: text("polar_invoice_id").unique(), // Invoice created in Polar
    polarPaymentStatus: text("polar_payment_status"), // paid, pending, failed
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    // Waiver/adjustment tracking
    waivedAmount: integer("waived_amount").default(0).notNull(), // in cents
    waivedReason: text("waived_reason"),
    waivedByUserId: text("waived_by_user_id"),
    waivedAt: timestamp("waived_at", { withTimezone: true }),

    // Error tracking
    billingError: text("billing_error"),
    retryCount: integer("retry_count").default(0).notNull(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),

    // Metadata
    calculationMethod: text("calculation_method").default("end_of_period").notNull(), // How usage was calculated
    metadata: json("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("overage_billing_box_id_idx").on(table.boxId),
    subscriptionIdIdx: index("overage_billing_subscription_id_idx").on(table.subscriptionId),
    statusIdx: index("overage_billing_status_idx").on(table.status),
    billingPeriodStartIdx: index("overage_billing_period_start_idx").on(table.billingPeriodStart),
    billingPeriodEndIdx: index("overage_billing_period_end_idx").on(table.billingPeriodEnd),
    polarInvoiceIdx: index("overage_billing_polar_invoice_idx").on(table.polarInvoiceId),
    invoicedAtIdx: index("overage_billing_invoiced_at_idx").on(table.invoicedAt),
    paidAtIdx: index("overage_billing_paid_at_idx").on(table.paidAt),

    // Critical composite indexes for processing
    pendingInvoiceIdx: index("overage_billing_pending_invoice_idx")
        .on(table.status, table.totalOverageAmount)
        .where(sql`status = 'calculated' AND total_overage_amount > 0`),
    retryableIdx: index("overage_billing_retryable_idx")
        .on(table.status, table.retryCount, table.nextRetryAt)
        .where(sql`status = 'failed' AND retry_count < 3 AND next_retry_at <= NOW()`),
    billingPeriodIdx: index("overage_billing_period_idx")
        .on(table.billingPeriodStart, table.billingPeriodEnd),

    // Constraints
    periodValid: check(
        "overage_billing_period_valid",
        sql`${table.billingPeriodEnd} > ${table.billingPeriodStart}`
    ),
    limitsPositive: check(
        "overage_billing_limits_positive",
        sql`${table.athleteLimit} > 0 AND ${table.coachLimit} > 0`
    ),
    countsPositive: check(
        "overage_billing_counts_positive",
        sql`${table.athleteCount} >= 0 AND ${table.coachCount} >= 0`
    ),
    overagePositive: check(
        "overage_billing_overage_positive",
        sql`${table.athleteOverage} >= 0 AND ${table.coachOverage} >= 0`
    ),
    ratesPositive: check(
        "overage_billing_rates_positive",
        sql`${table.athleteOverageRate} >= 0 AND ${table.coachOverageRate} >= 0`
    ),
    amountsPositive: check(
        "overage_billing_amounts_positive",
        sql`${table.athleteOverageAmount} >= 0 AND ${table.coachOverageAmount} >= 0 AND ${table.totalOverageAmount} >= 0`
    ),
    waivedAmountValid: check(
        "overage_billing_waived_amount_valid",
        sql`${table.waivedAmount} >= 0 AND ${table.waivedAmount} <= ${table.totalOverageAmount}`
    ),
    retryCountPositive: check(
        "overage_billing_retry_count_positive",
        sql`${table.retryCount} >= 0`
    ),
}));

// ENHANCED: Orders/payments tracking with better categorization
export const orders = pgTable("orders", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    customerProfileId: uuid("customer_profile_id").references(() => customerProfiles.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),

    // Polar order details
    polarOrderId: text("polar_order_id").notNull().unique(),
    polarProductId: text("polar_product_id").notNull(),

    // NEW: Order categorization
    orderType: text("order_type").notNull(), // "subscription", "onboarding", "overage", "addon"
    description: text("description"), // Human-readable description

    // Order state - enhanced
    status: text("status").notNull(), // "paid", "refunded", "failed", "pending", "canceled"
    amount: integer("amount").notNull(), // in cents
    currency: text("currency").notNull(),

    // NEW: Tax and fees breakdown
    subtotalAmount: integer("subtotal_amount"), // in cents, before tax
    taxAmount: integer("tax_amount").default(0), // in cents
    feeAmount: integer("fee_amount").default(0), // in cents, processing fees etc.

    // Enhanced payment details
    paymentMethod: text("payment_method"), // "card", "bank_transfer", "paypal", etc.
    paymentProvider: text("payment_provider"), // "stripe", "paypal", etc.
    paymentReference: text("payment_reference"), // External payment ID

    // NEW: Refund tracking
    refundedAmount: integer("refunded_amount").default(0), // in cents
    refundReason: text("refund_reason"),
    refundedByUserId: text("refunded_by_user_id"),

    // Enhanced timestamps
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),

    // NEW: Dunning and retry for failed payments
    failureReason: text("failure_reason"),
    retryCount: integer("retry_count").default(0).notNull(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),

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

// ENHANCED: Grace period tracking for over-limit scenarios - moved from core.ts and enhanced
export const gracePeriods = pgTable("grace_periods", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Grace period details
    reason: text("reason").notNull(), // "athlete_limit_exceeded", "trial_ending", "payment_failed", etc.
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),

    // NEW: Enhanced tracking and automation
    severity: text("severity").default("warning").notNull(), // "info", "warning", "critical", "blocking"
    autoResolve: boolean("auto_resolve").default(false).notNull(), // Should system auto-resolve?
    escalationLevel: integer("escalation_level").default(0).notNull(), // 0=first warning, 1=second, etc.

    // Communication tracking
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    warningsSent: integer("warnings_sent").default(0).notNull(),
    lastWarningSentAt: timestamp("last_warning_sent_at", { withTimezone: true }),
    communicationPreference: text("communication_preference").default("email"), // email, sms, in_app

    // Resolution tracking
    resolved: boolean("resolved").default(false).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"), // "upgraded", "downgraded", "athletes_removed", "payment_resolved", etc.
    resolvedByUserId: text("resolved_by_user_id"),
    autoResolved: boolean("auto_resolved").default(false).notNull(),

    // Enhanced context and metadata
    contextSnapshot: json("context_snapshot"), // Box state when grace period started
    actionsTaken: json("actions_taken"), // Log of automated actions
    metadata: json("metadata"),

    // Impact tracking
    businessImpact: text("business_impact"), // "none", "limited_functionality", "service_suspended"
    userExperience: text("user_experience"), // "normal", "degraded", "blocked"

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("grace_periods_box_id_idx").on(table.boxId),
    endsAtIdx: index("grace_periods_ends_at_idx").on(table.endsAt),
    resolvedIdx: index("grace_periods_resolved_idx").on(table.resolved),
    reasonIdx: index("grace_periods_reason_idx").on(table.reason),
    severityIdx: index("grace_periods_severity_idx").on(table.severity),
    notifiedAtIdx: index("grace_periods_notified_at_idx").on(table.notifiedAt),
    escalationLevelIdx: index("grace_periods_escalation_level_idx").on(table.escalationLevel),

    // Critical composite indexes for automated processing
    unresolvedExpiringIdx: index("grace_periods_unresolved_expiring_idx")
        .on(table.resolved, table.endsAt, table.severity)
        .where(sql`resolved = false AND ends_at <= NOW() + INTERVAL '1 day'`),
    boxActiveIdx: index("grace_periods_box_active_idx")
        .on(table.boxId, table.resolved)
        .where(sql`resolved = false`),
    needsNotificationIdx: index("grace_periods_needs_notification_idx")
        .on(table.resolved, table.notifiedAt, table.endsAt)
        .where(sql`resolved = false AND (notified_at IS NULL OR notified_at < NOW() - INTERVAL '24 hours')`),
    autoResolveIdx: index("grace_periods_auto_resolve_idx")
        .on(table.autoResolve, table.resolved, table.endsAt)
        .where(sql`auto_resolve = true AND resolved = false AND ends_at <= NOW()`),

    // Constraints
    warningsSentPositive: check(
        "grace_periods_warnings_sent_positive",
        sql`${table.warningsSent} >= 0`
    ),
    escalationLevelPositive: check(
        "grace_periods_escalation_level_positive",
        sql`${table.escalationLevel} >= 0 AND ${table.escalationLevel} <= 10`
    ),
}));

// NEW: Usage tracking for potential usage-based billing and analytics
export const usageEvents = pgTable("usage_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Event details - enhanced
    eventType: text("event_type").notNull(), // "athlete_added", "coach_added", "checkin_logged", etc.
    quantity: integer("quantity").default(1).notNull(),

    // Enhanced tracking context
    entityId: uuid("entity_id"), // ID of related entity (membershipId, prId, etc.)
    entityType: text("entity_type"), // "membership", "pr", "checkin", etc.
    userId: text("user_id"), // Who triggered the event

    // NEW: Billing and metering context
    meteringKey: text("metering_key"), // Key for grouping related events
    billable: boolean("billable").default(false).notNull(), // Should this count toward usage billing?

    metadata: json("metadata"),

    // Polar integration for usage-based billing
    polarEventId: text("polar_event_id"), // If sent to Polar for usage billing
    sentToPolarAt: timestamp("sent_to_polar_at", { withTimezone: true }),
    polarError: text("polar_error"),

    // NEW: Billing period association for accurate usage calculations
    billingPeriodStart: timestamp("billing_period_start", { withTimezone: true }),
    billingPeriodEnd: timestamp("billing_period_end", { withTimezone: true }),
    processed: boolean("processed").default(false).notNull(), // Has been included in billing calculations

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("usage_events_box_id_idx").on(table.boxId),
    eventTypeIdx: index("usage_events_event_type_idx").on(table.eventType),
    createdAtIdx: index("usage_events_created_at_idx").on(table.createdAt),
    entityIdIdx: index("usage_events_entity_id_idx").on(table.entityId),
    entityTypeIdx: index("usage_events_entity_type_idx").on(table.entityType),
    userIdIdx: index("usage_events_user_id_idx").on(table.userId),
    meteringKeyIdx: index("usage_events_metering_key_idx").on(table.meteringKey),
    billableIdx: index("usage_events_billable_idx").on(table.billable),
    polarEventIdIdx: index("usage_events_polar_event_id_idx").on(table.polarEventId),
    billingPeriodStartIdx: index("usage_events_billing_period_start_idx").on(table.billingPeriodStart),
    processedIdx: index("usage_events_processed_idx").on(table.processed),

    // Critical composite indexes for billing aggregation
    boxEventTypePeriodIdx: index("usage_events_box_event_type_period_idx")
        .on(table.boxId, table.eventType, table.billingPeriodStart),
    billingPeriodIdx: index("usage_events_billing_period_idx")
        .on(table.billingPeriodStart, table.billingPeriodEnd),
    billableUnprocessedIdx: index("usage_events_billable_unprocessed_idx")
        .on(table.billable, table.processed)
        .where(sql`billable = true AND processed = false`),
    needsPolarSyncIdx: index("usage_events_needs_polar_sync_idx")
        .on(table.billable, table.polarEventId)
        .where(sql`billable = true AND polar_event_id IS NULL`),

    // Constraints
    quantityPositive: check(
        "usage_events_quantity_positive",
        sql`${table.quantity} > 0`
    ),
}));

// NEW: Plan change requests - for managing upgrade/downgrade workflows
export const planChangeRequests = pgTable("plan_change_requests", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "cascade" }).notNull(),

    // Change details
    fromPlanId: uuid("from_plan_id").references(() => subscriptionPlans.id).notNull(),
    toPlanId: uuid("to_plan_id").references(() => subscriptionPlans.id).notNull(),
    changeType: text("change_type").notNull(), // "upgrade", "downgrade", "lateral"

    // Timing
    requestedEffectiveDate: timestamp("requested_effective_date", { withTimezone: true }),
    actualEffectiveDate: timestamp("actual_effective_date", { withTimezone: true }),

    // Approval workflow
    status: text("status").default("pending").notNull(), // pending, approved, rejected, processed, failed
    requestedByUserId: text("requested_by_user_id").notNull(),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),

    // Financial impact
    proratedAmount: integer("prorated_amount"), // in cents, can be negative
    prorationType: text("proration_type").default("immediate"), // immediate, next_billing_cycle, end_of_period

    // Processing
    polarEventId: text("polar_event_id"), // Related Polar event
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingError: text("processing_error"),

    metadata: json("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("plan_change_requests_box_id_idx").on(table.boxId),
    subscriptionIdIdx: index("plan_change_requests_subscription_id_idx").on(table.subscriptionId),
    statusIdx: index("plan_change_requests_status_idx").on(table.status),
    changeTypeIdx: index("plan_change_requests_change_type_idx").on(table.changeType),
    requestedByIdx: index("plan_change_requests_requested_by_idx").on(table.requestedByUserId),
    requestedEffectiveDateIdx: index("plan_change_requests_requested_effective_date_idx").on(table.requestedEffectiveDate),

    // Composite indexes for processing workflows
    pendingProcessingIdx: index("plan_change_requests_pending_processing_idx")
        .on(table.status, table.requestedEffectiveDate)
        .where(sql`status = 'approved' AND requested_effective_date <= NOW()`),
    boxStatusIdx: index("plan_change_requests_box_status_idx").on(table.boxId, table.status),
}));

// NEW: Payment method management - for tracking customer payment methods
export const paymentMethods = pgTable("payment_methods", {
    id: uuid("id").defaultRandom().primaryKey(),
    customerProfileId: uuid("customer_profile_id").references(() => customerProfiles.id, { onDelete: "cascade" }).notNull(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Payment method details
    type: text("type").notNull(), // "card", "bank_account", "paypal", etc.
    isDefault: boolean("is_default").default(false).notNull(),

    // Card/Bank details (anonymized)
    last4: text("last4"), // Last 4 digits
    brand: text("brand"), // visa, mastercard, etc.
    expiryMonth: integer("expiry_month"),
    expiryYear: integer("expiry_year"),

    // External references
    polarPaymentMethodId: text("polar_payment_method_id"),
    stripePaymentMethodId: text("stripe_payment_method_id"),

    // Status
    isActive: boolean("is_active").default(true).notNull(),
    isExpired: boolean("is_expired").default(false).notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    metadata: json("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    customerProfileIdIdx: index("payment_methods_customer_profile_id_idx").on(table.customerProfileId),
    boxIdIdx: index("payment_methods_box_id_idx").on(table.boxId),
    typeIdx: index("payment_methods_type_idx").on(table.type),
    isDefaultIdx: index("payment_methods_is_default_idx").on(table.isDefault),
    isActiveIdx: index("payment_methods_is_active_idx").on(table.isActive),
    isExpiredIdx: index("payment_methods_is_expired_idx").on(table.isExpired),

    // Composite indexes
    customerActiveIdx: index("payment_methods_customer_active_idx").on(table.customerProfileId, table.isActive),
    expiringIdx: index("payment_methods_expiring_idx")
        .on(table.expiryYear, table.expiryMonth, table.isActive)
        .where(sql`is_active = true AND expiry_year IS NOT NULL AND expiry_month IS NOT NULL`),

    // Constraints
    expiryMonthRange: check(
        "payment_methods_expiry_month_range",
        sql`${table.expiryMonth} IS NULL OR (${table.expiryMonth} >= 1 AND ${table.expiryMonth} <= 12)`
    ),
    expiryYearValid: check(
        "payment_methods_expiry_year_valid",
        sql`${table.expiryYear} IS NULL OR ${table.expiryYear} >= 2024`
    ),
    failureCountPositive: check(
        "payment_methods_failure_count_positive",
        sql`${table.failureCount} >= 0`
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
    changeRequestsFrom: many(planChangeRequests, { relationName: "plan_change_requests_from" }),
    changeRequestsTo: many(planChangeRequests, { relationName: "plan_change_requests_to" }),
}));

export const customerProfilesRelations = relations(customerProfiles, ({ one, many }) => ({
    box: one(boxes, {
        fields: [customerProfiles.boxId],
        references: [boxes.id],
        relationName: "box_customer_profiles"
    }),
    subscriptions: many(subscriptions, { relationName: "customer_subscriptions" }),
    orders: many(orders, { relationName: "customer_orders" }),
    paymentMethods: many(paymentMethods, { relationName: "customer_payment_methods" }),
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
    changes: many(subscriptionChanges, { relationName: "subscription_changes" }),
    overageBilling: many(overageBilling, { relationName: "subscription_overage_billing" }),
    changeRequests: many(planChangeRequests, { relationName: "subscription_change_requests" }),
}));

export const subscriptionChangesRelations = relations(subscriptionChanges, ({ one }) => ({
    subscription: one(subscriptions, {
        fields: [subscriptionChanges.subscriptionId],
        references: [subscriptions.id],
        relationName: "subscription_changes"
    }),
    box: one(boxes, {
        fields: [subscriptionChanges.boxId],
        references: [boxes.id],
        relationName: "box_subscription_changes"
    }),
    fromPlan: one(subscriptionPlans, {
        fields: [subscriptionChanges.fromPlanId],
        references: [subscriptionPlans.id],
        relationName: "subscription_changes_from_plan"
    }),
    toPlan: one(subscriptionPlans, {
        fields: [subscriptionChanges.toPlanId],
        references: [subscriptionPlans.id],
        relationName: "subscription_changes_to_plan"
    }),
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

export const overageBillingRelations = relations(overageBilling, ({ one }) => ({
    box: one(boxes, {
        fields: [overageBilling.boxId],
        references: [boxes.id],
        relationName: "box_overage_billing"
    }),
    subscription: one(subscriptions, {
        fields: [overageBilling.subscriptionId],
        references: [subscriptions.id],
        relationName: "subscription_overage_billing"
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

export const planChangeRequestsRelations = relations(planChangeRequests, ({ one }) => ({
    box: one(boxes, {
        fields: [planChangeRequests.boxId],
        references: [boxes.id],
        relationName: "box_plan_change_requests"
    }),
    subscription: one(subscriptions, {
        fields: [planChangeRequests.subscriptionId],
        references: [subscriptions.id],
        relationName: "subscription_change_requests"
    }),
    fromPlan: one(subscriptionPlans, {
        fields: [planChangeRequests.fromPlanId],
        references: [subscriptionPlans.id],
        relationName: "plan_change_requests_from"
    }),
    toPlan: one(subscriptionPlans, {
        fields: [planChangeRequests.toPlanId],
        references: [subscriptionPlans.id],
        relationName: "plan_change_requests_to"
    }),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
    customerProfile: one(customerProfiles, {
        fields: [paymentMethods.customerProfileId],
        references: [customerProfiles.id],
        relationName: "customer_payment_methods"
    }),
    box: one(boxes, {
        fields: [paymentMethods.boxId],
        references: [boxes.id],
        relationName: "box_payment_methods"
    }),
}));
