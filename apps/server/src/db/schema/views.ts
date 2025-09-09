// server/src/db/schema/views.ts
import { pgView, text, integer, timestamp, numeric, uuid, jsonb, boolean } from "drizzle-orm/pg-core";

// Materialized View: Box Health Dashboard
// Purpose: Pre-aggregates key metrics for the box health dashboard, grouped by period (likely weekly).
export const mvBoxHealthDashboard = pgView("mv_box_health_dashboard", {
    boxId: uuid("box_id"),
    period: text("period"),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    totalRiskScores: integer("total_risk_scores"),
    totalAlerts: integer("total_alerts"),
    avgEnergy: numeric("avg_energy"), // Changed from numeric with scale/precision to generic numeric to match SQL AVG result
    avgSleep: numeric("avg_sleep"),
    avgStress: numeric("avg_stress"),
    totalCheckins: integer("total_checkins"),
    uniqueAthletes: integer("unique_athletes"),
    totalPrs: integer("total_prs"),
    avgImprovement: numeric("avg_improvement"), // Changed from numeric with scale/precision
    calculatedAt: timestamp("calculated_at"),
}).existing();

// View: Athlete Risk Overview
// Purpose: Provides a current snapshot of the latest risk scores for athletes, enriched with athlete and box details.
export const vwAthleteRiskOverview = pgView("vw_athlete_risk_overview", {
    // Include all columns from athlete_risk_scores
    id: uuid("id"),
    boxId: uuid("box_id"),
    membershipId: uuid("membership_id"),
    overallRiskScore: numeric("overall_risk_score"), // Changed from explicit scale/precision
    riskLevel: text("risk_level"), // Matches risk_level enum
    churnProbability: numeric("churn_probability"), // Changed from explicit scale/precision
    attendanceScore: numeric("attendance_score"), // Changed from explicit scale/precision
    performanceScore: numeric("performance_score"), // Changed from explicit scale/precision
    engagementScore: numeric("engagement_score"), // Changed from explicit scale/precision
    wellnessScore: numeric("wellness_score"), // Changed from explicit scale/precision
    attendanceTrend: numeric("attendance_trend"), // Changed from explicit scale/precision
    performanceTrend: numeric("performance_trend"), // Changed from explicit scale/precision
    engagementTrend: numeric("engagement_trend"), // Changed from explicit scale/precision
    wellnessTrend: numeric("wellness_trend"), // Changed from explicit scale/precision
    daysSinceLastVisit: integer("days_since_last_visit"),
    daysSinceLastCheckin: integer("days_since_last_checkin"),
    daysSinceLastPr: integer("days_since_last_pr"),
    factors: jsonb("factors"),
    calculatedAt: timestamp("calculated_at"),
    validUntil: timestamp("valid_until"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),

    // Additional joined columns
    membershipPublicId: text("membership_public_id"),
    athleteName: text("athlete_name"),
    athleteEmail: text("athlete_email"),
    fitnessLevel: text("fitness_level"), // Matches text type in user_profiles
    boxName: text("box_name"),
}).existing();

// Materialized View: Coach Performance
// Purpose: Aggregates performance metrics for coaches based on interventions and alert resolutions.
export const mvCoachPerformance = pgView("mv_coach_performance", {
    coachMembershipId: uuid("coach_membership_id"),
    boxId: uuid("box_id"),
    coachName: text("coach_name"),
    totalInterventions: integer("total_interventions"),
    successfulInterventions: integer("successful_interventions"),
    avgResolutionTimeHours: numeric("avg_resolution_time_hours"), // Changed from explicit scale/precision
    calculatedAt: timestamp("calculated_at"),
}).existing();

