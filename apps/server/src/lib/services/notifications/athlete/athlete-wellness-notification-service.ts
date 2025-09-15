// lib/services/notifications/athlete/athlete-wellness-notification-service.ts
import { db } from "@/db";
import {
    athleteWellnessCheckins,
    boxMemberships
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NotificationService } from "@/lib/services/notifications";

export class AthleteWellnessNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Send wellness check-in confirmation
     */
    async sendWellnessCheckinConfirmation(checkinId: string) {
        const checkin = await this.getCheckinWithDetails(checkinId);
        if (!checkin) return null;

        const notification = await this.notificationService.createNotification({
            boxId: checkin.boxId,
            userId: checkin.membership.user.id,
            membershipId: checkin.membershipId,
            type: "wellness_checkin",
            category: "engagement",
            priority: "low",
            title: "✅ Wellness Check-in Complete",
            message: "Your daily wellness check-in has been recorded. Thank you!",
            actionUrl: `/athlete/wellness`,
            actionLabel: "View Wellness History",
            channels: ["in_app"],
            data: {
                checkinId: checkin.id,
                energyLevel: checkin.energyLevel,
                sleepQuality: checkin.sleepQuality,
                stressLevel: checkin.stressLevel,
                checkinDate: checkin.checkinDate
            },
            deduplicationKey: `wellness_checkin_${checkinId}`,
        });

        return notification;
    }

    /**
     * Send wellness alert to coaches for concerning metrics
     */
    async sendWellnessAlertToCoaches(checkinId: string) {
        const checkin = await this.getCheckinWithDetails(checkinId);
        if (!checkin) return null;

        // Check if metrics are concerning
        const isConcerning = this.isCheckinConcerning(checkin);
        if (!isConcerning) return null;

        const coaches = await this.getBoxCoaches(checkin.boxId);
        const notifications = [];

        for (const coach of coaches) {
            const notification = await this.notificationService.createNotification({
                boxId: checkin.boxId,
                userId: coach.userId,
                membershipId: coach.id,
                type: "athlete_wellness_alert",
                category: "retention",
                priority: "high",
                title: `⚠️ Wellness Alert: ${checkin.membership.displayName}`,
                message: `${checkin.membership.displayName} reported concerning wellness metrics in their daily check-in`,
                actionUrl: `/coaching/wellness/${checkin.membership.publicId}`,
                actionLabel: "Review Wellness",
                channels: ["in_app", "email"],
                data: {
                    athleteId: checkin.membershipId,
                    athleteName: checkin.membership.displayName,
                    energyLevel: checkin.energyLevel,
                    sleepQuality: checkin.sleepQuality,
                    stressLevel: checkin.stressLevel,
                    checkinDate: checkin.checkinDate,
                    concerns: this.getConcernDetails(checkin)
                },
                deduplicationKey: `wellness_alert_${checkinId}_${coach.id}`,
            });

            notifications.push(notification);
        }

        return notifications;
    }

    /**
     * Send reminder to complete wellness check-in
     */
    async sendWellnessReminder(athleteId: string) {
        const athlete = await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, athleteId),
            with: {
                user: true,
                box: true
            }
        });

        if (!athlete) return null;

        const notification = await this.notificationService.createNotification({
            boxId: athlete.boxId,
            userId: athlete.user.id,
            membershipId: athleteId,
            type: "wellness_reminder",
            category: "engagement",
            priority: "low",
            title: "📋 Daily Wellness Check-in",
            message: `Don't forget to complete your daily wellness check-in for ${athlete.box.name}`,
            actionUrl: `/athlete/wellness/checkin`,
            actionLabel: "Complete Check-in",
            channels: ["in_app"],
            data: {
                remindedAt: new Date(),
                boxName: athlete.box.name
            },
            deduplicationKey: `wellness_reminder_${athleteId}_${new Date().toISOString().split('T')[0]}`,
        });

        return notification;
    }

    /**
     * Send wellness streak notification
     */
    async sendWellnessStreakNotification(athleteId: string, streakLength: number) {
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
            type: "wellness_streak",
            category: "engagement",
            priority: "normal",
            title: `📈 ${streakLength}-Day Wellness Streak!`,
            message: `You've completed ${streakLength} consecutive days of wellness check-ins`,
            actionUrl: `/athlete/wellness`,
            actionLabel: "View Wellness History",
            channels: ["in_app"],
            data: {
                streakLength,
                milestone,
                achievedAt: new Date()
            },
            deduplicationKey: `wellness_streak_${athleteId}_${streakLength}`,
        });

        return notification;
    }

    /**
     * Helper to get checkin with details
     */
    private async getCheckinWithDetails(checkinId: string) {
        return await db.query.athleteWellnessCheckins.findFirst({
            where: eq(athleteWellnessCheckins.id, checkinId),
            with: {
                membership: {
                    with: {
                        user: true
                    }
                },
                sorenessEntries: true,
                painEntries: true
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
     * Check if check-in has concerning metrics
     */
    private isCheckinConcerning(checkin: any): boolean {
        // Low energy or high stress
        if (checkin.energyLevel <= 3 || checkin.stressLevel >= 8) {
            return true;
        }

        // Poor sleep quality
        if (checkin.sleepQuality <= 3) {
            return true;
        }

        // High pain or soreness levels
        const highPain = checkin.painEntries?.some((entry: any) => entry.severity >= 7);
        const highSoreness = checkin.sorenessEntries?.some((entry: any) => entry.severity >= 7);

        return highPain || highSoreness;
    }

    /**
     * Get details about concerns for notification
     */
    private getConcernDetails(checkin: any): string[] {
        const concerns = [];

        if (checkin.energyLevel <= 3) {
            concerns.push(`Low energy (${checkin.energyLevel}/10)`);
        }

        if (checkin.stressLevel >= 8) {
            concerns.push(`High stress (${checkin.stressLevel}/10)`);
        }

        if (checkin.sleepQuality <= 3) {
            concerns.push(`Poor sleep quality (${checkin.sleepQuality}/10)`);
        }

        checkin.painEntries?.forEach((entry: any) => {
            if (entry.severity >= 7) {
                concerns.push(`Pain in ${entry.bodyPart} (${entry.severity}/10)`);
            }
        });

        checkin.sorenessEntries?.forEach((entry: any) => {
            if (entry.severity >= 7) {
                concerns.push(`Soreness in ${entry.bodyPart} (${entry.severity}/10)`);
            }
        });

        return concerns;
    }

    /**
     * Helper to get streak milestone
     */
    private getStreakMilestone(streakLength: number): string {
        if (streakLength >= 30) return "amazing";
        if (streakLength >= 15) return "great";
        if (streakLength >= 7) return "good";
        return "starting";
    }
}
