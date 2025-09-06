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
import {boxes, boxMemberships, userRoleEnum} from "./core";

// Risk levels for athlete retention
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

// Athlete retention risk scores
export const athleteRiskScores = pgTable("athlete_risk_scores", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

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
    boxAthleteIdx: index("athlete_risk_scores_box_athlete_idx").on(table.boxId, table.membershipId),
    riskLevelIdx: index("athlete_risk_scores_risk_level_idx").on(table.riskLevel),
    overallScoreIdx: index("athlete_risk_scores_overall_score_idx").on(table.overallRiskScore),
    calculatedAtIdx: index("athlete_risk_scores_calculated_at_idx").on(table.calculatedAt),
}));

// Coach alerts for athlete intervention
export const athleteAlerts = pgTable("athlete_alerts", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    assignedCoachId: uuid("assigned_coach_id").references(() => boxMemberships.id),

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
    acknowledgedById: uuid("acknowledged_by_id").references(() => boxMemberships.id),
    resolvedAt: timestamp("resolved_at"),
    resolvedById: uuid("resolved_by_id").references(() => boxMemberships.id),
    resolutionNotes: text("resolution_notes"),

    // Follow-up
    followUpAt: timestamp("follow_up_at"),
    remindersSent: integer("reminders_sent").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    boxAthleteIdx: index("athlete_alerts_box_athlete_idx").on(table.boxId, table.membershipId),
    statusIdx: index("athlete_alerts_status_idx").on(table.status),
    severityIdx: index("athlete_alerts_severity_idx").on(table.severity),
    assignedCoachIdx: index("athlete_alerts_assigned_coach_idx").on(table.assignedCoachId),
    followUpIdx: index("athlete_alerts_follow_up_idx").on(table.followUpAt),
}));

// Coach interventions and actions taken
export const athleteInterventions = pgTable("athlete_interventions", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    coachId: uuid("coach_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    alertId: uuid("alert_id").references(() => athleteAlerts.id), // Optional - might not be alert-driven

    // Intervention Details
    interventionType: text("intervention_type").notNull(), // "conversation", "goal_setting", "program_modification", etc.
    title: text("title").notNull(),
    description: text("description").notNull(),

    // Outcome
    outcome: text("outcome"), // "positive", "neutral", "negative", "no_response"
    athleteResponse: text("athlete_response"),
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
    boxAthleteIdx: index("athlete_interventions_box_athlete_idx").on(table.boxId, table.membershipId),
    coachIdx: index("athlete_interventions_coach_idx").on(table.coachId),
    interventionDateIdx: index("athlete_interventions_intervention_date_idx").on(table.interventionDate),
}));

// Box analytics snapshots (daily/weekly/monthly aggregates)
export const boxAnalytics = pgTable("box_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Period
    period: text("period").notNull(), // "daily", "weekly", "monthly"
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),

    // Athlete Metrics
    totalAthletes: integer("total_athletes").notNull(),
    activeAthletes: integer("active_athletes").notNull(),
    newAthletes: integer("new_athletes").notNull(),
    churnedAthletes: integer("churned_athletes").notNull(),
    retentionRate: decimal("retention_rate", { precision: 5, scale: 2 }),

    // Engagement Metrics
    totalCheckins: integer("total_checkins").notNull(),
    totalAttendances: integer("total_attendances").notNull(),
    avgAttendancePerAthlete: decimal("avg_attendance_per_athlete", { precision: 5, scale: 2 }),
    checkinRate: decimal("checkin_rate", { precision: 5, scale: 2 }), // % of active athletes checking in

    // Performance Metrics
    totalPrs: integer("total_prs").notNull(),
    totalBenchmarkAttempts: integer("total_benchmark_attempts").notNull(),
    avgAthletePerformanceScore: decimal("avg_athlete_performance_score", { precision: 5, scale: 2 }),

    // Risk & Alert Metrics
    highRiskAthletes: integer("high_risk_athletes").notNull(),
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
    boxPeriodIdx: index("box_analytics_box_period_idx").on(table.boxId, table.period, table.periodStart),
    periodStartIdx: index("box_analytics_period_start_idx").on(table.periodStart),
}));

// Athlete progress milestones and celebrations
export const athleteMilestones = pgTable("athlete_milestones", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

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
    boxAthleteIdx: index("athlete_milestones_box_athlete_idx").on(table.boxId, table.membershipId),
    milestoneTypeIdx: index("athlete_milestones_milestone_type_idx").on(table.milestoneType),
    achievedAtIdx: index("athlete_milestones_achieved_at_idx").on(table.achievedAt),
}));

// SaaS Admin
export const demoEngagementMetrics = pgTable("demo_engagement_metrics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id).notNull(),
    role: userRoleEnum("role").notNull(),
    demoDuration: integer("demo_duration"),
    featuresExplored: json("features_explored"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    boxIdx: index("demo_engagement_metrics_box_idx").on(table.boxId),
    roleIdx: index("demo_engagement_metrics_role_idx").on(table.role),
    createdAtIdx: index("demo_engagement_metrics_created_at_idx").on(table.createdAt),
}));

// Relations
export const athleteRiskScoresRelations = relations(athleteRiskScores, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteRiskScores.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [athleteRiskScores.membershipId],
        references: [boxMemberships.id],
    }),
}));

export const athleteAlertsRelations = relations(athleteAlerts, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteAlerts.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [athleteAlerts.membershipId],
        references: [boxMemberships.id],
    }),
    assignedCoach: one(boxMemberships, {
        fields: [athleteAlerts.assignedCoachId],
        references: [boxMemberships.id],
    }),
}));

export const athleteInterventionsRelations = relations(athleteInterventions, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteInterventions.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [athleteInterventions.membershipId],
        references: [boxMemberships.id],
    }),
    coach: one(boxMemberships, {
        fields: [athleteInterventions.coachId],
        references: [boxMemberships.id],
    }),
    alert: one(athleteAlerts, {
        fields: [athleteInterventions.alertId],
        references: [athleteAlerts.id],
    }),
}));

export const boxAnalyticsRelations = relations(boxAnalytics, ({ one }) => ({
    box: one(boxes, {
        fields: [boxAnalytics.boxId],
        references: [boxes.id],
    }),
}));

export const athleteMilestonesRelations = relations(athleteMilestones, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteMilestones.boxId],
        references: [boxes.id],
    }),
    membership: one(boxMemberships, {
        fields: [athleteMilestones.membershipId],
        references: [boxMemberships.id],
    }),
}));

export const demoEngagementMetricsRelations = relations(demoEngagementMetrics, ({ one }) => ({
    box: one(boxes, {
        fields: [demoEngagementMetrics.boxId],
        references: [boxes.id],
    }),
}));
