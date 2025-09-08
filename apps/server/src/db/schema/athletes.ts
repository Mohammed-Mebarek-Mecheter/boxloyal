// db/schema/athletes.ts - Enhanced version with consistency fixes and normalized data
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
    date,
    check,
    unique
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { boxes, boxMemberships, userRoleEnum } from "./core";

// Enhanced Movement Categories
export const movementCategoryEnum = pgEnum("movement_category", [
    "squat",
    "deadlift",
    "press",
    "olympic",
    "gymnastics",
    "cardio",
    "other"
]);

// Enhanced Benchmark Categories
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

// Video visibility with consistent enum usage
export const consentTypeEnum = pgEnum("consent_type", [
    "coaching",       // Required for any video usage
    "box_visibility", // Allows sharing within the box
    "public"          // Allows public sharing (requires coach approval)
]);

// Video processing status enum for consistency
export const videoProcessingStatusEnum = pgEnum("video_processing_status", [
    "pending",
    "upload_pending",
    "processing",
    "ready",
    "error"
]);

// Body parts enum for normalized soreness/pain tracking
export const bodyPartEnum = pgEnum("body_part", [
    "neck",
    "shoulders",
    "chest",
    "upper_back",
    "lower_back",
    "abs",
    "biceps",
    "triceps",
    "forearms",
    "glutes",
    "quads",
    "hamstrings",
    "calves",
    "ankles",
    "knees",
    "hips",
    "wrists"
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

    // Measurement - enhanced with validation
    unit: text("unit").notNull(), // "lbs", "kg", "seconds", "reps"
    isTimeBased: boolean("is_time_based").default(false).notNull(),

    // Metadata
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    nameIdx: index("movements_name_idx").on(table.name),
    categoryIdx: index("movements_category_idx").on(table.category),
    isSkillIdx: index("movements_is_skill_idx").on(table.isSkill),
    isLiftIdx: index("movements_is_lift_idx").on(table.isLift),
    isStandardIdx: index("movements_is_standard_idx").on(table.isStandard),
    // Unique constraint for standard movements
    nameUnique: unique("movements_name_unique").on(table.name),
}));

// Benchmark WODs with enhanced categorization
export const benchmarkWods = pgTable("benchmark_wods", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description").notNull(),
    type: text("type").notNull(), // "time", "rounds", "max_weight"
    category: benchmarkCategoryEnum("category").default("custom").notNull(),
    isStandard: boolean("is_standard").default(true).notNull(),

    // Enhanced metadata
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    nameIdx: index("benchmark_wods_name_idx").on(table.name),
    categoryIdx: index("benchmark_wods_category_idx").on(table.category),
    isStandardIdx: index("benchmark_wods_is_standard_idx").on(table.isStandard),
}));

// ENHANCED: Athlete Personal Records with proper video implementation
export const athletePrs = pgTable("athlete_prs", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for shareable PRs
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    movementId: uuid("movement_id").references(() => movements.id, { onDelete: "cascade" }).notNull(),

    // PR Data - consistent naming with benchmarks
    value: decimal("value", { precision: 8, scale: 2 }).notNull(),
    unit: text("unit").notNull(),
    reps: integer("reps"), // For strength movements

    // Context
    notes: text("notes"),
    coachNotes: text("coach_notes"),

    // ENHANCED: Video Implementation using Gumlet
    gumletAssetId: text("gumlet_asset_id"), // Stores Gumlet's asset_id
    videoProcessingStatus: videoProcessingStatusEnum("video_processing_status").default("pending"),
    videoDuration: decimal("video_duration", { precision: 8, scale: 3 }), // Gumlet provides decimal duration
    thumbnailUrl: text("thumbnail_url"), // Stores Gumlet-generated thumbnail
    collectionId: text("collection_id"), // Gumlet collection ID for organization
    gumletMetadata: json("gumlet_metadata"), // Store additional Gumlet metadata

    // Metadata
    achievedAt: timestamp("achieved_at", { withTimezone: true }).defaultNow().notNull(),
    verifiedByCoach: boolean("verified_by_coach").default(false).notNull(),
    isCelebrated: boolean("is_celebrated").default(false).notNull(), // For PR celebrations

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Enhanced indexing
    boxMembershipMovementIdx: index("athlete_prs_box_membership_movement_idx").on(
        table.boxId, table.membershipId, table.movementId
    ),
    boxMovementIdx: index("athlete_prs_box_movement_idx").on(table.boxId, table.movementId),
    publicIdIdx: index("athlete_prs_public_id_idx").on(table.publicId),
    achievedAtIdx: index("athlete_prs_achieved_at_idx").on(table.achievedAt),
    membershipIdIdx: index("athlete_prs_membership_id_idx").on(table.membershipId),
    gumletAssetIdx: index("athlete_prs_gumlet_asset_idx").on(table.gumletAssetId),
    videoStatusIdx: index("athlete_prs_video_status_idx").on(table.videoProcessingStatus),
    verifiedIdx: index("athlete_prs_verified_idx").on(table.verifiedByCoach),
    celebratedIdx: index("athlete_prs_celebrated_idx").on(table.isCelebrated),
    // Composite indexes for common queries
    boxMembershipAchievedIdx: index("athlete_prs_box_membership_achieved_idx").on(
        table.boxId, table.membershipId, table.achievedAt
    ),
    // Constraints
    valuePositive: check(
        "athlete_prs_value_positive",
        sql`${table.value} > 0`
    ),
    repsPositive: check(
        "athlete_prs_reps_positive",
        sql`${table.reps} >= 1`
    ),
}));