// Materialized View: Athlete Engagement Scores
// Purpose: Calculates an engagement score for each active athlete based on recent activity.
export const mvAthleteEngagementScores = pgView("mv_athlete_engagement_scores", {
    membershipId: uuid("membership_id"),
    boxId: uuid("box_id"),
    membershipPublicId: text("membership_public_id"),
    athleteName: text("athlete_name"),
    athleteEmail: text("athlete_email"),
    fitnessLevel: text("fitness_level"), // Matches text type in user_profiles
    checkinCount: integer("checkin_count"),
    prCount: integer("pr_count"),
    attendanceCount: integer("attendance_count"),
    benchmarkCount: integer("benchmark_count"),
    engagementScore: integer("engagement_score"), // Result of ROUND(), so integer
    calculatedAt: timestamp("calculated_at"),
}).existing();

// View: Wellness Performance Correlation
// Purpose: Calculates correlations between wellness scores and performance (PR) values for athletes.
export const vwWellnessPerformanceCorrelation = pgView("vw_wellness_performance_correlation", {
    membershipId: uuid("membership_id"),
    boxId: uuid("box_id"),
    energyPrCorrelation: numeric("energy_pr_correlation"), // Changed from explicit scale/precision
    sleepPrCorrelation: numeric("sleep_pr_correlation"), // Changed from explicit scale/precision
    stressPrCorrelation: numeric("stress_pr_correlation"), // Changed from explicit scale/precision
    dataPoints: integer("data_points"),
}).existing();

// Materialized View: Monthly Retention Cohort Analysis
// Purpose: Performs cohort analysis to calculate monthly retention rates based on initial joining month and subsequent activity.
export const mvMonthlyRetention = pgView("mv_monthly_retention", {
    boxId: uuid("box_id"),
    cohortMonth: timestamp("cohort_month"),
    cohortSize: integer("cohort_size"),
    activityMonth: timestamp("activity_month"),
    activeMembers: integer("active_members"),
    retentionRate: numeric("retention_rate"), // Changed from explicit scale/precision to match SQL ROUND result type
    monthsSinceJoin: integer("months_since_join"), // Changed from numeric to integer based on COALESCE/EXTRACT logic
}).existing();

// Materialized View: Athlete Progress Timeline
// Purpose: Creates a unified timeline of key athlete achievements (PRs, Benchmarks, Milestones).
export const mvAthleteProgress = pgView("mv_athlete_progress", {
    membershipId: uuid("membership_id"),
    boxId: uuid("box_id"),
    eventType: text("event_type"),
    eventDate: timestamp("event_date"),
    referenceId: uuid("reference_id"),
    resultValue: text("result_value"), // Result of ::TEXT cast
    eventDescription: text("event_description"),
}).existing();

// View: Box Subscription Health
// Purpose: Provides a snapshot of the subscription status and health for each box.
export const vwBoxSubscriptionHealth = pgView("vw_box_subscription_health", {
    boxId: uuid("box_id"),
    boxName: text("box_name"),
    subscriptionStatus: text("subscription_status"), // Matches subscription_status enum
    subscriptionTier: text("subscription_tier"), // Matches subscription_tier enum
    trialEndsAt: timestamp("trial_ends_at"),
    subscriptionEndsAt: timestamp("subscription_ends_at"),
    polarSubscriptionStatus: text("polar_subscription_status"), // Matches text type in subscriptions
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end"),
    activeAthletes: integer("active_athletes"),
    activeCoaches: integer("active_coaches"),
    athleteLimit: integer("athlete_limit"),
    coachLimit: integer("coach_limit"),
    healthStatus: text("health_status"), // Custom status derived in CASE statement
}).existing();

// Materialized View: Wellness Trends Over Time
// Purpose: Aggregates average wellness scores for athletes on a weekly basis.
export const mvWellnessTrends = pgView("mv_wellness_trends", {
    boxId: uuid("box_id"),
    membershipId: uuid("membership_id"),
    weekStart: timestamp("week_start"),
    avgEnergy: numeric("avg_energy"), // Changed from explicit scale/precision
    avgSleep: numeric("avg_sleep"), // Changed from explicit scale/precision
    avgStress: numeric("avg_stress"), // Changed from explicit scale/precision
    avgMotivation: numeric("avg_motivation"), // Changed from explicit scale/precision
    avgReadiness: numeric("avg_readiness"), // Changed from explicit scale/precision
    checkinCount: integer("checkin_count"),
}).existing();
