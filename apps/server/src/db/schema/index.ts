// db/schema/index.ts - Enhanced version with all schema exports and consistent naming
export * from "./auth";
export * from "./core";
export * from "./athletes";
export * from "./analytics";
export * from "./billing";

// Re-export all tables for easy importing
import * as auth from "./auth";
import * as core from "./core";
import * as athletes from "./athletes";
import * as analytics from "./analytics";
import * as billing from "./billing";

export const schema = {
    ...auth,
    ...core,
    ...athletes,
    ...analytics,
    ...billing,
};

// Type helpers for common queries - Enhanced with new tables
import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Auth schemas - Enhanced
export const selectUserSchema = createSelectSchema(auth.user);
export const insertUserSchema = createInsertSchema(auth.user);
export const selectSessionSchema = createSelectSchema(auth.session);
export const insertSessionSchema = createInsertSchema(auth.session);
export const selectAccountSchema = createSelectSchema(auth.account);
export const insertAccountSchema = createInsertSchema(auth.account);
export const selectVerificationSchema = createSelectSchema(auth.verification);
export const insertVerificationSchema = createInsertSchema(auth.verification);

// Core schemas - Updated with consistent naming
export const selectBoxSchema = createSelectSchema(core.boxes);
export const insertBoxSchema = createInsertSchema(core.boxes);
export const selectBoxMembershipSchema = createSelectSchema(core.boxMemberships);
export const insertBoxMembershipSchema = createInsertSchema(core.boxMemberships);
export const selectUserProfileSchema = createSelectSchema(core.userProfiles);
export const insertUserProfileSchema = createInsertSchema(core.userProfiles);

// Onboarding schemas
export const selectBoxInviteSchema = createSelectSchema(core.boxInvites);
export const insertBoxInviteSchema = createInsertSchema(core.boxInvites);
export const selectBoxQrCodeSchema = createSelectSchema(core.boxQrCodes);
export const insertBoxQrCodeSchema = createInsertSchema(core.boxQrCodes);
export const selectApprovalQueueSchema = createSelectSchema(core.approvalQueue);
export const insertApprovalQueueSchema = createInsertSchema(core.approvalQueue);

// Demo schemas - Enhanced
export const selectDemoPersonaSchema = createSelectSchema(core.demoPersonas);
export const insertDemoPersonaSchema = createInsertSchema(core.demoPersonas);
export const selectDemoDataSnapshotSchema = createSelectSchema(core.demoDataSnapshots);
export const insertDemoDataSnapshotSchema = createInsertSchema(core.demoDataSnapshots);
export const selectDemoGuidedFlowSchema = createSelectSchema(core.demoGuidedFlows);
export const insertDemoGuidedFlowSchema = createInsertSchema(core.demoGuidedFlows);

// Movement and benchmark schemas
export const selectMovementSchema = createSelectSchema(athletes.movements);
export const insertMovementSchema = createInsertSchema(athletes.movements);
export const selectBenchmarkWodSchema = createSelectSchema(athletes.benchmarkWods);
export const insertBenchmarkWodSchema = createInsertSchema(athletes.benchmarkWods);

// Athlete schemas - Enhanced with new video tables
export const selectAthletePrSchema = createSelectSchema(athletes.athletePrs);
export const insertAthletePrSchema = createInsertSchema(athletes.athletePrs);
export const selectVideoConsentSchema = createSelectSchema(athletes.videoConsents);
export const insertVideoConsentSchema = createInsertSchema(athletes.videoConsents);
export const selectVideoProcessingEventSchema = createSelectSchema(athletes.videoProcessingEvents);
export const insertVideoProcessingEventSchema = createInsertSchema(athletes.videoProcessingEvents);
export const selectGumletWebhookEventSchema = createSelectSchema(athletes.gumletWebhookEvents);
export const insertGumletWebhookEventSchema = createInsertSchema(athletes.gumletWebhookEvents);

export const selectAthleteBenchmarkSchema = createSelectSchema(athletes.athleteBenchmarks);
export const insertAthleteBenchmarkSchema = createInsertSchema(athletes.athleteBenchmarks);

// Wellness schemas - Enhanced with normalized tracking
export const selectAthleteWellnessCheckinSchema = createSelectSchema(athletes.athleteWellnessCheckins);
export const insertAthleteWellnessCheckinSchema = createInsertSchema(athletes.athleteWellnessCheckins);
export const selectAthleteSorenessEntrySchema = createSelectSchema(athletes.athleteSorenessEntries);
export const insertAthleteSorenessEntrySchema = createInsertSchema(athletes.athleteSorenessEntries);
export const selectAthletePainEntrySchema = createSelectSchema(athletes.athletePainEntries);
export const insertAthletePainEntrySchema = createInsertSchema(athletes.athletePainEntries);