// NEW: Video consent tracking (separate from PR data for flexibility)
export const videoConsents = pgTable("video_consents", {
    id: uuid("id").defaultRandom().primaryKey(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    prId: uuid("pr_id").references(() => athletePrs.id, { onDelete: "cascade" }).notNull(),
    consentTypes: text("consent_types").array().notNull(), // ['coaching', 'box_visibility', 'public']
    givenAt: timestamp("given_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    prIdIdx: index("video_consents_pr_id_idx").on(table.prId),
    membershipIdIdx: index("video_consents_membership_id_idx").on(table.membershipId),
    givenAtIdx: index("video_consents_given_at_idx").on(table.givenAt),
    // Unique constraint to prevent duplicate consents
    membershipPrUnique: unique("video_consents_membership_pr_unique").on(table.membershipId, table.prId),
}));

// NEW: Video processing events tracking
export const videoProcessingEvents = pgTable("video_processing_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    prId: uuid("pr_id").references(() => athletePrs.id, { onDelete: "cascade" }).notNull(),
    gumletAssetId: text("gumlet_asset_id").notNull(),
    eventType: text("event_type").notNull(), // 'upload_started', 'processing', 'completed', 'error'
    status: text("status").notNull(), // Gumlet status: 'upload-pending', 'processing', 'ready', etc.
    progress: integer("progress"), // Percentage (0-100)
    metadata: json("metadata"), // Additional Gumlet response data
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    prIdIdx: index("video_processing_events_pr_id_idx").on(table.prId),
    gumletAssetIdx: index("video_processing_events_gumlet_asset_idx").on(table.gumletAssetId),
    eventTypeIdx: index("video_processing_events_event_type_idx").on(table.eventType),
    statusIdx: index("video_processing_events_status_idx").on(table.status),
    createdAtIdx: index("video_processing_events_created_at_idx").on(table.createdAt),
    // Composite index for asset tracking
    assetEventIdx: index("video_processing_events_asset_event_idx").on(table.gumletAssetId, table.eventType),
    // Constraints
    progressRange: check(
        "video_processing_progress_range",
        sql`${table.progress} >= 0 AND ${table.progress} <= 100`
    ),
}));

// NEW: Gumlet webhook events tracking (CRITICAL for video processing)
export const gumletWebhookEvents = pgTable("gumlet_webhook_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    webhookId: text("webhook_id"), // Gumlet's webhook identifier
    assetId: text("asset_id").notNull(),
    eventType: text("event_type").notNull(), // 'status', 'processing', etc.
    status: text("status").notNull(), // Current asset status
    progress: integer("progress"),
    payload: json("payload").notNull(), // Full webhook payload for debugging
    processed: boolean("processed").default(false).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingError: text("processing_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    assetIdIdx: index("gumlet_webhook_events_asset_id_idx").on(table.assetId),
    processedIdx: index("gumlet_webhook_events_processed_idx").on(table.processed),
    eventTypeIdx: index("gumlet_webhook_events_event_type_idx").on(table.eventType),
    webhookIdIdx: index("gumlet_webhook_events_webhook_id_idx").on(table.webhookId),
    createdAtIdx: index("gumlet_webhook_events_created_at_idx").on(table.createdAt),
    // Index for unprocessed events
    unprocessedIdx: index("gumlet_webhook_events_unprocessed_idx").on(table.processed, table.createdAt)
        .where(sql`processed = false`),
}));

