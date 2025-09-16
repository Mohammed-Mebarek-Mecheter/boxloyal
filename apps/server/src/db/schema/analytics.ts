// db/schema/analytics.ts
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    decimal,
    uuid,
    index,
    json,
    check,
    unique,
    date
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { boxes, boxMemberships } from "./core";
import {alertStatusEnum, alertTypeEnum, riskLevelEnum, userRoleEnum} from "@/db/schema/enums";

// CORE ANALYTICS TABLE: Athlete retention risk scores
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

// CORE WORKFLOW TABLE: Coach alerts for athlete intervention
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

// CORE WORKFLOW TABLE: Coach interventions and actions taken
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

// CORE ENGAGEMENT TABLE: Athlete progress milestones and celebrations
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

// AGGREGATE REPORTING TABLE: Box analytics snapshots (daily/weekly/monthly aggregates)
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

// SaaS ADMIN ANALYTICS: Demo engagement tracking
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

// ENHANCEMENT: Track effectiveness of interventions by linking them to subsequent outcomes
export const interventionOutcomes = pgTable("intervention_outcomes", {
    id: uuid("id").defaultRandom().primaryKey(),
    interventionId: uuid("intervention_id").references(() => athleteInterventions.id, { onDelete: "cascade" }).notNull(),
    // Link to the athlete whose risk/behavior we are measuring post-intervention
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Outcome Metrics (measured after a defined period post-intervention)
    riskScoreChange: decimal("risk_score_change", { precision: 5, scale: 2 }), // Change in overall risk score
    attendanceRateChange: decimal("attendance_rate_change", { precision: 5, scale: 2 }), // % change in attendance
    checkinRateChange: decimal("checkin_rate_change", { precision: 5, scale: 2 }), // % change in checkin rate
    wellnessScoreChange: decimal("wellness_score_change", { precision: 5, scale: 2 }), // Change in wellness score
    prActivityChange: integer("pr_activity_change"), // Change in PR/Benchmark attempts
    overallEffectiveness: text("overall_effectiveness", { enum: ["positive", "neutral", "negative"] }).notNull(),
    effectivenessScore: decimal("effectiveness_score", { precision: 5, scale: 2 }).notNull(),

    // Outcome Period
    outcomePeriodStart: timestamp("outcome_period_start", { withTimezone: true }).notNull(), // When measurement started
    outcomePeriodEnd: timestamp("outcome_period_end", { withTimezone: true }).notNull(), // When measurement ended

    // Metadata
    measuredAt: timestamp("measured_at", { withTimezone: true }).defaultNow().notNull(),
    notes: text("notes"), // Qualitative notes on the outcome
}, (table) => ({
    interventionIdIdx: index("intervention_outcomes_intervention_id_idx").on(table.interventionId),
    membershipIdIdx: index("intervention_outcomes_membership_id_idx").on(table.membershipId),
    boxIdIdx: index("intervention_outcomes_box_id_idx").on(table.boxId),
    measuredAtIdx: index("intervention_outcomes_measured_at_idx").on(table.measuredAt),
    // Composite index for common queries
    interventionMembershipIdx: index("intervention_outcomes_intervention_membership_idx").on(table.interventionId, table.membershipId),
}));

// ENHANCEMENT: Store pre-calculated wellness-performance correlations for reporting
export const wellnessPerformanceCorrelations = pgTable("wellness_performance_correlations", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Correlation Details
    wellnessMetric: text("wellness_metric").notNull(), // e.g., "avg_sleep_quality", "avg_energy_level"
    performanceMetric: text("performance_metric").notNull(), // e.g., "avg_pr_score", "benchmark_completion_rate"
    correlationType: text("correlation_type").notNull(), // e.g., "pearson", "spearman"

    // Correlation Result
    correlationValue: decimal("correlation_value", { precision: 4, scale: 3 }).notNull(), // -1 to 1
    pValue: decimal("p_value", { precision: 6, scale: 5 }), // Statistical significance
    sampleSize: integer("sample_size").notNull(), // Number of data points used

    // Time Period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // Metadata
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
    version: text("version").default("1.0").notNull(), // For tracking model changes
}, (table) => ({
    boxIdIdx: index("wellness_performance_correlations_box_id_idx").on(table.boxId),
    wellnessMetricIdx: index("wellness_performance_correlations_wellness_metric_idx").on(table.wellnessMetric),
    performanceMetricIdx: index("wellness_performance_correlations_performance_metric_idx").on(table.performanceMetric),
    calculatedAtIdx: index("wellness_performance_correlations_calculated_at_idx").on(table.calculatedAt),
    // Composite index for common queries
    boxWellnessPerformanceIdx: index("wellness_performance_correlations_box_wellness_performance_idx").on(
        table.boxId, table.wellnessMetric, table.performanceMetric
    ),
    // Unique constraint for one correlation per box/metric/period
    boxWellnessPerformancePeriodUnique: unique("wellness_performance_correlations_box_wellness_performance_period_unique").on(
        table.boxId, table.wellnessMetric, table.performanceMetric, table.periodStart
    ),
    // Constraints
    correlationValueRange: check(
        "wellness_performance_correlations_value_range",
        sql`${table.correlationValue} >= -1 AND ${table.correlationValue} <= 1`
    ),
    sampleSizePositive: check(
        "wellness_performance_correlations_sample_size_positive",
        sql`${table.sampleSize} > 0`
    ),
    pValueRange: check(
        "wellness_performance_correlations_p_value_range",
        sql`${table.pValue} >= 0 AND ${table.pValue} <= 1`
    ),
}));

