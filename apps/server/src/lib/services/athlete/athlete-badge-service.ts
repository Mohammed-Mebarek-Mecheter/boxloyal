// lib/services/athlete-badge-service.ts - Enhanced for Video Strategy Gamification
import { athleteBadges, athletePrs, boxMemberships } from "@/db/schema";
import { and, desc, eq, count, gte, sql } from "drizzle-orm";
import { db } from "@/db";

export interface BadgeWithProgress {
    badge?: typeof athleteBadges.$inferSelect;
    progress: {
        current: number;
        required: number;
        percentage: number;
    };
    nextTier?: {
        tier: number;
        requirement: string;
        reward: string;
    };
    isCompleted: boolean;
    isNewlyEarned: boolean;
}

export interface VideoVerificationBadges {
    videoVerified: BadgeWithProgress;
    consistencyStreaks: BadgeWithProgress;
    journeyDocumenter: BadgeWithProgress;
    formImprovement: BadgeWithProgress;
    socialStar: BadgeWithProgress;
}

export class AthleteBadgeService {
    /**
     * Get athlete badges with enhanced filtering and progress tracking
     */
    static async getAthleteBadges(boxId: string, athleteId: string, options: {
        includeHidden?: boolean;
        badgeType?: string;
        limit?: number;
        includeProgress?: boolean;
    } = {}) {
        const { includeHidden = false, badgeType, limit = 50, includeProgress = false } = options;

        const conditions = [
            eq(athleteBadges.boxId, boxId),
            eq(athleteBadges.membershipId, athleteId)
        ];

        if (!includeHidden) {
            conditions.push(eq(athleteBadges.isHidden, false));
        }

        if (badgeType) {
            conditions.push(eq(athleteBadges.badgeType, badgeType as any));
        }

        const badges = await db
            .select()
            .from(athleteBadges)
            .where(and(...conditions))
            .orderBy(desc(athleteBadges.awardedAt))
            .limit(limit);

        // Add progress tracking if requested
        if (includeProgress) {
            const badgesWithProgress = await Promise.all(
                badges.map(async (badge) => {
                    const progress = await this.getBadgeProgress(boxId, athleteId, badge.badgeType);
                    return {
                        ...badge,
                        progress
                    };
                })
            );
            return badgesWithProgress;
        }

        return badges;
    }

    /**
     * Award badges with enhanced video-focused logic
     */
    static async awardBadge(
        boxId: string,
        athleteId: string,
        badgeData: {
            badgeType: string;
            title: string;
            description?: string;
            icon?: string;
            achievedValue?: string;
            tier?: number;
            isAutoAwarded?: boolean;
        }
    ) {
        // Check if badge already exists for this tier
        const existingBadge = await db
            .select()
            .from(athleteBadges)
            .where(
                and(
                    eq(athleteBadges.boxId, boxId),
                    eq(athleteBadges.membershipId, athleteId),
                    eq(athleteBadges.badgeType, badgeData.badgeType as any),
                    eq(athleteBadges.tier, badgeData.tier || 1)
                )
            )
            .limit(1);

        if (existingBadge.length > 0) {
            return existingBadge[0]; // Badge already awarded
        }

        const [badge] = await db
            .insert(athleteBadges)
            .values({
                boxId,
                membershipId: athleteId,
                badgeType: badgeData.badgeType as any,
                title: badgeData.title,
                description: badgeData.description,
                icon: badgeData.icon,
                achievedValue: badgeData.achievedValue,
                tier: badgeData.tier || 1,
                awardedAt: new Date(),
            })
            .returning();

        return badge;
    }