// ENHANCED: Athlete Benchmark WOD Results with consistent naming
export const athleteBenchmarks = pgTable("athlete_benchmarks", {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: text("public_id").notNull().unique(), // CUID2 for shareable benchmark results
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    benchmarkId: uuid("benchmark_id").references(() => benchmarkWods.id, { onDelete: "cascade" }).notNull(),

    // Result Data - consistent naming with PRs (using "value" instead of "result")
    value: decimal("value", { precision: 10, scale: 3 }).notNull(), // Time in seconds or rounds/reps
    valueType: text("value_type").notNull(), // "time", "rounds_reps", "weight" (renamed for consistency)
    scaled: boolean("scaled").default(false).notNull(),
    scalingNotes: text("scaling_notes"),

    // Context
    notes: text("notes"),
    coachNotes: text("coach_notes"),

    // Metadata - consistent naming
    achievedAt: timestamp("achieved_at", { withTimezone: true }).defaultNow().notNull(), // Renamed for consistency
    isCelebrated: boolean("is_celebrated").default(false).notNull(), // For benchmark celebrations

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxMembershipBenchmarkIdx: index("athlete_benchmarks_box_membership_benchmark_idx").on(
        table.boxId, table.membershipId, table.benchmarkId
    ),
    publicIdIdx: index("athlete_benchmarks_public_id_idx").on(table.publicId),
    achievedAtIdx: index("athlete_benchmarks_achieved_at_idx").on(table.achievedAt),
    membershipIdIdx: index("athlete_benchmarks_membership_id_idx").on(table.membershipId),
    benchmarkIdIdx: index("athlete_benchmarks_benchmark_id_idx").on(table.benchmarkId),
    celebratedIdx: index("athlete_benchmarks_celebrated_idx").on(table.isCelebrated),
    scaledIdx: index("athlete_benchmarks_scaled_idx").on(table.scaled),
    // Composite indexes
    boxMembershipAchievedIdx: index("athlete_benchmarks_box_membership_achieved_idx").on(
        table.boxId, table.membershipId, table.achievedAt
    ),
    // Constraints
    valuePositive: check(
        "athlete_benchmarks_value_positive",
        sql`${table.value} > 0`
    ),
}));

// ENHANCED: Daily wellness check-ins with normalized soreness tracking
export const athleteWellnessCheckins = pgTable("athlete_wellness_checkins", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // Wellness Metrics (1-10 scales) - enhanced with constraints
    energyLevel: integer("energy_level").notNull(),
    sleepQuality: integer("sleep_quality").notNull(),
    stressLevel: integer("stress_level").notNull(),
    motivationLevel: integer("motivation_level").notNull(),

    // Lifestyle - enhanced
    hydrationLevel: integer("hydration_level"),
    nutritionQuality: integer("nutrition_quality"),
    outsideActivity: text("outside_activity"), // "none", "light", "moderate", "heavy"

    // Workout Readiness
    workoutReadiness: integer("workout_readiness").notNull(),

    // Optional Notes
    notes: text("notes"),
    mood: text("mood"), // Free text or predefined options

    // Timestamps - consistent naming
    checkinDate: timestamp("checkin_date", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxMembershipDateIdx: index("athlete_wellness_checkins_box_membership_date_idx").on(
        table.boxId, table.membershipId, table.checkinDate
    ),
    checkinDateIdx: index("athlete_wellness_checkins_checkin_date_idx").on(table.checkinDate),
    membershipIdIdx: index("athlete_wellness_checkins_membership_id_idx").on(table.membershipId),
    boxIdIdx: index("athlete_wellness_checkins_box_id_idx").on(table.boxId),
    // Constraints for 1-10 scales
    energyLevelRange: check(
        "energy_level_range",
        sql`${table.energyLevel} >= 1 AND ${table.energyLevel} <= 10`
    ),
    sleepQualityRange: check(
        "sleep_quality_range",
        sql`${table.sleepQuality} >= 1 AND ${table.sleepQuality} <= 10`
    ),
    stressLevelRange: check(
        "stress_level_range",
        sql`${table.stressLevel} >= 1 AND ${table.stressLevel} <= 10`
    ),
    motivationLevelRange: check(
        "motivation_level_range",
        sql`${table.motivationLevel} >= 1 AND ${table.motivationLevel} <= 10`
    ),
    workoutReadinessRange: check(
        "workout_readiness_range",
        sql`${table.workoutReadiness} >= 1 AND ${table.workoutReadiness} <= 10`
    ),
    hydrationLevelRange: check(
        "hydration_level_range",
        sql`${table.hydrationLevel} >= 1 AND ${table.hydrationLevel} <= 10`
    ),
    nutritionQualityRange: check(
        "nutrition_quality_range",
        sql`${table.nutritionQuality} >= 1 AND ${table.nutritionQuality} <= 10`
    ),
}));

