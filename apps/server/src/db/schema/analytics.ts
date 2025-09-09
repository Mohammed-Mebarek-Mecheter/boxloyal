// db/schema/analytics.ts - Optimized version with improved indexing
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
    check,
    unique
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { boxes, boxMemberships, userRoleEnum } from "./core";

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

// CRITICAL MVP TABLE: Athlete retention risk scores
export const athleteRiskScores = pgTable("athlete_risk_scores", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // Risk Assessment - enhanced with proper constraints
    overallRiskScore: decimal("overall_risk_score", { precision: 5, scale: 2 }).notNull(), // 0-100
    riskLevel: riskLevelEnum("risk_level").notNull(),
    churnProbability: decimal("churn_probability", { precision: 5, scale: 4 }), // 0-1

    // Component Scores - all required for MVP
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

    // Metadata - consistent timestamp naming
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(), // Score expiry

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Optimized indexing for performance
    boxMembershipIdx: index("athlete_risk_scores_box_membership_idx").on(table.boxId, table.membershipId),
    riskLevelIdx: index("athlete_risk_scores_risk_level_idx").on(table.riskLevel),
    calculatedAtIdx: index("athlete_risk_scores_calculated_at_idx").on(table.calculatedAt),
    validUntilIdx: index("athlete_risk_scores_valid_until_idx").on(table.validUntil),

    // NEW: Composite index for getting latest risk score per membership
    membershipCalculatedAtIdx: index("athlete_risk_scores_membership_calculated_at_idx")
        .on(table.membershipId, table.calculatedAt.desc()),

    // Composite indexes for common queries
    boxRiskLevelIdx: index("athlete_risk_scores_box_risk_level_idx").on(table.boxId, table.riskLevel),
    validScoresIdx: index("athlete_risk_scores_valid_idx").on(table.validUntil, table.calculatedAt),

    // Constraints
    overallScoreRange: check(
        "overall_risk_score_range",
        sql`${table.overallRiskScore} >= 0 AND ${table.overallRiskScore} <= 100`
    ),
    churnProbabilityRange: check(
        "churn_probability_range",
        sql`${table.churnProbability} >= 0 AND ${table.churnProbability} <= 1`
    ),
    attendanceScoreRange: check(
        "attendance_score_range",
        sql`${table.attendanceScore} >= 0 AND ${table.attendanceScore} <= 100`
    ),
    performanceScoreRange: check(
        "performance_score_range",
        sql`${table.performanceScore} >= 0 AND ${table.performanceScore} <= 100`
    ),
    engagementScoreRange: check(
        "engagement_score_range",
        sql`${table.engagementScore} >= 0 AND ${table.engagementScore} <= 100`
    ),
    wellnessScoreRange: check(
        "wellness_score_range",
        sql`${table.wellnessScore} >= 0 AND ${table.wellnessScore} <= 100`
    ),
    daysSinceLastVisitPositive: check(
        "days_since_last_visit_positive",
        sql`${table.daysSinceLastVisit} >= 0`
    ),
    daysSinceLastCheckinPositive: check(
        "days_since_last_checkin_positive",
        sql`${table.daysSinceLastCheckin} >= 0`
    ),
    daysSinceLastPrPositive: check(
        "days_since_last_pr_positive",
        sql`${table.daysSinceLastPr} >= 0`
    ),
}));

// CRITICAL MVP TABLE: Coach alerts for athlete intervention
export const athleteAlerts = pgTable("athlete_alerts", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    assignedCoachId: uuid("assigned_coach_id").references(() => boxMemberships.id, { onDelete: "set null" }),

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
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedById: uuid("acknowledged_by_id").references(() => boxMemberships.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => boxMemberships.id),
    resolutionNotes: text("resolution_notes"),

    // Follow-up
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    remindersSent: integer("reminders_sent").default(0).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Optimized indexing for performance
    boxMembershipIdx: index("athlete_alerts_box_membership_idx").on(table.boxId, table.membershipId),
    statusIdx: index("athlete_alerts_status_idx").on(table.status),
    severityIdx: index("athlete_alerts_severity_idx").on(table.severity),
    assignedCoachIdx: index("athlete_alerts_assigned_coach_idx").on(table.assignedCoachId),
    followUpIdx: index("athlete_alerts_follow_up_idx").on(table.followUpAt),
    alertTypeIdx: index("athlete_alerts_alert_type_idx").on(table.alertType),
    createdAtIdx: index("athlete_alerts_created_at_idx").on(table.createdAt),

    // Composite indexes for common queries
    boxStatusSeverityIdx: index("athlete_alerts_box_status_severity_idx").on(
        table.boxId, table.status, table.severity),
    assignedActiveIdx: index("athlete_alerts_assigned_active_idx").on(
        table.assignedCoachId, table.status).where(sql`status = 'active'`),
    membershipActiveIdx: index("athlete_alerts_membership_active_idx").on(
        table.membershipId, table.status).where(sql`status = 'active'`),
    upcomingFollowUpsIdx: index("athlete_alerts_upcoming_follow_ups_idx").on(table.followUpAt),

    // Constraints
    remindersSentPositive: check(
        "athlete_alerts_reminders_sent_positive",
        sql`${table.remindersSent} >= 0`
    ),
}));