    /**
     * Check and award video-related badges automatically
     */
    static async checkAndAwardVideoBadges(boxId: string, athleteId: string) {
        const badges: typeof athleteBadges.$inferSelect[] = [];

        // Get video PR statistics for this athlete
        const stats = await this.getVideoStats(boxId, athleteId);

        // 1. Video Verified Badge (first video PR)
        if (stats.totalVideoPrs === 1) {
            const badge = await this.awardBadge(boxId, athleteId, {
                badgeType: 'pr_achievement',
                title: 'Video Verified',
                description: 'Uploaded your first PR video proof',
                icon: 'video-camera',
                achievedValue: 'First video PR',
                tier: 1,
                isAutoAwarded: true
            });
            if (badge) badges.push(badge);
        }

        // 2. Journey Documenter Badge (multiple video PRs)
        const journeyTiers = [
            { count: 5, tier: 1, title: 'Journey Starter', description: '5 video-verified PRs' },
            { count: 15, tier: 2, title: 'Journey Documenter', description: '15 video-verified PRs' },
            { count: 30, tier: 3, title: 'Journey Master', description: '30 video-verified PRs' },
            { count: 50, tier: 4, title: 'Journey Legend', description: '50 video-verified PRs' }
        ];

        for (const { count, tier, title, description } of journeyTiers) {
            if (stats.totalVideoPrs >= count) {
                const badge = await this.awardBadge(boxId, athleteId, {
                    badgeType: 'pr_achievement',
                    title,
                    description,
                    icon: 'film',
                    achievedValue: `${count} video PRs`,
                    tier,
                    isAutoAwarded: true
                });
                if (badge) badges.push(badge);
            }
        }

        // 3. Consistency Streaks (video PRs in consecutive months)
        if (stats.currentVideoStreak >= 3) {
            const badge = await this.awardBadge(boxId, athleteId, {
                badgeType: 'consistency',
                title: 'Video Consistency',
                description: `${stats.currentVideoStreak} months with video PRs`,
                icon: 'calendar-check',
                achievedValue: `${stats.currentVideoStreak} months`,
                tier: Math.min(Math.floor(stats.currentVideoStreak / 3), 5),
                isAutoAwarded: true
            });
            if (badge) badges.push(badge);
        }

        // 4. Coach Feedback Engagement
        if (stats.videosWithCoachFeedback >= 10) {
            const badge = await this.awardBadge(boxId, athleteId, {
                badgeType: 'community',
                title: 'Feedback Champion',
                description: 'Received coach feedback on 10+ video PRs',
                icon: 'message-circle',
                achievedValue: `${stats.videosWithCoachFeedback} videos with feedback`,
                tier: Math.min(Math.floor(stats.videosWithCoachFeedback / 10), 3),
                isAutoAwarded: true
            });
            if (badge) badges.push(badge);
        }

        // 5. Social Engagement (shared videos)
        if (stats.sharedVideos >= 5) {
            const badge = await this.awardBadge(boxId, athleteId, {
                badgeType: 'community',
                title: 'Social Star',
                description: 'Shared 5+ PR videos with the box',
                icon: 'share-2',
                achievedValue: `${stats.sharedVideos} shared videos`,
                tier: Math.min(Math.floor(stats.sharedVideos / 5), 3),
                isAutoAwarded: true
            });
            if (badge) badges.push(badge);
        }

        return badges;
    }