// NEW: Normalized soreness tracking (replaces JSON soreness field)
export const athleteSorenessEntries = pgTable("athlete_soreness_entries", {
    id: uuid("id").defaultRandom().primaryKey(),
    checkinId: uuid("checkin_id").references(() => athleteWellnessCheckins.id, { onDelete: "cascade" }).notNull(),
    bodyPart: bodyPartEnum("body_part").notNull(),
    severity: integer("severity").notNull(), // 0-10 scale
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    checkinIdIdx: index("athlete_soreness_entries_checkin_id_idx").on(table.checkinId),
    bodyPartIdx: index("athlete_soreness_entries_body_part_idx").on(table.bodyPart),
    severityIdx: index("athlete_soreness_entries_severity_idx").on(table.severity),
    // Composite indexes for analysis
    checkinBodyPartIdx: index("athlete_soreness_entries_checkin_body_part_idx").on(table.checkinId, table.bodyPart),
    // Constraints
    severityRange: check(
        "athlete_soreness_severity_range",
        sql`${table.severity} >= 0 AND ${table.severity} <= 10`
    ),
    // Unique constraint to prevent duplicate entries per checkin/body part
    checkinBodyPartUnique: unique("athlete_soreness_entries_checkin_body_part_unique").on(table.checkinId, table.bodyPart),
}));

// NEW: Normalized pain tracking (replaces JSON pain_areas field)
export const athletePainEntries = pgTable("athlete_pain_entries", {
    id: uuid("id").defaultRandom().primaryKey(),
    checkinId: uuid("checkin_id").references(() => athleteWellnessCheckins.id, { onDelete: "cascade" }).notNull(),
    bodyPart: bodyPartEnum("body_part").notNull(),
    severity: integer("severity").notNull(), // 0-10 scale
    painType: text("pain_type"), // "sharp", "dull", "throbbing", etc.
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    checkinIdIdx: index("athlete_pain_entries_checkin_id_idx").on(table.checkinId),
    bodyPartIdx: index("athlete_pain_entries_body_part_idx").on(table.bodyPart),
    severityIdx: index("athlete_pain_entries_severity_idx").on(table.severity),
    painTypeIdx: index("athlete_pain_entries_pain_type_idx").on(table.painType),
    // Composite indexes for analysis
    checkinBodyPartIdx: index("athlete_pain_entries_checkin_body_part_idx").on(table.checkinId, table.bodyPart),
    // Constraints
    severityRange: check(
        "athlete_pain_severity_range",
        sql`${table.severity} >= 0 AND ${table.severity} <= 10`
    ),
}));

