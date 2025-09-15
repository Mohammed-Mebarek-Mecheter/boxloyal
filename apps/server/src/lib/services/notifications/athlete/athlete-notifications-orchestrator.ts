// lib/services/notifications/athlete/athlete-notifications-orchestrator.ts
import { AthleteAttendanceNotificationService } from "./athlete-attendance-notification-service";
import { AthleteBadgeNotificationService } from "./athlete-badge-notification-service";
import { AthleteBenchmarkNotificationService } from "./athlete-benchmark-notification-service";
import { AthleteLeaderboardNotificationService } from "./athlete-leaderboard-notification-service";
import { AthletePRNotificationService } from "./athlete-pr-notification-service";
import { AthleteVideoNotificationService } from "./athlete-video-notification-service";
import { AthleteWellnessNotificationService } from "./athlete-wellness-notification-service";

/**
 * Main orchestrator for all athlete-related notifications
 * This service delegates to specialized notification services based on the notification type
 */
export class AthleteNotificationsOrchestrator {
    private attendanceService: AthleteAttendanceNotificationService;
    private badgeService: AthleteBadgeNotificationService;
    private benchmarkService: AthleteBenchmarkNotificationService;
    private leaderboardService: AthleteLeaderboardNotificationService;
    private prService: AthletePRNotificationService;
    private videoService: AthleteVideoNotificationService;
    private wellnessService: AthleteWellnessNotificationService;

    constructor() {
        this.attendanceService = new AthleteAttendanceNotificationService();
        this.badgeService = new AthleteBadgeNotificationService();
        this.benchmarkService = new AthleteBenchmarkNotificationService();
        this.leaderboardService = new AthleteLeaderboardNotificationService();
        this.prService = new AthletePRNotificationService();
        this.videoService = new AthleteVideoNotificationService();
        this.wellnessService = new AthleteWellnessNotificationService();
    }

    // Attendance-related notifications
    async sendAttendanceConfirmation(attendanceId: string) {
        return await this.attendanceService.sendAttendanceConfirmation(attendanceId);
    }

    async sendCoachAttendanceAlert(attendanceId: string) {
        return await this.attendanceService.sendCoachAttendanceAlert(attendanceId);
    }

    async sendAttendanceStreakNotification(athleteId: string, streakLength: number, streakType: 'attendance' | 'checkin') {
        return await this.attendanceService.sendAttendanceStreakNotification(athleteId, streakLength, streakType);
    }

    async sendAbsencePatternNotification(athleteId: string, pattern: string, missedSessions: number) {
        return await this.attendanceService.sendAbsencePatternNotification(athleteId, pattern, missedSessions);
    }

    // Badge-related notifications
    async sendNewBadgeNotification(badgeId: string) {
        return await this.badgeService.sendNewBadgeNotification(badgeId);
    }

    async sendMultipleBadgesNotification(athleteId: string, badgeIds: string[]) {
        return await this.badgeService.sendMultipleBadgesNotification(athleteId, badgeIds);
    }

    async sendBadgeUpgradeNotification(badgeId: string, previousTier: number) {
        return await this.badgeService.sendBadgeUpgradeNotification(badgeId, previousTier);
    }

    async sendCollectionMilestoneNotification(boxId: string, athleteId: string, milestone: string) {
        return await this.badgeService.sendCollectionMilestoneNotification(boxId, athleteId, milestone);
    }

    async sendLeaderboardAchievementNotification(boxId: string, athleteId: string, leaderboardName: string, position: number) {
        return await this.badgeService.sendLeaderboardAchievementNotification(boxId, athleteId, leaderboardName, position);
    }

    async sendVideoBadgeOpportunityNotification(
        boxId: string,
        athleteId: string,
        opportunity: {
            badgeType: string;
            title: string;
            description: string;
            progress: { current: number; required: number };
        }
    ) {
        return await this.badgeService.sendVideoBadgeOpportunityNotification(boxId, athleteId, opportunity);
    }

    async sendCoachBadgeAlertNotification(badgeId: string) {
        return await this.badgeService.sendCoachBadgeAlertNotification(badgeId);
    }

    async sendRareBadgeNotification(badgeId: string) {
        return await this.badgeService.sendRareBadgeNotification(badgeId);
    }

    // Benchmark-related notifications
    async sendNewBenchmarkNotification(benchmarkId: string) {
        return await this.benchmarkService.sendNewBenchmarkNotification(benchmarkId);
    }

    async sendCoachBenchmarkNotification(benchmarkId: string) {
        return await this.benchmarkService.sendCoachBenchmarkNotification(benchmarkId);
    }

    async sendPersonalBestNotification(benchmarkId: string, previousBest: string) {
        return await this.benchmarkService.sendPersonalBestNotification(benchmarkId, previousBest);
    }

    async sendBenchmarkConsistencyNotification(athleteId: string, benchmarkName: string, timesCompleted: number) {
        return await this.benchmarkService.sendBenchmarkConsistencyNotification(athleteId, benchmarkName, timesCompleted);
    }

    async sendRxAchievementNotification(benchmarkId: string) {
        return await this.benchmarkService.sendRxAchievementNotification(benchmarkId);
    }

    // Leaderboard-related notifications
    async sendLeaderboardAdditionNotification(entryId: string) {
        return await this.leaderboardService.sendLeaderboardAdditionNotification(entryId);
    }

    async sendRankChangeNotification(entryId: string, previousRank: number) {
        return await this.leaderboardService.sendRankChangeNotification(entryId, previousRank);
    }

