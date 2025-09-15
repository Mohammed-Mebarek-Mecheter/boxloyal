// lib/services/notifications/athlete/athlete-badge-notification-service.ts
import { db } from "@/db";
import {
    athleteBadges,
    boxMemberships
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NotificationService } from "@/lib/services/notifications";

export class AthleteBadgeNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Send notification for newly earned badges
     */
    async sendNewBadgeNotification(badgeId: string) {
        const badge = await this.getBadgeWithDetails(badgeId);
        if (!badge) return null;

        const notification = await this.notificationService.createNotification({
            boxId: badge.boxId,
            userId: badge.membership.user.id,
            membershipId: badge.membershipId,
            type: "badge_earned",
            category: "engagement",
            priority: "high",
            title: `🏆 New Badge Earned: ${badge.title}`,
            message: badge.description || `You've earned the ${badge.title} badge!`,
            actionUrl: `/athlete/profile/badges`,
            actionLabel: "View Badges",
            channels: ["in_app"],
            data: {
                badgeId: badge.id,
                badgeType: badge.badgeType,
                title: badge.title,
                description: badge.description,
                icon: badge.icon,
                tier: badge.tier,
                rarity: this.getBadgeRarity(badge.badgeType, badge.tier || 1),
                awardedAt: badge.awardedAt
            },
            deduplicationKey: `badge_earned_${badgeId}`,
        });

        return notification;
    }

    /**
     * Send notification for multiple badges earned at once
     */
    async sendMultipleBadgesNotification(athleteId: string, badgeIds: string[]) {
        if (badgeIds.length === 0) return null;

        const badges = await Promise.all(
            badgeIds.map(id => this.getBadgeWithDetails(id))
        );

        // Get the first valid badge to extract common details
        const firstBadge = badges.find(b => b !== null);
        if (!firstBadge) return null;

        const notification = await this.notificationService.createNotification({
            boxId: firstBadge.boxId,
            userId: firstBadge.membership.user.id,
            membershipId: firstBadge.membershipId,
            type: "multiple_badges_earned",
            category: "engagement",
            priority: "high",
            title: `🎉 ${badges.length} New Badges Earned!`,
            message: `You've unlocked ${badges.length} new achievements including "${firstBadge.title}" and more!`,
            actionUrl: `/athlete/profile/badges`,
            actionLabel: "View All Badges",
            channels: ["in_app"],
            data: {
                badgeCount: badges.length,
                badges: badges.map(badge => ({
                    id: badge!.id,
                    title: badge!.title,
                    type: badge!.badgeType,
                    tier: badge!.tier
                })),
                awardedAt: new Date()
            },
            deduplicationKey: `multiple_badges_${athleteId}_${Date.now()}`,
        });

        return notification;
    }

    /**
     * Send notification for badge tier upgrade
     */
    async sendBadgeUpgradeNotification(badgeId: string, previousTier: number) {
        const badge = await this.getBadgeWithDetails(badgeId);
        if (!badge || !badge.tier || badge.tier <= previousTier) return null;

        const notification = await this.notificationService.createNotification({
            boxId: badge.boxId,
            userId: badge.membership.user.id,
            membershipId: badge.membershipId,
            type: "badge_upgraded",
            category: "engagement",
            priority: "normal",
            title: `⬆️ Badge Upgraded: ${badge.title} Tier ${badge.tier}`,
            message: `Your ${badge.title} badge has been upgraded to tier ${badge.tier}!`,
            actionUrl: `/athlete/profile/badges`,
            actionLabel: "View Badge",
            channels: ["in_app"],
            data: {
                badgeId: badge.id,
                badgeType: badge.badgeType,
                title: badge.title,
                previousTier,
                newTier: badge.tier,
                upgradedAt: new Date()
            },
            deduplicationKey: `badge_upgrade_${badgeId}_${badge.tier}`,
        });

        return notification;
    }

    /**
     * Send notification for collection milestone
     */
    async sendCollectionMilestoneNotification(boxId: string, athleteId: string, milestone: string) {
        const athlete = await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, athleteId),
            with: {
                user: true
            }
        });

        if (!athlete) return null;

        const notification = await this.notificationService.createNotification({
            boxId,
            userId: athlete.user.id,
            membershipId: athleteId,
            type: "collection_milestone",
            category: "engagement",
            priority: "normal",
            title: `📊 Collection Milestone: ${milestone}`,
            message: `You've reached a new badge collection milestone: ${milestone}!`,
            actionUrl: `/athlete/profile/badges`,
            actionLabel: "View Collection",
            channels: ["in_app"],
            data: {
                milestone,
                achievedAt: new Date()
            },
            deduplicationKey: `collection_milestone_${athleteId}_${milestone}`,
        });

        return notification;
    }

    /**
     * Send notification for leaderboard achievement via badges
     */
    async sendLeaderboardAchievementNotification(boxId: string, athleteId: string, leaderboardName: string, position: number) {
        const athlete = await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, athleteId),
            with: {
                user: true
            }
        });

        if (!athlete) return null;

        const positionSuffix = this.getPositionSuffix(position);

        const notification = await this.notificationService.createNotification({
            boxId,
            userId: athlete.user.id,
            membershipId: athleteId,
            type: "leaderboard_achievement",
            category: "engagement",
            priority: "high",
            title: `🏅 Leaderboard Achievement`,
            message: `You're ${position}${positionSuffix} on the ${leaderboardName} leaderboard!`,
            actionUrl: `/leaderboards/${leaderboardName.toLowerCase().replace(/\s+/g, '-')}`,
            actionLabel: "View Leaderboard",
            channels: ["in_app", "email"],
            data: {
                leaderboardName,
                position,
                positionSuffix,
                achievedAt: new Date()
            },
            deduplicationKey: `leaderboard_${leaderboardName}_${athleteId}_${position}`,
        });

        return notification;
    }

    /**
     * Send notification for video verification badge opportunities
     */
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
        const athlete = await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, athleteId),
            with: {
                user: true
            }
        });

        if (!athlete) return null;

        const remaining = opportunity.progress.required - opportunity.progress.current;

        const notification = await this.notificationService.createNotification({
            boxId,
            userId: athlete.user.id,
            membershipId: athleteId,
            type: "badge_opportunity",
            category: "engagement",
            priority: "low",
            title: `🎯 Badge Opportunity: ${opportunity.title}`,
            message: `${opportunity.description}. Only ${remaining} more to go!`,
            actionUrl: `/athlete/profile/badges/opportunities`,
            actionLabel: "View Opportunities",
            channels: ["in_app"],
            data: {
                badgeType: opportunity.badgeType,
                title: opportunity.title,
                description: opportunity.description,
                progress: opportunity.progress,
                remaining,
                notifiedAt: new Date()
            },
            deduplicationKey: `badge_opportunity_${athleteId}_${opportunity.badgeType}`,
        });

        return notification;
    }

    /**
     * Send notification to coaches about athlete badge achievements
     */
    async sendCoachBadgeAlertNotification(badgeId: string) {
        const badge = await this.getBadgeWithDetails(badgeId);
        if (!badge) return null;

        const coaches = await this.getBoxCoaches(badge.boxId);

        const notifications = [];

        for (const coach of coaches) {
            const notification = await this.notificationService.createNotification({
                boxId: badge.boxId,
                userId: coach.userId,
                membershipId: coach.id,
                type: "athlete_badge_earned",
                category: "workflow",
                priority: "low",
                title: `${badge.membership.displayName} Earned a Badge`,
                message: `${badge.membership.displayName} earned the ${badge.title} badge`,
                actionUrl: `/coaching/athletes/${badge.membership.publicId}/progress`,
                actionLabel: "View Athlete Progress",
                channels: ["in_app"],
                data: {
                    athleteId: badge.membershipId,
                    athleteName: badge.membership.displayName,
                    badgeId: badge.id,
                    badgeTitle: badge.title,
                    badgeType: badge.badgeType,
                    awardedAt: badge.awardedAt
                },
                deduplicationKey: `coach_badge_alert_${badgeId}_${coach.id}`,
            });

            notifications.push(notification);
        }

        return notifications;
    }

    /**
     * Send notification for rare or epic badge achievements
     */
    async sendRareBadgeNotification(badgeId: string) {
        const badge = await this.getBadgeWithDetails(badgeId);
        if (!badge) return null;

        const rarity = this.getBadgeRarity(badge.badgeType, badge.tier || 1);

        if (rarity !== "rare" && rarity !== "epic" && rarity !== "legendary") {
            return null; // Only notify for rare+ badges
        }

        const notification = await this.notificationService.createNotification({
            boxId: badge.boxId,
            userId: badge.membership.user.id,
            membershipId: badge.membershipId,
            type: "rare_badge",
            category: "engagement",
            priority: "high",
            title: `✨ ${rarity.toUpperCase()} Badge: ${badge.title}`,
            message: `You've earned a ${rarity} badge! ${badge.description || 'An exceptional achievement!'}`,
            actionUrl: `/athlete/profile/badges`,
            actionLabel: "View Badge",
            channels: ["in_app", "email"],
            data: {
                badgeId: badge.id,
                badgeType: badge.badgeType,
                title: badge.title,
                description: badge.description,
                rarity,
                tier: badge.tier,
                awardedAt: badge.awardedAt
            },
            deduplicationKey: `rare_badge_${badgeId}`,
        });

        return notification;
    }

    /**
     * Helper to get badge with details
     */
    private async getBadgeWithDetails(badgeId: string) {
        return await db.query.athleteBadges.findFirst({
            where: eq(athleteBadges.id, badgeId),
            with: {
                membership: {
                    with: {
                        user: true
                    }
                }
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
     * Determine badge rarity
     */
    private getBadgeRarity(badgeType: string, tier: number): 'common' | 'rare' | 'epic' | 'legendary' {
        if (badgeType === 'pr_achievement') {
            if (tier === 1) return 'common';
            if (tier <= 3) return 'rare';
            return 'epic';
        }

        if (badgeType === 'consistency') {
            if (tier <= 2) return 'rare';
            return 'epic';
        }

        if (badgeType === 'community') {
            if (tier === 1) return 'rare';
            return 'epic';
        }

        return 'common';
    }

    /**
     * Helper to get position suffix (1st, 2nd, 3rd, etc.)
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