// ENHANCED: WOD feedback (post-workout) with normalized pain tracking
export const wodFeedback = pgTable("wod_feedback", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // RPE and Difficulty - enhanced with constraints
    rpe: integer("rpe").notNull(), // Rate of Perceived Exertion 1-10
    difficultyRating: integer("difficulty_rating").notNull(), // 1-10 (too easy to too hard)
    enjoymentRating: integer("enjoyment_rating"), // 1-10

    // Physical Response
    feltGoodMovements: text("felt_good_movements"),
    struggledMovements: text("struggled_movements"),

    // Workout completion
    completed: boolean("completed").default(true).notNull(),
    scalingUsed: boolean("scaling_used").default(false).notNull(),
    scalingDetails: text("scaling_details"),

    // Time and results
    workoutDurationMinutes: integer("workout_duration_minutes"), // Renamed for clarity
    result: text("result"), // Free text for workout result

    // Notes
    notes: text("notes"),
    coachNotes: text("coach_notes"),

    // Reference - consistent naming
    wodName: text("wod_name").notNull(),
    wodDate: timestamp("wod_date", { withTimezone: true }).defaultNow().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxMembershipWodIdx: index("wod_feedback_box_membership_wod_idx").on(
        table.boxId, table.membershipId, table.wodDate
    ),
    wodDateIdx: index("wod_feedback_wod_date_idx").on(table.wodDate),
    membershipIdIdx: index("wod_feedback_membership_id_idx").on(table.membershipId),
    boxIdIdx: index("wod_feedback_box_id_idx").on(table.boxId),
    completedIdx: index("wod_feedback_completed_idx").on(table.completed),
    scalingUsedIdx: index("wod_feedback_scaling_used_idx").on(table.scalingUsed),
    // Constraints
    rpeRange: check(
        "wod_feedback_rpe_range",
        sql`${table.rpe} >= 1 AND ${table.rpe} <= 10`
    ),
    difficultyRange: check(
        "wod_feedback_difficulty_range",
        sql`${table.difficultyRating} >= 1 AND ${table.difficultyRating} <= 10`
    ),
    enjoymentRange: check(
        "wod_feedback_enjoyment_range",
        sql`${table.enjoymentRating} >= 1 AND ${table.enjoymentRating} <= 10`
    ),
    durationPositive: check(
        "wod_feedback_duration_positive",
        sql`${table.workoutDurationMinutes} > 0`
    ),
}));

// NEW: Normalized pain during workout tracking (replaces JSON pain_during_workout field)
export const wodPainEntries = pgTable("wod_pain_entries", {
    id: uuid("id").defaultRandom().primaryKey(),
    feedbackId: uuid("feedback_id").references(() => wodFeedback.id, { onDelete: "cascade" }).notNull(),
    bodyPart: bodyPartEnum("body_part").notNull(),
    severity: integer("severity").notNull(), // 0-10 scale
    painType: text("pain_type"), // "sharp", "dull", "throbbing", etc.
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    feedbackIdIdx: index("wod_pain_entries_feedback_id_idx").on(table.feedbackId),
    bodyPartIdx: index("wod_pain_entries_body_part_idx").on(table.bodyPart),
    severityIdx: index("wod_pain_entries_severity_idx").on(table.severity),
    painTypeIdx: index("wod_pain_entries_pain_type_idx").on(table.painType),
    // Constraints
    severityRange: check(
        "wod_pain_severity_range",
        sql`${table.severity} >= 0 AND ${table.severity} <= 10`
    ),
}));

// ENHANCED: WOD attendance tracking with proper constraints and indexes
export const wodAttendance = pgTable("wod_attendance", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // WOD details
    wodName: text("wod_name").notNull(),
    // Scheduled start time of the WOD class (when the class was supposed to begin)
    wodTime: timestamp("wod_time", { withTimezone: true }).notNull(),

    // Attendance date (the actual calendar date when attendance occurred)
    attendanceDate: date("attendance_date").notNull(), // Renamed for consistency

    // Attendance status
    status: text("status").notNull(), // "attended", "no_show", "late_cancel", "excused"
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }), // When athlete actually checked in

    // Performance metrics (for attended sessions)
    durationMinutes: integer("duration_minutes"), // Actual time spent in workout
    scaled: boolean("scaled").default(false), // Whether workout was scaled
    rx: boolean("rx").default(false), // Whether performed as prescribed
    score: text("score"), // Workout result (time, rounds, weight, etc.)
    notes: text("notes"), // Coach or athlete notes about the session

    // Coach information - FIXED: Added proper foreign key constraint
    coachMembershipId: uuid("coach_membership_id").references(() => boxMemberships.id),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Index for quick lookup by box, athlete, and date
    boxMembershipDateIdx: index("wod_attendance_box_membership_date_idx").on(
        table.boxId, table.membershipId, table.attendanceDate
    ),
    // Index for class scheduling and reporting
    wodTimeIdx: index("wod_attendance_wod_time_idx").on(table.wodTime),
    // Index for attendance date-based reporting
    attendanceDateIdx: index("wod_attendance_attendance_date_idx").on(table.attendanceDate),
    // Index for status filtering
    statusIdx: index("wod_attendance_status_idx").on(table.status),
    // Enhanced indexes
    membershipIdIdx: index("wod_attendance_membership_id_idx").on(table.membershipId),
    boxIdIdx: index("wod_attendance_box_id_idx").on(table.boxId),
    coachMembershipIdIdx: index("wod_attendance_coach_membership_id_idx").on(table.coachMembershipId),
    checkedInAtIdx: index("wod_attendance_checked_in_at_idx").on(table.checkedInAt),
    rxIdx: index("wod_attendance_rx_idx").on(table.rx),
    scaledIdx: index("wod_attendance_scaled_idx").on(table.scaled),
    // Composite indexes for common queries
    boxStatusDateIdx: index("wod_attendance_box_status_date_idx").on(table.boxId, table.status, table.attendanceDate),
    membershipStatusIdx: index("wod_attendance_membership_status_idx").on(table.membershipId, table.status),
    // Constraints
    durationPositive: check(
        "wod_attendance_duration_positive",
        sql`${table.durationMinutes} > 0`
    ),
}));

