// Updated index file with all schema exports - aligned with CrossFit terminology
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

// Type helpers for common queries
import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Core schemas - updated terminology
export const selectBoxSchema = createSelectSchema(core.boxes);
export const insertBoxSchema = createInsertSchema(core.boxes);
export const selectBoxMembershipSchema = createSelectSchema(core.boxMemberships);
export const insertBoxMembershipSchema = createInsertSchema(core.boxMemberships);

// Onboarding schemas
export const selectBoxInviteSchema = createSelectSchema(core.boxInvites);
export const insertBoxInviteSchema = createInsertSchema(core.boxInvites);
export const selectBoxQrCodeSchema = createSelectSchema(core.boxQrCodes);
export const insertBoxQrCodeSchema = createInsertSchema(core.boxQrCodes);
export const selectApprovalQueueSchema = createSelectSchema(core.approvalQueue);
export const insertApprovalQueueSchema = createInsertSchema(core.approvalQueue);

// Athlete schemas
export const selectAthletePrSchema = createSelectSchema(athletes.athletePrs);
export const insertAthletePrSchema = createInsertSchema(athletes.athletePrs);
export const selectAthleteWellnessCheckinSchema = createSelectSchema(athletes.athleteWellnessCheckins);
export const insertAthleteWellnessCheckinSchema = createInsertSchema(athletes.athleteWellnessCheckins);
export const selectWodFeedbackSchema = createSelectSchema(athletes.wodFeedback);
export const insertWodFeedbackSchema = createInsertSchema(athletes.wodFeedback);
export const selectAthleteBadgeSchema = createSelectSchema(athletes.athleteBadges);
export const insertAthleteBadgeSchema = createInsertSchema(athletes.athleteBadges);

// Leaderboard schemas (new)
export const selectLeaderboardSchema = createSelectSchema(athletes.leaderboards);
export const insertLeaderboardSchema = createInsertSchema(athletes.leaderboards);
export const selectLeaderboardEntrySchema = createSelectSchema(athletes.leaderboardEntries);
export const insertLeaderboardEntrySchema = createInsertSchema(athletes.leaderboardEntries);

// Analytics schemas - updated terminology
export const selectAthleteRiskScoreSchema = createSelectSchema(analytics.athleteRiskScores);
export const selectAthleteAlertSchema = createSelectSchema(analytics.athleteAlerts);
export const insertAthleteInterventionSchema = createInsertSchema(analytics.athleteInterventions);

// Billing schemas
export const selectBillingEventSchema = createSelectSchema(billing.billingEvents);
export const selectSubscriptionPlanSchema = createSelectSchema(billing.subscriptionPlans);
export const selectGracePeriodSchema = createSelectSchema(billing.gracePeriods);

// Common filter schemas
export const paginationSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
});

export const athleteFilterSchema = z.object({
    role: z.enum(["owner", "head_coach", "coach", "athlete"]).optional(),
    isActive: z.boolean().optional(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
});

// Type definitions - updated with CrossFit terminology
export type Box = typeof core.boxes.$inferSelect;
export type NewBox = typeof core.boxes.$inferInsert;
export type BoxMembership = typeof core.boxMemberships.$inferSelect;
export type NewBoxMembership = typeof core.boxMemberships.$inferInsert;

export type BoxInvite = typeof core.boxInvites.$inferSelect;
export type NewBoxInvite = typeof core.boxInvites.$inferInsert;
export type BoxQrCode = typeof core.boxQrCodes.$inferSelect;
export type NewBoxQrCode = typeof core.boxQrCodes.$inferInsert;
export type ApprovalQueue = typeof core.approvalQueue.$inferSelect;
export type NewApprovalQueue = typeof core.approvalQueue.$inferInsert;

export type AthletePr = typeof athletes.athletePrs.$inferSelect;
export type NewAthletePr = typeof athletes.athletePrs.$inferInsert;
export type AthleteWellnessCheckin = typeof athletes.athleteWellnessCheckins.$inferSelect;
export type NewAthleteWellnessCheckin = typeof athletes.athleteWellnessCheckins.$inferInsert;
export type WodFeedback = typeof athletes.wodFeedback.$inferSelect;
export type NewWodFeedback = typeof athletes.wodFeedback.$inferInsert;
export type AthleteBadge = typeof athletes.athleteBadges.$inferSelect;
export type NewAthleteBadge = typeof athletes.athleteBadges.$inferInsert;

export type Leaderboard = typeof athletes.leaderboards.$inferSelect;
export type NewLeaderboard = typeof athletes.leaderboards.$inferInsert;
export type LeaderboardEntry = typeof athletes.leaderboardEntries.$inferSelect;
export type NewLeaderboardEntry = typeof athletes.leaderboardEntries.$inferInsert;

export type AthleteRiskScore = typeof analytics.athleteRiskScores.$inferSelect;
export type AthleteAlert = typeof analytics.athleteAlerts.$inferSelect;
export type AthleteIntervention = typeof analytics.athleteInterventions.$inferSelect;
export type NewAthleteIntervention = typeof analytics.athleteInterventions.$inferInsert;

export type BillingEvent = typeof billing.billingEvents.$inferSelect;
export type SubscriptionPlan = typeof billing.subscriptionPlans.$inferSelect;
export type GracePeriod = typeof billing.gracePeriods.$inferSelect;

// Movement and benchmark types
export type Movement = typeof athletes.movements.$inferSelect;
export type NewMovement = typeof athletes.movements.$inferInsert;
export type BenchmarkWod = typeof athletes.benchmarkWods.$inferSelect;
export type NewBenchmarkWod = typeof athletes.benchmarkWods.$inferInsert;
export type AthleteBenchmark = typeof athletes.athleteBenchmarks.$inferSelect;
export type NewAthleteBenchmark = typeof athletes.athleteBenchmarks.$inferInsert;
