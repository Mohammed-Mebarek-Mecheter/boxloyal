// db/schema/analytics.ts
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

// Risk levels for member retention
export const riskLevelEnum = pgEnum("risk_level", [
    "low",
    "medium",
    "high",
    "critical"
]);

// Alert types
export const alertTypeEnum = pgEnum("alert_type", [
    "declining_performance",
    "poor_attendance",
    "negative_wellness",
    "no_checkin",
    "injury_risk",
    "engagement_drop",
    "churn_risk"
]);

export const alertStatusEnum = pgEnum("alert_status", [
    "active",
    "acknowledged",
    "resolved",
    "dismissed"
]);

// Member retention risk scores
export const memberRiskScores = pgTable("member_risk_scores", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),

    // Risk Assessment
    overallRiskScore: decimal("overall_risk_score", { precision: 5, scale: 2 }).notNull(), // 0-100
    riskLevel: riskLevelEnum("risk_level").notNull(),
    churnProbability: decimal("churn_probability", { precision: 5, scale: 4 }), // 0-1

    // Component Scores
    attendanceScore: decimal("attendance_score", { precision: 5, scale: 2 }).notNull(),
    performanceScore: decimal("performance_score", { precision: 5, scale: 2 }).notNull(),
    engagementScore: decimal("engagement_score", { precision: 5, scale: 2 }).notNull(),
    wellnessScore: decimal("wellness_score", { precision: 5, scale: 2 }).notNull(),

    // Trends (compared to previous period)
    attendanceTrend: decimal("attendance_trend", { precision: 5, scale: 2 }), // % change
    performanceTrend: decimal("performance_trend", { precision: 5, scale: 2 }),
    engagementTrend: decimal("engagement_trend", { precision: 5, scale: 2 }),
    wellnessTrend: decimal("wellness_trend", { precision: 5, scale: 2 }),

    // Key Metrics
    daysSinceLastVisit: integer("days_since_last_visit"),
    daysSinceLastCheckin: integer("days_since_last_checkin"),
    daysSinceLastPr: integer("days_since_last_pr"),

    // Prediction factors
    factors: json("factors"), // Contributing risk factors and their weights

    // Metadata
    calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
    validUntil: timestamp("valid_until").notNull(), // Score expiry

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    gymMemberIdx: index("member_risk_scores_gym_member_idx").on(table.gymId, table.membershipId),
    riskLevelIdx: index("member_risk_scores_risk_level_idx").on(table.riskLevel),
    overallScoreIdx: index("member_risk_scores_overall_score_idx").on(table.overallRiskScore),
    calculatedAtIdx: index("member_risk_scores_calculated_at_idx").on(table.calculatedAt),
}));

// Coach alerts for member intervention
export const memberAlerts = pgTable("member_alerts", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),
    assignedCoachId: uuid("assigned_coach_id").references(() => gymMemberships.id),

    // Alert Details
    alertType: alertTypeEnum("alert_type").notNull(),
    severity: riskLevelEnum("severity").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),

    // Context Data
    triggerData: json("trigger_data"), // Data that triggered the alert
    suggestedActions: json("suggested_actions"), // Recommended interventions

    // Status & Resolution
    status: alertStatusEnum("status").default("active").notNull(),
    acknowledgedAt: timestamp("acknowledged_at"),
    acknowledgedById: uuid("acknowledged_by_id").references(() => gymMemberships.id),
    resolvedAt: timestamp("resolved_at"),
    resolvedById: uuid("resolved_by_id").references(() => gymMemberships.id),
    resolutionNotes: text("resolution_notes"),

    // Follow-up
    followUpAt: timestamp("follow_up_at"),
    remindersSent: integer("reminders_sent").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    gymMemberIdx: index("member_alerts_gym_member_idx").on(table.gymId, table.membershipId),
    statusIdx: index("member_alerts_status_idx").on(table.status),
    severityIdx: index("member_alerts_severity_idx").on(table.severity),
    assignedCoachIdx: index("member_alerts_assigned_coach_idx").on(table.assignedCoachId),
    followUpIdx: index("member_alerts_follow_up_idx").on(table.followUpAt),
}));

// Coach interventions and actions taken
export const memberInterventions = pgTable("member_interventions", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),
    coachId: uuid("coach_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),
    alertId: uuid("alert_id").references(() => memberAlerts.id), // Optional - might not be alert-driven

    // Intervention Details
    interventionType: text("intervention_type").notNull(), // "conversation", "goal_setting", "program_modification", etc.
    title: text("title").notNull(),
    description: text("description").notNull(),

    // Outcome
    outcome: text("outcome"), // "positive", "neutral", "negative", "no_response"
    memberResponse: text("member_response"),
    coachNotes: text("coach_notes"),

    // Follow-up
    followUpRequired: boolean("follow_up_required").default(false).notNull(),
    followUpAt: timestamp("follow_up_at"),
    followUpCompleted: boolean("follow_up_completed").default(false).notNull(),

    // Metadata
    interventionDate: timestamp("intervention_date").defaultNow().notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    gymMemberIdx: index("member_interventions_gym_member_idx").on(table.gymId, table.membershipId),
    coachIdx: index("member_interventions_coach_idx").on(table.coachId),
    interventionDateIdx: index("member_interventions_intervention_date_idx").on(table.interventionDate),
}));

