// server/src/db/schema/views.ts
import { pgView, text, integer, timestamp, numeric, uuid, jsonb, boolean } from "drizzle-orm/pg-core";

// 1. Materialized View: Intervention Effectiveness
// Purpose: Aggregate and analyze the outcomes of coach interventions.
export const mvInterventionEffectiveness = pgView("mv_intervention_effectiveness", {
    coachMembershipId: uuid("coach_membership_id"),
    boxId: uuid("box_id"),
    interventionType: text("intervention_type"),
    interventionsWithOutcome: integer("interventions_with_outcome"),
    avgRiskScoreChange: numeric("avg_risk_score_change"),
    avgAttendanceRateChange: numeric("avg_attendance_rate_change"),
    avgCheckinRateChange: numeric("avg_checkin_rate_change"),
    avgWellnessScoreChange: numeric("avg_wellness_score_change"),
    totalInterventionsInPeriod: integer("total_interventions_in_period"),
}).existing();

// 2. View: Wellness Performance Correlation History
// Purpose: Provide a standard way to access wellness-performance correlation data.
export const vwWellnessPerformanceCorrelationHistory = pgView("vw_wellness_performance_correlation_history", {
    id: uuid("id"),
    boxId: uuid("box_id"),
    wellnessMetric: text("wellness_metric"),
    performanceMetric: text("performance_metric"),
    correlationType: text("correlation_type"),
    correlationValue: numeric("correlation_value"),
    pValue: numeric("p_value"),
    sampleSize: integer("sample_size"),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    calculatedAt: timestamp("calculated_at"),
    version: text("version"),
}).existing();

// 3. Materialized View: Detailed Coach Performance
// Purpose: Provide a more granular, time-series view of coach performance.
export const mvDetailedCoachPerformance = pgView("mv_detailed_coach_performance", {
    coachId: uuid("coach_id"),
    boxId: uuid("box_id"),
    monthStart: timestamp("month_start"),
    interventionsCount: integer("interventions_count"),
    successfulInterventions: integer("successful_interventions"),
    avgResolutionTimeHours: numeric("avg_resolution_time_hours"),
    athletesImpacted: integer("athletes_impacted"),
    avgRiskReductionImpact: numeric("avg_risk_reduction_impact"),
}).existing();

// 4. Materialized View: Retention Event Analysis
// Purpose: Analyze patterns and reasons behind retention events.
export const mvRetentionEventAnalysis = pgView("mv_retention_event_analysis", {
    boxId: uuid("box_id"),
    eventMonth: timestamp("event_month"),
    eventType: text("event_type"),
    reason: text("reason"),
    eventCount: integer("event_count"),
    avgDaysBeforeEvent: numeric("avg_days_before_event"),
}).existing();

// 5. View: Box Subscription Health History
// Purpose: Provide a standard way to access box subscription health data.
export const vwBoxSubscriptionHealthHistory = pgView("vw_box_subscription_health_history", {
    id: uuid("id"),
    boxId: uuid("box_id"),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    mrr: numeric("mrr"),
    arr: numeric("arr"),
    churnedMrr: numeric("churned_mrr"),
    expansionMrr: numeric("expansion_mrr"),
    contractionMrr: numeric("contraction_mrr"),
    effectiveAthleteLimit: integer("effective_athlete_limit"),
    effectiveCoachLimit: integer("effective_coach_limit"),
    totalOverageRevenue: numeric("total_overage_revenue"),
    healthScore: numeric("health_score"),
    calculatedAt: timestamp("calculated_at"),
    version: text("version"),
}).existing();

