// server/src/db/schema/views.ts
import {pgView, text, integer, timestamp, numeric, uuid, jsonb, boolean} from "drizzle-orm/pg-core";

// Materialized View: Box Health Dashboard
export const mvBoxHealthDashboard = pgView("mv_box_health_dashboard", {
    boxId: uuid("box_id"),
    period: text("period"),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    totalRiskScores: integer("total_risk_scores"),
    totalAlerts: integer("total_alerts"),
    avgEnergy: numeric("avg_energy"),
    avgSleep: numeric("avg_sleep"),
    avgStress: numeric("avg_stress"),
    totalCheckins: integer("total_checkins"),
    uniqueAthletes: integer("unique_athletes"),
    totalPrs: integer("total_prs"),
    avgImprovement: numeric("avg_improvement"),
    calculatedAt: timestamp("calculated_at"),
}).existing();

// View: Athlete Risk Overview
export const vwAthleteRiskOverview = pgView("vw_athlete_risk_overview", {
    // Include all columns from athlete_risk_scores
    id: uuid("id"),
    boxId: uuid("box_id"),
    membershipId: uuid("membership_id"),
    overallRiskScore: numeric("overall_risk_score", { precision: 5, scale: 2 }),
    riskLevel: text("risk_level"),
    churnProbability: numeric("churn_probability", { precision: 5, scale: 4 }),
    attendanceScore: numeric("attendance_score", { precision: 5, scale: 2 }),
    performanceScore: numeric("performance_score", { precision: 5, scale: 2 }),
    engagementScore: numeric("engagement_score", { precision: 5, scale: 2 }),
    wellnessScore: numeric("wellness_score", { precision: 5, scale: 2 }),
    attendanceTrend: numeric("attendance_trend", { precision: 5, scale: 2 }),
    performanceTrend: numeric("performance_trend", { precision: 5, scale: 2 }),
    engagementTrend: numeric("engagement_trend", { precision: 5, scale: 2 }),
    wellnessTrend: numeric("wellness_trend", { precision: 5, scale: 2 }),
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
    fitnessLevel: text("fitness_level"),
    boxName: text("box_name"),
}).existing();

// Materialized View: Coach Performance
export const mvCoachPerformance = pgView("mv_coach_performance", {
    coachMembershipId: uuid("coach_membership_id"),
    boxId: uuid("box_id"),
    coachName: text("coach_name"),
    totalInterventions: integer("total_interventions"),
    successfulInterventions: integer("successful_interventions"),
    avgResolutionTimeHours: numeric("avg_resolution_time_hours"),
    calculatedAt: timestamp("calculated_at"),
}).existing();

// Materialized View: Athlete Engagement Scores
export const mvAthleteEngagementScores = pgView("mv_athlete_engagement_scores", {
    membershipId: uuid("membership_id"),
    boxId: uuid("box_id"),
    membershipPublicId: text("membership_public_id"),
    athleteName: text("athlete_name"),
    athleteEmail: text("athlete_email"),
    fitnessLevel: text("fitness_level"),
    checkinCount: integer("checkin_count"),
    prCount: integer("pr_count"),
    attendanceCount: integer("attendance_count"),
    benchmarkCount: integer("benchmark_count"),
    engagementScore: integer("engagement_score"),
    calculatedAt: timestamp("calculated_at"),
}).existing();

// View: Wellness Performance Correlation
export const vwWellnessPerformanceCorrelation = pgView("vw_wellness_performance_correlation", {
    membershipId: uuid("membership_id"),
    boxId: uuid("box_id"),
    energyPrCorrelation: numeric("energy_pr_correlation"),
    sleepPrCorrelation: numeric("sleep_pr_correlation"),
    stressPrCorrelation: numeric("stress_pr_correlation"),
    dataPoints: integer("data_points"),
}).existing();

// Materialized View: Monthly Retention Cohort Analysis
export const mvMonthlyRetention = pgView("mv_monthly_retention", {
    boxId: uuid("box_id"),
    cohortMonth: timestamp("cohort_month"),
    cohortSize: integer("cohort_size"),
    activityMonth: timestamp("activity_month"),
    activeMembers: integer("active_members"),
    retentionRate: numeric("retention_rate", { precision: 5, scale: 2 }),
    monthsSinceJoin: integer("months_since_join"),
}).existing();

// Materialized View: Athlete Progress Timeline
export const mvAthleteProgress = pgView("mv_athlete_progress", {
    membershipId: uuid("membership_id"),
    boxId: uuid("box_id"),
    eventType: text("event_type"),
    eventDate: timestamp("event_date"),
    referenceId: uuid("reference_id"),
    resultValue: text("result_value"),
    eventDescription: text("event_description"),
}).existing();

// View: Box Subscription Health
export const vwBoxSubscriptionHealth = pgView("vw_box_subscription_health", {
    boxId: uuid("box_id"),
    boxName: text("box_name"),
    subscriptionStatus: text("subscription_status"),
    subscriptionTier: text("subscription_tier"),
    trialEndsAt: timestamp("trial_ends_at"),
    subscriptionEndsAt: timestamp("subscription_ends_at"),
    polarSubscriptionStatus: text("polar_subscription_status"),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end"),
    activeAthletes: integer("active_athletes"),
    activeCoaches: integer("active_coaches"),
    athleteLimit: integer("athlete_limit"),
    coachLimit: integer("coach_limit"),
    healthStatus: text("health_status"),
}).existing();

// Materialized View: Wellness Trends Over Time
export const mvWellnessTrends = pgView("mv_wellness_trends", {
    boxId: uuid("box_id"),
    membershipId: uuid("membership_id"),
    weekStart: timestamp("week_start"),
    avgEnergy: numeric("avg_energy", { precision: 4, scale: 2 }),
    avgSleep: numeric("avg_sleep", { precision: 4, scale: 2 }),
    avgStress: numeric("avg_stress", { precision: 4, scale: 2 }),
    avgMotivation: numeric("avg_motivation", { precision: 4, scale: 2 }),
    avgReadiness: numeric("avg_readiness", { precision: 4, scale: 2 }),
    checkinCount: integer("checkin_count"),
}).existing();
