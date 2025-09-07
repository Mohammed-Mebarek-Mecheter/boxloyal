// db/schema/athletes.ts
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    decimal,
    pgEnum,
    uuid,
    index,
    json,
    date
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { boxes, boxMemberships } from "./core";

// CrossFit Movement Categories
export const movementCategoryEnum = pgEnum("movement_category", [
    "squat",
    "deadlift",
    "press",
    "olympic",
    "gymnastics",
    "cardio",
    "other"
]);

// Benchmark WOD Categories for better classification
export const benchmarkCategoryEnum = pgEnum("benchmark_category", [
    "girls", // Fran, Grace, Helen, etc.
    "hero", // Murph, DT, JT, etc.
    "open", // CrossFit Open workouts
    "games", // CrossFit Games workouts
    "custom" // Box-specific benchmarks
]);

// Badge types for gamification
export const badgeTypeEnum = pgEnum("badge_type", [
    "checkin_streak",
    "pr_achievement",
    "benchmark_completion",
    "attendance",
    "consistency",
    "community"
]);

export const videoVisibilityEnum = pgEnum("video_visibility", [
    "private", // Only the athlete and coaches
    "box",     // All athletes of the box
    "public"   // For leaderboards/social sharing (requires coach approval)
]);

// Movement types for PR tracking - enhanced with skill/lift flags
export const movements = pgTable("movements", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    category: movementCategoryEnum("category").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    isStandard: boolean("is_standard").default(false).notNull(), // Standard CrossFit movements

    // Enhanced categorization flags
    isSkill: boolean("is_skill").default(false).notNull(), // Skills like double-unders, muscle-ups
    isLift: boolean("is_lift").default(false).notNull(), // Pure strength movements

    // Measurement
    unit: text("unit").notNull(), // "lbs", "kg", "seconds", "reps"
    isTimeBased: boolean("is_time_based").default(false).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    nameIdx: index("movements_name_idx").on(table.name),
    categoryIdx: index("movements_category_idx").on(table.category),
    isSkillIdx: index("movements_is_skill_idx").on(table.isSkill),
    isLiftIdx: index("movements_is_lift_idx").on(table.isLift),
}));

// Benchmark WODs with enhanced categorization
export const benchmarkWods = pgTable("benchmark_wods", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description").notNull(),
    type: text("type").notNull(), // "time", "rounds", "max_weight"
    category: benchmarkCategoryEnum("category").default("custom").notNull(),
    isStandard: boolean("is_standard").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    nameIdx: index("benchmark_wods_name_idx").on(table.name),
    categoryIdx: index("benchmark_wods_category_idx").on(table.category),
}));

// Athlete Personal Records
export const athletePrs = pgTable("athlete_prs", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for shareable PRs
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    movementId: uuid("movement_id").references(() => movements.id, { onDelete: "cascade" }).notNull(),

    // PR Data
    value: decimal("value", { precision: 8, scale: 2 }).notNull(),
    unit: text("unit").notNull(),
    reps: integer("reps"), // For strength movements

    // Context
    notes: text("notes"),
    coachNotes: text("coach_notes"),
    videoUrl: text("video_url"),
    uploadStatus: text("upload_status").default('pending'), // 'pending', 'processing', 'complete', 'error'
    videoVisibility: videoVisibilityEnum("video_visibility").default('private').notNull(),
    consentForPublicUse: boolean("consent_for_public_use").default(false).notNull(),
    coachApprovedForPublic: boolean("coach_approved_for_public").default(false).notNull(),

    // Metadata
    achievedAt: timestamp("achieved_at").defaultNow().notNull(),
    verifiedByCoach: boolean("verified_by_coach").default(false).notNull(),
    isCelebrated: boolean("is_celebrated").default(false).notNull(), // For PR celebrations

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxAthleteMovementIdx: index("athlete_prs_box_athlete_movement_idx").on(
        table.boxId, table.membershipId, table.movementId
    ),
    boxMovementIdx: index("athlete_prs_box_movement_idx").on(table.boxId, table.movementId),
    publicIdIdx: index("athlete_prs_public_id_idx").on(table.publicId),
    achievedAtIdx: index("athlete_prs_achieved_at_idx").on(table.achievedAt),
}));

