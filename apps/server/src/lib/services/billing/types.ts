// lib/services/billing/types.ts
export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled" | "incomplete" | "paused" | "churned";
export type SubscriptionTier = "seed" | "grow" | "scale";
export type PlanChangeType = "upgrade" | "downgrade" | "lateral";
export type GracePeriodReason =
    | "athlete_limit_exceeded"
    | "coach_limit_exceeded"
    | "trial_ending"
    | "payment_failed"
    | "subscription_canceled"
    | "billing_issue";

export type UsageEventType =
    | "athlete_added" | "athlete_removed" | "checkin_logged" | "pr_logged"
    | "wod_completed" | "coach_added" | "coach_removed" | "subscription_created"
    | "subscription_canceled" | "subscription_reactivated" | "grace_period_triggered"
    | "plan_upgraded" | "plan_downgraded" | "overage_billed" | "payment_failed"
    | "payment_received" | "grace_period_resolved";

export interface SubscriptionUsage {
    athletes: number;
    coaches: number;
    athletesPercentage: number;
    coachesPercentage: number;
    isAthleteOverLimit: boolean;
    isCoachOverLimit: boolean;
    athleteLimit: number;
    coachLimit: number;
    athleteOverage: number;
    coachOverage: number;
    hasOverageEnabled: boolean;
    nextBillingDate?: Date;
    estimatedOverageAmount: number;
}

export interface BillingEvent {
    boxId: string;
    eventType: string;
    polarEventId: string;
    data: Record<string, any>;
    status: 'pending' | 'processing' | 'processed' | 'failed';
    retryCount?: number;
}

export interface PlanChangeRequest {
    boxId: string;
    subscriptionId: string;
    fromPlanId: string;
    toPlanId: string;
    changeType: PlanChangeType;
    requestedByUserId: string;
    effectiveDate?: Date;
    prorationType?: "immediate" | "next_billing_cycle" | "end_of_period";
    metadata?: Record<string, any>;
}

export interface OverageCalculation {
    boxId: string;
    subscriptionId: string;
    billingPeriodStart: Date;
    billingPeriodEnd: Date;
    athleteOverage: number;
    coachOverage: number;
    athleteOverageRate: number;
    coachOverageRate: number;
    totalOverageAmount: number;
}