// ENHANCEMENT: Store pre-calculated coach performance KPIs for reporting and dashboards
export const coachPerformanceMetrics = pgTable("coach_performance_metrics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    coachMembershipId: uuid("coach_membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    athletesActive: integer("athletes_active").notNull(),
    interventionsWithOutcome: integer("interventions_with_outcome").notNull(),
    alertsReceived: integer("alerts_received").notNull(),
    engagementScore: decimal("engagement_score", { precision: 5, scale: 2 }).notNull(),
    effectivenessScore: decimal("effectiveness_score", { precision: 5, scale: 2 }).notNull(),
    athleteAttendanceImpact: decimal("athlete_attendance_impact", { precision: 5, scale: 2 }),

    // Performance Period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // KPIs
    athletesAssigned: integer("athletes_assigned").notNull(),
    avgRiskScoreReduction: decimal("avg_risk_score_reduction", { precision: 5, scale: 2 }), // Avg change for assigned athletes
    interventionsCompleted: integer("interventions_completed").notNull(),
    alertsResolved: integer("alerts_resolved").notNull(),
    avgTimeToAlertResolution: decimal("avg_time_to_alert_resolution", { precision: 8, scale: 2 }), // hours
    athleteRetentionRate: decimal("athlete_retention_rate", { precision: 5, scale: 2 }), // % of assigned athletes retained
    athletePrImprovementRate: decimal("athlete_pr_improvement_rate", { precision: 5, scale: 2 }), // % of assigned athletes with PRs

    // Metadata
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
    version: text("version").default("1.0").notNull(), // For tracking model changes
}, (table) => ({
    boxIdIdx: index("coach_performance_metrics_box_id_idx").on(table.boxId),
    coachMembershipIdIdx: index("coach_performance_metrics_coach_membership_id_idx").on(table.coachMembershipId),
    calculatedAtIdx: index("coach_performance_metrics_calculated_at_idx").on(table.calculatedAt),
    // Composite index for common queries
    boxCoachPeriodIdx: index("coach_performance_metrics_box_coach_period_idx").on(
        table.boxId, table.coachMembershipId, table.periodStart
    ),
    // Unique constraint for one set of metrics per coach/box/period
    boxCoachPeriodUnique: unique("coach_performance_metrics_box_coach_period_unique").on(
        table.boxId, table.coachMembershipId, table.periodStart
    ),
    // Constraints
    athletesAssignedPositive: check(
        "coach_performance_metrics_athletes_assigned_positive",
        sql`${table.athletesAssigned} >= 0`
    ),
    interventionsCompletedPositive: check(
        "coach_performance_metrics_interventions_completed_positive",
        sql`${table.interventionsCompleted} >= 0`
    ),
    alertsResolvedPositive: check(
        "coach_performance_metrics_alerts_resolved_positive",
        sql`${table.alertsResolved} >= 0`
    ),
    athleteRetentionRateRange: check(
        "coach_performance_metrics_retention_rate_range",
        sql`${table.athleteRetentionRate} >= 0 AND ${table.athleteRetentionRate} <= 100`
    ),
    athletePrImprovementRateRange: check(
        "coach_performance_metrics_pr_improvement_rate_range",
        sql`${table.athletePrImprovementRate} >= 0 AND ${table.athletePrImprovementRate} <= 100`
    ),
}));

// ENHANCEMENT: Store detailed retention events for cohort analysis
export const retentionEvents = pgTable("retention_events", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),
    membershipId: uuid("membership_id").references(() => boxMemberships.id, { onDelete: "cascade" }).notNull(),

    // Event Details
    eventType: text("event_type").notNull(), // "churn", "reactivation", "pause", "downgrade"
    reason: text("reason"), // Optional reason (e.g., "price", "location", "injury")
    notes: text("notes"), // Additional context

    // Event Timestamps
    eventDate: timestamp("event_date", { withTimezone: true }).notNull(), // When the event occurred
    previousStatus: text("previous_status").notNull(), // Status before the event (e.g., "active")

    // Cohort Information (calculated at event time)
    cohortStartDate: timestamp("cohort_start_date", { withTimezone: true }).notNull(), // When the athlete joined
    daysInCohort: integer("days_in_cohort").notNull(), // How long they were in the cohort before event

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxIdIdx: index("retention_events_box_id_idx").on(table.boxId),
    membershipIdIdx: index("retention_events_membership_id_idx").on(table.membershipId),
    eventDateIdx: index("retention_events_event_date_idx").on(table.eventDate),
    eventTypeIdx: index("retention_events_event_type_idx").on(table.eventType),
    cohortStartDateIdx: index("retention_events_cohort_start_date_idx").on(table.cohortStartDate),
    // Composite indexes for common queries
    boxEventTypeIdx: index("retention_events_box_event_type_idx").on(table.boxId, table.eventType),
    boxEventDateIdx: index("retention_events_box_event_date_idx").on(table.boxId, table.eventDate),
    // Constraints
    daysInCohortPositive: check(
        "retention_events_days_in_cohort_positive",
        sql`${table.daysInCohort} >= 0`
    ),
}));

