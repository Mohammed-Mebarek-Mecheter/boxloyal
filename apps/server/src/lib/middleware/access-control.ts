// lib/middleware/access-control.ts - Hono-based access control
import type {Context, Next} from 'hono';
import { db } from "@/db";
import { boxes, subscriptions, gracePeriods } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";

export interface AccessCheckResult {
    hasAccess: boolean;
    reason?: string;
    gracePeriod?: any;
    subscription?: any;
    box?: any;
    upgradeRequired?: boolean;
    billingIssue?: boolean;
}

export class AccessControlService {
    /**
     * Check if a box has active access to the platform
     */
    static async checkBoxAccess(boxId: string): Promise<AccessCheckResult> {
        try {
            const box = await db.query.boxes.findFirst({
                where: eq(boxes.id, boxId)
            });

            if (!box) {
                return { hasAccess: false, reason: "Box not found" };
            }

            // Check for active grace periods
            const activeGracePeriod = await db.query.gracePeriods.findFirst({
                where: and(
                    eq(gracePeriods.boxId, boxId),
                    eq(gracePeriods.resolved, false),
                    gte(gracePeriods.endsAt, new Date())
                ),
                orderBy: gracePeriods.endsAt
            });

            // Get active subscription
            const activeSubscription = await db.query.subscriptions.findFirst({
                where: and(
                    eq(subscriptions.boxId, boxId),
                    eq(subscriptions.status, "active")
                ),
                with: { plan: true }
            });

            // Simple access decision logic
            let hasAccess = false;
            let reason: string | undefined;
            let upgradeRequired = false;
            let billingIssue = false;

            switch (box.status) {
                case 'active':
                    hasAccess = !!activeSubscription;
                    if (!hasAccess) {
                        reason = "No active subscription";
                        upgradeRequired = true;
                    }
                    break;

                case 'suspended':
                    hasAccess = !!activeGracePeriod;
                    billingIssue = true;
                    if (!hasAccess) {
                        reason = "Subscription suspended";
                    }
                    break;

                case 'trial_expired':
                    hasAccess = !!activeGracePeriod;
                    upgradeRequired = true;
                    if (!hasAccess) {
                        reason = "Trial expired";
                    }
                    break;

                default:
                    hasAccess = false;
                    reason = `Unknown box status: ${box.status}`;
            }

            return {
                hasAccess,
                reason,
                box,
                subscription: activeSubscription,
                gracePeriod: activeGracePeriod,
                upgradeRequired,
                billingIssue
            };

        } catch (error) {
            console.error("Error checking box access:", error);
            return { hasAccess: false, reason: "Access check failed" };
        }
    }

    /**
     * Check if specific features are available
     */
    static async checkFeatureAccess(
        boxId: string,
        feature: 'add_athlete' | 'add_coach' | 'advanced_analytics' | 'api_access'
    ): Promise<AccessCheckResult> {
        const accessCheck = await this.checkBoxAccess(boxId);

        if (!accessCheck.hasAccess) {
            return accessCheck;
        }

        const box = accessCheck.box;
        const plan = accessCheck.subscription?.plan;

        switch (feature) {
            case 'add_athlete':
                const canAddAthlete = box.currentAthleteCount < (plan?.athleteLimit || box.currentAthleteLimit) ||
                    box.isOverageEnabled;
                return {
                    hasAccess: canAddAthlete,
                    reason: canAddAthlete ? undefined : "Athlete limit reached",
                    upgradeRequired: !canAddAthlete && !box.isOverageEnabled
                };

            case 'add_coach':
                const canAddCoach = box.currentCoachCount < (plan?.coachLimit || box.currentCoachLimit) ||
                    box.isOverageEnabled;
                return {
                    hasAccess: canAddCoach,
                    reason: canAddCoach ? undefined : "Coach limit reached",
                    upgradeRequired: !canAddCoach && !box.isOverageEnabled
                };

            case 'advanced_analytics':
                const hasAdvancedAnalytics = plan?.tier === 'scale' || plan?.tier === 'grow';
                return {
                    hasAccess: hasAdvancedAnalytics,
                    reason: hasAdvancedAnalytics ? undefined : "Requires Grow or Scale plan",
                    upgradeRequired: !hasAdvancedAnalytics
                };

            case 'api_access':
                const hasApiAccess = plan?.tier === 'scale';
                return {
                    hasAccess: hasApiAccess,
                    reason: hasApiAccess ? undefined : "Requires Scale plan",
                    upgradeRequired: !hasApiAccess
                };

            default:
                return { hasAccess: true };
        }
    }
}

/**
 * Hono middleware for access control
 */
export const requireAccess = (options: {
    requireActiveSubscription?: boolean;
    allowGracePeriod?: boolean;
} = {}) => {
    return async (c: Context, next: Next) => {
        const { requireActiveSubscription = true, allowGracePeriod = true } = options;

        try {
            // Get boxId from context (assuming it's set by auth middleware)
            const boxId = c.get('boxId');

            if (!boxId) {
                return c.json({ error: 'Box ID required' }, 400);
            }

            const accessCheck = await AccessControlService.checkBoxAccess(boxId);

            if (!accessCheck.hasAccess) {
                return c.json({
                    error: 'Access denied',
                    reason: accessCheck.reason,
                    upgradeRequired: accessCheck.upgradeRequired,
                    billingIssue: accessCheck.billingIssue
                }, 403);
            }

            if (requireActiveSubscription && !accessCheck.subscription) {
                return c.json({
                    error: 'Active subscription required',
                    upgradeRequired: true
                }, 402);
            }

            if (!allowGracePeriod && accessCheck.gracePeriod) {
                return c.json({
                    error: 'Billing issue must be resolved',
                    billingIssue: true
                }, 402);
            }

            // Set access context for the request
            c.set('accessCheck', accessCheck);
            c.set('hasGracePeriod', !!accessCheck.gracePeriod);

            await next();
        } catch (error) {
            console.error("Error in access control middleware:", error);
            return c.json({ error: 'Access check failed' }, 500);
        }
    };
};

/**
 * Feature-specific access middleware
 */
export const requireFeatureAccess = (feature: 'add_athlete' | 'add_coach' | 'advanced_analytics' | 'api_access') => {
    return async (c: Context, next: Next) => {
        try {
            const boxId = c.get('boxId');

            if (!boxId) {
                return c.json({ error: 'Box ID required' }, 400);
            }

            const featureCheck = await AccessControlService.checkFeatureAccess(boxId, feature);

            if (!featureCheck.hasAccess) {
                return c.json({
                    error: `Feature access denied: ${feature}`,
                    reason: featureCheck.reason,
                    upgradeRequired: featureCheck.upgradeRequired
                }, 403);
            }

            c.set('featureAccess', featureCheck);
            await next();
        } catch (error) {
            console.error(`Error checking feature access for ${feature}:`, error);
            return c.json({ error: 'Feature access check failed' }, 500);
        }
    };
};