// ENHANCED: Athlete badges and achievements
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
    awardedAt: timestamp("awarded_at", { withTimezone: true }).defaultNow().notNull(),
    isHidden: boolean("is_hidden").default(false).notNull(), // Hide from athlete if needed

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxMembershipBadgeIdx: index("athlete_badges_box_membership_badge_idx").on(
        table.boxId, table.membershipId, table.badgeType
    ),
    awardedAtIdx: index("athlete_badges_awarded_at_idx").on(table.awardedAt),
    membershipIdIdx: index("athlete_badges_membership_id_idx").on(table.membershipId),
    boxIdIdx: index("athlete_badges_box_id_idx").on(table.boxId),
    badgeTypeIdx: index("athlete_badges_badge_type_idx").on(table.badgeType),
    tierIdx: index("athlete_badges_tier_idx").on(table.tier),
    hiddenIdx: index("athlete_badges_hidden_idx").on(table.isHidden),
    // Constraints
    tierPositive: check(
        "athlete_badges_tier_positive",
        sql`${table.tier} >= 1`
    ),
}));

// ENHANCED: Leaderboards for engagement
export const leaderboards = pgTable("leaderboards", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Leaderboard details
    name: text("name").notNull(),
    type: text("type").notNull(), // "benchmark", "pr", "streak", "custom"
    category: text("category"), // "rx", "scaled", "all"

    // Filtering criteria - FIXED: Added proper foreign key constraints
    movementId: uuid("movement_id").references(() => movements.id, { onDelete: "set null" }),
    benchmarkId: uuid("benchmark_id").references(() => benchmarkWods.id, { onDelete: "set null" }),

    // Time period
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),

    // Settings
    isActive: boolean("is_active").default(true).notNull(),
    maxEntries: integer("max_entries").default(10).notNull(), // Top N athletes

    // Metadata - FIXED: Should reference box_memberships, not user directly
    createdByMembershipId: uuid("created_by_membership_id").references(() => boxMemberships.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("leaderboards_box_id_idx").on(table.boxId),
    typeIdx: index("leaderboards_type_idx").on(table.type),
    activeIdx: index("leaderboards_active_idx").on(table.isActive),
    movementIdIdx: index("leaderboards_movement_id_idx").on(table.movementId),
    benchmarkIdIdx: index("leaderboards_benchmark_id_idx").on(table.benchmarkId),
    createdByIdx: index("leaderboards_created_by_idx").on(table.createdByMembershipId),
    periodStartIdx: index("leaderboards_period_start_idx").on(table.periodStart),
    periodEndIdx: index("leaderboards_period_end_idx").on(table.periodEnd),
    // Composite indexes
    boxActiveTypeIdx: index("leaderboards_box_active_type_idx").on(table.boxId, table.isActive, table.type),
    // Constraints
    maxEntriesPositive: check(
        "leaderboards_max_entries_positive",
        sql`${table.maxEntries} >= 1`
    ),
}));

