// lib/services/billing/billing-dashboard-service.ts
import { db } from "@/db";
import {
    boxes,
    subscriptions,
    subscriptionPlans,
    orders,
    usageEvents,
    subscriptionChanges,
    gracePeriods,
    planChangeRequests
} from "@/db/schema";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";
import { UsageTrackingService } from "./usage-tracking-service";
import { OverageBillingService } from "./overage-billing-service";
import type { SubscriptionUsage } from "./types";

export interface BillingDashboard {
    subscription: any;
    usage: SubscriptionUsage;
    upcomingBilling: {
        nextBillingDate?: Date;
        estimatedAmount: number;
        baseAmount: number;
        overageAmount: number;
        daysUntilBilling: number;
    };
    recentActivity: any[];
    gracePeriods: any[];
    planChangeRequests: any[];
}

export interface RetentionMetrics {
    churned: number;
    new: number;
    active: number;
    retentionRate: number;
    timeframe: string;
    period: {
        start: Date;
        end: Date;
    };
}

export class BillingDashboardService {
    /**
     * Get comprehensive billing dashboard data for a box
     */
    static async getBillingDashboard(boxId: string): Promise<BillingDashboard> {
        const box = await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
        });

        if (!box) {
            throw new Error("Box not found");
        }

        // Get active subscription with all related data
        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            ),
            with: {
                customerProfile: true,
                plan: true,
                orders: {
                    limit: 3,
                    orderBy: desc(orders.createdAt)
                },
                changes: {
                    limit: 5,
                    orderBy: desc(subscriptionChanges.createdAt)
                }
            },
            orderBy: desc(subscriptions.createdAt),
        });

        // Get current plan (fallback to tier-based lookup)
        const currentPlan = activeSubscription?.plan || await db.query.subscriptionPlans.findFirst({
            where: and(
                eq(subscriptionPlans.tier, box.subscriptionTier),
                eq(subscriptionPlans.isCurrentVersion, true)
            ),
        });

        // Calculate usage
        const usage = await UsageTrackingService.calculateUsage(boxId, currentPlan, box);

        // Get active grace periods
        const activeGracePeriods = await db.query.gracePeriods.findMany({
            where: and(
                eq(gracePeriods.boxId, boxId),
                eq(gracePeriods.resolved, false),
                gte(gracePeriods.endsAt, new Date())
            ),
            orderBy: desc(gracePeriods.createdAt)
        });

        // Get pending plan change requests
        const pendingPlanChanges = await db.query.planChangeRequests.findMany({
            where: and(
                eq(planChangeRequests.boxId, boxId),
                eq(planChangeRequests.status, "pending")
            ),
            with: {
                fromPlan: true,
                toPlan: true
            },
            orderBy: desc(planChangeRequests.createdAt)
        });

        // Get recent billing activity
        const recentActivity = await this.getRecentBillingActivity(boxId, 10);

        // Calculate upcoming billing
        const upcomingBilling = await this.calculateUpcomingBilling(boxId, usage, activeSubscription);

        return {
            subscription: activeSubscription,
            usage,
            upcomingBilling,
            recentActivity,
            gracePeriods: activeGracePeriods,
            planChangeRequests: pendingPlanChanges
        };
    }

    /**
     * Get recent billing activity
     */
    static async getRecentBillingActivity(boxId: string, limit: number = 10) {
        // Fetch different types of activity
        const [ordersResult, usageEventsList, subscriptionChangesList] = await Promise.all([
            db.query.orders.findMany({
                where: eq(orders.boxId, boxId),
                orderBy: desc(orders.createdAt),
                limit: Math.floor(limit / 3),
                with: {
                    subscription: true,
                    customerProfile: true,
                }
            }),
            db.query.usageEvents.findMany({
                where: and(
                    eq(usageEvents.boxId, boxId),
                    eq(usageEvents.billable, true)
                ),
                orderBy: desc(usageEvents.createdAt),
                limit: Math.floor(limit / 3),
            }),
            db.query.subscriptionChanges.findMany({
                where: eq(subscriptionChanges.boxId, boxId),
                orderBy: desc(subscriptionChanges.createdAt),
                limit: Math.floor(limit / 3),
                with: {
                    fromPlan: true,
                    toPlan: true
                }
            })
        ]);

        // Combine and format activities
        const activities = [
            ...ordersResult.map(order => ({
                type: 'order' as const,
                id: order.id,
                timestamp: order.createdAt,
                description: `${order.orderType} - ${order.status}`,
                amount: order.amount,
                data: order
            })),
            ...usageEventsList.map(event => ({
                type: 'usage' as const,
                id: event.id,
                timestamp: event.createdAt,
                description: `${event.eventType} x${event.quantity}`,
                amount: null,
                data: event
            })),
            ...subscriptionChangesList.map(change => ({
                type: 'subscription_change' as const,
                id: change.id,
                timestamp: change.createdAt,
                description: `${change.changeType}${change.fromPlan ? ` from ${change.fromPlan.name}` : ''}${change.toPlan ? ` to ${change.toPlan.name}` : ''}`,
                amount: change.proratedAmount,
                data: change
            }))
        ];

        return activities
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit);
    }

    /**
     * Calculate upcoming billing information
     */
    static async calculateUpcomingBilling(
        boxId: string,
        usage: SubscriptionUsage,
        subscription?: any
    ) {
        const nextBillingDate = usage.nextBillingDate || subscription?.currentPeriodEnd;
        const daysUntilBilling = nextBillingDate
            ? Math.ceil((new Date(nextBillingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : 0;

        const baseAmount = subscription?.amount ?? 0;
        const overageAmount = usage.hasOverageEnabled ? usage.estimatedOverageAmount : 0;

        return {
            nextBillingDate,
            estimatedAmount: baseAmount + overageAmount,
            baseAmount,
            overageAmount,
            daysUntilBilling: Math.max(0, daysUntilBilling)
        };
    }

    /**
     * Get retention analytics for a box
     */
    static async getRetentionAnalytics(
        boxId: string,
        timeframe: "7d" | "30d" | "90d" | "365d" = "30d"
    ): Promise<RetentionMetrics> {
        const endDate = new Date();
        const startDate = new Date();

        switch (timeframe) {
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

        // Import boxMemberships here to avoid circular dependency
        const { boxMemberships } = await import("@/db/schema");

        const [churnedAthletes, newAthletes, activeAthletes] = await Promise.all([
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, false),
                    gte(boxMemberships.leftAt, startDate),
                    lte(boxMemberships.leftAt, endDate)
                )),
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    gte(boxMemberships.joinedAt, startDate),
                    lte(boxMemberships.joinedAt, endDate)
                )),
            db
                .select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                ))
        ]);

        const totalActive = activeAthletes[0].count;
        const totalChurned = churnedAthletes[0].count;
        const retentionRate = totalActive > 0
            ? ((totalActive - totalChurned) / totalActive) * 100
            : 0;

        return {
            churned: totalChurned,
            new: newAthletes[0].count,
            active: totalActive,
            retentionRate: Math.round(retentionRate * 100) / 100,
            timeframe,
            period: {
                start: startDate,
                end: endDate
            }
        };
    }

    /**
     * Get billing summary for a specific period
     */
    static async getBillingSummary(
        boxId: string,
        startDate: Date,
        endDate: Date
    ) {
        const [ordersInPeriod, usageEventsInPeriod, subscriptionChangesInPeriod] = await Promise.all([
            db.query.orders.findMany({
                where: and(
                    eq(orders.boxId, boxId),
                    gte(orders.createdAt, startDate),
                    lte(orders.createdAt, endDate)
                ),
                orderBy: desc(orders.createdAt)
            }),
            db.query.usageEvents.findMany({
                where: and(
                    eq(usageEvents.boxId, boxId),
                    eq(usageEvents.billable, true),
                    gte(usageEvents.createdAt, startDate),
                    lte(usageEvents.createdAt, endDate)
                ),
                orderBy: desc(usageEvents.createdAt)
            }),
            db.query.subscriptionChanges.findMany({
                where: and(
                    eq(subscriptionChanges.boxId, boxId),
                    gte(subscriptionChanges.createdAt, startDate),
                    lte(subscriptionChanges.createdAt, endDate)
                ),
                with: {
                    fromPlan: true,
                    toPlan: true
                },
                orderBy: desc(subscriptionChanges.createdAt)
            })
        ]);

        // Calculate totals
        const totalRevenue = ordersInPeriod
            .filter(order => order.status === 'paid')
            .reduce((sum, order) => sum + (order.amount || 0), 0);

        const totalOverageCharges = ordersInPeriod
            .filter(order => order.orderType === 'overage' && order.status === 'paid')
            .reduce((sum, order) => sum + (order.amount || 0), 0);

        const subscriptionRevenue = totalRevenue - totalOverageCharges;

        // Get overage billing summary
        const overageSummary = await OverageBillingService.getOverageBillingSummary(
            boxId,
            startDate,
            endDate
        );

        return {
            period: { startDate, endDate },
            revenue: {
                total: totalRevenue,
                subscription: subscriptionRevenue,
                overage: totalOverageCharges,
                formatted: {
                    total: `$${(totalRevenue / 100).toFixed(2)}`,
                    subscription: `$${(subscriptionRevenue / 100).toFixed(2)}`,
                    overage: `$${(totalOverageCharges / 100).toFixed(2)}`
                }
            },
            orders: ordersInPeriod.length,
            usageEvents: usageEventsInPeriod.length,
            subscriptionChanges: subscriptionChangesInPeriod.length,
            overageSummary
        };
    }

    /**
     * Get upcoming billing events
     */
    static async getUpcomingBillingEvents(daysAhead: number = 30) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysAhead);

        // Get subscriptions with upcoming billing dates
        const upcomingBilling = await db.query.subscriptions.findMany({
            where: and(
                eq(subscriptions.status, "active"),
                gte(subscriptions.currentPeriodEnd, new Date()),
                lte(subscriptions.currentPeriodEnd, futureDate)
            ),
            with: {
                box: {
                    columns: {
                        id: true,
                        name: true,
                        email: true,
                        isOverageEnabled: true
                    }
                },
                plan: true
            },
            orderBy: desc(subscriptions.currentPeriodEnd)
        });

        return upcomingBilling.map(subscription => ({
            boxId: subscription.boxId,
            boxName: subscription.box?.name,
            subscriptionId: subscription.id,
            billingDate: subscription.currentPeriodEnd,
            daysUntilBilling: Math.ceil((new Date(subscription.currentPeriodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
            baseAmount: subscription.amount,
            planName: subscription.plan?.name,
            hasOverageEnabled: subscription.box?.isOverageEnabled || false
        }));
    }
}