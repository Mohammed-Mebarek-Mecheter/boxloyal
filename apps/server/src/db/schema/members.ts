// Updated with engagement and gamification features
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
    json
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { gyms, gymMemberships } from "./core";

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
    "private", // Only the member and coaches
    "box",     // All members of the box
    "public"   // For leaderboards/social sharing (requires coach approval)
]);

// Movement types for PR tracking
export const movements = pgTable("movements", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    category: movementCategoryEnum("category").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    isStandard: boolean("is_standard").default(false).notNull(), // Standard CrossFit movements

    // Measurement
    unit: text("unit").notNull(), // "lbs", "kg", "seconds", "reps"
    isTimeBased: boolean("is_time_based").default(false).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    nameIdx: index("movements_name_idx").on(table.name),
    categoryIdx: index("movements_category_idx").on(table.category),
}));

// Benchmark WODs (Fran, Grace, Helen, etc.)
export const benchmarkWods = pgTable("benchmark_wods", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description").notNull(),
    type: text("type").notNull(), // "time", "rounds", "max_weight"
    standard: boolean("is_standard").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    nameIdx: index("benchmark_wods_name_idx").on(table.name),
}));

// Member Personal Records
export const memberPrs = pgTable("member_prs", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),
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
    gymMemberMovementIdx: index("member_prs_gym_member_movement_idx").on(
        table.gymId, table.membershipId, table.movementId
    ),
    gymMovementIdx: index("member_prs_gym_movement_idx").on(table.gymId, table.movementId),
    achievedAtIdx: index("member_prs_achieved_at_idx").on(table.achievedAt),
}));

// Member Benchmark WOD Results
export const memberBenchmarks = pgTable("member_benchmarks", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),
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
    gymMemberBenchmarkIdx: index("member_benchmarks_gym_member_benchmark_idx").on(
        table.gymId, table.membershipId, table.benchmarkId
    ),
    completedAtIdx: index("member_benchmarks_completed_at_idx").on(table.completedAt),
}));

// Daily wellness check-ins
export const memberCheckins = pgTable("member_checkins", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),

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
    gymMemberDateIdx: index("member_checkins_gym_member_date_idx").on(
        table.gymId, table.membershipId, table.checkinDate
    ),
    checkinDateIdx: index("member_checkins_checkin_date_idx").on(table.checkinDate),
}));

// Workout feedback (post-workout)
export const workoutFeedback = pgTable("workout_feedback", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),

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
    workoutName: text("workout_name"),
    workoutDate: timestamp("workout_date").defaultNow().notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    gymMemberWorkoutIdx: index("workout_feedback_gym_member_workout_idx").on(
        table.gymId, table.membershipId, table.workoutDate
    ),
    workoutDateIdx: index("workout_feedback_workout_date_idx").on(table.workoutDate),
}));

// Class attendance tracking
export const classAttendance = pgTable("class_attendance", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),

    // Class details
    className: text("class_name").notNull(),
    classTime: timestamp("class_time").notNull(),

    // Attendance
    status: text("status").notNull(), // "attended", "no_show", "late_cancel"
    checkedInAt: timestamp("checked_in_at"),

    // Coach
    coachMembershipId: uuid("coach_membership_id").references(() => gymMemberships.id),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    gymMemberClassIdx: index("class_attendance_gym_member_class_idx").on(
        table.gymId, table.membershipId, table.classTime
    ),
    classTimeIdx: index("class_attendance_class_time_idx").on(table.classTime),
}));

// Member badges and achievements
export const memberBadges = pgTable("member_badges", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),

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
    isHidden: boolean("is_hidden").default(false).notNull(), // Hide from member if needed

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    gymMemberBadgeIdx: index("member_badges_gym_member_badge_idx").on(
        table.gymId, table.membershipId, table.badgeType
    ),
    awardedAtIdx: index("member_badges_awarded_at_idx").on(table.awardedAt),
}));

// Relations
export const movementsRelations = relations(movements, ({ many }) => ({
    memberPrs: many(memberPrs),
}));

export const benchmarkWodsRelations = relations(benchmarkWods, ({ many }) => ({
    memberBenchmarks: many(memberBenchmarks),
}));

export const memberPrsRelations = relations(memberPrs, ({ one }) => ({
    gym: one(gyms, {
        fields: [memberPrs.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [memberPrs.membershipId],
        references: [gymMemberships.id],
    }),
    movement: one(movements, {
        fields: [memberPrs.movementId],
        references: [movements.id],
    }),
}));

export const memberBenchmarksRelations = relations(memberBenchmarks, ({ one }) => ({
    gym: one(gyms, {
        fields: [memberBenchmarks.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [memberBenchmarks.membershipId],
        references: [gymMemberships.id],
    }),
    benchmark: one(benchmarkWods, {
        fields: [memberBenchmarks.benchmarkId],
        references: [benchmarkWods.id],
    }),
}));

export const memberCheckinsRelations = relations(memberCheckins, ({ one }) => ({
    gym: one(gyms, {
        fields: [memberCheckins.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [memberCheckins.membershipId],
        references: [gymMemberships.id],
    }),
}));

export const workoutFeedbackRelations = relations(workoutFeedback, ({ one }) => ({
    gym: one(gyms, {
        fields: [workoutFeedback.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [workoutFeedback.membershipId],
        references: [gymMemberships.id],
    }),
}));

export const classAttendanceRelations = relations(classAttendance, ({ one }) => ({
    gym: one(gyms, {
        fields: [classAttendance.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [classAttendance.membershipId],
        references: [gymMemberships.id],
    }),
    coach: one(gymMemberships, {
        fields: [classAttendance.coachMembershipId],
        references: [gymMemberships.id],
    }),
}));

export const memberBadgesRelations = relations(memberBadges, ({ one }) => ({
    gym: one(gyms, {
        fields: [memberBadges.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [memberBadges.membershipId],
        references: [gymMemberships.id],
    }),
}));
