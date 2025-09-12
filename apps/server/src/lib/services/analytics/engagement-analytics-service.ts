// lib/services/analytics/engagement-analytics-service.ts
import { db } from "@/db";
import {
    athleteWellnessCheckins,
    athletePrs,
    athleteBenchmarks,
    boxMemberships,
    benchmarkWods
} from "@/db/schema";
import {
    mvAthleteEngagementScores,
    mvAthleteProgress
} from "@/db/schema/views";
import { eq, desc, and, gte, count, sql } from "drizzle-orm";

export interface EngagementMetrics {
    score: number;
    metrics: {
        checkins: number;
        prs: number;
        attendance: number;
        benchmarks: number;
    };
    breakdown: {
        checkinScore: number;
        prScore: number;
        attendanceScore: number;
        benchmarkScore: number;
    };
    period: {
        days: number;
        start: Date;
        end: Date;
    };
}

export interface ActivityFeedItem {
    type: 'pr' | 'benchmark' | 'checkin';
    date: Date;
    membershipId: string;
    boxId: string;
    description: string;
}

export class EngagementAnalyticsService {
    /**
     * Calculate athlete engagement score - Using mv_athlete_engagement_scores
     */
    static async calculateAthleteEngagementScore(
        boxId: string,
        membershipId: string,
        days: number = 30
    ): Promise<EngagementMetrics> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get engagement data from materialized view
        const engagementData = await db
            .select()
            .from(mvAthleteEngagementScores)
            .where(and(
                eq(mvAthleteEngagementScores.boxId, boxId),
                eq(mvAthleteEngagementScores.membershipId, membershipId),
                gte(mvAthleteEngagementScores.calculatedAt, startDate)
            ))
            .orderBy(desc(mvAthleteEngagementScores.calculatedAt))
            .limit(1);

        if (!engagementData[0]) {
            return {
                score: 0,
                metrics: { checkins: 0, prs: 0, attendance: 0, benchmarks: 0 },
                breakdown: { checkinScore: 0, prScore: 0, attendanceScore: 0, benchmarkScore: 0 },
                period: { days, start: startDate, end: new Date() }
            };
        }

        const data = engagementData[0];

        // Provide default values for potentially null fields
        const checkinCount = data.checkinCount || 0;
        const prCount = data.prCount || 0;
        const attendanceCount = data.attendanceCount || 0;
        const benchmarkCount = data.benchmarkCount || 0;

