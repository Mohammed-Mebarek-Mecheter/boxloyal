// Billing and subscription management
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    uuid,
    index
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { gyms } from "./core";

// Billing events from Polar
export const billingEvents = pgTable("billing_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),

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
    gymIdx: index("billing_events_gym_idx").on(table.gymId),
    eventTypeIdx: index("billing_events_event_type_idx").on(table.eventType),
    polarEventIdx: index("billing_events_polar_event_idx").on(table.polarEventId),
    processedIdx: index("billing_events_processed_idx").on(table.processed),
}));

// Subscription plans and pricing
export const subscriptionPlans = pgTable("subscription_plans", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    tier: text("tier").notNull(), // "starter", "performance", "elite"
    memberLimit: integer("member_limit").notNull(),
    coachLimit: integer("coach_limit").notNull(),
    monthlyPrice: integer("monthly_price").notNull(), // in cents
    annualPrice: integer("annual_price").notNull(), // in cents
    features: text("features").notNull(), // JSON array of features
    isActive: boolean("is_active").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    tierIdx: index("subscription_plans_tier_idx").on(table.tier),
    activeIdx: index("subscription_plans_active_idx").on(table.isActive),
}));

// Grace period tracking for over-limit scenarios
export const gracePeriods = pgTable("grace_periods", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),

    // Grace period details
    reason: text("reason").notNull(), // "member_limit_exceeded", "trial_ending", etc.
    endsAt: timestamp("ends_at").notNull(),
    notifiedAt: timestamp("notified_at"),

    // Resolution
    resolved: boolean("resolved").default(false).notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolution: text("resolution"), // "upgraded", "downgraded", "members_removed", etc.

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    gymIdx: index("grace_periods_gym_idx").on(table.gymId),
    endsAtIdx: index("grace_periods_ends_at_idx").on(table.endsAt),
    resolvedIdx: index("grace_periods_resolved_idx").on(table.resolved),
}));

// Relations
export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
    gym: one(gyms, {
        fields: [billingEvents.gymId],
        references: [gyms.id],
    }),
}));

export const gracePeriodsRelations = relations(gracePeriods, ({ one }) => ({
    gym: one(gyms, {
        fields: [gracePeriods.gymId],
        references: [gyms.id],
    }),
}));
