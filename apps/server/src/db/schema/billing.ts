// db/schema/billing.ts
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    uuid,
    index,
    json
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { boxes } from "./core";

// Billing events from Polar
export const billingEvents = pgTable("billing_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Event details
    eventType: text("event_type").notNull(), // "subscription.created", "subscription.updated", etc.
    polarEventId: text("polar_event_id").notNull().unique(),
    data: text("data").notNull(), // Raw event data from Polar

    // Processing status
    processed: boolean("processed").default(false).notNull(),
    processingError: text("processing_error"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
}, (table) => ({
    boxIdx: index("billing_events_box_idx").on(table.boxId),
    eventTypeIdx: index("billing_events_event_type_idx").on(table.eventType),
    polarEventIdx: index("billing_events_polar_event_idx").on(table.polarEventId),
    processedIdx: index("billing_events_processed_idx").on(table.processed),
}));

// Subscription plans and pricing
export const subscriptionPlans = pgTable("subscription_plans", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    tier: text("tier").notNull(), // "starter", "performance", "elite"
    athleteLimit: integer("athlete_limit").notNull(), // Athletes limit
    coachLimit: integer("coach_limit").notNull(),
    monthlyPrice: integer("monthly_price").notNull(), // in cents
    annualPrice: integer("annual_price").notNull(), // in cents
    features: text("features").notNull(), // JSON array of features
    isActive: boolean("is_active").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),

    // Polar integration
    polarProductId: text("polar_product_id").unique(), // Monthly product ID
    polarAnnualProductId: text("polar_annual_product_id").unique(), // Annual product ID

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    tierIdx: index("subscription_plans_tier_idx").on(table.tier),
    activeIdx: index("subscription_plans_active_idx").on(table.isActive),
    polarProductIdx: index("subscription_plans_polar_product_idx").on(table.polarProductId),
}));

// Customer billing profiles (link to Polar customers)
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

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxIdx: index("customer_profiles_box_idx").on(table.boxId),
    polarCustomerIdx: index("customer_profiles_polar_customer_idx").on(table.polarCustomerId),
}));

// Subscription records (sync from Polar)
export const subscriptions = pgTable("subscriptions", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    customerProfileId: uuid("customer_profile_id").references(() => customerProfiles.id, { onDelete: "cascade" }).notNull(),

    // Polar subscription details
    polarSubscriptionId: text("polar_subscription_id").notNull().unique(),
    polarProductId: text("polar_product_id").notNull(),

    // Subscription state - reference plan ID instead of tier
    planId: uuid("plan_id").references(() => subscriptionPlans.id).notNull(),
    status: text("status").notNull(),
    currentPeriodStart: timestamp("current_period_start").notNull(),
    currentPeriodEnd: timestamp("current_period_end").notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    canceledAt: timestamp("canceled_at"),

    // Pricing
    currency: text("currency").notNull(),
    amount: integer("amount").notNull(),
    interval: text("interval").notNull(),

    // Metadata
    metadata: json("metadata"),

    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxIdx: index("subscriptions_box_idx").on(table.boxId),
    polarSubscriptionIdx: index("subscriptions_polar_subscription_idx").on(table.polarSubscriptionId),
    statusIdx: index("subscriptions_status_idx").on(table.status),
    currentPeriodEndIdx: index("subscriptions_current_period_end_idx").on(table.currentPeriodEnd),
    planIdIdx: index("subscriptions_plan_id_idx").on(table.planId),
    cancelAtPeriodEndIdx: index("subscriptions_cancel_at_period_end_idx").on(table.cancelAtPeriodEnd),
}));

// Orders/payments tracking
export const orders = pgTable("orders", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    customerProfileId: uuid("customer_profile_id").references(() => customerProfiles.id),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id),

    // Polar order details
    polarOrderId: text("polar_order_id").notNull().unique(),
    polarProductId: text("polar_product_id").notNull(),

    // Order state
    status: text("status").notNull(), // "paid", "refunded", "failed", etc.
    amount: integer("amount").notNull(), // in cents
    currency: text("currency").notNull(),

    // Timestamps
    paidAt: timestamp("paid_at"),
    refundedAt: timestamp("refunded_at"),

    // Metadata
    metadata: json("metadata"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxIdx: index("orders_box_idx").on(table.boxId),
    polarOrderIdx: index("orders_polar_order_idx").on(table.polarOrderId),
    statusIdx: index("orders_status_idx").on(table.status),
    paidAtIdx: index("orders_paid_at_idx").on(table.paidAt),
}));

// Grace period tracking for over-limit scenarios
export const gracePeriods = pgTable("grace_periods", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Grace period details
    reason: text("reason").notNull(), // "athlete_limit_exceeded", "trial_ending", etc.
    endsAt: timestamp("ends_at").notNull(),
    notifiedAt: timestamp("notified_at"),

    // Resolution
    resolved: boolean("resolved").default(false).notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolution: text("resolution"), // "upgraded", "downgraded", "athletes_removed", etc.

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxIdx: index("grace_periods_box_idx").on(table.boxId),
    endsAtIdx: index("grace_periods_ends_at_idx").on(table.endsAt),
    resolvedIdx: index("grace_periods_resolved_idx").on(table.resolved),
}));

// Usage tracking for potential usage-based billing
export const usageEvents = pgTable("usage_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Event details
    eventType: text("event_type").notNull(), // "athlete_added", "checkin_logged", etc.
    quantity: integer("quantity").default(1).notNull(),
    metadata: json("metadata"),

    // Polar integration
    polarEventId: text("polar_event_id"), // If sent to Polar for usage billing

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    boxIdx: index("usage_events_box_idx").on(table.boxId),
    eventTypeIdx: index("usage_events_event_type_idx").on(table.eventType),
    createdAtIdx: index("usage_events_created_at_idx").on(table.createdAt),
}));

// Relations
export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
    box: one(boxes, {
        fields: [billingEvents.boxId],
        references: [boxes.id],
    }),
}));

export const customerProfilesRelations = relations(customerProfiles, ({ one, many }) => ({
    box: one(boxes, {
        fields: [customerProfiles.boxId],
        references: [boxes.id],
    }),
    subscriptions: many(subscriptions),
    orders: many(orders),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
    box: one(boxes, {
        fields: [subscriptions.boxId],
        references: [boxes.id],
    }),
    customerProfile: one(customerProfiles, {
        fields: [subscriptions.customerProfileId],
        references: [customerProfiles.id],
        // Ensure subscription cannot exist without a customer profile
        relationName: "subscription_customer_profile"
    }),
    orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
    box: one(boxes, {
        fields: [orders.boxId],
        references: [boxes.id],
    }),
    customerProfile: one(customerProfiles, {
        fields: [orders.customerProfileId],
        references: [customerProfiles.id],
    }),
    subscription: one(subscriptions, {
        fields: [orders.subscriptionId],
        references: [subscriptions.id],
    }),
}));

export const gracePeriodsRelations = relations(gracePeriods, ({ one }) => ({
    box: one(boxes, {
        fields: [gracePeriods.boxId],
        references: [boxes.id],
    }),
}));

export const usageEventsRelations = relations(usageEvents, ({ one }) => ({
    box: one(boxes, {
        fields: [usageEvents.boxId],
        references: [boxes.id],
    }),
}));