    /**
     * Get comprehensive video statistics for badge calculations
     */
    static async getVideoStats(boxId: string, athleteId: string) {
        const [
            totalVideoPrs,
            videosWithCoachFeedback,
            sharedVideos,
            videoStreakData
        ] = await Promise.all([
            // Total video PRs
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    eq(athletePrs.membershipId, athleteId),
                    sql`${athletePrs.gumletAssetId} IS NOT NULL`
                )),

            // PRs with coach feedback (placeholder - would need prCoachFeedback table)
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    eq(athletePrs.membershipId, athleteId),
                    sql`${athletePrs.gumletAssetId} IS NOT NULL`,
                    sql`${athletePrs.coachNotes} IS NOT NULL AND ${athletePrs.coachNotes} != ''`
                )),

            // Shared videos (placeholder - would need videoSocialShares table)
            Promise.resolve([{ count: 0 }]), // Placeholder

            // Video streak calculation (PRs with video in consecutive months)
            this.calculateVideoStreak(boxId, athleteId)
        ]);

        return {
            totalVideoPrs: totalVideoPrs[0].count,
            videosWithCoachFeedback: videosWithCoachFeedback[0].count,
            sharedVideos: sharedVideos[0].count,
            currentVideoStreak: videoStreakData.currentStreak,
            longestVideoStreak: videoStreakData.longestStreak
        };
    }

    /**
     * Calculate video consistency streak
     */
    private static async calculateVideoStreak(boxId: string, athleteId: string) {
        // Get video PRs grouped by month
        const monthlyVideoPrs = await db
            .select({
                month: sql<string>`DATE_TRUNC('month', ${athletePrs.achievedAt})`,
                count: count()
            })
            .from(athletePrs)
            .where(and(
                eq(athletePrs.boxId, boxId),
                eq(athletePrs.membershipId, athleteId),
                sql`${athletePrs.gumletAssetId} IS NOT NULL`
            ))
            .groupBy(sql`DATE_TRUNC('month', ${athletePrs.achievedAt})`)
            .orderBy(desc(sql`DATE_TRUNC('month', ${athletePrs.achievedAt})`));

        if (monthlyVideoPrs.length === 0) {
            return { currentStreak: 0, longestStreak: 0 };
        }

        let currentStreak = 0;
        let longestStreak = 0;
        let tempStreak = 0;
        let lastMonth: Date | null = null;

        for (const record of monthlyVideoPrs) {
            const recordMonth = new Date(record.month);

            if (lastMonth) {
                const monthDiff = (lastMonth.getFullYear() - recordMonth.getFullYear()) * 12 +
                    (lastMonth.getMonth() - recordMonth.getMonth());

                if (monthDiff === 1) {
                    tempStreak++;
                } else {
                    longestStreak = Math.max(longestStreak, tempStreak);
                    tempStreak = 1;
                }
            } else {
                tempStreak = 1;
                currentStreak = 1; // Start current streak
            }

            lastMonth = recordMonth;
        }

        longestStreak = Math.max(longestStreak, tempStreak);
        currentStreak = tempStreak;

        return { currentStreak, longestStreak };
    }

    /**
     * Get badge progress for specific badge types
     */
    static async getBadgeProgress(boxId: string, athleteId: string, badgeType: string): Promise<{
        current: number;
        required: number;
        percentage: number;
    }> {
        const stats = await this.getVideoStats(boxId, athleteId);

        switch (badgeType) {
            case 'pr_achievement':
                // Video verified badges
                const nextVideoMilestone = [1, 5, 15, 30, 50].find(m => stats.totalVideoPrs < m) || 100;
                return {
                    current: stats.totalVideoPrs,
                    required: nextVideoMilestone,
                    percentage: Math.min((stats.totalVideoPrs / nextVideoMilestone) * 100, 100)
                };

            case 'consistency':
                // Video consistency streak
                const nextStreakMilestone = Math.ceil(stats.currentVideoStreak / 3) * 3 + 3;
                return {
                    current: stats.currentVideoStreak,
                    required: nextStreakMilestone,
                    percentage: Math.min((stats.currentVideoStreak / nextStreakMilestone) * 100, 100)
                };

            case 'community':
                // Social engagement
                const nextSocialMilestone = Math.ceil(stats.sharedVideos / 5) * 5 + 5;
                return {
                    current: stats.sharedVideos,
                    required: nextSocialMilestone,
                    percentage: Math.min((stats.sharedVideos / nextSocialMilestone) * 100, 100)
                };

            default:
                return {
                    current: 0,
                    required: 1,
                    percentage: 0
                };
        }
    }

    /**
     * Get video verification leaderboard for the box
     */
    static async getVideoLeaderboard(boxId: string, timeframe: 'month' | 'quarter' | 'all' = 'month') {
        let dateFrom: Date | undefined;
        if (timeframe !== 'all') {
            dateFrom = new Date();
            if (timeframe === 'month') {
                dateFrom.setMonth(dateFrom.getMonth() - 1);
            } else {
                dateFrom.setMonth(dateFrom.getMonth() - 3);
            }
        }

        const conditions = [
            eq(athletePrs.boxId, boxId),
            sql`${athletePrs.gumletAssetId} IS NOT NULL`
        ];

        if (dateFrom) {
            conditions.push(gte(athletePrs.achievedAt, dateFrom));
        }

        const leaderboard = await db
            .select({
                membership: {
                    publicId: boxMemberships.publicId,
                    displayName: boxMemberships.displayName,
                },
                videoPrCount: count(athletePrs.id)
            })
            .from(athletePrs)
            .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
            .where(and(...conditions))
            .groupBy(boxMemberships.id, boxMemberships.publicId, boxMemberships.displayName)
            .orderBy(desc(count(athletePrs.id)))
            .limit(10);

        // Add rank and badges for each member
        const enhancedLeaderboard = await Promise.all(
            leaderboard.map(async (entry, index) => {
                const badges = await this.getAthleteBadges(boxId, entry.membership.publicId, {
                    badgeType: 'pr_achievement',
                    limit: 5
                });

                return {
                    rank: index + 1,
                    ...entry,
                    badges: badges.slice(0, 3) // Show top 3 video-related badges
                };
            })
        );

        return enhancedLeaderboard;
    }

    /**
     * Get upcoming badge opportunities for motivation
     */
    static async getUpcomingBadgeOpportunities(boxId: string, athleteId: string) {
        const stats = await this.getVideoStats(boxId, athleteId);
        const opportunities = [];

        // Video verification opportunities
        const videoMilestones = [1, 5, 15, 30, 50];
        const nextVideoMilestone = videoMilestones.find(m => stats.totalVideoPrs < m);

        if (nextVideoMilestone) {
            const remaining = nextVideoMilestone - stats.totalVideoPrs;
            opportunities.push({
                badgeType: 'pr_achievement',
                title: nextVideoMilestone === 1 ? 'Video Verified' : `Journey Documenter (Level ${videoMilestones.indexOf(nextVideoMilestone)})`,
                description: `${remaining} more video PR${remaining > 1 ? 's' : ''} needed`,
                progress: {
                    current: stats.totalVideoPrs,
                    required: nextVideoMilestone,
                    percentage: (stats.totalVideoPrs / nextVideoMilestone) * 100
                },
                category: 'video_verification',
                difficulty: remaining <= 2 ? 'easy' : remaining <= 5 ? 'medium' : 'hard',
                estimatedTimeframe: remaining <= 2 ? '1-2 weeks' : remaining <= 5 ? '1 month' : '2-3 months'
            });
        }

        // Consistency streak opportunities
        const nextStreakMilestone = Math.ceil((stats.currentVideoStreak + 1) / 3) * 3;
        if (nextStreakMilestone > stats.currentVideoStreak) {
            const monthsNeeded = nextStreakMilestone - stats.currentVideoStreak;
            opportunities.push({
                badgeType: 'consistency',
                title: 'Video Consistency',
                description: `${monthsNeeded} more month${monthsNeeded > 1 ? 's' : ''} with video PRs needed`,
                progress: {
                    current: stats.currentVideoStreak,
                    required: nextStreakMilestone,
                    percentage: (stats.currentVideoStreak / nextStreakMilestone) * 100
                },
                category: 'consistency',
                difficulty: 'medium',
                estimatedTimeframe: `${monthsNeeded} month${monthsNeeded > 1 ? 's' : ''}`
            });
        }

        // Coach feedback opportunities
        const feedbackNeeded = 10 - stats.videosWithCoachFeedback;
        if (feedbackNeeded > 0 && stats.totalVideoPrs > 0) {
            opportunities.push({
                badgeType: 'community',
                title: 'Feedback Champion',
                description: `Upload ${feedbackNeeded} more video PR${feedbackNeeded > 1 ? 's' : ''} and engage with coach feedback`,
                progress: {
                    current: stats.videosWithCoachFeedback,
                    required: 10,
                    percentage: (stats.videosWithCoachFeedback / 10) * 100
                },
                category: 'community_engagement',
                difficulty: 'medium',
                estimatedTimeframe: '1-2 months'
            });
        }

        // Social sharing opportunities
        const sharingNeeded = 5 - stats.sharedVideos;
        if (sharingNeeded > 0 && stats.totalVideoPrs >= 3) {
            opportunities.push({
                badgeType: 'community',
                title: 'Social Star',
                description: `Share ${sharingNeeded} more PR video${sharingNeeded > 1 ? 's' : ''} with your box`,
                progress: {
                    current: stats.sharedVideos,
                    required: 5,
                    percentage: (stats.sharedVideos / 5) * 100
                },
                category: 'social_engagement',
                difficulty: 'easy',
                estimatedTimeframe: '2-4 weeks'
            });
        }

        return opportunities.sort((a, b) => {
            // Sort by difficulty and progress
            const difficultyOrder = { easy: 1, medium: 2, hard: 3 };
            const aDiff = difficultyOrder[a.difficulty as keyof typeof difficultyOrder];
            const bDiff = difficultyOrder[b.difficulty as keyof typeof difficultyOrder];

            if (aDiff !== bDiff) return aDiff - bDiff;
            return b.progress.percentage - a.progress.percentage;
        });
    }

    /**
     * Celebrate newly earned badges with enhanced notification data
     */
    static async celebrateNewBadges(boxId: string, athleteId: string, newBadges: typeof athleteBadges.$inferSelect[]) {
        if (newBadges.length === 0) return null;

        // Get athlete details for personalization
        const athlete = await db
            .select({
                displayName: boxMemberships.displayName,
                publicId: boxMemberships.publicId
            })
            .from(boxMemberships)
            .where(eq(boxMemberships.id, athleteId))
            .limit(1);

        if (!athlete.length) return null;

        const celebration = {
            athleteName: athlete[0].displayName || 'Athlete',
            athletePublicId: athlete[0].publicId,
            badges: newBadges.map(badge => ({
                title: badge.title,
                description: badge.description,
                icon: badge.icon,
                tier: badge.tier,
                category: badge.badgeType,
                rarity: this.getBadgeRarity(badge.badgeType, badge.tier || 1),
                shareText: `Just earned the "${badge.title}" badge! ${badge.description} 🏆`
            })),
            totalBadgesCount: newBadges.length,
            celebrationLevel: newBadges.length >= 3 ? 'epic' : newBadges.length >= 2 ? 'great' : 'nice',
            confettiDuration: Math.min(newBadges.length * 2000, 8000), // 2s per badge, max 8s
            notificationTitle: newBadges.length === 1 ?
                `New Badge Earned!` :
                `${newBadges.length} New Badges Earned!`,
            notificationText: newBadges.length === 1 ?
                newBadges[0].title :
                `${newBadges[0].title} and ${newBadges.length - 1} more!`
        };

        return celebration;
    }

    /**
     * Determine badge rarity for enhanced presentation
     */
    private static getBadgeRarity(badgeType: string, tier: number): 'common' | 'rare' | 'epic' | 'legendary' {
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
     * Get badge collection overview for profile display
     */
    static async getBadgeCollection(boxId: string, athleteId: string) {
        const badges = await this.getAthleteBadges(boxId, athleteId, {
            includeProgress: false,
            limit: 100
        });

        // Group badges by category
        const collection = badges.reduce((acc, badge) => {
            const category = badge.badgeType;
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(badge);
            return acc;
        }, {} as Record<string, typeof athleteBadges.$inferSelect[]>);

        // Calculate collection statistics
        const stats = {
            totalBadges: badges.length,
            badgesByRarity: badges.reduce((acc, badge) => {
                const rarity = this.getBadgeRarity(badge.badgeType, badge.tier || 1);
                acc[rarity] = (acc[rarity] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            badgesByCategory: Object.keys(collection).map(category => ({
                category,
                count: collection[category].length,
                latestBadge: collection[category].sort((a, b) =>
                    new Date(b.awardedAt).getTime() - new Date(a.awardedAt).getTime()
                )[0]
            })),
            recentBadges: badges
                .sort((a, b) => new Date(b.awardedAt).getTime() - new Date(a.awardedAt).getTime())
                .slice(0, 5)
        };

        return {
            collection,
            stats,
            displayBadges: stats.recentBadges.slice(0, 3), // For profile display
            collectionCompleteness: this.calculateCollectionCompleteness(badges)
        };
    }

    /**
     * Calculate how complete the badge collection is
     */
    private static calculateCollectionCompleteness(badges: typeof athleteBadges.$inferSelect[]) {
        // Define total possible badges for each category
        const totalPossibleBadges = {
            pr_achievement: 5, // Video verification tiers
            consistency: 5,    // Streak tiers
            community: 6,      // Feedback + social tiers
            checkin_streak: 4, // Check-in related
            attendance: 3,     // Attendance related
        };

        const earnedByCategory = badges.reduce((acc, badge) => {
            acc[badge.badgeType] = (acc[badge.badgeType] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const completeness = Object.keys(totalPossibleBadges).map(category => ({
            category,
            earned: earnedByCategory[category] || 0,
            total: totalPossibleBadges[category as keyof typeof totalPossibleBadges],
            percentage: Math.round(((earnedByCategory[category] || 0) / totalPossibleBadges[category as keyof typeof totalPossibleBadges]) * 100)
        }));

        const overallPercentage = Math.round(
            (badges.length / Object.values(totalPossibleBadges).reduce((a, b) => a + b, 0)) * 100
        );

        return {
            overall: overallPercentage,
            byCategory: completeness,
            nextMilestone: overallPercentage < 25 ? 25 : overallPercentage < 50 ? 50 : overallPercentage < 75 ? 75 : 100
        };
    }
}
