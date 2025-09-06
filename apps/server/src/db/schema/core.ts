// core.ts
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
    json
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "@/db/schema/auth";

// Enums for type safety - moved to top to avoid reference errors
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
    "starter",
    "performance",
    "elite"
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

// Core tenant/organization table
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
    athleteLimit: integer("athlete_limit").default(200).notNull(), // Changed from memberLimit
    coachLimit: integer("coach_limit").default(10).notNull(),

    // Status & Metadata
    status: boxStatusEnum("status").default("active").notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    demoDataResetAt: timestamp("demo_data_reset_at"), // Hourly reset for demo boxes

    // Settings
    settings: text("settings"), // JSON for flexible box-specific settings

    // Onboarding settings
    requireApproval: boolean("require_approval").default(true).notNull(), // For public signups
    allowPublicSignup: boolean("allow_public_signup").default(true).notNull(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    slugIdx: index("box_slug_idx").on(table.slug),
    publicIdIdx: index("box_public_id_idx").on(table.publicId),
    subscriptionStatusIdx: index("box_subscription_status_idx").on(table.subscriptionStatus),
    polarCustomerIdx: index("box_polar_customer_idx").on(table.polarCustomerId),
    isDemoIdx: index("box_is_demo_idx").on(table.isDemo),
}));

// Demo athlete personas for storytelling
export const demoPersonas = pgTable("demo_personas", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id).notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull(),
    backstory: text("backstory").notNull(),
    metrics: json("metrics").notNull(), // Pre-populated performance data
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const demoDataSnapshots = pgTable("demo_data_snapshots", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id).notNull(),
    snapshotData: json("snapshot_data").notNull(), // Complete box state for demo reset
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const demoGuidedFlows = pgTable("demo_guided_flows", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id).notNull(),
    currentStep: integer("current_step").default(0).notNull(),
    completedSteps: json("completed_steps").default([]).notNull(),
    role: userRoleEnum("role").notNull(), // Which role's flow is active
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Junction table for box membership with roles
export const boxMemberships = pgTable("box_memberships", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for athlete profiles
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => user.id).notNull(),
    role: userRoleEnum("role").notNull(),

    // Athlete-specific fields
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
    boxUserIdx: index("box_memberships_box_user_idx").on(table.boxId, table.userId),
    boxRoleIdx: index("box_memberships_box_role_idx").on(table.boxId, table.role),
    publicIdIdx: index("box_memberships_public_id_idx").on(table.publicId),
    userBoxUnique: unique("box_memberships_user_box_unique").on(table.boxId, table.userId),
    checkinStreakIdx: index("box_memberships_checkin_streak_idx").on(table.checkinStreak),
}));

export const userProfiles = pgTable("user_profiles", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => user.id).notNull().unique(),
    bio: text("bio"),
    fitnessLevel: text("fitness_level"), // beginner, intermediate, advanced
    preferredWorkoutTypes: text("preferred_workout_types"), // strength, conditioning, etc.
    yearsOfExperience: integer("years_of_experience"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Onboarding: Invite system for coaches/athletes
export const boxInvites = pgTable("box_invites", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for secure invite URLs
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
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
    boxIdx: index("box_invites_box_idx").on(table.boxId),
    publicIdIdx: index("box_invites_public_id_idx").on(table.publicId),
    tokenIdx: index("box_invites_token_idx").on(table.token),
    emailIdx: index("box_invites_email_idx").on(table.email),
    statusIdx: index("box_invites_status_idx").on(table.status),
}));

// Onboarding: QR codes for box signup
export const boxQrCodes = pgTable("box_qr_codes", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for QR code URLs
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    code: text("code").notNull().unique(),
    name: text("name"),
    isActive: boolean("is_active").default(true).notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxIdx: index("box_qr_codes_box_idx").on(table.boxId),
    publicIdIdx: index("box_qr_codes_public_id_idx").on(table.publicId),
    codeIdx: index("box_qr_codes_code_idx").on(table.code),
    activeIdx: index("box_qr_codes_active_idx").on(table.isActive),
}));

// Onboarding: Approval queue for public signups
export const approvalQueue = pgTable("approval_queue", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => user.id).notNull(),
    requestedRole: userRoleEnum("requested_role").notNull(),
    status: approvalStatusEnum("status").default("pending").notNull(),
    submittedAt: timestamp("submitted_at").defaultNow().notNull(),
    decidedAt: timestamp("decided_at"),
    decidedByUserId: text("decided_by_user_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxIdx: index("approval_queue_box_idx").on(table.boxId),
    statusIdx: index("approval_queue_status_idx").on(table.status),
    userIdIdx: index("approval_queue_user_idx").on(table.userId),
}));

// Relations
export const boxesRelations = relations(boxes, ({ many }) => ({
    memberships: many(boxMemberships),
    invites: many(boxInvites),
    qrCodes: many(boxQrCodes),
    approvalQueue: many(approvalQueue),
    demoPersonas: many(demoPersonas),
    demoDataSnapshots: many(demoDataSnapshots),
    demoGuidedFlows: many(demoGuidedFlows),
}));

export const boxMembershipsRelations = relations(boxMemberships, ({ one }) => ({
    box: one(boxes, {
        fields: [boxMemberships.boxId],
        references: [boxes.id],
    }),
    user: one(user, {
        fields: [boxMemberships.userId],
        references: [user.id],
    }),
}));

export const boxInvitesRelations = relations(boxInvites, ({ one }) => ({
    box: one(boxes, {
        fields: [boxInvites.boxId],
        references: [boxes.id],
    }),
}));

export const boxQrCodesRelations = relations(boxQrCodes, ({ one }) => ({
    box: one(boxes, {
        fields: [boxQrCodes.boxId],
        references: [boxes.id],
    }),
}));

export const approvalQueueRelations = relations(approvalQueue, ({ one }) => ({
    box: one(boxes, {
        fields: [approvalQueue.boxId],
        references: [boxes.id],
    }),
    user: one(user, {
        fields: [approvalQueue.userId],
        references: [user.id],
    }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
    user: one(user, {
        fields: [userProfiles.userId],
        references: [user.id],
    }),
}));

export const demoPersonasRelations = relations(demoPersonas, ({ one }) => ({
    box: one(boxes, {
        fields: [demoPersonas.boxId],
        references: [boxes.id],
    }),
}));

export const demoDataSnapshotsRelations = relations(demoDataSnapshots, ({ one }) => ({
    box: one(boxes, {
        fields: [demoDataSnapshots.boxId],
        references: [boxes.id],
    }),
}));

export const demoGuidedFlowsRelations = relations(demoGuidedFlows, ({ one }) => ({
    box: one(boxes, {
        fields: [demoGuidedFlows.boxId],
        references: [boxes.id],
    }),
}));
