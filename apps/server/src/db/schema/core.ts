// Updated with onboarding, demo, and billing integration
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    pgEnum,
    uuid,
    index,
    unique
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums for type safety
export const subscriptionStatusEnum = pgEnum("subscription_status", [
    "trial",
    "active",
    "past_due",
    "canceled",
    "incomplete"
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
    "starter",
    "performance",
    "elite"
]);

export const gymStatusEnum = pgEnum("gym_status", [
    "active",
    "suspended",
    "trial_expired"
]);

export const inviteStatusEnum = pgEnum("invite_status", [
    "pending",
    "accepted",
    "expired",
    "canceled"
]);

export const approvalStatusEnum = pgEnum("approval_status", [
    "pending",
    "approved",
    "rejected"
]);

// Core tenant/organization table
export const gyms = pgTable("gyms", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),

    // Contact & Location
    email: text("email").notNull(),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zipCode: text("zip_code"),
    country: text("country").default("US"),
    timezone: text("timezone").default("America/New_York"),

    // Business Info
    website: text("website"),
    logo: text("logo"),
    description: text("description"),

    // Subscription & Billing
    subscriptionStatus: subscriptionStatusEnum("subscription_status").default("trial").notNull(),
    subscriptionTier: subscriptionTierEnum("subscription_tier").default("starter").notNull(),
    trialEndsAt: timestamp("trial_ends_at"),
    subscriptionEndsAt: timestamp("subscription_ends_at"),

    // Polar.sh Integration
    polarCustomerId: text("polar_customer_id"),
    polarSubscriptionId: text("polar_subscription_id"),

    // Limits based on tier
    memberLimit: integer("member_limit").default(200).notNull(),
    coachLimit: integer("coach_limit").default(10).notNull(),

    // Status & Metadata
    status: gymStatusEnum("status").default("active").notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    demoDataResetAt: timestamp("demo_data_reset_at"), // Hourly reset for demo gyms

    // Settings
    settings: text("settings"), // JSON for flexible gym-specific settings

    // Onboarding settings
    requireApproval: boolean("require_approval").default(true).notNull(), // For public signups
    allowPublicSignup: boolean("allow_public_signup").default(true).notNull(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    slugIdx: index("gym_slug_idx").on(table.slug),
    subscriptionStatusIdx: index("gym_subscription_status_idx").on(table.subscriptionStatus),
    polarCustomerIdx: index("gym_polar_customer_idx").on(table.polarCustomerId),
    isDemoIdx: index("gym_is_demo_idx").on(table.isDemo),
}));

// User roles within a gym
export const userRoleEnum = pgEnum("user_role", [
    "owner",
    "head_coach",
    "coach",
    "member"
]);

// Junction table for gym membership with roles
export const gymMemberships = pgTable("gym_memberships", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").notNull(), // References user.id from auth schema
    role: userRoleEnum("role").notNull(),

    // Member-specific fields
    emergencyContact: text("emergency_contact"),
    emergencyPhone: text("emergency_phone"),
    medicalNotes: text("medical_notes"),
    goals: text("goals"),

    // Engagement tracking
    checkinStreak: integer("checkin_streak").default(0).notNull(),
    longestCheckinStreak: integer("longest_checkin_streak").default(0).notNull(),
    lastCheckinDate: timestamp("last_checkin_date"),
    totalCheckins: integer("total_checkins").default(0).notNull(),

    // Status
    isActive: boolean("is_active").default(true).notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    leftAt: timestamp("left_at"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    gymUserIdx: index("gym_memberships_gym_user_idx").on(table.gymId, table.userId),
    gymRoleIdx: index("gym_memberships_gym_role_idx").on(table.gymId, table.role),
    userGymUnique: unique("gym_memberships_user_gym_unique").on(table.gymId, table.userId),
    checkinStreakIdx: index("gym_memberships_checkin_streak_idx").on(table.checkinStreak),
}));

// Onboarding: Invite system for coaches/members
export const gymInvites = pgTable("gym_invites", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull(),
    token: text("token").notNull().unique(),
    invitedByUserId: text("invited_by_user_id").notNull(),
    status: inviteStatusEnum("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    gymIdx: index("gym_invites_gym_idx").on(table.gymId),
    tokenIdx: index("gym_invites_token_idx").on(table.token),
    emailIdx: index("gym_invites_email_idx").on(table.email),
    statusIdx: index("gym_invites_status_idx").on(table.status),
}));

// Onboarding: QR codes for gym signup
export const gymQrCodes = pgTable("gym_qr_codes", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    code: text("code").notNull().unique(),
    name: text("name"),
    isActive: boolean("is_active").default(true).notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    gymIdx: index("gym_qr_codes_gym_idx").on(table.gymId),
    codeIdx: index("gym_qr_codes_code_idx").on(table.code),
    activeIdx: index("gym_qr_codes_active_idx").on(table.isActive),
}));

// Onboarding: Approval queue for public signups
export const approvalQueue = pgTable("approval_queue", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").notNull(),
    requestedRole: userRoleEnum("requested_role").notNull(),
    status: approvalStatusEnum("status").default("pending").notNull(),
    submittedAt: timestamp("submitted_at").defaultNow().notNull(),
    decidedAt: timestamp("decided_at"),
    decidedByUserId: text("decided_by_user_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    gymIdx: index("approval_queue_gym_idx").on(table.gymId),
    statusIdx: index("approval_queue_status_idx").on(table.status),
    userIdIdx: index("approval_queue_user_idx").on(table.userId),
}));

// Relations
export const gymsRelations = relations(gyms, ({ many }) => ({
    memberships: many(gymMemberships),
    invites: many(gymInvites),
    qrCodes: many(gymQrCodes),
    approvalQueue: many(approvalQueue),
}));

export const gymMembershipsRelations = relations(gymMemberships, ({ one }) => ({
    gym: one(gyms, {
        fields: [gymMemberships.gymId],
        references: [gyms.id],
    }),
}));

export const gymInvitesRelations = relations(gymInvites, ({ one }) => ({
    gym: one(gyms, {
        fields: [gymInvites.gymId],
        references: [gyms.id],
    }),
}));

export const gymQrCodesRelations = relations(gymQrCodes, ({ one }) => ({
    gym: one(gyms, {
        fields: [gymQrCodes.gymId],
        references: [gyms.id],
    }),
}));

export const approvalQueueRelations = relations(approvalQueue, ({ one }) => ({
    gym: one(gyms, {
        fields: [approvalQueue.gymId],
        references: [gyms.id],
    }),
}));
