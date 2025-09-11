import {boxes} from "@/db/schema";

export type BoxRole = "owner" | "head_coach" | "coach" | "athlete";

export interface MemberWithStats {
    id: string;
    publicId: string;
    userId: string;
    role: BoxRole;
    isActive: boolean;
    joinedAt: Date;
    checkinStreak: number;
    totalCheckins: number;
    longestCheckinStreak: number;
    lastCheckinDate: Date | null;
    displayName?: string;
    stats?: {
        totalPrs: number;
        videoPrs: number;
        recentCheckins: number;
        coachInteractions: number;
        engagementScore: number;
    };
    riskIndicators?: {
        level: 'low' | 'medium' | 'high' | 'critical';
        factors: string[];
        lastActivity: Date | null;
    };
}

export interface BoxStats {
    members: {
        total: number;
        active: number;
        new: number;
    };
    activity: {
        totalPrs: number;
        totalCheckins: number;
        avgCheckinRate: number;
    };
    period: string;
    dateRange: {
        start: Date;
        end: Date;
    };
}

export interface BoxDashboard {
    box: typeof boxes.$inferSelect;
    members: {
        byRole: Array<{ role: string; count: number }>;
        recentJoins: number;
        atRiskCount: number;
    };
    activity: {
        pendingApprovals: number;
        recentPrs: number;
        videoPrs: number;
        activeCheckins: number;
        avgStreak: number;
        pendingModerations: number;
    };
    videoEngagement: {
        totalVideoUploads: number;
        coachFeedbackRate: number;
        socialSharesCount: number;
        avgVideoVerificationRate: number;
    };
}

export interface CoachModerationQueue {
    id: string;
    type: 'pr_video' | 'social_share' | 'feedback_request';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    athleteId: string;
    athleteName: string;
    title: string;
    description: string;
    createdAt: Date;
    requiresAction: boolean;
    metadata: any;
}

export interface InterventionInsight {
    membershipId: string;
    athleteName: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    riskFactors: Array<{
        type: 'declining_checkins' | 'no_video_engagement' | 'missed_workouts' | 'negative_feedback_pattern';
        severity: number;
        description: string;
        trend: 'improving' | 'stable' | 'declining';
        lastOccurrence: Date;
    }>;
    recommendations: Array<{
        action: string;
        urgency: 'low' | 'medium' | 'high';
        description: string;
        estimatedImpact: string;
    }>;
    lastInteractionDate: Date | null;
    suggestedActions: string[];
}
