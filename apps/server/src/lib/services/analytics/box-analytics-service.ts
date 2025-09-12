// lib/services/analytics/box-analytics-service.ts
import { db } from "@/db";
import {
    boxMemberships,
    boxAnalytics,
    athleteWellnessCheckins,
    athletePrs,
    athleteBenchmarks,
    user,
    userProfiles,
    orders
} from "@/db/schema";
import {
    mvBoxHealthDashboard
} from "@/db/schema/views";
import { eq, desc, and, gte, count, sql, avg, sum, lte, inArray } from "drizzle-orm";

export type AnalyticsPeriod = "daily" | "weekly" | "monthly";

export interface BoxHealthMetrics {
    riskDistribution: Array<{ riskLevel: string; count: number }>;
    alertStats: Array<{ alertType: string; status: string; count: number }>;
    interventionStats: Array<{ interventionType: string; outcome: string | null; count: number }>;
    wellnessTrends: {
        avgEnergy: number | null;
        avgSleep: number | null;
        avgStress: number | null;
    };
    attendanceTrends: {
        totalCheckins: number;
        uniqueAthletes: number;
    };
    performanceTrends: {
        totalPrs: number;
        avgImprovement: number | null;
    };
}

export interface BoxOverview {
    period: 'week' | 'month' | 'quarter' | 'year';
    summary: {
        totalAthletes: number;
        activeAthletes: number;
        retentionRate: number;
        avgCheckinStreak: number;
    };
    wellness: {
        avgEnergyLevel: number;
        avgStressLevel: number;
        avgWorkoutReadiness: number;
        totalCheckins: number;
        checkinRate: number;
    };
    performance: {
        totalPrs: number;
        totalBenchmarks: number;
        avgPrsPerAthlete: number;
    };
    generatedAt: Date;
}

export interface BasicBoxStats {
    activeAthletes: number;
    activeCoaches: number;
    newMembers30d: number;
    avgCheckinStreak: number;
}

export interface BillingAnalytics {
    timeframe: "30d" | "90d" | "12m";
    period: { start: Date; end: Date };
    summary: {
        totalSpent: number;
        totalSpentFormatted: string;
        orderCount: number;
        averageOrderValue: number;
        averageOrderValueFormatted: string;
    };
}

export interface BillingHistory {
    orders: Array<any>;
    pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
        page: number;
        totalPages: number;
    };
    summary: {
        totalSpent: number;
        totalSpentFormatted: string;
        totalRefunded: number;
        totalRefundedFormatted: string;
        monthlySpend: number;
        monthlySpendFormatted: string;
        averageOrderValue: number;
        categoryBreakdown: Record<string, { count: number; amount: number }>;
    };
}

export class BoxAnalyticsService {
    /**
     * Get comprehensive box analytics (owner dashboard)
     */
    static async getBoxAnalytics(
        boxId: string,
        options: {
            period?: 'week' | 'month' | 'quarter' | 'year';
            includeComparisons?: boolean;
        } = {}
    ): Promise<BoxOverview> {
        const { period = 'month', includeComparisons = true } = options;

        const daysMap = {
            week: 7,
            month: 30,
            quarter: 90,
            year: 365
        };

        const days = daysMap[period];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [
            totalAthletes,
            activeAthletes,
            avgWellness,
            retentionMetrics,
            performanceMetrics
        ] = await Promise.all([
            db.select({ count: count() })
                .from(boxMemberships)
                .where(eq(boxMemberships.boxId, boxId)),

            db.select({ count: count() })
                .from(boxMemberships)
                .where(
                    and(
                        eq(boxMemberships.boxId, boxId),
                        eq(boxMemberships.isActive, true),
                        gte(boxMemberships.lastCheckinDate || sql`'1970-01-01'::timestamp`, startDate)
                    )
                ),

            db.select({
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness),
                totalCheckins: count()
            })
                .from(athleteWellnessCheckins)
                .where(
                    and(
                        eq(athleteWellnessCheckins.boxId, boxId),
                        gte(athleteWellnessCheckins.checkinDate, startDate)
                    )
                ),

            db.select({
                checkinStreak: avg(boxMemberships.checkinStreak),
                avgTotalCheckins: avg(boxMemberships.totalCheckins)
            })
                .from(boxMemberships)
                .where(
                    and(
                        eq(boxMemberships.boxId, boxId),
                        eq(boxMemberships.isActive, true)
                    )
                ),

            Promise.all([
                db.select({ count: count() })
                    .from(athletePrs)
                    .where(
                        and(
                            eq(athletePrs.boxId, boxId),
                            gte(athletePrs.achievedAt, startDate)
                        )
                    ),
                db.select({ count: count() })
                    .from(athleteBenchmarks)
                    .where(
                        and(
                            eq(athleteBenchmarks.boxId, boxId),
                            gte(athleteBenchmarks.achievedAt, startDate)
                        )
                    )
            ])
        ]);

