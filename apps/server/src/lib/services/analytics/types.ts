// lib/services/analytics/types.ts

// Core risk and alert types
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AnalyticsPeriod = "daily" | "weekly" | "monthly";

// Box health metrics interface
export interface BoxHealthMetrics {
    riskDistribution: Array<{ riskLevel: string; count: number }>;
    alertStats: Array<{ alertType: string; status: string; count: number }>;
    interventionStats: Array<{ interventionType: string; outcome: string | null; count: number }>;
    wellnessTrends: {
        avgEnergy: number | null;
        avgSleep: number | null;
        avgStress: number | null;
    };
    attendanceTrends: {
        totalCheckins: number;
        uniqueAthletes: number;
    };
    performanceTrends: {
        totalPrs: number;
        avgImprovement: number | null;
    };
}

// Retention analysis types
export interface RetentionData {
    boxId: string;
    cohortMonth: Date;
    cohortSize: number;
    activityMonth: Date;
    activeMembers: number;
    retentionRate: number;
    monthsSinceJoin: number;
}

// Subscription health tracking
export interface SubscriptionHealth {
    boxId: string;
    boxName: string;
    subscriptionStatus: string;
    subscriptionTier: string;
    trialEndsAt: Date | null;
    subscriptionEndsAt: Date | null;
    polarSubscriptionStatus: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean | null;
    activeAthletes: number;
    activeCoaches: number;
    athleteLimit: number | null;
    coachLimit: number | null;
    healthStatus: string;
}

// Wellness trends tracking
export interface WellnessTrend {
    boxId: string;
    membershipId: string;
    weekStart: Date;
    avgEnergy: number;
    avgSleep: number;
    avgStress: number;
    avgMotivation: number;
    avgReadiness: number;
    checkinCount: number;
}

// Risk assessment specific types
export interface RiskFactor {
    type: string;
    severity: AlertSeverity;
    description: string;
    value: number;
    trend: 'improving' | 'stable' | 'declining';
}

export interface RiskIndicators {
    membershipId: string;
    riskScore: number;
    riskFactors: RiskFactor[];
    recommendations: string[];
    lastUpdated: Date;
}

// Alert management types
export interface CreateAlertParams {
    boxId: string;
    membershipId: string;
    assignedCoachId?: string;
    alertType: string;
    severity: AlertSeverity;
    title: string;
    description: string;
    triggerData?: any;
    suggestedActions?: string[];
    followUpAt?: Date;
}

export interface AlertFilters {
    severity?: AlertSeverity;
    status?: 'active' | 'acknowledged' | 'resolved' | 'dismissed';
    alertType?: string;
    assignedCoachId?: string;
    dateRange?: { start: Date; end: Date };
    limit?: number;
    offset?: number;
}

export interface InterventionParams {
    boxId: string;
    membershipId: string;
    coachId: string;
    alertId?: string;
    interventionType: string;
    title: string;
    description: string;
    outcome?: string;
    athleteResponse?: string;
    coachNotes?: string;
    followUpRequired?: boolean;
    followUpAt?: Date;
}

// Wellness analytics types
export interface WellnessInsights {
    averages: {
        energy: number;
        sleep: number;
        stress: number;
        motivation: number;
        readiness: number;
    };
    trends: {
        energy: 'improving' | 'stable' | 'declining';
        sleep: 'improving' | 'stable' | 'declining';
        stress: 'improving' | 'stable' | 'declining';
    };
    correlations: WellnessCorrelation;
    recommendations: string[];
}

export interface WellnessCorrelation {
    energyCorrelation: number;
    sleepCorrelation: number;
    stressCorrelation: number;
    sampleSize: number;
    period: {
        days: number;
        start: Date;
        end: Date;
    };
}

// Box analytics types
export interface BoxAnalyticsOptions {
    period?: 'week' | 'month' | 'quarter' | 'year';
    includeComparisons?: boolean;
    includeTrends?: boolean;
}

export interface AnalyticsSnapshot {
    period: string;
    summary: {
        totalAthletes: number;
        activeAthletes: number;
        retentionRate: number;
        avgCheckinStreak: number;
    };
    wellness: {
        avgEnergyLevel: number;
        avgStressLevel: number;
        avgWorkoutReadiness: number;
        totalCheckins: number;
        checkinRate: number;
    };
    performance: {
        totalPrs: number;
        totalBenchmarks: number;
        avgPrsPerAthlete: number;
    };
    generatedAt: Date;
}

// Billing analytics types
export interface BillingAnalytics {
    timeframe: "30d" | "90d" | "12m";
    period: { start: Date; end: Date };
    summary: {
        totalSpent: number;
        totalSpentFormatted: string;
        orderCount: number;
        averageOrderValue: number;
        averageOrderValueFormatted: string;
    };
}

export interface BillingHistoryOptions {
    limit?: number;
    offset?: number;
    orderType?: string;
    status?: string;
    dateRange?: { start: Date; end: Date };
}

export interface BillingHistory {
    orders: any[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
        page: number;
        totalPages: number;
    };
    summary: {
        totalSpent: number;
        totalSpentFormatted: string;
        totalRefunded: number;
        totalRefundedFormatted: string;
        monthlySpend: number;
        monthlySpendFormatted: string;
        averageOrderValue: number;
        categoryBreakdown: Record<string, { count: number; amount: number }>;
    };
}

// Common analytics interfaces
export interface DateRange {
    start: Date;
    end: Date;
}

export interface MetricTrend {
    current: number;
    previous: number;
    change: number;
    changePercentage: number;
    direction: 'up' | 'down' | 'stable';
}

export interface PaginationInfo {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    page: number;
    totalPages: number;
}