// Athlete Benchmark WOD Results
export const athleteBenchmarks = pgTable("athlete_benchmarks", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for shareable benchmark results
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    benchmarkId: uuid("benchmark_id").references(() => benchmarkWods.id, { onDelete: "cascade" }).notNull(),

    // Result Data
    result: decimal("result", { precision: 10, scale: 3 }).notNull(), // Time in seconds or rounds/reps
    resultType: text("result_type").notNull(), // "time", "rounds_reps", "weight"
    scaled: boolean("scaled").default(false).notNull(),
    scalingNotes: text("scaling_notes"),

    // Context
    notes: text("notes"),
    coachNotes: text("coach_notes"),

    // Metadata
    completedAt: timestamp("completed_at").defaultNow().notNull(),
    isCelebrated: boolean("is_celebrated").default(false).notNull(), // For benchmark celebrations

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxAthleteBenchmarkIdx: index("athlete_benchmarks_box_athlete_benchmark_idx").on(
        table.boxId, table.membershipId, table.benchmarkId
    ),
    publicIdIdx: index("athlete_benchmarks_public_id_idx").on(table.publicId),
    completedAtIdx: index("athlete_benchmarks_completed_at_idx").on(table.completedAt),
}));

// Daily wellness check-ins
export const athleteWellnessCheckins = pgTable("athlete_wellness_checkins", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // Wellness Metrics (1-10 scales)
    energyLevel: integer("energy_level").notNull(), // 1-10
    sleepQuality: integer("sleep_quality").notNull(), // 1-10
    stressLevel: integer("stress_level").notNull(), // 1-10
    motivationLevel: integer("motivation_level").notNull(), // 1-10

    // Body state
    soreness: json("soreness"), // Body map data: { shoulders: 3, legs: 7, etc. }
    painAreas: json("pain_areas"), // Areas of pain with severity

    // Lifestyle
    hydrationLevel: integer("hydration_level"), // 1-10
    nutritionQuality: integer("nutrition_quality"), // 1-10
    outsideActivity: text("outside_activity"), // "none", "light", "moderate", "heavy"

    // Workout Readiness
    workoutReadiness: integer("workout_readiness").notNull(), // 1-10

    // Optional Notes
    notes: text("notes"),
    mood: text("mood"), // Free text or predefined options

    // Timestamps
    checkinDate: timestamp("checkin_date").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    boxAthleteDateIdx: index("athlete_wellness_checkins_box_athlete_date_idx").on(
        table.boxId, table.membershipId, table.checkinDate
    ),
    checkinDateIdx: index("athlete_wellness_checkins_checkin_date_idx").on(table.checkinDate),
}));

// WOD feedback (post-workout)
export const wodFeedback = pgTable("wod_feedback", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // RPE and Difficulty
    rpe: integer("rpe").notNull(), // Rate of Perceived Exertion 1-10
    difficultyRating: integer("difficulty_rating").notNull(), // 1-10 (too easy to too hard)
    enjoymentRating: integer("enjoyment_rating"), // 1-10

    // Physical Response
    painDuringWorkout: json("pain_during_workout"), // Areas and severity
    feltGoodMovements: text("felt_good_movements"),
    struggledMovements: text("struggled_movements"),

    // Workout completion
    completed: boolean("completed").default(true).notNull(),
    scalingUsed: boolean("scaling_used").default(false).notNull(),
    scalingDetails: text("scaling_details"),

    // Time and results
    workoutTime: integer("workout_time"), // minutes
    result: text("result"), // Free text for workout result

    // Notes
    notes: text("notes"),
    coachNotes: text("coach_notes"),

    // Reference
    wodName: text("wod_name"),
    wodDate: timestamp("wod_date").defaultNow().notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    boxAthleteWodIdx: index("wod_feedback_box_athlete_wod_idx").on(
        table.boxId, table.membershipId, table.wodDate
    ),
    wodDateIdx: index("wod_feedback_wod_date_idx").on(table.wodDate),
}));

