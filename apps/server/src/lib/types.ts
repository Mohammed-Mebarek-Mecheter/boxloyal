// lib/types.ts
import type { BoxMembership, Box } from "@/db/schema";

export interface UserWithBoxes {
    user: {
        id: string;
        name: string;
        email: string;
        image?: string;
    };
    boxes: Array<{
        membership: BoxMembership;
        box: Box;
    }>;
}

export interface AthleteProfile {
    membership: BoxMembership;
    recentPRs: number;
    checkinStreak: number;
    lastActivity: Date;
    riskScore?: number;
    riskLevel?: "low" | "medium" | "high" | "critical";
}

export interface CoachDashboard {
    totalAthletes: number;
    atRiskAthletes: number;
    activeAlerts: number;
    recentActivity: {
        newPRs: number;
        checkins: number;
        workouts: number;
    };
}