        return {
            score: data.engagementScore || 0,
            metrics: {
                checkins: checkinCount,
                prs: prCount,
                attendance: attendanceCount,
                benchmarks: benchmarkCount
            },
            breakdown: {
                checkinScore: Math.round((checkinCount / days) * 100) || 0,
                prScore: prCount * 10,
                attendanceScore: Math.round((attendanceCount / days) * 100) || 0,
                benchmarkScore: benchmarkCount * 15
            },
            period: {
                days,
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Get athlete engagement leaderboard for a box - Using mv_athlete_engagement_scores
     */
    static async getEngagementLeaderboard(
        boxId: string,
        options: {
            days?: number;
            limit?: number;
            includeInactive?: boolean;
        } = {}
    ) {
        const { days = 30, limit = 20, includeInactive = false } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        let conditions = [
            eq(mvAthleteEngagementScores.boxId, boxId),
            gte(mvAthleteEngagementScores.calculatedAt, startDate)
        ];

        if (!includeInactive) {
            // Join with memberships to filter active only
            const query = db
                .select({
                    membershipId: mvAthleteEngagementScores.membershipId,
                    boxId: mvAthleteEngagementScores.boxId,
                    membershipPublicId: mvAthleteEngagementScores.membershipPublicId,
                    athleteName: mvAthleteEngagementScores.athleteName,
                    athleteEmail: mvAthleteEngagementScores.athleteEmail,
                    fitnessLevel: mvAthleteEngagementScores.fitnessLevel,
                    checkinCount: mvAthleteEngagementScores.checkinCount,
                    prCount: mvAthleteEngagementScores.prCount,
                    attendanceCount: mvAthleteEngagementScores.attendanceCount,
                    benchmarkCount: mvAthleteEngagementScores.benchmarkCount,
                    engagementScore: mvAthleteEngagementScores.engagementScore,
                    calculatedAt: mvAthleteEngagementScores.calculatedAt,
                    isActive: boxMemberships.isActive
                })
                .from(mvAthleteEngagementScores)
                .innerJoin(
                    boxMemberships,
                    eq(mvAthleteEngagementScores.membershipId, boxMemberships.id)
                )
                .where(and(
                    ...conditions,
                    eq(boxMemberships.isActive, true)
                ))
                .orderBy(desc(mvAthleteEngagementScores.engagementScore))
                .limit(limit);

            return query;
        }

        return db
            .select()
            .from(mvAthleteEngagementScores)
            .where(and(...conditions))
            .orderBy(desc(mvAthleteEngagementScores.engagementScore))
            .limit(limit);
    }

    /**
     * Get athlete progress timeline - Using mv_athlete_progress
     */
    static async getAthleteProgressTimeline(
        boxId: string,
        membershipId: string,
        limit: number = 50
    ) {
        return db
            .select()
            .from(mvAthleteProgress)
            .where(and(
                eq(mvAthleteProgress.boxId, boxId),
                eq(mvAthleteProgress.membershipId, membershipId)
            ))
            .orderBy(desc(mvAthleteProgress.eventDate))
            .limit(limit);
    }

    /**
     * Get recent activity feed (simple query - no view needed)
     */
    static async getRecentActivityFeed(
        boxId: string,
        options: {
            limit?: number;
            membershipId?: string;
            activityTypes?: Array<'pr' | 'benchmark' | 'checkin'>;
        } = {}
    ): Promise<ActivityFeedItem[]> {
        const { limit = 20, membershipId, activityTypes = ['pr', 'benchmark', 'checkin'] } = options;
        const activities: ActivityFeedItem[] = [];

        // Get PRs
        if (activityTypes.includes('pr')) {
            const prConditions = [eq(athletePrs.boxId, boxId)];
            if (membershipId) {
                prConditions.push(eq(athletePrs.membershipId, membershipId));
            }

            const prs = await db
                .select({
                    type: sql`'pr'`.as('type'),
                    date: athletePrs.achievedAt,
                    membershipId: athletePrs.membershipId,
                    boxId: athletePrs.boxId,
                    description: sql`CONCAT('PR Set: ', m.name, ' - ', ${athletePrs.value}, ' ', ${athletePrs.unit})`.as('description')
                })
                .from(athletePrs)
                .leftJoin(benchmarkWods, eq(athletePrs.movementId, benchmarkWods.id)) // Join to get movement name
                .where(and(...prConditions))
                .orderBy(desc(athletePrs.achievedAt))
                .limit(limit);

            activities.push(...prs as ActivityFeedItem[]);
        }

        // Get benchmarks
        if (activityTypes.includes('benchmark')) {
            const benchmarkConditions = [eq(athleteBenchmarks.boxId, boxId)];
            if (membershipId) {
                benchmarkConditions.push(eq(athleteBenchmarks.membershipId, membershipId));
            }

            const benchmarks = await db
                .select({
                    type: sql`'benchmark'`.as('type'),
                    date: athleteBenchmarks.updatedAt,
                    membershipId: athleteBenchmarks.membershipId,
                    boxId: athleteBenchmarks.boxId,
                    description: sql`CONCAT('Benchmark: ', bw.name)`.as('description')
                })
                .from(athleteBenchmarks)
                .leftJoin(benchmarkWods, eq(athleteBenchmarks.benchmarkId, benchmarkWods.id)) // Join to get benchmark name
                .where(and(...benchmarkConditions))
                .orderBy(desc(athleteBenchmarks.updatedAt))
                .limit(limit);

            activities.push(...benchmarks as ActivityFeedItem[]);
        }

        // Get checkins
        if (activityTypes.includes('checkin')) {
            const checkinConditions = [eq(athleteWellnessCheckins.boxId, boxId)];
            if (membershipId) {
                checkinConditions.push(eq(athleteWellnessCheckins.membershipId, membershipId));
            }

            const checkins = await db
                .select({
                    type: sql`'checkin'`.as('type'),
                    date: athleteWellnessCheckins.checkinDate,
                    membershipId: athleteWellnessCheckins.membershipId,
                    boxId: athleteWellnessCheckins.boxId,
                    description: sql`'Wellness Check-in'`.as('description')
                })
                .from(athleteWellnessCheckins)
                .where(and(...checkinConditions))
                .orderBy(desc(athleteWellnessCheckins.checkinDate))
                .limit(limit);

            activities.push(...checkins as ActivityFeedItem[]);
        }

        // Combine and sort all activities
        activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return activities.slice(0, limit);
    }

    /**
     * Get engagement trends over time
     */
    static async getEngagementTrends(
        boxId: string,
        options: {
            membershipId?: string;
            days?: number;
            granularity?: 'daily' | 'weekly' | 'monthly';
        } = {}
    ) {
        const { membershipId, days = 90, granularity = 'weekly' } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        let dateGrouping: string;
        switch (granularity) {
            case 'daily':
                dateGrouping = `DATE(${athleteWellnessCheckins.checkinDate})`;
                break;
            case 'weekly':
                dateGrouping = `DATE_TRUNC('week', ${athleteWellnessCheckins.checkinDate})`;
                break;
            case 'monthly':
                dateGrouping = `DATE_TRUNC('month', ${athleteWellnessCheckins.checkinDate})`;
                break;
            default:
                dateGrouping = `DATE_TRUNC('week', ${athleteWellnessCheckins.checkinDate})`;
        }

        // This is a simplified version - in a real implementation, you might want to
        // aggregate data from multiple sources (checkins, PRs, attendance, etc.)
        const conditions = [
            eq(athleteWellnessCheckins.boxId, boxId),
            gte(athleteWellnessCheckins.checkinDate, startDate)
        ];

        if (membershipId) {
            conditions.push(eq(athleteWellnessCheckins.membershipId, membershipId));
        }

        const trendData = await db
            .select({
                period: sql`${dateGrouping}`.as('period'),
                engagementScore: sql<number>`COUNT(*)`.as('engagement_score')
            })
            .from(athleteWellnessCheckins)
            .where(and(...conditions))
            .groupBy(sql`${dateGrouping}`)
            .orderBy(sql`${dateGrouping}`);

        return trendData.map(item => ({
            period: item.period,
            engagementScore: Number(item.engagementScore)
        }));
    }

    /**
     * Calculate engagement score for multiple athletes
     */
    static async calculateBulkEngagementScores(
        boxId: string,
        membershipIds: string[],
        days: number = 30
    ): Promise<Record<string, EngagementMetrics>> {
        if (membershipIds.length === 0) return {};

        const results: Record<string, EngagementMetrics> = {};

        // Process in batches to avoid overwhelming the database
        const batchSize = 10;
        for (let i = 0; i < membershipIds.length; i += batchSize) {
            const batch = membershipIds.slice(i, i + batchSize);
            const batchPromises = batch.map(async (membershipId) => {
                const metrics = await this.calculateAthleteEngagementScore(boxId, membershipId, days);
                return { membershipId, metrics };
            });

            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(({ membershipId, metrics }) => {
                results[membershipId] = metrics;
            });
        }

        return results;
    }

    /**
     * Get low engagement athletes
     */
    static async getLowEngagementAthletes(
        boxId: string,
        options: {
            threshold?: number;
            days?: number;
            limit?: number;
        } = {}
    ) {
        const { threshold = 30, days = 30, limit = 20 } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return db
            .select()
            .from(mvAthleteEngagementScores)
            .where(and(
                eq(mvAthleteEngagementScores.boxId, boxId),
                gte(mvAthleteEngagementScores.calculatedAt, startDate),
                sql`${mvAthleteEngagementScores.engagementScore} < ${threshold}`
            ))
            .orderBy(mvAthleteEngagementScores.engagementScore)
            .limit(limit);
    }

    /**
     * Get engagement insights for a box
     */
    static async getEngagementInsights(boxId: string, days: number = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [avgEngagement, topPerformers, lowEngagement, trends] = await Promise.all([
            // Average engagement score
            db.select({
                avgScore: sql<number>`AVG(${mvAthleteEngagementScores.engagementScore})`,
                totalAthletes: count()
            })
                .from(mvAthleteEngagementScores)
                .where(and(
                    eq(mvAthleteEngagementScores.boxId, boxId),
                    gte(mvAthleteEngagementScores.calculatedAt, startDate)
                )),

            // Top performers (engagement > 80)
            db.select({ count: count() })
                .from(mvAthleteEngagementScores)
                .where(and(
                    eq(mvAthleteEngagementScores.boxId, boxId),
                    gte(mvAthleteEngagementScores.calculatedAt, startDate),
                    sql`${mvAthleteEngagementScores.engagementScore} >= 80`
                )),

            // Low engagement (< 40)
            db.select({ count: count() })
                .from(mvAthleteEngagementScores)
                .where(and(
                    eq(mvAthleteEngagementScores.boxId, boxId),
                    gte(mvAthleteEngagementScores.calculatedAt, startDate),
                    sql`${mvAthleteEngagementScores.engagementScore} < 40`
                )),

            // Weekly trends
            this.getEngagementTrends(boxId, { days, granularity: 'weekly' })
        ]);

        return {
            summary: {
                averageEngagement: Math.round(avgEngagement[0]?.avgScore || 0),
                totalAthletes: avgEngagement[0]?.totalAthletes || 0,
                highPerformers: topPerformers[0]?.count || 0,
                lowEngagement: lowEngagement[0]?.count || 0,
                highPerformerRate: avgEngagement[0]?.totalAthletes ?
                    Math.round((topPerformers[0]?.count || 0) / avgEngagement[0].totalAthletes * 100) : 0
            },
            trends,
            period: {
                days,
                start: startDate,
                end: new Date()
            }
        };
    }
}