// WOD attendance tracking
export const wodAttendance = pgTable("wod_attendance", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // WOD details
    wodName: text("wod_name").notNull(),
    // Scheduled start time of the WOD class (when the class was supposed to begin)
    wodTime: timestamp("wod_time").notNull(),

    // Attendance date (the actual calendar date when attendance occurred)
    wodAttendanceDate: date("attendance_date").notNull(),

    // Attendance status
    status: text("status").notNull(), // "attended", "no_show", "late_cancel", "excused"
    checkedInAt: timestamp("checked_in_at"), // When athlete actually checked in

    // Performance metrics (for attended sessions)
    durationMinutes: integer("duration_minutes"), // Actual time spent in workout
    scaled: boolean("scaled").default(false), // Whether workout was scaled
    rx: boolean("rx").default(false), // Whether performed as prescribed
    score: text("score"), // Workout result (time, rounds, weight, etc.)
    notes: text("notes"), // Coach or athlete notes about the session

    // Coach information
    coachMembershipId: uuid("coach_membership_id").references(() => boxMemberships.id),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    // Index for quick lookup by box, athlete, and date
    boxAthleteDateIdx: index("wod_attendance_box_athlete_date_idx").on(
        table.boxId, table.membershipId, table.wodAttendanceDate
    ),
    // Index for class scheduling and reporting
    wodTimeIdx: index("wod_attendance_wod_time_idx").on(table.wodTime),
    // Index for attendance date-based reporting
    attendanceDateIdx: index("wod_attendance_date_idx").on(table.wodAttendanceDate),
    // Index for status filtering
    statusIdx: index("wod_attendance_status_idx").on(table.status),
}));

// Athlete badges and achievements
export const athleteBadges = pgTable("athlete_badges", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // Badge details
    badgeType: badgeTypeEnum("badge_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    icon: text("icon"), // Icon name or URL

    // Achievement data
    achievedValue: text("achieved_value"), // Value that triggered the badge
    tier: integer("tier").default(1), // For multi-level badges

    // Metadata
    awardedAt: timestamp("awarded_at").defaultNow().notNull(),
    isHidden: boolean("is_hidden").default(false).notNull(), // Hide from athlete if needed

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    boxAthleteBadgeIdx: index("athlete_badges_box_athlete_badge_idx").on(
        table.boxId, table.membershipId, table.badgeType
    ),
    awardedAtIdx: index("athlete_badges_awarded_at_idx").on(table.awardedAt),
}));

// Leaderboards for engagement
export const leaderboards = pgTable("leaderboards", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Leaderboard details
    name: text("name").notNull(),
    type: text("type").notNull(), // "benchmark", "pr", "streak", "custom"
    category: text("category"), // "rx", "scaled", "all"

    // Filtering criteria
    movementId: uuid("movement_id").references(() => movements.id),
    benchmarkId: uuid("benchmark_id").references(() => benchmarkWods.id),

    // Time period
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),

    // Settings
    isActive: boolean("is_active").default(true).notNull(),
    maxEntries: integer("max_entries").default(10).notNull(), // Top N athletes

    // Metadata
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxIdx: index("leaderboards_box_idx").on(table.boxId),
    typeIdx: index("leaderboards_type_idx").on(table.type),
    activeIdx: index("leaderboards_active_idx").on(table.isActive),
}));