// CRITICAL MVP TABLE: Coach interventions and actions taken
export const athleteInterventions = pgTable("athlete_interventions", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    coachId: uuid("coach_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    alertId: uuid("alert_id").references(() => athleteAlerts.id, { onDelete: "set null" }), // Optional - might not be alert-driven

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
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    followUpCompleted: boolean("follow_up_completed").default(false).notNull(),

    // Metadata - consistent timestamp naming
    interventionDate: timestamp("intervention_date", { withTimezone: true }).defaultNow().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Optimized indexing for performance
    boxMembershipIdx: index("athlete_interventions_box_membership_idx").on(table.boxId, table.membershipId),
    coachIdx: index("athlete_interventions_coach_idx").on(table.coachId),
    interventionDateIdx: index("athlete_interventions_intervention_date_idx").on(table.interventionDate),
    alertIdIdx: index("athlete_interventions_alert_id_idx").on(table.alertId),
    followUpAtIdx: index("athlete_interventions_follow_up_at_idx").on(table.followUpAt),

    // NEW: Composite index for getting interventions per membership, newest first
    membershipInterventionDateIdx: index("athlete_interventions_membership_intervention_date_idx")
        .on(table.membershipId, table.interventionDate.desc()),

    // Composite indexes for common queries
    coachInterventionDateIdx: index("athlete_interventions_coach_intervention_date_idx").on(
        table.coachId, table.interventionDate),
    pendingFollowUpsIdx: index("athlete_interventions_pending_follow_ups_idx").on(
        table.followUpRequired, table.followUpCompleted, table.followUpAt)
        .where(sql`follow_up_required = true AND follow_up_completed = false`),
}));

// CRITICAL MVP TABLE: Athlete progress milestones and celebrations
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
    celebratedAt: timestamp("celebrated_at", { withTimezone: true }),
    celebrationType: text("celebration_type"), // "announcement", "social_post", "reward"

    // Metadata - consistent timestamp naming
    achievedAt: timestamp("achieved_at", { withTimezone: true }).defaultNow().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Optimized indexing for performance
    boxMembershipIdx: index("athlete_milestones_box_membership_idx").on(table.boxId, table.membershipId),
    milestoneTypeIdx: index("athlete_milestones_milestone_type_idx").on(table.milestoneType),
    achievedAtIdx: index("athlete_milestones_achieved_at_idx").on(table.achievedAt),
    categoryIdx: index("athlete_milestones_category_idx").on(table.category),

    // NEW: Composite index for getting milestones per membership, newest first
    membershipAchievedAtIdx: index("athlete_milestones_membership_achieved_at_idx")
        .on(table.membershipId, table.achievedAt.desc()),

    // Composite indexes for common queries
    boxMilestoneTypeIdx: index("athlete_milestones_box_milestone_type_idx").on(
        table.boxId, table.milestoneType),
    uncelebratedIdx: index("athlete_milestones_uncelebrated_idx").on(table.celebrated, table.achievedAt)
        .where(sql`celebrated = false`),

    // Constraints
    improvementPercentPositive: check(
        "athlete_milestones_improvement_percent_positive",
        sql`${table.improvementPercent} >= 0`
    ),
}));