// ENHANCED: Leaderboard entries with proper foreign key constraints
export const leaderboardEntries = pgTable("leaderboard_entries", {
    id: uuid("id").defaultRandom().primaryKey(),
    leaderboardId: uuid("leaderboard_id").references(() => leaderboards.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // Entry data
    value: decimal("value", { precision: 10, scale: 3 }).notNull(),
    rank: integer("rank").notNull(),

    // References to source records - FIXED: Added proper foreign key constraints
    prId: uuid("pr_id").references(() => athletePrs.id, { onDelete: "set null" }),
    benchmarkId: uuid("benchmark_id").references(() => athleteBenchmarks.id, { onDelete: "set null" }),

    // Metadata
    achievedAt: timestamp("achieved_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    leaderboardRankIdx: index("leaderboard_entries_leaderboard_rank_idx").on(
        table.leaderboardId, table.rank
    ),
    leaderboardMembershipIdx: index("leaderboard_entries_leaderboard_membership_idx").on(
        table.leaderboardId, table.membershipId
    ),
    membershipIdIdx: index("leaderboard_entries_membership_id_idx").on(table.membershipId),
    prIdIdx: index("leaderboard_entries_pr_id_idx").on(table.prId),
    benchmarkIdIdx: index("leaderboard_entries_benchmark_id_idx").on(table.benchmarkId),
    achievedAtIdx: index("leaderboard_entries_achieved_at_idx").on(table.achievedAt),
    // Constraints
    rankPositive: check(
        "leaderboard_entries_rank_positive",
        sql`${table.rank} >= 1`
    ),
    valuePositive: check(
        "leaderboard_entries_value_positive",
        sql`${table.value} > 0`
    ),
    // Unique constraint for leaderboard position
    leaderboardRankUnique: unique("leaderboard_entries_leaderboard_rank_unique").on(table.leaderboardId, table.rank),
}));

// Import sql for where clauses
import { sql } from "drizzle-orm";

// Relations - Enhanced with proper naming and relationship clarification
export const movementsRelations = relations(movements, ({ many }) => ({
    athletePrs: many(athletePrs, { relationName: "movement_prs" }),
    leaderboards: many(leaderboards, { relationName: "movement_leaderboards" }),
}));

export const benchmarkWodsRelations = relations(benchmarkWods, ({ many }) => ({
    athleteBenchmarks: many(athleteBenchmarks, { relationName: "benchmark_results" }),
    leaderboards: many(leaderboards, { relationName: "benchmark_leaderboards" }),
}));