// ENHANCEMENT: Store billing/subscription health metrics for owner dashboards
export const boxSubscriptionHealth = pgTable("box_subscription_health", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Health Period (e.g., Monthly snapshot)
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // --- Financial Health Metrics (derived from billing.ts) ---

    // Recurring Revenue
    mrr: decimal("mrr", { precision: 10, scale: 2 }), // Monthly Recurring Revenue for the period
    arr: decimal("arr", { precision: 12, scale: 2 }), // Annual Recurring Revenue (MRR * 12 or calculated annually)

    // MRR Movements (Churn, Expansion, Contraction)
    churnedMrr: decimal("churned_mrr", { precision: 10, scale: 2 }),     // MRR lost due to cancellations/downgrades during the period
    expansionMrr: decimal("expansion_mrr", { precision: 10, scale: 2 }), // MRR gained from upgrades/new subscriptions during the period
    contractionMrr: decimal("contraction_mrr", { precision: 10, scale: 2 }), // MRR lost specifically from existing subscription downgrades during the period

    // --- Plan Utilization Metrics (derived from billing.ts & core boxes table) ---

    // Effective Plan Limits during the period (reflects the plan(s) active)
    effectiveAthleteLimit: integer("effective_athlete_limit"), // Weighted average or snapshot of the plan's athlete limit(s) active during the period
    effectiveCoachLimit: integer("effective_coach_limit"),     // Weighted average or snapshot of the plan's coach limit(s) active during the period

    // Overages (derived from overageBilling)
    totalOverageRevenue: decimal("total_overage_revenue", { precision: 10, scale: 2 }), // Total revenue from overages in the period

    // --- Health Score (calculated) ---
    // A composite score (0-100) based on financial stability (MRR growth, low churn)
    // and plan fit (low overages might indicate good fit, high overages might indicate need to upgrade)
    healthScore: decimal("health_score", { precision: 5, scale: 2 }),

    // --- Metadata ---
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
    version: text("version").default("1.0").notNull(), // For tracking model changes
}, (table) => ({
    boxIdIdx: index("box_subscription_health_box_id_idx").on(table.boxId),
    calculatedAtIdx: index("box_subscription_health_calculated_at_idx").on(table.calculatedAt),
    periodStartIdx: index("box_subscription_health_period_start_idx").on(table.periodStart),
    // Composite index for common queries (e.g., get latest health snapshot for a box)
    boxPeriodIdx: index("box_subscription_health_box_period_idx").on(table.boxId, table.periodStart),
    // Unique constraint to ensure one health record per box per period
    boxPeriodUnique: unique("box_subscription_health_box_period_unique").on(table.boxId, table.periodStart),

    // --- Constraints ---
    // MRR/ARR and financial movements can be negative (contraction/churn), so no positive checks for those.
    // Overages are typically positive revenue.
    totalOverageRevenuePositive: check(
        "box_subscription_health_total_overage_revenue_positive",
        sql`${table.totalOverageRevenue} >= 0`
    ),
    // Limits should generally be positive if present.
    effectiveLimitsPositive: check(
        "box_subscription_health_effective_limits_positive",
        sql`(${table.effectiveAthleteLimit} IS NULL OR ${table.effectiveAthleteLimit} > 0) AND (${table.effectiveCoachLimit} IS NULL OR ${table.effectiveCoachLimit} > 0)`
    ),
    // Health score range
    healthScoreRange: check(
        "box_subscription_health_score_range",
        sql`${table.healthScore} >= 0 AND ${table.healthScore} <= 100`
    ),
}));

// ========== NEW CRITICAL ANALYTICS TABLES ==========

// NEW: Comprehensive cohort analysis for retention tracking
export const athleteCohortAnalytics = pgTable("athlete_cohort_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Cohort Definition
    cohortMonth: date("cohort_month").notNull(), // Month when athletes joined (e.g., '2024-01-01')
    cohortSize: integer("cohort_size").notNull(), // Total athletes who joined in this cohort

    // Retention Analysis Period
    analysisMonth: date("analysis_month").notNull(), // Month being analyzed (e.g., '2024-03-01')
    monthsSinceCohortStart: integer("months_since_cohort_start").notNull(), // e.g., 0, 1, 2, 3...

    // Retention Metrics
    activeAthletes: integer("active_athletes").notNull(), // Still active in analysis month
    churnedAthletes: integer("churned_athletes").notNull(), // Churned by analysis month
    retentionRate: decimal("retention_rate", { precision: 5, scale: 2 }).notNull(), // % still active

    // Revenue Impact
    cohortRevenue: decimal("cohort_revenue", { precision: 10, scale: 2 }), // Total revenue from cohort in analysis month
    cumulativeRevenue: decimal("cumulative_revenue", { precision: 12, scale: 2 }), // Total revenue from cohort to date
    avgRevenuePerAthlete: decimal("avg_revenue_per_athlete", { precision: 8, scale: 2 }), // Average monthly revenue per remaining athlete

    // Engagement Metrics
    avgCheckinRate: decimal("avg_checkin_rate", { precision: 5, scale: 2 }), // Average checkin rate for remaining athletes
    avgAttendanceRate: decimal("avg_attendance_rate", { precision: 5, scale: 2 }), // Average attendance rate
    avgRiskScore: decimal("avg_risk_score", { precision: 5, scale: 2 }), // Average risk score of remaining athletes

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxCohortAnalysisIdx: index("athlete_cohort_analytics_box_cohort_analysis_idx").on(
        table.boxId, table.cohortMonth, table.analysisMonth
    ),
    cohortMonthIdx: index("athlete_cohort_analytics_cohort_month_idx").on(table.cohortMonth),
    analysisMonthIdx: index("athlete_cohort_analytics_analysis_month_idx").on(table.analysisMonth),
    monthsSinceIdx: index("athlete_cohort_analytics_months_since_idx").on(table.monthsSinceCohortStart),

    // Unique constraint
    boxCohortAnalysisUnique: unique("athlete_cohort_analytics_box_cohort_analysis_unique").on(
        table.boxId, table.cohortMonth, table.analysisMonth
    ),

    // Constraints
    cohortSizePositive: check("cohort_size_positive", sql`${table.cohortSize} > 0`),
    activeAthletesValid: check("active_athletes_valid", sql`${table.activeAthletes} >= 0`),
    churnedAthletesValid: check("churned_athletes_valid", sql`${table.churnedAthletes} >= 0`),
    retentionRateValid: check("retention_rate_valid", sql`${table.retentionRate} >= 0 AND ${table.retentionRate} <= 100`),
    monthsSincePositive: check("months_since_positive", sql`${table.monthsSinceCohortStart} >= 0`),
}));