// WOD schemas - Enhanced
export const selectWodFeedbackSchema = createSelectSchema(athletes.wodFeedback);
export const insertWodFeedbackSchema = createInsertSchema(athletes.wodFeedback);
export const selectWodPainEntrySchema = createSelectSchema(athletes.wodPainEntries);
export const insertWodPainEntrySchema = createInsertSchema(athletes.wodPainEntries);
export const selectWodAttendanceSchema = createSelectSchema(athletes.wodAttendance);
export const insertWodAttendanceSchema = createInsertSchema(athletes.wodAttendance);

// Badge and leaderboard schemas
export const selectAthleteBadgeSchema = createSelectSchema(athletes.athleteBadges);
export const insertAthleteBadgeSchema = createInsertSchema(athletes.athleteBadges);
export const selectLeaderboardSchema = createSelectSchema(athletes.leaderboards);
export const insertLeaderboardSchema = createInsertSchema(athletes.leaderboards);
export const selectLeaderboardEntrySchema = createSelectSchema(athletes.leaderboardEntries);
export const insertLeaderboardEntrySchema = createInsertSchema(athletes.leaderboardEntries);

// Analytics schemas - CRITICAL MVP TABLES ADDED
export const selectAthleteRiskScoreSchema = createSelectSchema(analytics.athleteRiskScores);
export const insertAthleteRiskScoreSchema = createInsertSchema(analytics.athleteRiskScores);
export const selectAthleteAlertSchema = createSelectSchema(analytics.athleteAlerts);
export const insertAthleteAlertSchema = createInsertSchema(analytics.athleteAlerts);
export const selectAthleteInterventionSchema = createSelectSchema(analytics.athleteInterventions);
export const insertAthleteInterventionSchema = createInsertSchema(analytics.athleteInterventions);
export const selectAthleteMilestoneSchema = createSelectSchema(analytics.athleteMilestones);
export const insertAthleteMilestoneSchema = createInsertSchema(analytics.athleteMilestones);
export const selectBoxAnalyticsSchema = createSelectSchema(analytics.boxAnalytics);
export const insertBoxAnalyticsSchema = createInsertSchema(analytics.boxAnalytics);
export const selectDemoEngagementMetricsSchema = createSelectSchema(analytics.demoEngagementMetrics);
export const insertDemoEngagementMetricsSchema = createInsertSchema(analytics.demoEngagementMetrics);

// New analytics schemas
export const selectRiskFactorHistorySchema = createSelectSchema(analytics.riskFactorHistory);
export const insertRiskFactorHistorySchema = createInsertSchema(analytics.riskFactorHistory);
export const selectAlertEscalationSchema = createSelectSchema(analytics.alertEscalations);
export const insertAlertEscalationSchema = createInsertSchema(analytics.alertEscalations);

// Billing schemas - Enhanced
export const selectBillingEventSchema = createSelectSchema(billing.billingEvents);
export const insertBillingEventSchema = createInsertSchema(billing.billingEvents);
export const selectSubscriptionPlanSchema = createSelectSchema(billing.subscriptionPlans);
export const insertSubscriptionPlanSchema = createInsertSchema(billing.subscriptionPlans);
export const selectCustomerProfileSchema = createSelectSchema(billing.customerProfiles);
export const insertCustomerProfileSchema = createInsertSchema(billing.customerProfiles);
export const selectSubscriptionSchema = createSelectSchema(billing.subscriptions);
export const insertSubscriptionSchema = createInsertSchema(billing.subscriptions);
export const selectOrderSchema = createSelectSchema(billing.orders);
export const insertOrderSchema = createInsertSchema(billing.orders);
export const selectGracePeriodSchema = createSelectSchema(billing.gracePeriods);
export const insertGracePeriodSchema = createInsertSchema(billing.gracePeriods);
export const selectUsageEventSchema = createSelectSchema(billing.usageEvents);
export const insertUsageEventSchema = createInsertSchema(billing.usageEvents);

// Common filter schemas - Enhanced
export const paginationSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
});

