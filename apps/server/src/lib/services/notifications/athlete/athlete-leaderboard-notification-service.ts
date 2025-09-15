// lib/services/notifications/athlete/athlete-leaderboard-notification-service.ts
import { db } from "@/db";
import { leaderboardEntries, leaderboards, boxMemberships } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NotificationService } from "@/lib/services/notifications";

export class AthleteLeaderboardNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Send notification when athlete is added to a leaderboard
     */
    async sendLeaderboardAdditionNotification(entryId: string) {
        const entry = await this.getEntryWithDetails(entryId);
        if (!entry) return null;

        const notification = await this.notificationService.createNotification({
            boxId: entry.leaderboard.boxId,
            userId: entry.membership.user.id,
            membershipId: entry.membershipId,
            type: "leaderboard_addition",
            category: "engagement",
            priority: "normal",
            title: `🏆 Added to Leaderboard: ${entry.leaderboard.name}`,
            message: `You've been added to the ${entry.leaderboard.name} leaderboard in position #${entry.rank}`,
            actionUrl: `/leaderboards/${entry.leaderboard.id}`,
            actionLabel: "View Leaderboard",
            channels: ["in_app"],
            data: {
                leaderboardId: entry.leaderboardId,
                leaderboardName: entry.leaderboard.name,
                position: entry.rank,
                value: entry.value,
                achievedAt: entry.achievedAt
            },
            deduplicationKey: `leaderboard_add_${entryId}`,
        });

        return notification;
    }

    /**
     * Send notification when athlete's rank changes
     */
    async sendRankChangeNotification(entryId: string, previousRank: number) {
        const entry = await this.getEntryWithDetails(entryId);
        if (!entry || entry.rank === previousRank) return null;

        const improved = entry.rank < previousRank;

        const notification = await this.notificationService.createNotification({
            boxId: entry.leaderboard.boxId,
            userId: entry.membership.user.id,
            membershipId: entry.membershipId,
            type: "leaderboard_rank_change",
            category: "engagement",
            priority: "normal",
            title: improved ?
                `⬆️ Moved Up on ${entry.leaderboard.name}` :
                `⬇️ Moved Down on ${entry.leaderboard.name}`,
            message: improved ?
                `You moved from #${previousRank} to #${entry.rank} on the ${entry.leaderboard.name} leaderboard!` :
                `You moved from #${previousRank} to #${entry.rank} on the ${entry.leaderboard.name} leaderboard.`,
            actionUrl: `/leaderboards/${entry.leaderboard.id}`,
            actionLabel: "View Leaderboard",
            channels: ["in_app"],
            data: {
                leaderboardId: entry.leaderboardId,
                leaderboardName: entry.leaderboard.name,
                previousRank,
                newRank: entry.rank,
                improved,
                changedAt: new Date()
            },
            deduplicationKey: `rank_change_${entryId}_${entry.rank}`,
        });

        return notification;
    }

    /**
     * Send notification for top 3 positions
     */
    async sendTopPositionNotification(entryId: string) {
        const entry = await this.getEntryWithDetails(entryId);
        if (!entry || entry.rank > 3) return null;

        const positionSuffix = this.getPositionSuffix(entry.rank);

        const notification = await this.notificationService.createNotification({
            boxId: entry.leaderboard.boxId,
            userId: entry.membership.user.id,
            membershipId: entry.membershipId,
            type: "leaderboard_top_position",
            category: "engagement",
            priority: "high",
            title: `🏅 ${entry.rank}${positionSuffix} Place on ${entry.leaderboard.name}!`,
            message: `Congratulations! You're in ${entry.rank}${positionSuffix} place on the ${entry.leaderboard.name} leaderboard.`,
            actionUrl: `/leaderboards/${entry.leaderboard.id}`,
            actionLabel: "View Leaderboard",
            channels: ["in_app", "email"],
            data: {
                leaderboardId: entry.leaderboardId,
                leaderboardName: entry.leaderboard.name,
                position: entry.rank,
                positionSuffix,
                value: entry.value,
                achievedAt: entry.achievedAt
            },
            deduplicationKey: `top_position_${entryId}`,
        });

        return notification;
    }

    /**
     * Send notification when a new leaderboard is created
     */
    async sendNewLeaderboardNotification(leaderboardId: string, athleteIds: string[]) {
        const leaderboard = await db.query.leaderboards.findFirst({
            where: eq(leaderboards.id, leaderboardId),
            with: {
                box: true
            }
        });

        if (!leaderboard) return null;

        const notifications = [];

        for (const athleteId of athleteIds) {
            const athlete = await db.query.boxMemberships.findFirst({
                where: eq(boxMemberships.id, athleteId),
                with: {
                    user: true
                }
            });

            if (!athlete) continue;

            const notification = await this.notificationService.createNotification({
                boxId: leaderboard.boxId,
                userId: athlete.user.id,
                membershipId: athleteId,
                type: "new_leaderboard",
                category: "engagement",
                priority: "normal",
                title: `📊 New Leaderboard: ${leaderboard.name}`,
                message: `A new ${leaderboard.type} leaderboard has been created at ${leaderboard.box.name}`,
                actionUrl: `/leaderboards/${leaderboardId}`,
                actionLabel: "View Leaderboard",
                channels: ["in_app"],
                data: {
                    leaderboardId,
                    leaderboardName: leaderboard.name,
                    leaderboardType: leaderboard.type,
                    createdBy: leaderboard.createdByMembershipId,
                    createdAt: leaderboard.createdAt
                },
                deduplicationKey: `new_leaderboard_${leaderboardId}_${athleteId}`,
            });

            notifications.push(notification);
        }

        return notifications;
    }

    /**
     * Helper to get entry with details
     */
    private async getEntryWithDetails(entryId: string) {
        return await db.query.leaderboardEntries.findFirst({
            where: eq(leaderboardEntries.id, entryId),
            with: {
                membership: {
                    with: {
                        user: true
                    }
                },
                leaderboard: true
            }
        });
    }

    /**
     * Helper to get position suffix
     */
    private getPositionSuffix(position: number): string {
        if (position >= 11 && position <= 13) {
            return 'th';
        }

        switch (position % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    }
}
