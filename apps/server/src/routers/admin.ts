// routers/admin.ts
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/permissions";
import { db } from "@/db";
import {boxes, boxMemberships, user, subscriptions, subscriptionPlans} from "@/db/schema";
import {desc, count, eq, gte, sql, and, lte, or} from "drizzle-orm";

export const adminRouter = router({
    getPlatformStats: protectedProcedure
        .query(async ({ ctx }) => {
            await requirePlatformAdmin(ctx);

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const [
                totalBoxes,
                activeBoxes,
                totalUsers,
                recentSignups,
                totalMemberships,
                activeMemberships
            ] = await Promise.all([
                db.select({ count: count() }).from(boxes),
                db.select({ count: count() })
                    .from(boxes)
                    .where(eq(boxes.status, "active")),
                db.select({ count: count() }).from(user),
                db.select({ count: count() })
                    .from(user)
                    .where(gte(user.createdAt, thirtyDaysAgo)),
                db.select({ count: count() }).from(boxMemberships),
                db.select({ count: count() })
                    .from(boxMemberships)
                    .where(eq(boxMemberships.isActive, true))
            ]);

            return {
                boxes: {
                    total: totalBoxes[0].count,
                    active: activeBoxes[0].count,
                },
                users: {
                    total: totalUsers[0].count,
                    recentSignups: recentSignups[0].count,
                },
                memberships: {
                    total: totalMemberships[0].count,
                    active: activeMemberships[0].count,
                }
            };
        }),

    // Get all boxes (platform admin only)
    getAllBoxes: protectedProcedure
        .input(z.object({
            limit: z.number().min(1).max(100).default(20),
            offset: z.number().min(0).default(0),
            status: z.enum(["active", "suspended", "trial_expired"]).optional(),
        }))
        .query(async ({ ctx, input }) => {
            await requirePlatformAdmin(ctx);

            const whereConditions = input.status ? eq(boxes.status, input.status) : undefined;

            const boxesData = await db
                .select()
                .from(boxes)
                .where(whereConditions)
                .orderBy(desc(boxes.createdAt))
                .limit(input.limit)
                .offset(input.offset);

            const totalCount = await db
                .select({ count: count() })
                .from(boxes)
                .where(whereConditions);

            return {
                boxes: boxesData,
                pagination: {
                    total: totalCount[0].count,
                    limit: input.limit,
                    offset: input.offset,
                    hasMore: (input.offset + input.limit) < totalCount[0].count,
                }
            };
        }),

    // Suspend/unsuspend box (platform admin only)
    updateBoxStatus: protectedProcedure
        .input(z.object({
            boxId: z.string(),
            status: z.enum(["active", "suspended", "trial_expired"]),
            reason: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await requirePlatformAdmin(ctx);

            const [updatedBox] = await db
                .update(boxes)
                .set({
                    status: input.status,
                    updatedAt: new Date(),
                })
                .where(eq(boxes.id, input.boxId))
                .returning();

            return updatedBox;
        }),

    getPlatformRetentionAnalytics: protectedProcedure
        .input(z.object({
            timeframe: z.enum(["7d", "30d", "90d", "365d"]).default("30d"),
        }))
        .query(async ({ ctx, input }) => {
            await requirePlatformAdmin(ctx);

            const endDate = new Date();
            const startDate = new Date();

            switch (input.timeframe) {
                case "7d":
                    startDate.setDate(endDate.getDate() - 7);
                    break;
                case "30d":
                    startDate.setDate(endDate.getDate() - 30);
                    break;
                case "90d":
                    startDate.setDate(endDate.getDate() - 90);
                    break;
                case "365d":
                    startDate.setDate(endDate.getDate() - 365);
                    break;
            }

            // Get churn data across all boxes
            const churnedAthletes = await db
                .select({
                    count: count()
                })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.isActive, false),
                    gte(boxMemberships.leftAt, startDate),
                    lte(boxMemberships.leftAt, endDate)
                ));

            // Get new athletes across all boxes
            const newAthletes = await db
                .select({
                    count: count()
                })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.isActive, true),
                    gte(boxMemberships.joinedAt, startDate),
                    lte(boxMemberships.joinedAt, endDate)
                ));

            // Get total active athletes across all boxes
            const activeAthletes = await db
                .select({
                    count: count()
                })
                .from(boxMemberships)
                .where(eq(boxMemberships.isActive, true));

            // Calculate retention rate
            const retentionRate = activeAthletes[0].count > 0
                ? (1 - (churnedAthletes[0].count / activeAthletes[0].count)) * 100
                : 0;

            return {
                churned: churnedAthletes[0].count,
                new: newAthletes[0].count,
                active: activeAthletes[0].count,
                retentionRate: Math.round(retentionRate * 100) / 100,
                timeframe: input.timeframe,
                period: {
                    start: startDate,
                    end: endDate
                }
            };
        }),

    // Get subscription revenue analytics
    getRevenueAnalytics: protectedProcedure
        .input(z.object({
            timeframe: z.enum(["month", "quarter", "year"]).default("month"),
        }))
        .query(async ({ ctx, input }) => {
            await requirePlatformAdmin(ctx);

            const endDate = new Date();
            const startDate = new Date();

            switch (input.timeframe) {
                case "month":
                    startDate.setMonth(endDate.getMonth() - 1);
                    break;
                case "quarter":
                    startDate.setMonth(endDate.getMonth() - 3);
                    break;
                case "year":
                    startDate.setFullYear(endDate.getFullYear() - 1);
                    break;
            }

            // Get active subscriptions with their plans
            const activeSubscriptions = await db
                .select()
                .from(subscriptions)
                .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
                .where(and(
                    eq(subscriptions.status, "active"),
                    gte(subscriptions.createdAt, startDate),
                    lte(subscriptions.createdAt, endDate)
                ));

            // Calculate MRR (Monthly Recurring Revenue)
            const mrr = activeSubscriptions.reduce((total, { subscriptions: sub, subscriptionPlans: plan }) => {
                const amount = sub.interval === "year" ? plan.annualPrice / 12 : plan.monthlyPrice;
                return total + amount;
            }, 0);

            // Count subscriptions by tier
            const tierCounts = activeSubscriptions.reduce((acc, { subscriptionPlans: plan }) => {
                acc[plan.tier] = (acc[plan.tier] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            // Get revenue by month for charting
            const revenueByMonth = await db
                .select({
                    month: sql<string>`TO_CHAR(${subscriptions.createdAt}, 'YYYY-MM')`,
                    revenue: sql<number>`SUM(CASE 
                        WHEN ${subscriptions.interval} = 'year' THEN ${subscriptionPlans.annualPrice} / 12 
                        ELSE ${subscriptionPlans.monthlyPrice} 
                    END)`
                })
                .from(subscriptions)
                .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
                .where(and(
                    eq(subscriptions.status, "active"),
                    gte(subscriptions.createdAt, startDate),
                    lte(subscriptions.createdAt, endDate)
                ))
                .groupBy(sql`TO_CHAR(${subscriptions.createdAt}, 'YYYY-MM')`)
                .orderBy(sql`TO_CHAR(${subscriptions.createdAt}, 'YYYY-MM')`);

            return {
                mrr: Math.round(mrr / 100), // Convert from cents to dollars
                totalSubscriptions: activeSubscriptions.length,
                tierCounts,
                revenueByMonth: revenueByMonth.map(item => ({
                    month: item.month,
                    revenue: Math.round((item.revenue || 0) / 100) // Convert from cents to dollars
                })),
                timeframe: input.timeframe,
                period: {
                    start: startDate,
                    end: endDate
                }
            };
        }),

    // Get platform-wide health metrics
    getPlatformHealthMetrics: protectedProcedure
        .query(async ({ ctx }) => {
            await requirePlatformAdmin(ctx);

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // Get boxes with subscription issues
            const boxesWithIssues = await db
                .select()
                .from(boxes)
                .where(or(
                    and(
                        eq(boxes.subscriptionStatus, "trial"),
                        lte(boxes.trialEndsAt, new Date())
                    ),
                    and(
                        eq(boxes.subscriptionStatus, "active"),
                        lte(boxes.subscriptionEndsAt, new Date())
                    ),
                    eq(boxes.status, "suspended")
                ));

            // Get boxes with high risk athletes
            const boxesWithHighRisk = await db
                .select({
                    boxId: boxes.id,
                    boxName: boxes.name,
                    highRiskCount: count()
                })
                .from(boxes)
                .innerJoin(boxMemberships, eq(boxes.id, boxMemberships.boxId))
                .where(and(
                    eq(boxMemberships.isActive, true),
                    eq(boxMemberships.role, "athlete")
                ))
                .groupBy(boxes.id, boxes.name)
                .having(sql`COUNT(*) > 5`); // Arbitrary threshold for demonstration

            // Get recent platform activity
            const recentSignups = await db
                .select({ count: count() })
                .from(boxes)
                .where(gte(boxes.createdAt, thirtyDaysAgo));

            return {
                boxesWithIssues: boxesWithIssues.length,
                boxesWithHighRisk: boxesWithHighRisk.length,
                recentSignups: recentSignups[0].count,
                totalBoxes: (await db.select({ count: count() }).from(boxes))[0].count,
                totalActiveBoxes: (await db.select({ count: count() }).from(boxes).where(eq(boxes.status, "active")))[0].count,
                timestamp: new Date().toISOString()
            };
        }),

    refreshAllAnalyticsViews: protectedProcedure
        .mutation(async ({ ctx }) => {
            await requirePlatformAdmin(ctx);

            try {
                // Refresh ALL materialized views across ALL boxes
                await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_box_health_dashboard`);
                await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_athlete_engagement_scores`);
                await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_coach_performance`);
                await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_retention`);
                await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_athlete_progress`);
                await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_wellness_trends`);

                return {
                    success: true,
                    message: "All platform analytics views refreshed successfully"
                };
            } catch (error) {
                console.error("Failed to refresh platform analytics views", error);
                throw new Error("Failed to refresh platform analytics views");
            }
        }),
});