// Gym analytics snapshots (daily/weekly/monthly aggregates)
export const gymAnalytics = pgTable("gym_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),

    // Period
    period: text("period").notNull(), // "daily", "weekly", "monthly"
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),

    // Member Metrics
    totalMembers: integer("total_members").notNull(),
    activeMembers: integer("active_members").notNull(),
    newMembers: integer("new_members").notNull(),
    churnedMembers: integer("churned_members").notNull(),
    retentionRate: decimal("retention_rate", { precision: 5, scale: 2 }),

    // Engagement Metrics
    totalCheckins: integer("total_checkins").notNull(),
    totalAttendances: integer("total_attendances").notNull(),
    avgAttendancePerMember: decimal("avg_attendance_per_member", { precision: 5, scale: 2 }),
    checkinRate: decimal("checkin_rate", { precision: 5, scale: 2 }), // % of active members checking in

    // Performance Metrics
    totalPrs: integer("total_prs").notNull(),
    totalBenchmarkAttempts: integer("total_benchmark_attempts").notNull(),
    avgMemberPerformanceScore: decimal("avg_member_performance_score", { precision: 5, scale: 2 }),

    // Risk & Alert Metrics
    highRiskMembers: integer("high_risk_members").notNull(),
    totalActiveAlerts: integer("total_active_alerts").notNull(),
    alertsResolved: integer("alerts_resolved").notNull(),
    avgTimeToAlertResolution: decimal("avg_time_to_alert_resolution", { precision: 8, scale: 2 }), // hours

    // Wellness Metrics
    avgEnergyLevel: decimal("avg_energy_level", { precision: 3, scale: 2 }),
    avgSleepQuality: decimal("avg_sleep_quality", { precision: 3, scale: 2 }),
    avgStressLevel: decimal("avg_stress_level", { precision: 3, scale: 2 }),
    avgWorkoutReadiness: decimal("avg_workout_readiness", { precision: 3, scale: 2 }),

    // Additional metrics as JSON for flexibility
    customMetrics: json("custom_metrics"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    gymPeriodIdx: index("gym_analytics_gym_period_idx").on(table.gymId, table.period, table.periodStart),
    periodStartIdx: index("gym_analytics_period_start_idx").on(table.periodStart),
}));

// Member progress milestones and celebrations
export const memberMilestones = pgTable("member_milestones", {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => gymMemberships.id, { onDelete: "cascade" }).notNull(),

    // Milestone Details
    milestoneType: text("milestone_type").notNull(), // "pr", "attendance", "benchmark", "consistency", "transformation"
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category"), // e.g., "strength", "conditioning", "community"

    // Achievement Data
    value: text("value"), // The achieved value (weight, time, etc.)
    previousValue: text("previous_value"), // Previous best for comparison
    improvementPercent: decimal("improvement_percent", { precision: 5, scale: 2 }),

    // Recognition
    celebrated: boolean("celebrated").default(false).notNull(),
    celebratedAt: timestamp("celebrated_at"),
    celebrationType: text("celebration_type"), // "announcement", "social_post", "reward"

    // Metadata
    achievedAt: timestamp("achieved_at").defaultNow().notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    gymMemberIdx: index("member_milestones_gym_member_idx").on(table.gymId, table.membershipId),
    milestoneTypeIdx: index("member_milestones_milestone_type_idx").on(table.milestoneType),
    achievedAtIdx: index("member_milestones_achieved_at_idx").on(table.achievedAt),
}));

// Relations
export const memberRiskScoresRelations = relations(memberRiskScores, ({ one }) => ({
    gym: one(gyms, {
        fields: [memberRiskScores.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [memberRiskScores.membershipId],
        references: [gymMemberships.id],
    }),
}));

export const memberAlertsRelations = relations(memberAlerts, ({ one }) => ({
    gym: one(gyms, {
        fields: [memberAlerts.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [memberAlerts.membershipId],
        references: [gymMemberships.id],
    }),
    assignedCoach: one(gymMemberships, {
        fields: [memberAlerts.assignedCoachId],
        references: [gymMemberships.id],
    }),
}));

export const memberInterventionsRelations = relations(memberInterventions, ({ one }) => ({
    gym: one(gyms, {
        fields: [memberInterventions.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [memberInterventions.membershipId],
        references: [gymMemberships.id],
    }),
    coach: one(gymMemberships, {
        fields: [memberInterventions.coachId],
        references: [gymMemberships.id],
    }),
    alert: one(memberAlerts, {
        fields: [memberInterventions.alertId],
        references: [memberAlerts.id],
    }),
}));

export const gymAnalyticsRelations = relations(gymAnalytics, ({ one }) => ({
    gym: one(gyms, {
        fields: [gymAnalytics.gymId],
        references: [gyms.id],
    }),
}));

export const memberMilestonesRelations = relations(memberMilestones, ({ one }) => ({
    gym: one(gyms, {
        fields: [memberMilestones.gymId],
        references: [gyms.id],
    }),
    membership: one(gymMemberships, {
        fields: [memberMilestones.membershipId],
        references: [gymMemberships.id],
    }),
}));