// Enhanced filter schemas
export const membershipFilterSchema = z.object({
    role: z.enum(["owner", "head_coach", "coach", "athlete"]).optional(),
    isActive: z.boolean().optional(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
});

export const videoFilterSchema = z.object({
    processingStatus: z.enum(["pending", "upload_pending", "processing", "ready", "error"]).optional(),
    visibility: z.enum(["private", "box", "public"]).optional(),
    hasConsent: z.boolean().optional(),
});

export const alertFilterSchema = z.object({
    status: z.enum(["active", "acknowledged", "resolved", "dismissed"]).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    alertType: z.enum([
        "declining_performance", "poor_attendance", "negative_wellness",
        "no_checkin", "injury_risk", "engagement_drop", "churn_risk"
    ]).optional(),
    assignedCoachId: z.string().uuid().optional(),
});

export const wellnessFilterSchema = z.object({
    minEnergyLevel: z.number().min(1).max(10).optional(),
    maxStressLevel: z.number().min(1).max(10).optional(),
    minWorkoutReadiness: z.number().min(1).max(10).optional(),
    bodyParts: z.array(z.enum([
        "neck", "shoulders", "chest", "upper_back", "lower_back", "abs",
        "biceps", "triceps", "forearms", "glutes", "quads", "hamstrings",
        "calves", "ankles", "knees", "hips", "wrists"
    ])).optional(),
});

// Type definitions - Enhanced with all new tables and consistent naming

// Auth types
export type User = typeof auth.user.$inferSelect;
export type NewUser = typeof auth.user.$inferInsert;
export type Session = typeof auth.session.$inferSelect;
export type NewSession = typeof auth.session.$inferInsert;
export type Account = typeof auth.account.$inferSelect;
export type NewAccount = typeof auth.account.$inferInsert;
export type Verification = typeof auth.verification.$inferSelect;
export type NewVerification = typeof auth.verification.$inferInsert;

// Core types - Updated with consistent naming
export type Box = typeof core.boxes.$inferSelect;
export type NewBox = typeof core.boxes.$inferInsert;
export type BoxMembership = typeof core.boxMemberships.$inferSelect;
export type NewBoxMembership = typeof core.boxMemberships.$inferInsert;
export type UserProfile = typeof core.userProfiles.$inferSelect;
export type NewUserProfile = typeof core.userProfiles.$inferInsert;

// Onboarding types
export type BoxInvite = typeof core.boxInvites.$inferSelect;
export type NewBoxInvite = typeof core.boxInvites.$inferInsert;
export type BoxQrCode = typeof core.boxQrCodes.$inferSelect;
export type NewBoxQrCode = typeof core.boxQrCodes.$inferInsert;
export type ApprovalQueue = typeof core.approvalQueue.$inferSelect;
export type NewApprovalQueue = typeof core.approvalQueue.$inferInsert;

// Demo types
export type DemoPersona = typeof core.demoPersonas.$inferSelect;
export type NewDemoPersona = typeof core.demoPersonas.$inferInsert;
export type DemoDataSnapshot = typeof core.demoDataSnapshots.$inferSelect;
export type NewDemoDataSnapshot = typeof core.demoDataSnapshots.$inferInsert;
export type DemoGuidedFlow = typeof core.demoGuidedFlows.$inferSelect;
export type NewDemoGuidedFlow = typeof core.demoGuidedFlows.$inferInsert;

// Movement and benchmark types
export type Movement = typeof athletes.movements.$inferSelect;
export type NewMovement = typeof athletes.movements.$inferInsert;
export type BenchmarkWod = typeof athletes.benchmarkWods.$inferSelect;
export type NewBenchmarkWod = typeof athletes.benchmarkWods.$inferInsert;

// Athlete performance types - Enhanced with video types
export type AthletePr = typeof athletes.athletePrs.$inferSelect;
export type NewAthletePr = typeof athletes.athletePrs.$inferInsert;
export type VideoConsent = typeof athletes.videoConsents.$inferSelect;
export type NewVideoConsent = typeof athletes.videoConsents.$inferInsert;
export type VideoProcessingEvent = typeof athletes.videoProcessingEvents.$inferSelect;
export type NewVideoProcessingEvent = typeof athletes.videoProcessingEvents.$inferInsert;
export type GumletWebhookEvent = typeof athletes.gumletWebhookEvents.$inferSelect;
export type NewGumletWebhookEvent = typeof athletes.gumletWebhookEvents.$inferInsert;

export type AthleteBenchmark = typeof athletes.athleteBenchmarks.$inferSelect;
export type NewAthleteBenchmark = typeof athletes.athleteBenchmarks.$inferInsert;

// Wellness types - Enhanced with normalized tracking
export type AthleteWellnessCheckin = typeof athletes.athleteWellnessCheckins.$inferSelect;
export type NewAthleteWellnessCheckin = typeof athletes.athleteWellnessCheckins.$inferInsert;
export type AthleteSorenessEntry = typeof athletes.athleteSorenessEntries.$inferSelect;
export type NewAthleteSorenessEntry = typeof athletes.athleteSorenessEntries.$inferInsert;
export type AthletePainEntry = typeof athletes.athletePainEntries.$inferSelect;
export type NewAthletePainEntry = typeof athletes.athletePainEntries.$inferInsert;

// WOD types - Enhanced
export type WodFeedback = typeof athletes.wodFeedback.$inferSelect;
export type NewWodFeedback = typeof athletes.wodFeedback.$inferInsert;
export type WodPainEntry = typeof athletes.wodPainEntries.$inferSelect;
export type NewWodPainEntry = typeof athletes.wodPainEntries.$inferInsert;
export type WodAttendance = typeof athletes.wodAttendance.$inferSelect;
export type NewWodAttendance = typeof athletes.wodAttendance.$inferInsert;

// Badge and leaderboard types
export type AthleteBadge = typeof athletes.athleteBadges.$inferSelect;
export type NewAthleteBadge = typeof athletes.athleteBadges.$inferInsert;
export type Leaderboard = typeof athletes.leaderboards.$inferSelect;
export type NewLeaderboard = typeof athletes.leaderboards.$inferInsert;
export type LeaderboardEntry = typeof athletes.leaderboardEntries.$inferSelect;
export type NewLeaderboardEntry = typeof athletes.leaderboardEntries.$inferInsert;

// Analytics types - CRITICAL MVP TABLES
export type AthleteRiskScore = typeof analytics.athleteRiskScores.$inferSelect;
export type NewAthleteRiskScore = typeof analytics.athleteRiskScores.$inferInsert;
export type AthleteAlert = typeof analytics.athleteAlerts.$inferSelect;
export type NewAthleteAlert = typeof analytics.athleteAlerts.$inferInsert;
export type AthleteIntervention = typeof analytics.athleteInterventions.$inferSelect;
export type NewAthleteIntervention = typeof analytics.athleteInterventions.$inferInsert;
export type AthleteMilestone = typeof analytics.athleteMilestones.$inferSelect;
export type NewAthleteMilestone = typeof analytics.athleteMilestones.$inferInsert;
export type BoxAnalytics = typeof analytics.boxAnalytics.$inferSelect;
export type NewBoxAnalytics = typeof analytics.boxAnalytics.$inferInsert;
export type DemoEngagementMetrics = typeof analytics.demoEngagementMetrics.$inferSelect;
export type NewDemoEngagementMetrics = typeof analytics.demoEngagementMetrics.$inferInsert;

// New analytics types
export type RiskFactorHistory = typeof analytics.riskFactorHistory.$inferSelect;
export type NewRiskFactorHistory = typeof analytics.riskFactorHistory.$inferInsert;
export type AlertEscalation = typeof analytics.alertEscalations.$inferSelect;
export type NewAlertEscalation = typeof analytics.alertEscalations.$inferInsert;

// Billing types - Enhanced
export type BillingEvent = typeof billing.billingEvents.$inferSelect;
export type NewBillingEvent = typeof billing.billingEvents.$inferInsert;
export type SubscriptionPlan = typeof billing.subscriptionPlans.$inferSelect;
export type NewSubscriptionPlan = typeof billing.subscriptionPlans.$inferInsert;
export type CustomerProfile = typeof billing.customerProfiles.$inferSelect;
export type NewCustomerProfile = typeof billing.customerProfiles.$inferInsert;
export type Subscription = typeof billing.subscriptions.$inferSelect;
export type NewSubscription = typeof billing.subscriptions.$inferInsert;
export type Order = typeof billing.orders.$inferSelect;
export type NewOrder = typeof billing.orders.$inferInsert;
export type GracePeriod = typeof billing.gracePeriods.$inferSelect;
export type NewGracePeriod = typeof billing.gracePeriods.$inferInsert;
export type UsageEvent = typeof billing.usageEvents.$inferSelect;
export type NewUsageEvent = typeof billing.usageEvents.$inferInsert;

// Enum types for type safety
export type UserRole = "owner" | "head_coach" | "coach" | "athlete";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertType = "declining_performance" | "poor_attendance" | "negative_wellness" |
    "no_checkin" | "injury_risk" | "engagement_drop" | "churn_risk";
export type AlertStatus = "active" | "acknowledged" | "resolved" | "dismissed";
export type VideoVisibility = "private" | "box" | "public";
export type VideoProcessingStatus = "pending" | "upload_pending" | "processing" | "ready" | "error";
export type MovementCategory = "squat" | "deadlift" | "press" | "olympic" | "gymnastics" | "cardio" | "other";
export type BenchmarkCategory = "girls" | "hero" | "open" | "games" | "custom";
export type BadgeType = "checkin_streak" | "pr_achievement" | "benchmark_completion" |
    "attendance" | "consistency" | "community";
export type BodyPart = "neck" | "shoulders" | "chest" | "upper_back" | "lower_back" | "abs" |
    "biceps" | "triceps" | "forearms" | "glutes" | "quads" | "hamstrings" |
    "calves" | "ankles" | "knees" | "hips" | "wrists";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled" | "incomplete";
export type SubscriptionTier = "seed" | "grow" | "scale";
export type BoxStatus = "active" | "suspended" | "trial_expired";
export type InviteStatus = "pending" | "accepted" | "expired" | "canceled";
export type ApprovalStatus = "pending" | "approved" | "rejected";

// Utility types for common operations
export type PaginatedResponse<T> = {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
};

export type DateRange = {
    startDate?: Date;
    endDate?: Date;
};

export type FilterOptions<T = Record<string, any>> = T & {
    pagination?: z.infer<typeof paginationSchema>;
    dateRange?: z.infer<typeof dateRangeSchema>;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
};

// Common query result types
export type MembershipWithUser = BoxMembership & {
    user: User;
};

export type MembershipWithBox = BoxMembership & {
    box: Box;
};

export type PrWithMovementAndMembership = AthletePr & {
    movement: Movement;
    membership: MembershipWithUser;
};

export type BenchmarkWithWodAndMembership = AthleteBenchmark & {
    benchmark: BenchmarkWod;
    membership: MembershipWithUser;
};

export type AlertWithMembershipAndCoach = AthleteAlert & {
    membership: MembershipWithUser;
    assignedCoach?: MembershipWithUser;
};

export type InterventionWithMembershipAndCoach = AthleteIntervention & {
    membership: MembershipWithUser;
    coach: MembershipWithUser;
    alert?: AthleteAlert;
};

export type RiskScoreWithMembership = AthleteRiskScore & {
    membership: MembershipWithUser;
    riskFactors?: RiskFactorHistory[];
};

export type WellnessCheckinWithEntries = AthleteWellnessCheckin & {
    sorenessEntries: AthleteSorenessEntry[];
    painEntries: AthletePainEntry[];
};

export type WodFeedbackWithPainEntries = WodFeedback & {
    painEntries: WodPainEntry[];
};

export type SubscriptionWithPlanAndCustomer = Subscription & {
    plan: SubscriptionPlan;
    customerProfile: CustomerProfile;
};

export type BoxWithSubscriptionInfo = Box & {
    subscription?: SubscriptionWithPlanAndCustomer;
    gracePeriods?: GracePeriod[];
};

// Video-related composite types
export type PrWithVideoInfo = AthletePr & {
    videoConsents: VideoConsent[];
    videoProcessingEvents: VideoProcessingEvent[];
};

export type VideoProcessingSummary = {
    prId: string;
    gumletAssetId: string | null;
    status: VideoProcessingStatus;
    progress: number | null;
    thumbnailUrl: string | null;
    hasConsent: boolean;
    consentTypes: string[];
};

// Analytics summary types
export type BoxAnalyticsSummary = {
    totalAthletes: number;
    activeAthletes: number;
    retentionRate: number;
    avgAttendancePerAthlete: number;
    highRiskAthletes: number;
    totalActiveAlerts: number;
    avgWellnessScores: {
        energy: number;
        sleep: number;
        stress: number;
        workoutReadiness: number;
    };
};

export type AthleteHealthSummary = {
    membershipId: string;
    riskScore: number;
    riskLevel: RiskLevel;
    activeAlerts: number;
    daysSinceLastCheckin: number;
    recentWellnessAvg: {
        energy: number;
        sleep: number;
        stress: number;
        workoutReadiness: number;
    };
    topRiskFactors: {
        type: string;
        contribution: number;
        description: string;
    }[];
};
