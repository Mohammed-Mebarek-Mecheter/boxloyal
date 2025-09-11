// lib/services/box/box-core-service.ts
import {
    approvalQueue,
    athletePrs,
    athleteWellnessCheckins,
    boxes,
    boxMemberships, prCoachFeedback,
    videoSocialShares
} from "@/db/schema";
import {db} from "@/db";
import {and, count, eq, gte, sql} from "drizzle-orm";
import type {BoxDashboard, BoxStats} from "@/lib/services/box/types";

export class BoxCoreService {
    /**
     * Update box settings
     */
    static async updateBox(boxId: string, updates: Partial<{
        name: string;
        description: string;
        phone: string;
        address: string;
        city: string;
        state: string;
        zipCode: string;
        website: string;
        timezone: string;
        logo: string;
        requireApproval: boolean;
        allowPublicSignup: boolean;
    }>) {
        const [updated] = await db
            .update(boxes)
            .set({
                ...updates,
                updatedAt: new Date(),
            })
            .where(eq(boxes.id, boxId))
            .returning();

        return updated;
    }

    /**
     * Get box statistics for a given period
     */
    static async getBoxStats(
        boxId: string,
        period: "week" | "month" | "quarter" | "year" = "month"
    ): Promise<BoxStats> {
        // Calculate date range
        const now = new Date();
        const startDate = new Date();

        switch (period) {
            case "week":
                startDate.setDate(now.getDate() - 7);
                break;
            case "month":
                startDate.setMonth(now.getMonth() - 1);
                break;
            case "quarter":
                startDate.setMonth(now.getMonth() - 3);
                break;
            case "year":
                startDate.setFullYear(now.getFullYear() - 1);
                break;
        }

        // Get various statistics
        const [
            totalMembers,
            activeMembers,
            newMembers,
            totalPrs,
            totalCheckins,
            avgCheckinRate
        ] = await Promise.all([
            db.select({ count: count() })
                .from(boxMemberships)
                .where(eq(boxMemberships.boxId, boxId)),

            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                )),

            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    gte(boxMemberships.joinedAt, startDate)
                )),

            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, startDate)
                )),

            db.select({ count: count() })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),

            db.select({
                avg: sql<number>`AVG(${boxMemberships.checkinStreak})`
            })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                ))
        ]);

        return {
            members: {
                total: totalMembers[0].count,
                active: activeMembers[0].count,
                new: newMembers[0].count,
            },
            activity: {
                totalPrs: totalPrs[0].count,
                totalCheckins: totalCheckins[0].count,
                avgCheckinRate: Math.round((avgCheckinRate[0].avg || 0) * 10) / 10,
            },
            period,
            dateRange: {
                start: startDate,
                end: now,
            }
        };
    }

    /**
     * Get enhanced box dashboard with video metrics
     */
    static async getDashboard(boxId: string): Promise<BoxDashboard> {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [
            boxInfo,
            memberCounts,
            recentActivity,
            pendingApprovals,
            recentPrs,
            videoPrs,
            checkinStats,
            videoEngagementMetrics,
            atRiskMembers
        ] = await Promise.all([
            // Box basic info
            db.select().from(boxes).where(eq(boxes.id, boxId)).limit(1),

            // Member counts by role
            db.select({
                role: boxMemberships.role,
                count: count()
            })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                ))
                .groupBy(boxMemberships.role),

            // Recent member activity
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    gte(boxMemberships.joinedAt, sevenDaysAgo)
                )),

            // Pending approvals count
            db.select({ count: count() })
                .from(approvalQueue)
                .where(and(
                    eq(approvalQueue.boxId, boxId),
                    eq(approvalQueue.status, "pending")
                )),

            // Recent PRs
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, sevenDaysAgo)
                )),

            // Recent video PRs
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, sevenDaysAgo),
                    sql`${athletePrs.gumletAssetId} IS NOT NULL`
                )),

            // Check-in statistics
            db.select({
                count: count(),
                avgStreak: sql<number>`AVG(${boxMemberships.checkinStreak})`
            })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    gte(boxMemberships.lastCheckinDate, sevenDaysAgo)
                )),

            // Video engagement metrics
            this.getVideoEngagementMetrics(boxId, thirtyDaysAgo),

            // At-risk members count
            this.getAtRiskMembersCount(boxId)
        ]);

        return {
            box: boxInfo[0],
            members: {
                byRole: memberCounts,
                recentJoins: recentActivity[0].count,
                atRiskCount: atRiskMembers
            },
            activity: {
                pendingApprovals: pendingApprovals[0].count,
                recentPrs: recentPrs[0].count,
                videoPrs: videoPrs[0].count,
                activeCheckins: checkinStats[0].count,
                avgStreak: Math.round((checkinStats[0].avgStreak || 0) * 10) / 10,
                pendingModerations: 0 // To be implemented with moderation queue
            },
            videoEngagement: videoEngagementMetrics
        };
    }

    /**
     * Get video engagement metrics for dashboard
     */
    private static async getVideoEngagementMetrics(boxId: string, since: Date) {
        const [totalVideoUploads, totalPrs, coachFeedbackCount, socialShares] = await Promise.all([
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    sql`${athletePrs.gumletAssetId} IS NOT NULL`,
                    gte(athletePrs.achievedAt, since)
                )),

            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, since)
                )),

            db.select({ count: count() })
                .from(prCoachFeedback)
                .innerJoin(athletePrs, eq(prCoachFeedback.prId, athletePrs.id))
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(prCoachFeedback.createdAt, since)
                )),

            db.select({ count: count() })
                .from(videoSocialShares)
                .innerJoin(athletePrs, eq(videoSocialShares.prId, athletePrs.id))
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(videoSocialShares.sharedAt, since)
                ))
        ]);

        const coachFeedbackRate = totalVideoUploads[0].count > 0 ?
            (coachFeedbackCount[0].count / totalVideoUploads[0].count) * 100 : 0;

        const videoVerificationRate = totalPrs[0].count > 0 ?
            (totalVideoUploads[0].count / totalPrs[0].count) * 100 : 0;

        return {
            totalVideoUploads: totalVideoUploads[0].count,
            coachFeedbackRate: Math.round(coachFeedbackRate),
            socialSharesCount: socialShares[0].count,
            avgVideoVerificationRate: Math.round(videoVerificationRate)
        };
    }

    /**
     * Get count of at-risk members
     */
    private static async getAtRiskMembersCount(boxId: string): Promise<number> {
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

        const atRiskMembers = await db
            .select({ count: count() })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                sql`(${boxMemberships.lastCheckinDate} < ${twoWeeksAgo} OR ${boxMemberships.lastCheckinDate} IS NULL)`
            ));

        return atRiskMembers[0].count;
    }
}
