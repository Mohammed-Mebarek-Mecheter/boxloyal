// db/schema/core.ts - Enhanced version with consistency fixes
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    pgEnum,
    uuid,
    index,
    unique,
    json,
    check
} from "drizzle-orm/pg-core";
import {relations, sql} from "drizzle-orm";
import { user } from "@/db/schema/auth";

// Centralized enums for consistency across all tables
export const userRoleEnum = pgEnum("user_role", [
    "owner",
    "head_coach",
    "coach",
    "athlete"
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
    "trial",
    "active",
    "past_due",
    "canceled",
    "incomplete"
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
    "seed",
    "grow",
    "scale"
]);

export const boxStatusEnum = pgEnum("box_status", [
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

// Core tenant/organization table - Enhanced with proper constraints
export const boxes = pgTable("boxes", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for public URLs
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),

    // Contact & Location
    email: text("email").notNull(),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zipCode: text("zip_code"),
    country: text("country").default("US").notNull(),
    timezone: text("timezone").default("America/New_York").notNull(),

    // Business Info
    website: text("website"),
    logo: text("logo"),
    description: text("description"),

    // Subscription & Billing - Enhanced with proper constraints
    subscriptionStatus: subscriptionStatusEnum("subscription_status").default("trial").notNull(),
    subscriptionTier: subscriptionTierEnum("subscription_tier").default("seed").notNull(),

    // Trial Handling - Consistent timestamp naming
    trialStartsAt: timestamp("trial_starts_at", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),

    // Subscription Period - Consistent timestamp naming
    subscriptionStartsAt: timestamp("subscription_starts_at", { withTimezone: true }),
    subscriptionEndsAt: timestamp("subscription_ends_at", { withTimezone: true }),

    // Polar Integration
    polarCustomerId: text("polar_customer_id").unique(),
    polarSubscriptionId: text("polar_subscription_id").unique(),

    // Status & Metadata
    status: boxStatusEnum("status").default("active").notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    demoDataResetAt: timestamp("demo_data_reset_at", { withTimezone: true }),

    // Settings
    settings: json("settings"),

    // Onboarding settings
    requireApproval: boolean("require_approval").default(true).notNull(),
    allowPublicSignup: boolean("allow_public_signup").default(true).notNull(),

    // Timestamps - Consistent timezone handling
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Enhanced indexing for performance
    slugIdx: index("boxes_slug_idx").on(table.slug),
    publicIdIdx: index("boxes_public_id_idx").on(table.publicId),
    subscriptionStatusIdx: index("boxes_subscription_status_idx").on(table.subscriptionStatus),
    statusIdx: index("boxes_status_idx").on(table.status),
    subscriptionEndsAtIdx: index("boxes_subscription_ends_at_idx").on(table.subscriptionEndsAt),
    trialEndsAtIdx: index("boxes_trial_ends_at_idx").on(table.trialEndsAt),
    polarCustomerIdx: index("boxes_polar_customer_idx").on(table.polarCustomerId),
    polarSubscriptionIdx: index("boxes_polar_subscription_idx").on(table.polarSubscriptionId),
    isDemoIdx: index("boxes_is_demo_idx").on(table.isDemo),
    // Composite indexes for common queries
    statusSubscriptionIdx: index("boxes_status_subscription_idx").on(table.status, table.subscriptionStatus),
}));

// Demo athlete personas for storytelling - Enhanced
export const demoPersonas = pgTable("demo_personas", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull(),
    backstory: text("backstory").notNull(),
    metrics: json("metrics").notNull(), // Pre-populated performance data
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("demo_personas_box_id_idx").on(table.boxId),
    roleIdx: index("demo_personas_role_idx").on(table.role),
    activeIdx: index("demo_personas_active_idx").on(table.isActive),
}));

// Demo data snapshots - Enhanced
export const demoDataSnapshots = pgTable("demo_data_snapshots", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    snapshotData: json("snapshot_data").notNull(), // Complete box state for demo reset
    version: text("version").default("1.0").notNull(), // Track snapshot versions
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("demo_data_snapshots_box_id_idx").on(table.boxId),
    activeIdx: index("demo_data_snapshots_active_idx").on(table.isActive),
    versionIdx: index("demo_data_snapshots_version_idx").on(table.version),
}));

// Demo guided flows - Enhanced
export const demoGuidedFlows = pgTable("demo_guided_flows", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    role: userRoleEnum("role").notNull(), // Which role's flow is active
    currentStep: integer("current_step").default(0).notNull(),
    completedSteps: json("completed_steps").default([]).notNull(),
    totalSteps: integer("total_steps").default(10).notNull(), // Track progress
    isCompleted: boolean("is_completed").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("demo_guided_flows_box_id_idx").on(table.boxId),
    roleIdx: index("demo_guided_flows_role_idx").on(table.role),
    completedIdx: index("demo_guided_flows_completed_idx").on(table.isCompleted),
    // Composite index for active flows
    boxRoleIdx: index("demo_guided_flows_box_role_idx").on(table.boxId, table.role),
}));