// ENHANCED: Box analytics snapshots (daily/weekly/monthly aggregates)
export const boxAnalytics = pgTable("box_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Period
    period: text("period").notNull(), // "daily", "weekly", "monthly"
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // Athlete Metrics - enhanced with constraints
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

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Optimized indexing for performance
    boxPeriodIdx: index("box_analytics_box_period_idx").on(table.boxId, table.period, table.periodStart),
    periodStartIdx: index("box_analytics_period_start_idx").on(table.periodStart),

    // Composite indexes for analytics queries
    boxPeriodDateRangeIdx: index("box_analytics_box_period_date_range_idx").on(
        table.boxId, table.period, table.periodStart, table.periodEnd),

    // Unique constraint to prevent duplicate analytics for same period
    boxPeriodUnique: unique("box_analytics_box_period_unique").on(
        table.boxId, table.period, table.periodStart),

    // Constraints
    totalAthletesPositive: check(
        "box_analytics_total_athletes_positive",
        sql`${table.totalAthletes} >= 0`
    ),
    activeAthletesPositive: check(
        "box_analytics_active_athletes_positive",
        sql`${table.activeAthletes} >= 0`
    ),
    newAthletesPositive: check(
        "box_analytics_new_athletes_positive",
        sql`${table.newAthletes} >= 0`
    ),
    churnedAthletesPositive: check(
        "box_analytics_churned_athletes_positive",
        sql`${table.churnedAthletes} >= 0`
    ),
    totalCheckinsPositive: check(
        "box_analytics_total_checkins_positive",
        sql`${table.totalCheckins} >= 0`
    ),
    totalAttendancesPositive: check(
        "box_analytics_total_attendances_positive",
        sql`${table.totalAttendances} >= 0`
    ),
    totalPrsPositive: check(
        "box_analytics_total_prs_positive",
        sql`${table.totalPrs} >= 0`
    ),
    retentionRateRange: check(
        "box_analytics_retention_rate_range",
        sql`${table.retentionRate} >= 0 AND ${table.retentionRate} <= 100`
    ),
    checkinRateRange: check(
        "box_analytics_checkin_rate_range",
        sql`${table.checkinRate} >= 0 AND ${table.checkinRate} <= 100`
    ),
}));

// SaaS Admin - Enhanced demo engagement tracking
export const demoEngagementMetrics = pgTable("demo_engagement_metrics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    role: userRoleEnum("role").notNull(),
    demoDuration: integer("demo_duration"), // in minutes
    featuresExplored: json("features_explored"),

    // Enhanced tracking
    stepCompleted: integer("steps_completed").default(0).notNull(),
    totalSteps: integer("total_steps").default(10).notNull(),
    conversionEvent: text("conversion_event"), // "trial_started", "contacted_sales", etc.
    dropOffPoint: text("drop_off_point"), // Where they stopped in the demo

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("demo_engagement_metrics_box_id_idx").on(table.boxId),
    roleIdx: index("demo_engagement_metrics_role_idx").on(table.role),
    createdAtIdx: index("demo_engagement_metrics_created_at_idx").on(table.createdAt),
    conversionEventIdx: index("demo_engagement_metrics_conversion_event_idx").on(table.conversionEvent),

    // Composite index
    boxRoleIdx: index("demo_engagement_metrics_box_role_idx").on(table.boxId, table.role),

    // Constraints
    demoDurationPositive: check(
        "demo_engagement_demo_duration_positive",
        sql`${table.demoDuration} > 0`
    ),
    stepsCompletedPositive: check(
        "demo_engagement_steps_completed_positive",
        sql`${table.stepCompleted} >= 0`
    ),
    totalStepsPositive: check(
        "demo_engagement_total_steps_positive",
        sql`${table.totalSteps} > 0`
    ),
    stepsValidRange: check(
        "demo_engagement_steps_valid_range",
        sql`${table.stepCompleted} <= ${table.totalSteps}`
    ),
}));

// NEW: Risk factor tracking for detailed analytics
export const riskFactorHistory = pgTable("risk_factor_history", {
    id: uuid("id").defaultRandom().primaryKey(),
    riskScoreId: uuid("risk_score_id").references(() => athleteRiskScores.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // Factor details
    factorType: text("factor_type").notNull(), // "attendance_decline", "wellness_drop", etc.
    factorValue: decimal("factor_value", { precision: 8, scale: 4 }).notNull(),
    weight: decimal("weight", { precision: 5, scale: 4 }).notNull(), // Importance weight
    contribution: decimal("contribution", { precision: 5, scale: 2 }).notNull(), // Contribution to overall risk

    // Context
    description: text("description"),
    metadata: json("metadata"), // Additional context data

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    riskScoreIdIdx: index("risk_factor_history_risk_score_id_idx").on(table.riskScoreId),
    membershipIdIdx: index("risk_factor_history_membership_id_idx").on(table.membershipId),
    factorTypeIdx: index("risk_factor_history_factor_type_idx").on(table.factorType),
    createdAtIdx: index("risk_factor_history_created_at_idx").on(table.createdAt),

    // Constraints
    weightRange: check(
        "risk_factor_weight_range",
        sql`${table.weight} >= 0 AND ${table.weight} <= 1`
    ),
    contributionRange: check(
        "risk_factor_contribution_range",
        sql`${table.contribution} >= -100 AND ${table.contribution} <= 100`
    ),
}));

