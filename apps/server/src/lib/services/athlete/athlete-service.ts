// lib/services/athlete-service.ts - Enhanced version aligned with new schema
import {
    athletePrs,
    athleteWellnessCheckins,
    athleteBenchmarks,
    athleteBadges,
    movements,
    benchmarkWods,
    boxMemberships
} from "@/db/schema";
import { AthleteCoreService } from "./athlete-core-service";
import { AthletePRService } from "./athlete-pr-service";
import { AthleteBenchmarkService } from "./athlete-benchmark-service";
import { AthleteWellnessService } from "./athlete-wellness-service";
import { AthleteBadgeService } from "./athlete-badge-service";
import { AthleteVideoService } from "./athlete-video-service";
import { AthleteAttendanceService } from "./athlete-attendance-service";
import { AthleteLeaderboardService } from "./athlete-leaderboard-service";

export interface AthleteProfileData {
    profile: typeof boxMemberships.$inferSelect;
    recentPrs: Array<{
        pr: typeof athletePrs.$inferSelect;
        movement: typeof movements.$inferSelect;
    }>;
    recentBenchmarks: Array<{
        benchmark: typeof athleteBenchmarks.$inferSelect;
        benchmarkWod: typeof benchmarkWods.$inferSelect;
    }>;
    recentActivity: typeof athleteWellnessCheckins.$inferSelect[];
    badges: typeof athleteBadges.$inferSelect[];
    stats: {
        checkinStreak: number;
        totalCheckins: number;
        longestStreak: number;
        memberSince: Date;
        totalPrs: number;
        totalBenchmarks: number;
        attendanceRate: number;
        avgWellnessScore: number;
    };
}

export interface VideoUploadData {
    gumletAssetId: string;
    consentTypes: string[];
    thumbnailUrl?: string;
    videoDuration?: number;
    collectionId?: string;
    gumletMetadata?: any;
}

export interface RiskIndicators {
    membershipId: string;
    riskScore: number;
    riskFactors: Array<{
        type: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        description: string;
        value: number | string;
        trend: 'improving' | 'stable' | 'declining';
    }>;
    recommendations: string[];
    lastUpdated: Date;
}

export class AthleteService {
    // Core service methods
    static getAthleteProfile = AthleteCoreService.getAthleteProfile;
    static getAthleteStats = AthleteCoreService.getAthleteStats;
    static updateCheckinStreak = AthleteCoreService.updateCheckinStreak;

    // PR service methods
    static logPr = AthletePRService.logPr;
    static getRecentPRs = AthletePRService.getRecentPRs;

    // Benchmark service methods
    static logBenchmarkResult = AthleteBenchmarkService.logBenchmarkResult;
    static getRecentBenchmarks = AthleteBenchmarkService.getRecentBenchmarks;

    // Wellness service methods
    static getWellnessCheckins = AthleteWellnessService.getWellnessCheckins;
    static submitWellnessCheckin = AthleteWellnessService.submitWellnessCheckin;
    static submitWodFeedback = AthleteWellnessService.submitWodFeedback;

    // Badge service methods
    static getAthleteBadges = AthleteBadgeService.getAthleteBadges;
    static awardBadge = AthleteBadgeService.awardBadge;

    // Video service methods
    static initializePRVideo = AthleteVideoService.initializePRVideo;
    static completePRWithVideo = AthleteVideoService.completePRWithVideo;
    static getVideoStatus = AthleteVideoService.getVideoStatus;
    static getVideoAnalytics = AthleteVideoService.getVideoAnalytics;
    static updateVideoConsent = AthleteVideoService.updateVideoConsent;
    static getAthleteVideoHistory = AthleteVideoService.getAthleteVideoHistory;
    static getBoxVideoStats = AthleteVideoService.getBoxVideoStats;
    static processVideoWebhookBatch = AthleteVideoService.processVideoWebhookBatch;
    static getVideoConsentStatus = AthleteVideoService.getVideoConsentStatus;
    static createHighlightReel = AthleteVideoService.createHighlightReel;
    static processGumletWebhook = AthleteVideoService.processGumletWebhook;
    static mapGumletStatusToEnum = AthleteVideoService.mapGumletStatusToEnum;

    // Attendance service methods
    static recordAttendance = AthleteAttendanceService.recordAttendance;

    // Leaderboard service methods
    static createLeaderboard = AthleteLeaderboardService.createLeaderboard;
    static addLeaderboardEntry = AthleteLeaderboardService.addLeaderboardEntry;
    static getLeaderboard = AthleteLeaderboardService.getLeaderboard;
    static getBoxLeaderboards = AthleteLeaderboardService.getBoxLeaderboards;
    static updateLeaderboardEntryRank = AthleteLeaderboardService.updateLeaderboardEntryRank;
    static removeLeaderboardEntry = AthleteLeaderboardService.removeLeaderboardEntry;
    static deactivateLeaderboard = AthleteLeaderboardService.deactivateLeaderboard;

    /**
     * Get comprehensive athlete profile with recent activity and analytics
     * This is a wrapper that provides the required service dependencies
     */
    static async getAthleteProfileWithDeps(
        boxId: string,
        athleteId: string,
        options: {
            includePrs?: boolean;
            includeRecentActivity?: boolean;
            includeBenchmarks?: boolean;
            includeBadges?: boolean;
            includeStats?: boolean;
            days?: number;
            limit?: number;
        } = {}
    ): Promise<AthleteProfileData | null> {
        return AthleteCoreService.getAthleteProfile(
            boxId,
            athleteId,
            options,
            {
                prService: AthletePRService,
                benchmarkService: AthleteBenchmarkService,
                wellnessService: AthleteWellnessService,
                badgeService: AthleteBadgeService,
            }
        );
    }
}
