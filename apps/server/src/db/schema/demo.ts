// db/schema/demo.ts
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
import { boxes, boxMemberships } from "./core";
import {userRoleEnum} from "@/db/schema/enums";

// Demo athlete personas for storytelling - Enhanced with CUID2
export const demoPersonas = pgTable("demo_personas", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for public reference
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull(),
    backstory: text("backstory").notNull(),
    metrics: json("metrics").notNull(), // Pre-populated performance data
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    publicIdIdx: index("demo_personas_public_id_idx").on(table.publicId), // Index CUID2
    boxIdIdx: index("demo_personas_box_id_idx").on(table.boxId),
    boxRoleIdx: index("demo_personas_box_role_idx").on(table.boxId, table.role),
}));

// Demo data snapshots - Enhanced with CUID2
export const demoDataSnapshots = pgTable("demo_data_snapshots", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for public reference
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    snapshotData: json("snapshot_data").notNull(), // Complete box state for demo reset
    version: text("version").default("1.0").notNull(), // Track snapshot versions
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    publicIdIdx: index("demo_data_snapshots_public_id_idx").on(table.publicId), // Index CUID2
    boxIdIdx: index("demo_data_snapshots_box_id_idx").on(table.boxId),
}));

// Demo guided flows - Enhanced with CUID2
export const demoGuidedFlows = pgTable("demo_guided_flows", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for public reference
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    role: userRoleEnum("role").notNull(), // Which role's flow is active
    currentStep: integer("current_step").default(0).notNull(),
    completedSteps: json("completed_steps").default([]).notNull(),
    totalSteps: integer("total_steps").default(10).notNull(), // Track progress
    isCompleted: boolean("is_completed").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    publicIdIdx: index("demo_guided_flows_public_id_idx").on(table.publicId), // Index CUID2
    boxRoleIdx: index("demo_guided_flows_box_role_idx").on(table.boxId, table.role),
}));

// NEW: Demo scenario templates - Enhanced with CUID2
export const demoScenarios = pgTable("demo_scenarios", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for public reference
    name: text("name").notNull(),
    description: text("description").notNull(),
    targetRole: userRoleEnum("target_role").notNull(), // Which role this demo targets
    estimatedDuration: integer("estimated_duration").notNull(), // in minutes
    difficulty: text("difficulty").default("beginner").notNull(), // beginner, intermediate, advanced
    prerequisites: json("prerequisites"), // What needs to be set up first
    script: json("script").notNull(), // Step-by-step demo script
    expectedOutcomes: json("expected_outcomes").notNull(), // What the user should experience
    keyMetrics: json("key_metrics"), // What success looks like for this demo
    isActive: boolean("is_active").default(true).notNull(),
    version: text("version").default("1.0").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    publicIdIdx: index("demo_scenarios_public_id_idx").on(table.publicId), // Index CUID2
    targetRoleIdx: index("demo_scenarios_target_role_idx").on(table.targetRole),
    difficultyIdx: index("demo_scenarios_difficulty_idx").on(table.difficulty),
}));

// NEW: Demo session tracking - Enhanced with CUID2
export const demoSessions = pgTable("demo_sessions", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for public reference
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    scenarioId: uuid("scenario_id").references(() => demoScenarios.id),
    startedBy: uuid("started_by").references(() => boxMemberships.id),

    // Session details
    currentStep: integer("current_step").default(0).notNull(),
    completedSteps: json("completed_steps").default([]).notNull(),
    sessionData: json("session_data"), // State of the demo session

    // Timing
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),

    // Outcomes
    wasSuccessful: boolean("was_successful"),
    feedback: json("feedback"), // User feedback on the demo
    conversionEvent: text("conversion_event"), // What action they took after demo

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    publicIdIdx: index("demo_sessions_public_id_idx").on(table.publicId), // Index CUID2
    boxIdIdx: index("demo_sessions_box_id_idx").on(table.boxId),
    scenarioIdIdx: index("demo_sessions_scenario_id_idx").on(table.scenarioId),
    startedAtIdx: index("demo_sessions_started_at_idx").on(table.startedAt),
}));

// NEW: Demo achievement system - Enhanced with CUID2
export const demoAchievements = pgTable("demo_achievements", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for public reference
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    achievementType: text("achievement_type").notNull(), // "feature_explored", "scenario_completed", "conversion"
    title: text("title").notNull(),
    description: text("description"),
    icon: text("icon"),
    earnedAt: timestamp("earned_at", { withTimezone: true }).defaultNow().notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    publicIdIdx: index("demo_achievements_public_id_idx").on(table.publicId), // Index CUID2
    boxIdIdx: index("demo_achievements_box_id_idx").on(table.boxId),
    achievementTypeIdx: index("demo_achievements_type_idx").on(table.achievementType),
    earnedAtIdx: index("demo_achievements_earned_at_idx").on(table.earnedAt),
}));

// --- Relations (No changes needed here for CUID2, only table definitions changed) ---

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

export const demoScenariosRelations = relations(demoScenarios, ({ many }) => ({
    sessions: many(demoSessions, { relationName: "scenario_sessions" }),
}));

export const demoSessionsRelations = relations(demoSessions, ({ one }) => ({
    box: one(boxes, {
        fields: [demoSessions.boxId],
        references: [boxes.id],
        relationName: "box_demo_sessions"
    }),
    scenario: one(demoScenarios, {
        fields: [demoSessions.scenarioId],
        references: [demoScenarios.id],
        relationName: "scenario_sessions"
    }),
    startedBy: one(boxMemberships, {
        fields: [demoSessions.startedBy],
        references: [boxMemberships.id],
        relationName: "user_demo_sessions"
    }),
}));

export const demoAchievementsRelations = relations(demoAchievements, ({ one }) => ({
    box: one(boxes, {
        fields: [demoAchievements.boxId],
        references: [boxes.id],
        relationName: "box_demo_achievements"
    }),
}));
