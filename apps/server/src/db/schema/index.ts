// Updated index file with all schema exports
export * from "./auth";
export * from "./core";
export * from "./members";
export * from "./analytics";
export * from "./billing";

// Re-export all tables for easy importing
import * as auth from "./auth";
import * as core from "./core";
import * as members from "./members";
import * as analytics from "./analytics";
import * as billing from "./billing";

export const schema = {
    ...auth,
    ...core,
    ...members,
    ...analytics,
    ...billing,
};

// Type helpers for common queries
import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Core schemas
export const selectGymSchema = createSelectSchema(core.gyms);
export const insertGymSchema = createInsertSchema(core.gyms);
export const selectGymMembershipSchema = createSelectSchema(core.gymMemberships);
export const insertGymMembershipSchema = createInsertSchema(core.gymMemberships);

// Onboarding schemas
export const selectGymInviteSchema = createSelectSchema(core.gymInvites);
export const insertGymInviteSchema = createInsertSchema(core.gymInvites);
export const selectGymQrCodeSchema = createSelectSchema(core.gymQrCodes);
export const insertGymQrCodeSchema = createInsertSchema(core.gymQrCodes);
export const selectApprovalQueueSchema = createSelectSchema(core.approvalQueue);
export const insertApprovalQueueSchema = createInsertSchema(core.approvalQueue);

// Member schemas
export const selectMemberPrSchema = createSelectSchema(members.memberPrs);
export const insertMemberPrSchema = createInsertSchema(members.memberPrs);
export const selectMemberCheckinSchema = createSelectSchema(members.memberCheckins);
export const insertMemberCheckinSchema = createInsertSchema(members.memberCheckins);
export const selectWorkoutFeedbackSchema = createSelectSchema(members.workoutFeedback);
export const insertWorkoutFeedbackSchema = createInsertSchema(members.workoutFeedback);
export const selectMemberBadgeSchema = createSelectSchema(members.memberBadges);
export const insertMemberBadgeSchema = createInsertSchema(members.memberBadges);

// Analytics schemas
export const selectMemberRiskScoreSchema = createSelectSchema(analytics.memberRiskScores);
export const selectMemberAlertSchema = createSelectSchema(analytics.memberAlerts);
export const insertMemberInterventionSchema = createInsertSchema(analytics.memberInterventions);

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

export const memberFilterSchema = z.object({
    role: z.enum(["owner", "head_coach", "coach", "member"]).optional(),
    isActive: z.boolean().optional(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
});

// Type definitions
export type Gym = typeof core.gyms.$inferSelect;
export type NewGym = typeof core.gyms.$inferInsert;
export type GymMembership = typeof core.gymMemberships.$inferSelect;
export type NewGymMembership = typeof core.gymMemberships.$inferInsert;

export type GymInvite = typeof core.gymInvites.$inferSelect;
export type NewGymInvite = typeof core.gymInvites.$inferInsert;
export type GymQrCode = typeof core.gymQrCodes.$inferSelect;
export type NewGymQrCode = typeof core.gymQrCodes.$inferInsert;
export type ApprovalQueue = typeof core.approvalQueue.$inferSelect;
export type NewApprovalQueue = typeof core.approvalQueue.$inferInsert;

export type MemberPr = typeof members.memberPrs.$inferSelect;
export type NewMemberPr = typeof members.memberPrs.$inferInsert;
export type MemberCheckin = typeof members.memberCheckins.$inferSelect;
export type NewMemberCheckin = typeof members.memberCheckins.$inferInsert;
export type WorkoutFeedback = typeof members.workoutFeedback.$inferSelect;
export type NewWorkoutFeedback = typeof members.workoutFeedback.$inferInsert;
export type MemberBadge = typeof members.memberBadges.$inferSelect;
export type NewMemberBadge = typeof members.memberBadges.$inferInsert;

export type MemberRiskScore = typeof analytics.memberRiskScores.$inferSelect;
export type MemberAlert = typeof analytics.memberAlerts.$inferSelect;
export type MemberIntervention = typeof analytics.memberInterventions.$inferSelect;
export type NewMemberIntervention = typeof analytics.memberInterventions.$inferInsert;

export type BillingEvent = typeof billing.billingEvents.$inferSelect;
export type SubscriptionPlan = typeof billing.subscriptionPlans.$inferSelect;
export type GracePeriod = typeof billing.gracePeriods.$inferSelect;