// Leaderboard entries
export const leaderboardEntries = pgTable("leaderboard_entries", {
    id: uuid("id").defaultRandom().primaryKey(),
    leaderboardId: uuid("leaderboard_id").references(() => leaderboards.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // Entry data
    value: decimal("value", { precision: 10, scale: 3 }).notNull(),
    rank: integer("rank").notNull(),

    // References to source records
    prId: uuid("pr_id").references(() => athletePrs.id),
    benchmarkId: uuid("benchmark_id").references(() => athleteBenchmarks.id),

    // Metadata
    achievedAt: timestamp("achieved_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    leaderboardRankIdx: index("leaderboard_entries_leaderboard_rank_idx").on(
        table.leaderboardId, table.rank
    ),
    leaderboardAthleteIdx: index("leaderboard_entries_leaderboard_athlete_idx").on(
        table.leaderboardId, table.membershipId
    ),
}));

// Relations
export const movementsRelations = relations(movements, ({ many }) => ({
    athletePrs: many(athletePrs),
    leaderboards: many(leaderboards),
}));

export const benchmarkWodsRelations = relations(benchmarkWods, ({ many }) => ({
    athleteBenchmarks: many(athleteBenchmarks),
    leaderboards: many(leaderboards),
}));

export const athletePrsRelations = relations(athletePrs, ({ one, many }) => ({
    box: one(boxes, {
        fields: [athletePrs.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [athletePrs.membershipId],
        references: [boxMemberships.id],
    }),
    movement: one(movements, {
        fields: [athletePrs.movementId],
        references: [movements.id],
    }),
    leaderboardEntries: many(leaderboardEntries),
}));

export const athleteBenchmarksRelations = relations(athleteBenchmarks, ({ one, many }) => ({
    box: one(boxes, {
        fields: [athleteBenchmarks.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [athleteBenchmarks.membershipId],
        references: [boxMemberships.id],
    }),
    benchmark: one(benchmarkWods, {
        fields: [athleteBenchmarks.benchmarkId],
        references: [benchmarkWods.id],
    }),
    leaderboardEntries: many(leaderboardEntries),
}));

export const athleteWellnessCheckinsRelations = relations(athleteWellnessCheckins, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteWellnessCheckins.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [athleteWellnessCheckins.membershipId],
        references: [boxMemberships.id],
    }),
}));

export const wodFeedbackRelations = relations(wodFeedback, ({ one }) => ({
    box: one(boxes, {
        fields: [wodFeedback.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [wodFeedback.membershipId],
        references: [boxMemberships.id],
    }),
}));

export const wodAttendanceRelations = relations(wodAttendance, ({ one }) => ({
    box: one(boxes, {
        fields: [wodAttendance.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [wodAttendance.membershipId],
        references: [boxMemberships.id],
    }),
    coach: one(boxMemberships, {
        fields: [wodAttendance.coachMembershipId],
        references: [boxMemberships.id],
    }),
}));

export const athleteBadgesRelations = relations(athleteBadges, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteBadges.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [athleteBadges.membershipId],
        references: [boxMemberships.id],
    }),
}));

export const leaderboardsRelations = relations(leaderboards, ({ one, many }) => ({
    box: one(boxes, {
        fields: [leaderboards.boxId],
        references: [boxes.id],
    }),
    movement: one(movements, {
        fields: [leaderboards.movementId],
        references: [movements.id],
    }),
    benchmark: one(benchmarkWods, {
        fields: [leaderboards.benchmarkId],
        references: [benchmarkWods.id],
    }),
    entries: many(leaderboardEntries),
}));

export const leaderboardEntriesRelations = relations(leaderboardEntries, ({ one }) => ({
    leaderboard: one(leaderboards, {
        fields: [leaderboardEntries.leaderboardId],
        references: [leaderboards.id],
    }),
    membership: one(boxMemberships, {
        fields: [leaderboardEntries.membershipId],
        references: [boxMemberships.id],
    }),
    pr: one(athletePrs, {
        fields: [leaderboardEntries.prId],
        references: [athletePrs.id],
    }),
    benchmark: one(athleteBenchmarks, {
        fields: [leaderboardEntries.benchmarkId],
        references: [athleteBenchmarks.id],
    }),
}));