// 6. View: Active Alerts by Coach
// Purpose: Provide a real-time list of active alerts assigned to each coach.
export const vwActiveAlertsByCoach = pgView("vw_active_alerts_by_coach", {
    // All athlete_alerts columns
    id: uuid("id"),
    boxId: uuid("box_id"),
    membershipId: uuid("membership_id"),
    assignedCoachId: uuid("assigned_coach_id"),
    alertType: text("alert_type"),
    severity: text("severity"),
    title: text("title"),
    description: text("description"),
    triggerData: jsonb("trigger_data"),
    suggestedActions: jsonb("suggested_actions"),
    status: text("status"),
    acknowledgedAt: timestamp("acknowledged_at"),
    acknowledgedById: uuid("acknowledged_by_id"),
    resolvedAt: timestamp("resolved_at"),
    resolvedById: uuid("resolved_by_id"),
    resolutionNotes: text("resolution_notes"),
    followUpAt: timestamp("follow_up_at"),
    remindersSent: integer("reminders_sent"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    // Additional joined column
    coachUserId: uuid("coach_user_id"),
}).existing();

// 7. View: Upcoming Intervention Follow-ups
// Purpose: Show interventions that require follow-up actions soon.
export const vwUpcomingInterventionFollowUps = pgView("vw_upcoming_intervention_follow_ups", {
    // All athlete_interventions columns
    id: uuid("id"),
    boxId: uuid("box_id"),
    membershipId: uuid("membership_id"),
    coachId: uuid("coach_id"),
    alertId: uuid("alert_id"),
    interventionType: text("intervention_type"),
    title: text("title"),
    description: text("description"),
    outcome: text("outcome"),
    athleteResponse: text("athlete_response"),
    coachNotes: text("coach_notes"),
    followUpRequired: boolean("follow_up_required"),
    followUpAt: timestamp("follow_up_at"),
    followUpCompleted: boolean("follow_up_completed"),
    interventionDate: timestamp("intervention_date"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
}).existing();

// 8. Materialized View: Billing Event Processing Queue
// Purpose: Help monitor and manage the processing of incoming billing events from Polar.
export const mvBillingEventProcessingQueue = pgView("mv_billing_event_processing_queue", {
    eventType: text("event_type"),
    status: text("status"),
    boxId: uuid("box_id"),
    eventCount: integer("event_count"),
    oldestEventDate: timestamp("oldest_event_date"),
    newestEventDate: timestamp("newest_event_date"),
    errorMessages: text("error_messages"),
}).existing();

// 9. View: Box Billing Details
// Purpose: Provide a consolidated view of a box's current billing status.
export const vwBoxBillingDetails = pgView("vw_box_billing_details", {
    boxId: uuid("box_id"),
    boxName: text("box_name"),
    subscriptionStatus: text("subscription_status"),
    subscriptionTier: text("subscription_tier"),
    currentAthleteLimit: integer("current_athlete_limit"),
    currentCoachLimit: integer("current_coach_limit"),
    currentAthleteCount: integer("current_athlete_count"),
    currentCoachCount: integer("current_coach_count"),
    // Subscription details
    subscriptionId: uuid("subscription_id"),
    subStatus: text("sub_status"),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    nextBillingDate: timestamp("next_billing_date"),
    planTier: text("plan_tier"),
    monthlyPrice: numeric("monthly_price"),
    planAthleteLimit: integer("plan_athlete_limit"),
    planCoachLimit: integer("plan_coach_limit"),
    // Recent order/charge info
    lastOrderAmount: numeric("last_order_amount"),
    lastOrderStatus: text("last_order_status"),
    lastOrderDate: timestamp("last_order_date"),
    // Overage info
    recentOverageAmount: numeric("recent_overage_amount"),
}).existing();

// 10. Materialized View: Wellness Trends (Updated version)
// Purpose: Aggregates average wellness scores for athletes on a weekly basis.
export const mvWellnessTrends = pgView("mv_wellness_trends", {
    boxId: uuid("box_id"),
    membershipId: uuid("membership_id"),
    weekStart: timestamp("week_start"),
    avgEnergy: numeric("avg_energy"),
    avgSleep: numeric("avg_sleep"),
    avgStress: numeric("avg_stress"),
    avgMotivation: numeric("avg_motivation"),
    avgReadiness: numeric("avg_readiness"),
    avgHydration: numeric("avg_hydration"),
    avgNutrition: numeric("avg_nutrition"),
    totalCheckins: integer("total_checkins"),
    lastCheckinDate: timestamp("last_checkin_date"),
}).existing();

// 11. Materialized View: Box Health Dashboard (Updated version)
// Purpose: Pre-aggregates key metrics for the box health dashboard.
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

// 12. View: Athlete Risk Overview (Updated version)
// Purpose: Provides a current snapshot of the latest risk scores for athletes.
export const vwAthleteRiskOverview = pgView("vw_athlete_risk_overview", {
    riskScoreId: uuid("risk_score_id"),
    boxId: uuid("box_id"),
    membershipId: uuid("membership_id"),
    membershipPublicId: text("membership_public_id"),
    athleteName: text("athlete_name"),
    athleteEmail: text("athlete_email"),
    overallRiskScore: numeric("overall_risk_score"),
    riskLevel: text("risk_level"),
    churnProbability: numeric("churn_probability"),
    calculatedAt: timestamp("calculated_at"),
    validUntil: timestamp("valid_until"),
    healthStatus: text("health_status"),
}).existing();

// 13. Materialized View: Monthly Retention (Updated version)
// Purpose: Performs cohort analysis to calculate monthly retention rates.
export const mvMonthlyRetention = pgView("mv_monthly_retention", {
    boxId: uuid("box_id"),
    cohortMonth: timestamp("cohort_month"),
    cohortSize: integer("cohort_size"),
    activityMonth: timestamp("activity_month"),
    activeMembers: integer("active_members"),
    retentionRate: numeric("retention_rate"),
    monthsSinceJoin: integer("months_since_join"),
}).existing();

// 14. Materialized View: Athlete Progress (Updated version)
// Purpose: Creates a unified timeline of key athlete achievements.
export const mvAthleteProgress = pgView("mv_athlete_progress", {
    membershipId: uuid("membership_id"),
    boxId: uuid("box_id"),
    eventType: text("event_type"),
    eventDate: timestamp("event_date"),
    referenceId: uuid("reference_id"),
    resultValue: text("result_value"),
    eventDescription: text("event_description"),
}).existing();

// 15. Materialized View: Wellness Performance Correlations
// Purpose: Calculates correlations between wellness metrics and performance.
export const mvWellnessPerformanceCorrelations = pgView("mv_wellness_performance_correlations", {
    boxId: uuid("box_id"),
    membershipId: uuid("membership_id"),
    weekStart: timestamp("week_start"),
    avgEnergyLevel: numeric("avg_energy_level"),
    avgSleepQuality: numeric("avg_sleep_quality"),
    avgStressLevel: numeric("avg_stress_level"),
    avgWorkoutReadiness: numeric("avg_workout_readiness"),
    avgRecentPrValue: numeric("avg_recent_pr_value"),
}).existing();

// 16. Materialized View: Coach Performance (Updated version)
// Purpose: Aggregates performance metrics for coaches based on interventions and alert resolutions.
export const mvCoachPerformance = pgView("mv_coach_performance", {
    coachMembershipId: uuid("coach_membership_id"),
    boxId: uuid("box_id"),
    avgRiskScoreReduction: numeric("avg_risk_score_reduction"),
    interventionsCompleted: integer("interventions_completed"),
    alertsResolved: integer("alerts_resolved"),
    avgTimeToAlertResolution: numeric("avg_time_to_alert_resolution"),
    athleteRetentionRate: numeric("athlete_retention_rate"),
    athletePrImprovementRate: numeric("athlete_pr_improvement_rate"),
    calculatedAt: timestamp("calculated_at"),
}).existing();

// 17. Materialized View: Athlete Engagement Scores (Updated version)
// Purpose: Calculates an engagement score for each active athlete based on recent activity.
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

// LEGACY VIEWS (from old implementation - keeping for backward compatibility)

// View: Wellness Performance Correlation (Legacy)
// Purpose: Calculates correlations between wellness scores and performance (PR) values for athletes.
export const vwWellnessPerformanceCorrelation = pgView("vw_wellness_performance_correlation", {
    membershipId: uuid("membership_id"),
    boxId: uuid("box_id"),
    energyPrCorrelation: numeric("energy_pr_correlation"),
    sleepPrCorrelation: numeric("sleep_pr_correlation"),
    stressPrCorrelation: numeric("stress_pr_correlation"),
    dataPoints: integer("data_points"),
}).existing();

// View: Box Subscription Health (Legacy)
// Purpose: Provides a snapshot of the subscription status and health for each box.
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