// NEW: Athlete segmentation for targeted analytics and interventions
export const athleteSegmentAnalytics = pgTable("athlete_segment_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Segmentation Criteria
    segmentType: text("segment_type").notNull(), // "demographic", "behavioral", "risk", "engagement", "performance"
    segmentName: text("segment_name").notNull(), // "high_performers", "at_risk", "new_members", etc.
    segmentCriteria: json("segment_criteria").notNull(), // The rules that define this segment

    // Analysis Period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // Segment Metrics
    segmentSize: integer("segment_size").notNull(), // Number of athletes in segment
    percentOfTotal: decimal("percent_of_total", { precision: 5, scale: 2 }).notNull(), // % of total athletes

    // Performance Metrics
    avgRiskScore: decimal("avg_risk_score", { precision: 5, scale: 2 }),
    avgAttendanceRate: decimal("avg_attendance_rate", { precision: 5, scale: 2 }),
    avgCheckinRate: decimal("avg_checkin_rate", { precision: 5, scale: 2 }),
    avgPrsPerMonth: decimal("avg_prs_per_month", { precision: 5, scale: 2 }),

    // Wellness Metrics
    avgEnergyLevel: decimal("avg_energy_level", { precision: 3, scale: 2 }),
    avgSleepQuality: decimal("avg_sleep_quality", { precision: 3, scale: 2 }),
    avgStressLevel: decimal("avg_stress_level", { precision: 3, scale: 2 }),

    // Retention Metrics
    churnRate: decimal("churn_rate", { precision: 5, scale: 2 }), // % who churned in period
    avgTenure: decimal("avg_tenure", { precision: 6, scale: 2 }), // Average days as member

    // Revenue Impact
    totalRevenue: decimal("total_revenue", { precision: 10, scale: 2 }), // Total revenue from segment
    avgRevenuePerAthlete: decimal("avg_revenue_per_athlete", { precision: 8, scale: 2 }), // Average revenue per athlete in segment

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxSegmentPeriodIdx: index("athlete_segment_analytics_box_segment_period_idx").on(
        table.boxId, table.segmentType, table.segmentName, table.periodStart
    ),
    segmentTypeIdx: index("athlete_segment_analytics_segment_type_idx").on(table.segmentType),
    periodStartIdx: index("athlete_segment_analytics_period_start_idx").on(table.periodStart),

    // Unique constraint
    boxSegmentPeriodUnique: unique("athlete_segment_analytics_box_segment_period_unique").on(
        table.boxId, table.segmentType, table.segmentName, table.periodStart
    ),

    // Constraints
    segmentSizePositive: check("segment_size_positive", sql`${table.segmentSize} >= 0`),
    percentValid: check("percent_valid", sql`${table.percentOfTotal} >= 0 AND ${table.percentOfTotal} <= 100`),
    churnRateValid: check("churn_rate_valid", sql`${table.churnRate} >= 0 AND ${table.churnRate} <= 100`),
}));

// NEW: Predictive model performance tracking
export const modelPerformanceMetrics = pgTable("model_performance_metrics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Model Information
    modelName: text("model_name").notNull(), // "churn_prediction_v2", "risk_scoring_v1", etc.
    modelVersion: text("model_version").notNull(), // "1.2.3"

    // Evaluation Period
    evaluationPeriodStart: timestamp("evaluation_period_start", { withTimezone: true }).notNull(),
    evaluationPeriodEnd: timestamp("evaluation_period_end", { withTimezone: true }).notNull(),

    // Performance Metrics
    accuracy: decimal("accuracy", { precision: 5, scale: 4 }), // Overall accuracy (0-1)
    precision: decimal("precision", { precision: 5, scale: 4 }), // Precision score (0-1)
    recall: decimal("recall", { precision: 5, scale: 4 }), // Recall/sensitivity (0-1)
    f1Score: decimal("f1_score", { precision: 5, scale: 4 }), // F1 score (0-1)
    auc: decimal("auc", { precision: 5, scale: 4 }), // Area under ROC curve (0-1)

    // Confusion Matrix
    truePositives: integer("true_positives").notNull(),
    trueNegatives: integer("true_negatives").notNull(),
    falsePositives: integer("false_positives").notNull(),
    falseNegatives: integer("false_negatives").notNull(),

    // Business Impact
    predictionsGenerated: integer("predictions_generated").notNull(), // Total predictions made
    alertsTriggered: integer("alerts_triggered").notNull(), // Alerts generated from predictions
    interventionsTriggered: integer("interventions_triggered").notNull(), // Interventions from alerts
    churnsPrevented: integer("churns_prevented"), // Estimated churns prevented
    falseAlertRate: decimal("false_alert_rate", { precision: 5, scale: 4 }), // % of alerts that were false positives

    // Model Drift Detection
    featureDrift: json("feature_drift"), // Metrics about feature distribution changes
    performanceDrift: decimal("performance_drift", { precision: 5, scale: 4 }), // Change in performance vs baseline

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxModelVersionIdx: index("model_performance_metrics_box_model_version_idx").on(
        table.boxId, table.modelName, table.modelVersion
    ),
    evaluationPeriodIdx: index("model_performance_metrics_evaluation_period_idx").on(table.evaluationPeriodStart),
    modelNameIdx: index("model_performance_metrics_model_name_idx").on(table.modelName),

    // Constraints
    accuracyRange: check("accuracy_range", sql`${table.accuracy} >= 0 AND ${table.accuracy} <= 1`),
    precisionRange: check("precision_range", sql`${table.precision} >= 0 AND ${table.precision} <= 1`),
    recallRange: check("recall_range", sql`${table.recall} >= 0 AND ${table.recall} <= 1`),
    f1Range: check("f1_range", sql`${table.f1Score} >= 0 AND ${table.f1Score} <= 1`),
    aucRange: check("auc_range", sql`${table.auc} >= 0 AND ${table.auc} <= 1`),
    confusionMatrixPositive: check("confusion_matrix_positive",
        sql`${table.truePositives} >= 0 AND ${table.trueNegatives} >= 0 AND ${table.falsePositives} >= 0 AND ${table.falseNegatives} >= 0`
    ),
}));

