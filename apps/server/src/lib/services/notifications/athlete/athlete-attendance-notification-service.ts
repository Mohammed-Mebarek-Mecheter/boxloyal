// lib/services/notifications/athlete/athlete-attendance-notification-service.ts
import { db } from "@/db";
import { wodAttendance, boxMemberships } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NotificationService } from "@/lib/services/notifications";

export class AthleteAttendanceNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Send attendance confirmation to athlete
     */
    async sendAttendanceConfirmation(attendanceId: string) {
        const attendance = await this.getAttendanceWithDetails(attendanceId);
        if (!attendance) return null;

        const notification = await this.notificationService.createNotification({
            boxId: attendance.boxId,
            userId: attendance.membership.user.id,
            membershipId: attendance.membershipId,
            type: "attendance_confirmation",
            category: "engagement",
            priority: "low",
            title: `✅ Attendance Recorded: ${attendance.wodName}`,
            message: `You've been marked as ${attendance.status} for today's ${attendance.wodName} class.`,
            actionUrl: `/athlete/schedule`,
            actionLabel: "View Schedule",
            channels: ["in_app"],
            data: {
                wodName: attendance.wodName,
                status: attendance.status,
                checkedInAt: attendance.checkedInAt,
                coach: attendance.coach?.displayName
            },
            deduplicationKey: `attendance_${attendanceId}`,
        });

        return notification;
    }

    /**
     * Send attendance alert to coaches
     */
    async sendCoachAttendanceAlert(attendanceId: string) {
        const attendance = await this.getAttendanceWithDetails(attendanceId);
        if (!attendance) return null;

        const coaches = await this.getBoxCoaches(attendance.boxId);
        const notifications = [];

        for (const coach of coaches) {
            const notification = await this.notificationService.createNotification({
                boxId: attendance.boxId,
                userId: coach.userId,
                membershipId: coach.id,
                type: "athlete_attendance",
                category: "workflow",
                priority: "normal",
                title: `${attendance.membership.displayName} ${attendance.status === 'attended' ? 'attended' : 'missed'} class`,
                message: `${attendance.membership.displayName} was marked as ${attendance.status} for ${attendance.wodName}`,
                actionUrl: `/coaching/attendance`,
                actionLabel: "View Attendance",
                channels: ["in_app"],
                data: {
                    athleteId: attendance.membershipId,
                    athleteName: attendance.membership.displayName,
                    wodName: attendance.wodName,
                    status: attendance.status,
                    time: attendance.wodTime
                },
                deduplicationKey: `coach_attendance_${attendanceId}_${coach.id}`,
            });

            notifications.push(notification);
        }

        return notifications;
    }

    /**
     * Send streak milestone notification
     */
    async sendAttendanceStreakNotification(athleteId: string, streakLength: number, streakType: 'attendance' | 'checkin') {
        const athlete = await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, athleteId),
            with: {
                user: true,
                box: true
            }
        });

        if (!athlete) return null;

        const milestone = this.getStreakMilestone(streakLength);

        const notification = await this.notificationService.createNotification({
            boxId: athlete.boxId,
            userId: athlete.user.id,
            membershipId: athleteId,
            type: "attendance_streak",
            category: "engagement",
            priority: "normal",
            title: `🔥 ${streakLength}-Day ${streakType === 'attendance' ? 'Attendance' : 'Check-in'} Streak!`,
            message: `You've maintained a ${streakLength}-day ${streakType} streak at ${athlete.box.name}`,
            actionUrl: `/athlete/streaks`,
            actionLabel: "View Streaks",
            channels: ["in_app"],
            data: {
                streakLength,
                streakType,
                milestone,
                achievedAt: new Date()
            },
            deduplicationKey: `streak_${athleteId}_${streakType}_${streakLength}`,
        });

        return notification;
    }

    /**
     * Send absence pattern notification to coaches
     */
    async sendAbsencePatternNotification(athleteId: string, pattern: string, missedSessions: number) {
        const athlete = await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, athleteId),
            with: {
                user: true,
                box: true
            }
        });

        if (!athlete) return null;

        const coaches = await this.getBoxCoaches(athlete.boxId);
        const notifications = [];

        for (const coach of coaches) {
            const notification = await this.notificationService.createNotification({
                boxId: athlete.boxId,
                userId: coach.userId,
                membershipId: coach.id,
                type: "absence_pattern",
                category: "retention",
                priority: "high",
                title: `⚠️ Attendance Pattern Alert: ${athlete.displayName}`,
                message: `${athlete.displayName} has missed ${missedSessions} sessions with pattern: ${pattern}`,
                actionUrl: `/coaching/athletes/${athlete.publicId}/attendance`,
                actionLabel: "Review Attendance",
                channels: ["in_app", "email"],
                data: {
                    athleteId,
                    athleteName: athlete.displayName,
                    pattern,
                    missedSessions,
                    alertedAt: new Date()
                },
                deduplicationKey: `absence_pattern_${athleteId}_${coach.id}`,
            });

            notifications.push(notification);
        }

        return notifications;
    }

    /**
     * Helper to get attendance with details
     */
    private async getAttendanceWithDetails(attendanceId: string) {
        return await db.query.wodAttendance.findFirst({
            where: eq(wodAttendance.id, attendanceId),
            with: {
                membership: {
                    with: {
                        user: true
                    }
                },
                coach: true
            }
        });
    }

    /**
     * Helper to get box coaches
     */
    private async getBoxCoaches(boxId: string) {
        return await db.query.boxMemberships.findMany({
            where: and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                eq(boxMemberships.role, "coach")
            ),
            with: {
                user: true
            }
        });
    }

    /**
     * Helper to get streak milestone
     */
    private getStreakMilestone(streakLength: number): string {
        if (streakLength >= 90) return "legendary";
        if (streakLength >= 60) return "epic";
        if (streakLength >= 30) return "amazing";
        if (streakLength >= 15) return "great";
        if (streakLength >= 7) return "good";
        return "starting";
    }
}