// Junction table for box membership with roles - ENHANCED with consistent membershipId usage
export const boxMemberships = pgTable("box_memberships", {
    id: uuid("id").defaultRandom().primaryKey(), // This is the membershipId referenced everywhere
    publicId: text("public_id").notNull().unique(), // CUID2 for athlete profiles
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }).notNull(),
    role: userRoleEnum("role").notNull(),

    // Athlete-specific fields
    emergencyContact: text("emergency_contact"),
    emergencyPhone: text("emergency_phone"),
    medicalNotes: text("medical_notes"),
    goals: text("goals"),

    // Engagement tracking - Enhanced with constraints
    checkinStreak: integer("checkin_streak").default(0).notNull(),
    longestCheckinStreak: integer("longest_checkin_streak").default(0).notNull(),
    lastCheckinDate: timestamp("last_checkin_date", { withTimezone: true }),
    totalCheckins: integer("total_checkins").default(0).notNull(),

    // Status
    isActive: boolean("is_active").default(true).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),

    // Timestamps - Consistent naming
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Enhanced indexing for performance
    boxUserIdx: index("box_memberships_box_user_idx").on(table.boxId, table.userId),
    boxRoleIdx: index("box_memberships_box_role_idx").on(table.boxId, table.role),
    publicIdIdx: index("box_memberships_public_id_idx").on(table.publicId),
    userIdIdx: index("box_memberships_user_id_idx").on(table.userId), // Added missing index
    boxIdIdx: index("box_memberships_box_id_idx").on(table.boxId), // Added missing index
    checkinStreakIdx: index("box_memberships_checkin_streak_idx").on(table.checkinStreak),
    activeIdx: index("box_memberships_active_idx").on(table.isActive),
    joinedAtIdx: index("box_memberships_joined_at_idx").on(table.joinedAt),
    // Composite indexes for common queries
    boxActiveRoleIdx: index("box_memberships_box_active_role_idx").on(table.boxId, table.isActive, table.role),
    // Unique constraint
    userBoxUnique: unique("box_memberships_user_box_unique").on(table.boxId, table.userId),
    // Constraints
    checkinStreakPositive: check(
        "checkin_streak_positive",
        sql`${table.checkinStreak} >= 0`
    ),
    longestStreakPositive: check(
        "longest_streak_positive",
        sql`${table.longestCheckinStreak} >= 0`
    ),
    totalCheckinsPositive: check(
        "total_checkins_positive",
        sql`${table.totalCheckins} >= 0`
    ),
}));

// User profiles - Enhanced
export const userProfiles = pgTable("user_profiles", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }).notNull().unique(),
    bio: text("bio"),
    fitnessLevel: text("fitness_level"), // beginner, intermediate, advanced
    preferredWorkoutTypes: text("preferred_workout_types"), // strength, conditioning, etc.
    yearsOfExperience: integer("years_of_experience"),
    dateOfBirth: timestamp("date_of_birth", { withTimezone: true }), // Optional for age-based analytics
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index("user_profiles_user_id_idx").on(table.userId),
    fitnessLevelIdx: index("user_profiles_fitness_level_idx").on(table.fitnessLevel),
    // Constraints
    experiencePositive: check(
        "experience_positive",
        sql`${table.yearsOfExperience} >= 0`
    ),
}));

// Onboarding: Invite system for coaches/athletes - Enhanced
export const boxInvites = pgTable("box_invites", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for secure invite URLs
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull(),
    token: text("token").notNull().unique(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id).notNull(),
    status: inviteStatusEnum("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("box_invites_box_id_idx").on(table.boxId),
    publicIdIdx: index("box_invites_public_id_idx").on(table.publicId),
    tokenIdx: index("box_invites_token_idx").on(table.token),
    emailIdx: index("box_invites_email_idx").on(table.email),
    statusIdx: index("box_invites_status_idx").on(table.status),
    expiresAtIdx: index("box_invites_expires_at_idx").on(table.expiresAt),
    invitedByIdx: index("box_invites_invited_by_idx").on(table.invitedByUserId),
    // Composite indexes for common queries
    boxStatusIdx: index("box_invites_box_status_idx").on(table.boxId, table.status),
    emailStatusIdx: index("box_invites_email_status_idx").on(table.email, table.status),
}));

// Onboarding: QR codes for box signup - Enhanced
export const boxQrCodes = pgTable("box_qr_codes", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for QR code URLs
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    usageCount: integer("usage_count").default(0).notNull(), // Track QR code usage
    maxUsages: integer("max_usages"), // Optional usage limit
    expiresAt: timestamp("expires_at", { withTimezone: true }), // Optional expiration
    createdByUserId: text("created_by_user_id").references(() => user.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("box_qr_codes_box_id_idx").on(table.boxId),
    publicIdIdx: index("box_qr_codes_public_id_idx").on(table.publicId),
    codeIdx: index("box_qr_codes_code_idx").on(table.code),
    activeIdx: index("box_qr_codes_active_idx").on(table.isActive),
    createdByIdx: index("box_qr_codes_created_by_idx").on(table.createdByUserId),
    expiresAtIdx: index("box_qr_codes_expires_at_idx").on(table.expiresAt),
    // Composite indexes
    boxActiveIdx: index("box_qr_codes_box_active_idx").on(table.boxId, table.isActive),
    // Constraints
    usageCountPositive: check(
        "usage_count_positive",
        sql`${table.usageCount} >= 0`
    ),
    maxUsagesPositive: check(
        "max_usages_positive",
        sql`${table.maxUsages} >= 1`
    ),
}));