export const athletePrsRelations = relations(athletePrs, ({ one, many }) => ({
    box: one(boxes, {
        fields: [athletePrs.boxId],
        references: [boxes.id],
        relationName: "box_prs"
    }),
    membership: one(boxMemberships, {
        fields: [athletePrs.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_prs"
    }),
    movement: one(movements, {
        fields: [athletePrs.movementId],
        references: [movements.id],
        relationName: "movement_prs"
    }),
    leaderboardEntries: many(leaderboardEntries, { relationName: "pr_leaderboard_entries" }),
    videoConsents: many(videoConsents, { relationName: "pr_video_consents" }),
    videoProcessingEvents: many(videoProcessingEvents, { relationName: "pr_video_events" }),
}));

export const videoConsentsRelations = relations(videoConsents, ({ one }) => ({
    membership: one(boxMemberships, {
        fields: [videoConsents.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_video_consents"
    }),
    pr: one(athletePrs, {
        fields: [videoConsents.prId],
        references: [athletePrs.id],
        relationName: "pr_video_consents"
    }),
}));

export const videoProcessingEventsRelations = relations(videoProcessingEvents, ({ one }) => ({
    pr: one(athletePrs, {
        fields: [videoProcessingEvents.prId],
        references: [athletePrs.id],
        relationName: "pr_video_events"
    }),
}));

export const athleteBenchmarksRelations = relations(athleteBenchmarks, ({ one, many }) => ({
    box: one(boxes, {
        fields: [athleteBenchmarks.boxId],
        references: [boxes.id],
        relationName: "box_benchmarks"
    }),
    membership: one(boxMemberships, {
        fields: [athleteBenchmarks.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_benchmarks"
    }),
    benchmark: one(benchmarkWods, {
        fields: [athleteBenchmarks.benchmarkId],
        references: [benchmarkWods.id],
        relationName: "benchmark_results"
    }),
    leaderboardEntries: many(leaderboardEntries, { relationName: "benchmark_leaderboard_entries" }),
}));

export const athleteWellnessCheckinsRelations = relations(athleteWellnessCheckins, ({ one, many }) => ({
    box: one(boxes, {
        fields: [athleteWellnessCheckins.boxId],
        references: [boxes.id],
        relationName: "box_wellness_checkins"
    }),
    membership: one(boxMemberships, {
        fields: [athleteWellnessCheckins.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_wellness_checkins"
    }),
    sorenessEntries: many(athleteSorenessEntries, { relationName: "checkin_soreness_entries" }),
    painEntries: many(athletePainEntries, { relationName: "checkin_pain_entries" }),
}));

export const athleteSorenessEntriesRelations = relations(athleteSorenessEntries, ({ one }) => ({
    checkin: one(athleteWellnessCheckins, {
        fields: [athleteSorenessEntries.checkinId],
        references: [athleteWellnessCheckins.id],
        relationName: "checkin_soreness_entries"
    }),
}));

export const athletePainEntriesRelations = relations(athletePainEntries, ({ one }) => ({
    checkin: one(athleteWellnessCheckins, {
        fields: [athletePainEntries.checkinId],
        references: [athleteWellnessCheckins.id],
        relationName: "checkin_pain_entries"
    }),
}));

export const wodFeedbackRelations = relations(wodFeedback, ({ one, many }) => ({
    box: one(boxes, {
        fields: [wodFeedback.boxId],
        references: [boxes.id],
        relationName: "box_wod_feedback"
    }),
    membership: one(boxMemberships, {
        fields: [wodFeedback.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_wod_feedback"
    }),
    painEntries: many(wodPainEntries, { relationName: "wod_pain_entries" }),
}));

export const wodPainEntriesRelations = relations(wodPainEntries, ({ one }) => ({
    feedback: one(wodFeedback, {
        fields: [wodPainEntries.feedbackId],
        references: [wodFeedback.id],
        relationName: "wod_pain_entries"
    }),
}));

export const wodAttendanceRelations = relations(wodAttendance, ({ one }) => ({
    box: one(boxes, {
        fields: [wodAttendance.boxId],
        references: [boxes.id],
        relationName: "box_wod_attendance"
    }),
    membership: one(boxMemberships, {
        fields: [wodAttendance.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_wod_attendance"
    }),
    coach: one(boxMemberships, {
        fields: [wodAttendance.coachMembershipId],
        references: [boxMemberships.id],
        relationName: "coach_wod_attendance"
    }),
}));

export const athleteBadgesRelations = relations(athleteBadges, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteBadges.boxId],
        references: [boxes.id],
        relationName: "box_athlete_badges"
    }),
    membership: one(boxMemberships, {
        fields: [athleteBadges.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_athlete_badges"
    }),
}));

export const leaderboardsRelations = relations(leaderboards, ({ one, many }) => ({
    box: one(boxes, {
        fields: [leaderboards.boxId],
        references: [boxes.id],
        relationName: "box_leaderboards"
    }),
    movement: one(movements, {
        fields: [leaderboards.movementId],
        references: [movements.id],
        relationName: "movement_leaderboards"
    }),
    benchmark: one(benchmarkWods, {
        fields: [leaderboards.benchmarkId],
        references: [benchmarkWods.id],
        relationName: "benchmark_leaderboards"
    }),
    createdBy: one(boxMemberships, {
        fields: [leaderboards.createdByMembershipId],
        references: [boxMemberships.id],
        relationName: "created_leaderboards"
    }),
    entries: many(leaderboardEntries, { relationName: "leaderboard_entries" }),
}));

export const leaderboardEntriesRelations = relations(leaderboardEntries, ({ one }) => ({
    leaderboard: one(leaderboards, {
        fields: [leaderboardEntries.leaderboardId],
        references: [leaderboards.id],
        relationName: "leaderboard_entries"
    }),
    membership: one(boxMemberships, {
        fields: [leaderboardEntries.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_leaderboard_entries"
    }),
    pr: one(athletePrs, {
        fields: [leaderboardEntries.prId],
        references: [athletePrs.id],
        relationName: "pr_leaderboard_entries"
    }),
    benchmark: one(athleteBenchmarks, {
        fields: [leaderboardEntries.benchmarkId],
        references: [athleteBenchmarks.id],
        relationName: "benchmark_leaderboard_entries"
    }),
}));