    async sendTopPositionNotification(entryId: string) {
        return await this.leaderboardService.sendTopPositionNotification(entryId);
    }

    async sendNewLeaderboardNotification(leaderboardId: string, athleteIds: string[]) {
        return await this.leaderboardService.sendNewLeaderboardNotification(leaderboardId, athleteIds);
    }

    // PR-related notifications
    async sendNewPRNotification(
        prId: string,
        options: { includeCoaches?: boolean; includeAthlete?: boolean } = {
            includeCoaches: true,
            includeAthlete: true
        }
    ) {
        return await this.prService.sendNewPRNotification(prId, options);
    }

    async sendCoachFeedbackNotification(feedbackId: string) {
        return await this.prService.sendCoachFeedbackNotification(feedbackId);
    }

    async sendPRCelebrationNotification(
        prId: string,
        milestoneType: "first_pr" | "video_verified" | "weight_milestone" | "consistency",
        achievement: string,
        value: string
    ) {
        return await this.prService.sendPRCelebrationNotification(prId, milestoneType, achievement, value);
    }

    async sendVideoReviewNotification(prId: string, assignedCoachId: string) {
        return await this.prService.sendVideoReviewNotification(prId, assignedCoachId);
    }

    async sendSocialShareNotification(prId: string, platform: string) {
        return await this.prService.sendSocialShareNotification(prId, platform);
    }

    // Video-related notifications
    async sendVideoProcessingNotification(
        prId: string,
        status: "uploaded" | "processing" | "ready" | "failed",
        options: { error?: string } = {}
    ) {
        return await this.videoService.sendVideoProcessingNotification(prId, status, options);
    }

    async sendVideoCelebrationNotification(
        prId: string,
        milestoneType: "first_video" | "video_verified" | "video_milestone" | "social_recognition",
        achievement: string,
        value: string
    ) {
        return await this.videoService.sendVideoCelebrationNotification(prId, milestoneType, achievement, value);
    }

    async sendVideoEngagementNotification(
        prId: string,
        engagementType: "views_milestone" | "likes_milestone" | "comments_milestone",
        milestone: number,
        currentCount: number
    ) {
        return await this.videoService.sendVideoEngagementNotification(prId, engagementType, milestone, currentCount);
    }

    async sendCoachEngagementAlert(
        prId: string,
        engagementType: "high_views" | "high_likes" | "high_comments",
        count: number
    ) {
        return await this.videoService.sendCoachEngagementAlert(prId, engagementType, count);
    }

    // Wellness-related notifications
    async sendWellnessCheckinConfirmation(checkinId: string) {
        return await this.wellnessService.sendWellnessCheckinConfirmation(checkinId);
    }

    async sendWellnessAlertToCoaches(checkinId: string) {
        return await this.wellnessService.sendWellnessAlertToCoaches(checkinId);
    }

    async sendWellnessReminder(athleteId: string) {
        return await this.wellnessService.sendWellnessReminder(athleteId);
    }

    async sendWellnessStreakNotification(athleteId: string, streakLength: number) {
        return await this.wellnessService.sendWellnessStreakNotification(athleteId, streakLength);
    }

    /**
     * Send batch notifications for athlete events
     */
    async sendAthleteEventNotifications(events: Array<{
        type: string;
        boxId: string;
        athleteId: string;
        data: any;
    }>) {
        const results = [];

        for (const event of events) {
            try {
                let notification = null;

                switch (event.type) {
                    case 'attendance_confirmation':
                        notification = await this.sendAttendanceConfirmation(event.data.attendanceId);
                        break;

                    case 'coach_attendance_alert':
                        notification = await this.sendCoachAttendanceAlert(event.data.attendanceId);
                        break;

                    case 'attendance_streak':
                        notification = await this.sendAttendanceStreakNotification(
                            event.athleteId,
                            event.data.streakLength,
                            event.data.streakType
                        );
                        break;

                    case 'absence_pattern':
                        notification = await this.sendAbsencePatternNotification(
                            event.athleteId,
                            event.data.pattern,
                            event.data.missedSessions
                        );
                        break;

                    case 'badge_earned':
                        notification = await this.sendNewBadgeNotification(event.data.badgeId);
                        break;

                    case 'multiple_badges_earned':
                        notification = await this.sendMultipleBadgesNotification(
                            event.athleteId,
                            event.data.badgeIds
                        );
                        break;

                    case 'benchmark_result':
                        notification = await this.sendNewBenchmarkNotification(event.data.benchmarkId);
                        break;

                    case 'leaderboard_addition':
                        notification = await this.sendLeaderboardAdditionNotification(event.data.entryId);
                        break;

                    case 'pr_achieved':
                        notification = await this.sendNewPRNotification(event.data.prId, event.data.options);
                        break;

                    case 'wellness_checkin':
                        notification = await this.sendWellnessCheckinConfirmation(event.data.checkinId);
                        break;

                    default:
                        console.warn(`Unknown athlete event type: ${event.type}`);
                        continue;
                }

                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    athleteId: event.athleteId,
                    notificationSent: !!notification,
                    success: true,
                });

            } catch (error) {
                console.error(`Failed to send ${event.type} notification for athlete ${event.athleteId}:`, error);
                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    athleteId: event.athleteId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return results;
    }
}

// For backward compatibility - export as AthleteNotificationService
export { AthleteNotificationsOrchestrator as AthleteNotificationService };
