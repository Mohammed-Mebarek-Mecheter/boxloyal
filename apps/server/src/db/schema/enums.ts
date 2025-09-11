// db/schema/enums.ts
import {pgEnum} from "drizzle-orm/pg-core";

// Centralized enums for consistency across all tables
export const userRoleEnum = pgEnum("user_role", [
    "owner",
    "head_coach",
    "coach",
    "athlete"
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
    "trial",
    "active",
    "past_due",
    "canceled",
    "incomplete",
    "paused", // Added for temporary suspensions
    "churned"  // Added for definitively lost customers
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
    "seed",
    "grow",
    "scale"
]);

export const boxStatusEnum = pgEnum("box_status", [
    "active",
    "suspended",
    "trial_expired",
    "over_limit", // Added for soft-block scenarios
    "payment_failed" // Added for billing issues
]);

export const inviteStatusEnum = pgEnum("invite_status", [
    "pending",
    "accepted",
    "expired",
    "canceled"
]);

export const approvalStatusEnum = pgEnum("approval_status", [
    "pending",
    "approved",
    "rejected"
]);

export const riskLevelEnum = pgEnum("risk_level", [
    "low",
    "medium",
    "high",
    "critical"
]);

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

// Enhanced Movement Categories
export const movementCategoryEnum = pgEnum("movement_category", [
    "squat",
    "deadlift",
    "press",
    "olympic",
    "gymnastics",
    "cardio",
    "other"
]);

// Enhanced Benchmark Categories
export const benchmarkCategoryEnum = pgEnum("benchmark_category", [
    "girls", // Fran, Grace, Helen, etc.
    "hero", // Murph, DT, JT, etc.
    "open", // CrossFit Open workouts
    "games", // CrossFit Games workouts
    "custom" // Box-specific benchmarks
]);

// Badge types for gamification
export const badgeTypeEnum = pgEnum("badge_type", [
    "checkin_streak",
    "pr_achievement",
    "benchmark_completion",
    "attendance",
    "consistency",
    "community"
]);

// Video processing status enum for consistency
export const videoProcessingStatusEnum = pgEnum("video_processing_status", [
    "pending",
    "upload_pending",
    "processing",
    "ready",
    "error"
]);

// Body parts enum for normalized soreness/pain tracking
export const bodyPartEnum = pgEnum("body_part", [
    "neck",
    "shoulders",
    "chest",
    "upper_back",
    "lower_back",
    "abs",
    "biceps",
    "triceps",
    "forearms",
    "glutes",
    "quads",
    "hamstrings",
    "calves",
    "ankles",
    "knees",
    "hips",
    "wrists"
]);

// Video strategy enums
export const feedbackTypeEnum = pgEnum("feedback_type", [
    "technique",
    "encouragement",
    "correction",
    "celebration"
]);

export const socialPlatformEnum = pgEnum("social_platform", [
    "box_feed",
    "instagram",
    "facebook",
    "public"
]);

export const shareTypeEnum = pgEnum("share_type", [
    "pr_celebration",
    "progress_update",
    "technique_showcase",
    "milestone_achievement"
]);