// Onboarding: Approval queue for public signups - Enhanced
export const approvalQueue = pgTable("approval_queue", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }).notNull(),
    requestedRole: userRoleEnum("requested_role").notNull(),
    status: approvalStatusEnum("status").default("pending").notNull(),
    requestMessage: text("request_message"), // Why they want to join
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: text("decided_by_user_id").references(() => user.id),
    notes: text("notes"),
    rejectionReason: text("rejection_reason"), // For rejected applications
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("approval_queue_box_id_idx").on(table.boxId),
    statusIdx: index("approval_queue_status_idx").on(table.status),
    userIdIdx: index("approval_queue_user_id_idx").on(table.userId),
    submittedAtIdx: index("approval_queue_submitted_at_idx").on(table.submittedAt),
    decidedByIdx: index("approval_queue_decided_by_idx").on(table.decidedByUserId),
    // Composite indexes for common queries
    boxStatusIdx: index("approval_queue_box_status_idx").on(table.boxId, table.status),
    userBoxUnique: unique("approval_queue_user_box_unique").on(table.boxId, table.userId),
}));

// Relations - Enhanced with proper naming
export const boxesRelations = relations(boxes, ({ many }) => ({
    memberships: many(boxMemberships, { relationName: "box_memberships" }),
    invites: many(boxInvites, { relationName: "box_invites" }),
    qrCodes: many(boxQrCodes, { relationName: "box_qr_codes" }),
    approvalQueue: many(approvalQueue, { relationName: "box_approval_queue" }),
    demoPersonas: many(demoPersonas, { relationName: "box_demo_personas" }),
    demoDataSnapshots: many(demoDataSnapshots, { relationName: "box_demo_snapshots" }),
    demoGuidedFlows: many(demoGuidedFlows, { relationName: "box_demo_flows" }),
}));

export const boxMembershipsRelations = relations(boxMemberships, ({ one }) => ({
    box: one(boxes, {
        fields: [boxMemberships.boxId],
        references: [boxes.id],
        relationName: "box_memberships"
    }),
    user: one(user, {
        fields: [boxMemberships.userId],
        references: [user.id],
        relationName: "user_memberships"
    }),
}));

export const boxInvitesRelations = relations(boxInvites, ({ one }) => ({
    box: one(boxes, {
        fields: [boxInvites.boxId],
        references: [boxes.id],
        relationName: "box_invites"
    }),
    invitedBy: one(user, {
        fields: [boxInvites.invitedByUserId],
        references: [user.id],
        relationName: "user_sent_invites"
    }),
}));

export const boxQrCodesRelations = relations(boxQrCodes, ({ one }) => ({
    box: one(boxes, {
        fields: [boxQrCodes.boxId],
        references: [boxes.id],
        relationName: "box_qr_codes"
    }),
    createdBy: one(user, {
        fields: [boxQrCodes.createdByUserId],
        references: [user.id],
        relationName: "user_created_qr_codes"
    }),
}));

export const approvalQueueRelations = relations(approvalQueue, ({ one }) => ({
    box: one(boxes, {
        fields: [approvalQueue.boxId],
        references: [boxes.id],
        relationName: "box_approval_queue"
    }),
    user: one(user, {
        fields: [approvalQueue.userId],
        references: [user.id],
        relationName: "user_approval_requests"
    }),
    decidedBy: one(user, {
        fields: [approvalQueue.decidedByUserId],
        references: [user.id],
        relationName: "user_approval_decisions"
    }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
    user: one(user, {
        fields: [userProfiles.userId],
        references: [user.id],
        relationName: "user_profile"
    }),
}));

export const demoPersonasRelations = relations(demoPersonas, ({ one }) => ({
    box: one(boxes, {
        fields: [demoPersonas.boxId],
        references: [boxes.id],
        relationName: "box_demo_personas"
    }),
}));

export const demoDataSnapshotsRelations = relations(demoDataSnapshots, ({ one }) => ({
    box: one(boxes, {
        fields: [demoDataSnapshots.boxId],
        references: [boxes.id],
        relationName: "box_demo_snapshots"
    }),
}));

export const demoGuidedFlowsRelations = relations(demoGuidedFlows, ({ one }) => ({
    box: one(boxes, {
        fields: [demoGuidedFlows.boxId],
        references: [boxes.id],
        relationName: "box_demo_flows"
    }),
}));