// NEW: Engagement pattern analysis for understanding user behavior
export const engagementPatternAnalytics = pgTable("engagement_pattern_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Pattern Definition
    patternType: text("pattern_type").notNull(), // "weekly", "monthly", "seasonal", "lifecycle"
    patternName: text("pattern_name").notNull(), // "monday_dropoff", "new_year_surge", "summer_decline"

    // Analysis Period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // Pattern Metrics
    occurrenceCount: integer("occurrence_count").notNull(), // How many times pattern occurred
    avgIntensity: decimal("avg_intensity", { precision: 5, scale: 2 }), // Average strength of pattern
    confidenceScore: decimal("confidence_score", { precision: 5, scale: 4 }), // Statistical confidence (0-1)

    // Impact Metrics
    athletesAffected: integer("athletes_affected").notNull(), // Number of athletes showing this pattern
    avgImpactOnRisk: decimal("avg_impact_on_risk", { precision: 5, scale: 2 }), // Average change in risk score
    avgImpactOnAttendance: decimal("avg_impact_on_attendance", { precision: 5, scale: 2 }), // Average change in attendance
    avgImpactOnEngagement: decimal("avg_impact_on_engagement", { precision: 5, scale: 2 }), // Average change in engagement

    // Pattern Details
    patternDescription: text("pattern_description"), // Human-readable description
    triggerConditions: json("trigger_conditions"), // Conditions that trigger this pattern
    correlatedFactors: json("correlated_factors"), // Other factors that correlate with this pattern

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxPatternTypeIdx: index("engagement_pattern_analytics_box_pattern_type_idx").on(
        table.boxId, table.patternType, table.patternName
    ),
    periodStartIdx: index("engagement_pattern_analytics_period_start_idx").on(table.periodStart),
    confidenceScoreIdx: index("engagement_pattern_analytics_confidence_score_idx").on(table.confidenceScore),

    // Constraints
    occurrenceCountPositive: check("occurrence_count_positive", sql`${table.occurrenceCount} >= 0`),
    confidenceScoreRange: check("confidence_score_range", sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`),
    athletesAffectedPositive: check("athletes_affected_positive", sql`${table.athletesAffected} >= 0`),
}));

// NEW: Alert effectiveness tracking to measure intervention success
export const alertEffectivenessMetrics = pgTable("alert_effectiveness_metrics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Alert Type Analysis
    alertType: alertTypeEnum("alert_type").notNull(),
    severity: riskLevelEnum("severity").notNull(),

    // Analysis Period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // Alert Volume Metrics
    totalAlerts: integer("total_alerts").notNull(),
    alertsAcknowledged: integer("alerts_acknowledged").notNull(),
    alertsResolved: integer("alerts_resolved").notNull(),
    alertsIgnored: integer("alerts_ignored").notNull(), // Never acknowledged
    alertsEscalated: integer("alerts_escalated").notNull(),

    // Response Time Metrics
    avgTimeToAcknowledge: decimal("avg_time_to_acknowledge", { precision: 8, scale: 2 }), // Hours
    avgTimeToResolve: decimal("avg_time_to_resolve", { precision: 8, scale: 2 }), // Hours
    avgTimeToIntervention: decimal("avg_time_to_intervention", { precision: 8, scale: 2 }), // Hours

    // Effectiveness Metrics
    successRate: decimal("success_rate", { precision: 5, scale: 2 }), // % of alerts that prevented churn
    falsePositiveRate: decimal("false_positive_rate", { precision: 5, scale: 2 }), // % that were false alarms
    avgRiskReduction: decimal("avg_risk_reduction", { precision: 5, scale: 2 }), // Average risk score improvement
    churnsPrevented: integer("churns_prevented"), // Estimated churns prevented

    // Coach Performance
    avgCoachResponseTime: decimal("avg_coach_response_time", { precision: 8, scale: 2 }), // Hours
    coachEngagementRate: decimal("coach_engagement_rate", { precision: 5, scale: 2 }), // % of alerts acted upon

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxAlertTypeSeverityIdx: index("alert_effectiveness_metrics_box_alert_type_severity_idx").on(
        table.boxId, table.alertType, table.severity
    ),
    periodStartIdx: index("alert_effectiveness_metrics_period_start_idx").on(table.periodStart),
    successRateIdx: index("alert_effectiveness_metrics_success_rate_idx").on(table.successRate),

    // Unique constraint
    boxAlertTypePeriodUnique: unique("alert_effectiveness_metrics_box_alert_type_period_unique").on(
        table.boxId, table.alertType, table.severity, table.periodStart
    ),

    // Constraints
    totalAlertsPositive: check("total_alerts_positive", sql`${table.totalAlerts} >= 0`),
    alertCountsValid: check("alert_counts_valid",
        sql`${table.alertsAcknowledged} + ${table.alertsIgnored} <= ${table.totalAlerts}`
    ),
    successRateRange: check("success_rate_range", sql`${table.successRate} >= 0 AND ${table.successRate} <= 100`),
    falsePositiveRateRange: check("false_positive_rate_range", sql`${table.falsePositiveRate} >= 0 AND ${table.falsePositiveRate} <= 100`),
    coachEngagementRateRange: check("coach_engagement_rate_range", sql`${table.coachEngagementRate} >= 0 AND ${table.coachEngagementRate} <= 100`),
}));

// NEW: Seasonal and temporal analytics
export const seasonalAnalytics = pgTable("seasonal_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Temporal Dimension
    temporalType: text("temporal_type").notNull(), // "monthly", "quarterly", "seasonal", "holiday"
    temporalValue: text("temporal_value").notNull(), // "january", "q1", "winter", "new_years"
    year: integer("year").notNull(),

    // Baseline Metrics (for comparison)
    baselineAthleteCount: integer("baseline_athlete_count").notNull(),
    baselineAttendanceRate: decimal("baseline_attendance_rate", { precision: 5, scale: 2 }).notNull(),
    baselineCheckinRate: decimal("baseline_checkin_rate", { precision: 5, scale: 2 }).notNull(),
    baselineChurnRate: decimal("baseline_churn_rate", { precision: 5, scale: 2 }).notNull(),

    // Seasonal Impact
    athleteCountChange: decimal("athlete_count_change", { precision: 5, scale: 2 }), // % change from baseline
    attendanceRateChange: decimal("attendance_rate_change", { precision: 5, scale: 2 }), // % change
    checkinRateChange: decimal("checkin_rate_change", { precision: 5, scale: 2 }), // % change
    churnRateChange: decimal("churn_rate_change", { precision: 5, scale: 2 }), // % change
    newMemberSignups: integer("new_member_signups"), // New signups during period

    // Wellness Impact
    avgEnergyChange: decimal("avg_energy_change", { precision: 3, scale: 2 }), // Change from baseline
    avgSleepQualityChange: decimal("avg_sleep_quality_change", { precision: 3, scale: 2 }),
    avgStressLevelChange: decimal("avg_stress_level_change", { precision: 3, scale: 2 }),
    avgMotivationChange: decimal("avg_motivation_change", { precision: 3, scale: 2 }),

    // Statistical Significance
    confidenceLevel: decimal("confidence_level", { precision: 3, scale: 2 }), // Statistical confidence (95%, 99%)
    pValue: decimal("p_value", { precision: 6, scale: 5 }), // P-value for significance testing

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxTemporalYearIdx: index("seasonal_analytics_box_temporal_year_idx").on(
        table.boxId, table.temporalType, table.temporalValue, table.year
    ),
    temporalTypeIdx: index("seasonal_analytics_temporal_type_idx").on(table.temporalType),
    yearIdx: index("seasonal_analytics_year_idx").on(table.year),

    // Unique constraint
    boxTemporalYearUnique: unique("seasonal_analytics_box_temporal_year_unique").on(
        table.boxId, table.temporalType, table.temporalValue, table.year
    ),

    // Constraints
    baselineMetricsPositive: check("baseline_metrics_positive",
        sql`${table.baselineAthleteCount} >= 0 AND ${table.baselineAttendanceRate} >= 0 AND ${table.baselineCheckinRate} >= 0`
    ),
    confidenceLevelRange: check("confidence_level_range", sql`${table.confidenceLevel} >= 0 AND ${table.confidenceLevel} <= 100`),
    pValueRange: check("p_value_range", sql`${table.pValue} >= 0 AND ${table.pValue} <= 1`),
    yearValid: check("year_valid", sql`${table.year} >= 2020 AND ${table.year} <= 2030`),
}));

// NEW: Comparative analytics (benchmarking)
export const benchmarkAnalytics = pgTable("benchmark_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Benchmark Type
    benchmarkType: text("benchmark_type").notNull(), // "industry", "size_cohort", "region", "tier"
    benchmarkGroup: text("benchmark_group").notNull(), // "small_boxes", "northeast", "premium_tier"

    // Analysis Period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // Box Performance vs Benchmark
    boxValue: decimal("box_value", { precision: 10, scale: 4 }).notNull(),
    benchmarkValue: decimal("benchmark_value", { precision: 10, scale: 4 }).notNull(),
    percentile: decimal("percentile", { precision: 5, scale: 2 }), // What percentile this box is in (0-100)
    standardDeviations: decimal("standard_deviations", { precision: 5, scale: 2 }), // How many std devs from mean

    // Metric Details
    metricName: text("metric_name").notNull(), // "retention_rate", "avg_risk_score", "churn_rate"
    metricCategory: text("metric_category").notNull(), // "retention", "engagement", "financial"

    // Benchmark Context
    sampleSize: integer("sample_size").notNull(), // Number of boxes in benchmark
    confidenceInterval: decimal("confidence_interval", { precision: 5, scale: 2 }), // 95%, 99%

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxBenchmarkMetricIdx: index("benchmark_analytics_box_benchmark_metric_idx").on(
        table.boxId, table.benchmarkType, table.metricName
    ),
    benchmarkGroupIdx: index("benchmark_analytics_benchmark_group_idx").on(table.benchmarkGroup),
    metricCategoryIdx: index("benchmark_analytics_metric_category_idx").on(table.metricCategory),
    periodStartIdx: index("benchmark_analytics_period_start_idx").on(table.periodStart),

    // Unique constraint
    boxBenchmarkMetricPeriodUnique: unique("benchmark_analytics_box_benchmark_metric_period_unique").on(
        table.boxId, table.benchmarkType, table.metricName, table.periodStart
    ),

    // Constraints
    percentileRange: check("percentile_range", sql`${table.percentile} >= 0 AND ${table.percentile} <= 100`),
    sampleSizePositive: check("sample_size_positive", sql`${table.sampleSize} > 0`),
    confidenceIntervalRange: check("confidence_interval_range", sql`${table.confidenceInterval} >= 0 AND ${table.confidenceInterval} <= 100`),
}));

// DETAILED ANALYTICS TABLE: Risk factor tracking for detailed analytics
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

// DETAILED AUDIT TABLE: Alert escalation tracking
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

// NEW: Financial impact analytics
export const financialImpactAnalytics = pgTable("financial_impact_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Analysis Period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // Revenue Impact
    totalRevenue: decimal("total_revenue", { precision: 12, scale: 2 }).notNull(),
    revenueFromNewMembers: decimal("revenue_from_new_members", { precision: 10, scale: 2 }),
    revenueFromRetainedMembers: decimal("revenue_from_retained_members", { precision: 10, scale: 2 }),
    lostRevenueFromChurn: decimal("lost_revenue_from_churn", { precision: 10, scale: 2 }),

    // Cost Impact
    estimatedInterventionCosts: decimal("estimated_intervention_costs", { precision: 8, scale: 2 }), // Time/effort costs
    customerAcquisitionCosts: decimal("customer_acquisition_costs", { precision: 8, scale: 2 }),
    retentionProgramCosts: decimal("retention_program_costs", { precision: 8, scale: 2 }),

    // ROI Metrics
    interventionRoi: decimal("intervention_roi", { precision: 8, scale: 2 }), // ROI of retention interventions
    retentionProgramRoi: decimal("retention_program_roi", { precision: 8, scale: 2 }), // Overall program ROI
    costPerRetainedMember: decimal("cost_per_retained_member", { precision: 8, scale: 2 }),

    // Lifetime Value Impact
    avgCustomerLifetimeValue: decimal("avg_customer_lifetime_value", { precision: 10, scale: 2 }),
    clvImprovementFromProgram: decimal("clv_improvement_from_program", { precision: 10, scale: 2 }),

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxPeriodIdx: index("financial_impact_analytics_box_period_idx").on(table.boxId, table.periodStart),
    periodStartIdx: index("financial_impact_analytics_period_start_idx").on(table.periodStart),

    // Unique constraint
    boxPeriodUnique: unique("financial_impact_analytics_box_period_unique").on(table.boxId, table.periodStart),

    // Constraints
    totalRevenuePositive: check("total_revenue_positive", sql`${table.totalRevenue} >= 0`),
    costsPositive: check("costs_positive",
        sql`${table.estimatedInterventionCosts} >= 0 AND ${table.customerAcquisitionCosts} >= 0 AND ${table.retentionProgramCosts} >= 0`
    ),
}));

// NEW: Feature usage analytics for product insights
export const featureUsageAnalytics = pgTable("feature_usage_analytics", {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id").references(() => boxes.id, { onDelete: "cascade" }).notNull(),

    // Feature Details
    featureName: text("feature_name").notNull(), // "wellness_checkins", "pr_tracking", "coach_feedback"
    featureCategory: text("feature_category").notNull(), // "core", "analytics", "engagement", "retention"
    userRole: userRoleEnum("user_role").notNull(), // Which role primarily uses this feature

    // Analysis Period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    // Usage Metrics
    totalUsers: integer("total_users").notNull(), // Total users who have access
    activeUsers: integer("active_users").notNull(), // Users who used feature in period
    adoptionRate: decimal("adoption_rate", { precision: 5, scale: 2 }).notNull(), // % of users who adopted
    usageFrequency: decimal("usage_frequency", { precision: 8, scale: 2 }), // Average uses per active user

    // Engagement Metrics
    avgSessionDuration: decimal("avg_session_duration", { precision: 8, scale: 2 }), // Minutes per session
    bounceRate: decimal("bounce_rate", { precision: 5, scale: 2 }), // % who left immediately
    conversionRate: decimal("conversion_rate", { precision: 5, scale: 2 }), // % who completed desired action

    // Impact on Retention
    usersWhoChurnedWithFeature: integer("users_who_churned_with_feature"),
    usersWhoChurnedWithoutFeature: integer("users_who_churned_without_feature"),
    featureImpactOnRetention: decimal("feature_impact_on_retention", { precision: 5, scale: 2 }), // % improvement in retention

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    boxFeatureRoleIdx: index("feature_usage_analytics_box_feature_role_idx").on(
        table.boxId, table.featureName, table.userRole
    ),
    featureCategoryIdx: index("feature_usage_analytics_feature_category_idx").on(table.featureCategory),
    periodStartIdx: index("feature_usage_analytics_period_start_idx").on(table.periodStart),
    adoptionRateIdx: index("feature_usage_analytics_adoption_rate_idx").on(table.adoptionRate),

    // Unique constraint
    boxFeatureRolePeriodUnique: unique("feature_usage_analytics_box_feature_role_period_unique").on(
        table.boxId, table.featureName, table.userRole, table.periodStart
    ),

    // Constraints
    totalUsersPositive: check("total_users_positive", sql`${table.totalUsers} >= 0`),
    activeUsersValid: check("active_users_valid", sql`${table.activeUsers} >= 0 AND ${table.activeUsers} <= ${table.totalUsers}`),
    adoptionRateRange: check("adoption_rate_range", sql`${table.adoptionRate} >= 0 AND ${table.adoptionRate} <= 100`),
    bounceRateRange: check("bounce_rate_range", sql`${table.bounceRate} >= 0 AND ${table.bounceRate} <= 100`),
    conversionRateRange: check("conversion_rate_range", sql`${table.conversionRate} >= 0 AND ${table.conversionRate} <= 100`),
}));

// --- Relations ---

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

export const athleteInterventionsRelations = relations(athleteInterventions, ({ one, many }) => ({
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
    outcomes: many(interventionOutcomes, { relationName: "intervention_outcomes" }),
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

// --- NEW RELATIONS FOR ENHANCEMENT TABLES ---

export const interventionOutcomesRelations = relations(interventionOutcomes, ({ one }) => ({
    intervention: one(athleteInterventions, {
        fields: [interventionOutcomes.interventionId],
        references: [athleteInterventions.id],
        relationName: "intervention_outcomes"
    }),
    membership: one(boxMemberships, {
        fields: [interventionOutcomes.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_intervention_outcomes"
    }),
    box: one(boxes, {
        fields: [interventionOutcomes.boxId],
        references: [boxes.id],
        relationName: "box_intervention_outcomes"
    }),
}));

export const wellnessPerformanceCorrelationsRelations = relations(wellnessPerformanceCorrelations, ({ one }) => ({
    box: one(boxes, {
        fields: [wellnessPerformanceCorrelations.boxId],
        references: [boxes.id],
        relationName: "box_wellness_performance_correlations"
    }),
}));

export const coachPerformanceMetricsRelations = relations(coachPerformanceMetrics, ({ one }) => ({
    box: one(boxes, {
        fields: [coachPerformanceMetrics.boxId],
        references: [boxes.id],
        relationName: "box_coach_performance_metrics"
    }),
    coach: one(boxMemberships, {
        fields: [coachPerformanceMetrics.coachMembershipId],
        references: [boxMemberships.id],
        relationName: "coach_performance_metrics"
    }),
}));

export const retentionEventsRelations = relations(retentionEvents, ({ one }) => ({
    box: one(boxes, {
        fields: [retentionEvents.boxId],
        references: [boxes.id],
        relationName: "box_retention_events"
    }),
    membership: one(boxMemberships, {
        fields: [retentionEvents.membershipId],
        references: [boxMemberships.id],
        relationName: "membership_retention_events"
    }),
}));

export const boxSubscriptionHealthRelations = relations(boxSubscriptionHealth, ({ one }) => ({
    box: one(boxes, {
        fields: [boxSubscriptionHealth.boxId],
        references: [boxes.id],
        relationName: "box_subscription_health"
    }),
}));

// Relations for new analytics tables

export const athleteCohortAnalyticsRelations = relations(athleteCohortAnalytics, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteCohortAnalytics.boxId],
        references: [boxes.id],
        relationName: "box_cohort_analytics"
    }),
}));

export const athleteSegmentAnalyticsRelations = relations(athleteSegmentAnalytics, ({ one }) => ({
    box: one(boxes, {
        fields: [athleteSegmentAnalytics.boxId],
        references: [boxes.id],
        relationName: "box_segment_analytics"
    }),
}));

export const modelPerformanceMetricsRelations = relations(modelPerformanceMetrics, ({ one }) => ({
    box: one(boxes, {
        fields: [modelPerformanceMetrics.boxId],
        references: [boxes.id],
        relationName: "box_model_performance_metrics"
    }),
}));

export const engagementPatternAnalyticsRelations = relations(engagementPatternAnalytics, ({ one }) => ({
    box: one(boxes, {
        fields: [engagementPatternAnalytics.boxId],
        references: [boxes.id],
        relationName: "box_engagement_pattern_analytics"
    }),
}));

export const alertEffectivenessMetricsRelations = relations(alertEffectivenessMetrics, ({ one }) => ({
    box: one(boxes, {
        fields: [alertEffectivenessMetrics.boxId],
        references: [boxes.id],
        relationName: "box_alert_effectiveness_metrics"
    }),
}));

export const seasonalAnalyticsRelations = relations(seasonalAnalytics, ({ one }) => ({
    box: one(boxes, {
        fields: [seasonalAnalytics.boxId],
        references: [boxes.id],
        relationName: "box_seasonal_analytics"
    }),
}));

export const benchmarkAnalyticsRelations = relations(benchmarkAnalytics, ({ one }) => ({
    box: one(boxes, {
        fields: [benchmarkAnalytics.boxId],
        references: [boxes.id],
        relationName: "box_benchmark_analytics"
    }),
}));

export const financialImpactAnalyticsRelations = relations(financialImpactAnalytics, ({ one }) => ({
    box: one(boxes, {
        fields: [financialImpactAnalytics.boxId],
        references: [boxes.id],
        relationName: "box_financial_impact_analytics"
    }),
}));

export const featureUsageAnalyticsRelations = relations(featureUsageAnalytics, ({ one }) => ({
    box: one(boxes, {
        fields: [featureUsageAnalytics.boxId],
        references: [boxes.id],
        relationName: "box_feature_usage_analytics"
    }),
}));