        const [totalPrs, totalBenchmarks] = performanceMetrics;

        return {
            period,
            summary: {
                totalAthletes: totalAthletes[0].count,
                activeAthletes: activeAthletes[0].count,
                retentionRate: totalAthletes[0].count > 0
                    ? Math.round((activeAthletes[0].count / totalAthletes[0].count) * 100)
                    : 0,
                avgCheckinStreak: Math.round(Number(retentionMetrics[0].checkinStreak || 0)),
            },
            wellness: {
                avgEnergyLevel: Math.round(Number(avgWellness[0].avgEnergy || 0) * 10) / 10,
                avgStressLevel: Math.round(Number(avgWellness[0].avgStress || 0) * 10) / 10,
                avgWorkoutReadiness: Math.round(Number(avgWellness[0].avgReadiness || 0) * 10) / 10,
                totalCheckins: avgWellness[0].totalCheckins,
                checkinRate: totalAthletes[0].count > 0
                    ? Math.round((avgWellness[0].totalCheckins / (totalAthletes[0].count * days)) * 100)
                    : 0
            },
            performance: {
                totalPrs: totalPrs[0].count,
                totalBenchmarks: totalBenchmarks[0].count,
                avgPrsPerAthlete: activeAthletes[0].count > 0
                    ? Math.round((totalPrs[0].count / activeAthletes[0].count) * 10) / 10
                    : 0
            },
            generatedAt: new Date()
        };
    }

    /**
     * Get box analytics snapshots (pre-computed snapshots)
     */
    static async getBoxAnalyticsSnapshots(
        boxId: string,
        period: AnalyticsPeriod = "weekly",
        limit: number = 12
    ) {
        return db
            .select()
            .from(boxAnalytics)
            .where(and(
                eq(boxAnalytics.boxId, boxId),
                eq(boxAnalytics.period, period)
            ))
            .orderBy(desc(boxAnalytics.periodStart))
            .limit(limit);
    }

    /**
     * Get comprehensive box health dashboard - Using mv_box_health_dashboard
     */
    static async getBoxHealthDashboard(
        boxId: string,
        days: number = 30
    ): Promise<BoxHealthMetrics & { dateRange: { start: Date; end: Date } }> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get the latest dashboard data
        const dashboardData = await db
            .select()
            .from(mvBoxHealthDashboard)
            .where(and(
                eq(mvBoxHealthDashboard.boxId, boxId),
                gte(mvBoxHealthDashboard.periodStart, startDate)
            ))
            .orderBy(desc(mvBoxHealthDashboard.periodStart))
            .limit(1);

        if (!dashboardData[0]) {
            // Return empty metrics if no data found
            return {
                riskDistribution: [],
                alertStats: [],
                interventionStats: [],
                wellnessTrends: { avgEnergy: null, avgSleep: null, avgStress: null },
                attendanceTrends: { totalCheckins: 0, uniqueAthletes: 0 },
                performanceTrends: { totalPrs: 0, avgImprovement: null },
                dateRange: { start: startDate, end: new Date() }
            };
        }

        const data = dashboardData[0];

        return {
            riskDistribution: [], // Would be populated from separate query
            alertStats: [], // Would be populated from separate query
            interventionStats: [], // Would be populated from separate query
            wellnessTrends: {
                avgEnergy: data.avgEnergy ? parseFloat(data.avgEnergy) : null,
                avgSleep: data.avgSleep ? parseFloat(data.avgSleep) : null,
                avgStress: data.avgStress ? parseFloat(data.avgStress) : null,
            },
            attendanceTrends: {
                totalCheckins: data.totalCheckins || 0,
                uniqueAthletes: data.uniqueAthletes || 0,
            },
            performanceTrends: {
                totalPrs: data.totalPrs || 0,
                avgImprovement: data.avgImprovement ? parseFloat(data.avgImprovement) : null,
            },
            dateRange: {
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Get basic box statistics (simple query - no view needed)
     */
    static async getBasicBoxStatistics(boxId: string): Promise<BasicBoxStats> {
        const stats = await db
            .select({
                activeAthletes: sql<number>`
                    COUNT(CASE 
                        WHEN ${boxMemberships.role} = 'athlete' 
                        AND ${boxMemberships.isActive} = true 
                        THEN 1 
                    END)`
                ,
                activeCoaches: sql<number>`
                    COUNT(CASE 
                        WHEN ${boxMemberships.role} IN ('head_coach', 'coach') 
                        AND ${boxMemberships.isActive} = true 
                        THEN 1 
                    END)`
                ,
                newMembers30d: sql<number>`
                    COUNT(CASE 
                        WHEN ${boxMemberships.joinedAt} >= NOW() - INTERVAL '30 days' 
                        THEN 1 
                    END)`
                ,
                avgCheckinStreak: sql<number>`
                    COALESCE(AVG(
                        CASE 
                            WHEN ${boxMemberships.role} = 'athlete'
                    THEN ${boxMemberships.checkinStreak}
                    END
                    ), 0)`
            })
            .from(boxMemberships)
            .where(eq(boxMemberships.boxId, boxId));

        return {
            activeAthletes: stats[0]?.activeAthletes || 0,
            activeCoaches: stats[0]?.activeCoaches || 0,
            newMembers30d: stats[0]?.newMembers30d || 0,
            avgCheckinStreak: stats[0]?.avgCheckinStreak || 0
        };
    }

    /**
     * Get box coaches information
     */
    static async getBoxCoaches(boxId: string) {
        return db
            .select({
                membership: boxMemberships,
                user: user,
                profile: userProfiles,
            })
            .from(boxMemberships)
            .innerJoin(user, eq(boxMemberships.userId, user.id))
            .leftJoin(userProfiles, eq(user.id, userProfiles.userId))
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                inArray(boxMemberships.role, ['head_coach', 'coach'])
            ));
    }

    /**
     * Get billing analytics and insights
     */
    static async getBillingAnalytics(boxId: string, timeframe: "30d" | "90d" | "12m" = "30d") {
        const endDate = new Date();
        const startDate = new Date();

        switch (timeframe) {
            case "30d":
                startDate.setDate(endDate.getDate() - 30);
                break;
            case "90d":
                startDate.setDate(endDate.getDate() - 90);
                break;
            case "12m":
                startDate.setFullYear(endDate.getFullYear() - 1);
                break;
        }

        const [totalSpentResult, orderCountResult, averageOrderResult] = await Promise.all([
            db
                .select({ total: sum(orders.amount) })
                .from(orders)
                .where(and(
                    eq(orders.boxId, boxId),
                    eq(orders.status, "paid"),
                    gte(orders.createdAt, startDate),
                    lte(orders.createdAt, endDate)
                )),
            db
                .select({ count: count() })
                .from(orders)
                .where(and(
                    eq(orders.boxId, boxId),
                    eq(orders.status, "paid"),
                    gte(orders.createdAt, startDate),
                    lte(orders.createdAt, endDate)
                )),
            db
                .select({ average: sql<number>`AVG(${orders.amount})` })
                .from(orders)
                .where(and(
                    eq(orders.boxId, boxId),
                    eq(orders.status, "paid"),
                    gte(orders.createdAt, startDate),
                    lte(orders.createdAt, endDate)
                ))
        ]);

        const totalSpent = totalSpentResult[0]?.total ?? 0;
        const orderCount = orderCountResult[0]?.count ?? 0;
        const averageOrder = averageOrderResult[0]?.average ?? 0;

        return {
            timeframe,
            period: { start: startDate, end: endDate },
            summary: {
                totalSpent,
                totalSpentFormatted: `$${(Number(totalSpent) / 100).toFixed(2)}`,
                orderCount,
                averageOrderValue: Math.round(Number(averageOrder)),
                averageOrderValueFormatted: `$${(Number(averageOrder) / 100).toFixed(2)}`
            }
        };
    }

    /**
     * Enhanced billing history with comprehensive filtering
     */
    static async getBillingHistory(
        boxId: string,
        options: {
            limit?: number;
            offset?: number;
            orderType?: string;
            status?: string;
            dateRange?: { start: Date; end: Date };
        } = {}
    ): Promise<BillingHistory> {
        const { limit = 20, offset = 0, orderType, status, dateRange } = options;

        // Build where conditions
        let whereConditions = [eq(orders.boxId, boxId)];

        if (orderType) {
            whereConditions.push(eq(orders.orderType, orderType));
        }

        if (status) {
            whereConditions.push(eq(orders.status, status));
        }

        if (dateRange) {
            whereConditions.push(
                gte(orders.createdAt, dateRange.start),
                lte(orders.createdAt, dateRange.end)
            );
        }

        const [ordersData, totalCountResult] = await Promise.all([
            db.query.orders.findMany({
                where: and(...whereConditions),
                orderBy: desc(orders.createdAt),
                limit,
                offset,
                with: {
                    subscription: {
                        with: {
                            plan: true
                        }
                    },
                    customerProfile: true,
                },
            }),
            db
                .select({ count: count() })
                .from(orders)
                .where(and(...whereConditions))
        ]);

        const totalCount = totalCountResult[0]?.count ?? 0;

        // Enhanced financial calculations
        const paidOrders = ordersData.filter(order => order.status === "paid");
        const totalSpent = paidOrders.reduce((sum, order) => sum + (order.amount ?? 0), 0);
        const totalRefunded = ordersData
            .filter(order => order.refundedAmount && order.refundedAmount > 0)
            .reduce((sum, order) => sum + (order.refundedAmount ?? 0), 0);

        // Monthly spend calculation
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const monthlySpend = ordersData
            .filter(order => {
                const orderDate = new Date(order.createdAt);
                return orderDate >= thirtyDaysAgo && order.status === "paid";
            })
            .reduce((sum, order) => sum + (order.amount ?? 0), 0);

        // Category breakdown
        const categoryBreakdown = ordersData.reduce((acc, order) => {
            const type = order.orderType || "unknown";
            if (!acc[type]) {
                acc[type] = { count: 0, amount: 0 };
            }
            acc[type].count++;
            if (order.status === "paid") {
                acc[type].amount += order.amount ?? 0;
            }
            return acc;
        }, {} as Record<string, { count: number; amount: number }>);

        return {
            orders: ordersData.map(order => ({
                ...order,
                amountFormatted: `${((order.amount ?? 0) / 100).toFixed(2)}`,
                refundedAmountFormatted: order.refundedAmount
                    ? `${(order.refundedAmount / 100).toFixed(2)}`
                    : null,
            })),
            pagination: {
                total: totalCount,
                limit,
                offset,
                hasMore: (offset + limit) < totalCount,
                page: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit)
            },
            summary: {
                totalSpent,
                totalSpentFormatted: `${(totalSpent / 100).toFixed(2)}`,
                totalRefunded,
                totalRefundedFormatted: `${(totalRefunded / 100).toFixed(2)}`,
                monthlySpend,
                monthlySpendFormatted: `${(monthlySpend / 100).toFixed(2)}`,
                averageOrderValue: paidOrders.length > 0
                    ? Math.round(totalSpent / paidOrders.length)
                    : 0,
                categoryBreakdown
            },
        };
    }

    /**
     * Get analytics trends over time
     */
    static async getAnalyticsTrends(
        boxId: string,
        options: {
            period?: 'daily' | 'weekly' | 'monthly';
            days?: number;
            metrics?: Array<'checkins' | 'prs' | 'attendance' | 'wellness'>;
        } = {}
    ) {
        const { period = 'weekly', days = 90, metrics = ['checkins', 'prs', 'wellness'] } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        let dateGrouping: string;
        switch (period) {
            case 'daily':
                dateGrouping = `DATE(created_at)`;
                break;
            case 'weekly':
                dateGrouping = `DATE_TRUNC('week', created_at)`;
                break;
            case 'monthly':
                dateGrouping = `DATE_TRUNC('month', created_at)`;
                break;
        }

        const trends: any = {};

        if (metrics.includes('checkins')) {
            trends.checkins = await db
                .select({
                    period: sql<Date>`${sql.raw(dateGrouping.replace('created_at', `${athleteWellnessCheckins.checkinDate}`))}`,
                    count: count()
                })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                ))
                .groupBy(sql.raw(dateGrouping.replace('created_at', `${athleteWellnessCheckins.checkinDate}`)))
                .orderBy(sql.raw(dateGrouping.replace('created_at', `${athleteWellnessCheckins.checkinDate}`)));
        }

        if (metrics.includes('prs')) {
            trends.prs = await db
                .select({
                    period: sql<Date>`${sql.raw(dateGrouping.replace('created_at', `${athletePrs.achievedAt}`))}`,
                    count: count()
                })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, startDate)
                ))
                .groupBy(sql.raw(dateGrouping.replace('created_at', `${athletePrs.achievedAt}`)))
                .orderBy(sql.raw(dateGrouping.replace('created_at', `${athletePrs.achievedAt}`)));
        }

        if (metrics.includes('wellness')) {
            trends.wellness = await db
                .select({
                    period: sql<Date>`${sql.raw(dateGrouping.replace('created_at', `${athleteWellnessCheckins.checkinDate}`))}`,
                    avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                    avgStress: avg(athleteWellnessCheckins.stressLevel),
                    avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
                })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                ))
                .groupBy(sql.raw(dateGrouping.replace('created_at', `${athleteWellnessCheckins.checkinDate}`)))
                .orderBy(sql.raw(dateGrouping.replace('created_at', `${athleteWellnessCheckins.checkinDate}`)));
        }

        return trends;
    }
}