// NEW: Alert escalation tracking
export const alertEscalations = pgTable("alert_escalations", {
    id: uuid("id").defaultRandom().primaryKey(),
    alertId: uuid("alert_id").references(() => athleteAlerts.id, { onDelete: "cascade" }).notNull(),
    fromSeverity: riskLevelEnum("from_severity").notNull(),
    toSeverity: riskLevelEnum("to_severity").notNull(),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }).defaultNow().notNull(),
    reason: text("reason").notNull(),
    autoEscalated: boolean("auto_escalated").default(false).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    alertIdIdx: index("alert_escalations_alert_id_idx").on(table.alertId),
    escalatedAtIdx: index("alert_escalations_escalated_at_idx").on(table.escalatedAt),
    fromSeverityIdx: index("alert_escalations_from_severity_idx").on(table.fromSeverity),
    toSeverityIdx: index("alert_escalations_to_severity_idx").on(table.toSeverity),
}));

// Relations - Enhanced with proper naming and relationship clarification
export const athleteRiskScoresRelations = relations(athleteRiskScores, ({ one, many }) => ({
    box: one(boxes, {
        fields: [athleteRiskScores.boxId],
        references: [boxes.id],
        relationName: "box_risk_scores"
    }),
    membership: one(boxMemberships, {
        fields: [athleteRiskScores.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_risk_scores"
    }),
    riskFactors: many(riskFactorHistory, { relationName: "risk_score_factors" }),
}));

export const athleteAlertsRelations = relations(athleteAlerts, ({ one, many }) => ({
    box: one(boxes, {
        fields: [athleteAlerts.boxId],
        references: [boxes.id],
        relationName: "box_alerts"
    }),
    membership: one(boxMemberships, {
        fields: [athleteAlerts.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_alerts"
    }),
    assignedCoach: one(boxMemberships, {
        fields: [athleteAlerts.assignedCoachId],
        references: [boxMemberships.id],
        relationName: "assigned_coach_alerts"
    }),
    acknowledgedBy: one(boxMemberships, {
        fields: [athleteAlerts.acknowledgedById],
        references: [boxMemberships.id],
        relationName: "acknowledged_alerts"
    }),
    resolvedBy: one(boxMemberships, {
        fields: [athleteAlerts.resolvedById],
        references: [boxMemberships.id],
        relationName: "resolved_alerts"
    }),
    interventions: many(athleteInterventions, { relationName: "alert_interventions" }),
    escalations: many(alertEscalations, { relationName: "alert_escalations" }),
}));

export const athleteInterventionsRelations = relations(athleteInterventions, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteInterventions.boxId],
        references: [boxes.id],
        relationName: "box_interventions"
    }),
    membership: one(boxMemberships, {
        fields: [athleteInterventions.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_interventions"
    }),
    coach: one(boxMemberships, {
        fields: [athleteInterventions.coachId],
        references: [boxMemberships.id],
        relationName: "coach_interventions"
    }),
    alert: one(athleteAlerts, {
        fields: [athleteInterventions.alertId],
        references: [athleteAlerts.id],
        relationName: "alert_interventions"
    }),
}));

export const athleteMilestonesRelations = relations(athleteMilestones, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteMilestones.boxId],
        references: [boxes.id],
        relationName: "box_milestones"
    }),
    membership: one(boxMemberships, {
        fields: [athleteMilestones.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_milestones"
    }),
}));

export const boxAnalyticsRelations = relations(boxAnalytics, ({ one }) => ({
    box: one(boxes, {
        fields: [boxAnalytics.boxId],
        references: [boxes.id],
        relationName: "box_analytics"
    }),
}));

export const demoEngagementMetricsRelations = relations(demoEngagementMetrics, ({ one }) => ({
    box: one(boxes, {
        fields: [demoEngagementMetrics.boxId],
        references: [boxes.id],
        relationName: "box_demo_engagement"
    }),
}));

export const riskFactorHistoryRelations = relations(riskFactorHistory, ({ one }) => ({
    riskScore: one(athleteRiskScores, {
        fields: [riskFactorHistory.riskScoreId],
        references: [athleteRiskScores.id],
        relationName: "risk_score_factors"
    }),
    membership: one(boxMemberships, {
        fields: [riskFactorHistory.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_risk_factors"
    }),
}));

export const alertEscalationsRelations = relations(alertEscalations, ({ one }) => ({
    alert: one(athleteAlerts, {
        fields: [alertEscalations.alertId],
        references: [athleteAlerts.id],
        relationName: "alert_escalations"
    }),
}));