// lib/services/billing/plan-change-service.ts
import { db } from "@/db";
import {
    subscriptions,
    subscriptionPlans,
    planChangeRequests,
    subscriptionChanges,
    boxes
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { PlanChangeType } from "./types";
// Import the BillingNotificationService
import {BillingNotificationService} from "@/lib/services/notifications/billing";

export class PlanChangeService {
    // Instantiate the BillingNotificationService
    private static billingNotificationService = new BillingNotificationService();

    /**
     * Request a plan change
     */
    static async requestPlanChange(
        boxId: string,
        toPlanId: string,
        options: {
            requestedByUserId: string;
            effectiveDate?: Date;
            prorationType?: "immediate" | "next_billing_cycle" | "end_of_period";
            metadata?: Record<string, any>;
        }
    ) {
        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            ),
            with: { plan: true }
        });

        if (!activeSubscription) {
            throw new Error("No active subscription found");
        }

        const toPlan = await db.query.subscriptionPlans.findFirst({
            where: eq(subscriptionPlans.id, toPlanId)
        });

        if (!toPlan) {
            throw new Error("Target plan not found");
        }

        // Determine change type
        const changeType = this.determineChangeType(
            activeSubscription.plan!.monthlyPrice,
            toPlan.monthlyPrice
        );

        // Create plan change request
        const [planChangeRequest] = await db
            .insert(planChangeRequests)
            .values({
                boxId,
                subscriptionId: activeSubscription.id,
                fromPlanId: activeSubscription.planId,
                toPlanId,
                changeType,
                requestedEffectiveDate: options.effectiveDate || new Date(),
                requestedByUserId: options.requestedByUserId,
                prorationType: options.prorationType || "immediate"
            })
            .returning();

        // --- INTEGRATION: Send Plan Change Requested Notification ---
        // Notify the user that a plan change has been requested.
        try {
            await this.billingNotificationService.sendPlanChangeRequestedNotification(
                boxId,
                activeSubscription.plan!.tier,
                toPlan.tier,
                changeType,
                planChangeRequest.id, // Pass the request ID
                options.requestedByUserId, // Pass the requester ID
                options.effectiveDate
            );
            console.log(`Plan change requested notification sent for box ${boxId}`);
        } catch (error) {
            console.error(`Failed to send plan change requested notification for box ${boxId}:`, error);
            // Depending on requirements, you might want to alert if this notification fails.
            // Note: Failing to send the notification should not fail the plan change request itself.
        }
        // --- END INTEGRATION ---

        return planChangeRequest;
    }

    /**
     * Process a plan change request
     */
    static async processPlanChangeRequest(
        planChangeRequestId: string,
        approvedByUserId: string
    ) {
        const planChangeRequest = await db.query.planChangeRequests.findFirst({
            where: eq(planChangeRequests.id, planChangeRequestId),
            with: {
                subscription: true,
                fromPlan: true,
                toPlan: true,
                box: true // Fetch box details for notification
            }
        });

        if (!planChangeRequest) {
            throw new Error("Plan change request not found");
        }

        if (planChangeRequest.status !== "pending") {
            throw new Error("Plan change request is not pending");
        }

        // Calculate proration if needed
        const proratedAmount = this.calculateProration(
            planChangeRequest.subscription!,
            planChangeRequest.toPlan!,
            planChangeRequest.prorationType!
        );

        // Update the plan change request
        await db.update(planChangeRequests)
            .set({
                status: "approved",
                approvedAt: new Date(),
                approvedByUserId,
                proratedAmount,
                updatedAt: new Date()
            })
            .where(eq(planChangeRequests.id, planChangeRequestId));

        // Create subscription change record
        await db.insert(subscriptionChanges).values({
            subscriptionId: planChangeRequest.subscriptionId,
            boxId: planChangeRequest.boxId,
            changeType: planChangeRequest.changeType,
            fromPlanId: planChangeRequest.fromPlanId,
            toPlanId: planChangeRequest.toPlanId,
            effectiveDate: planChangeRequest.requestedEffectiveDate || new Date(),
            reason: "plan_change_request",
            triggeredByUserId: approvedByUserId,
            proratedAmount
        });

        // Update subscription with new plan
        await db.update(subscriptions)
            .set({
                planId: planChangeRequest.toPlanId!,
                polarProductId: planChangeRequest.toPlan!.polarProductId!,
                updatedAt: new Date()
            })
            .where(eq(subscriptions.id, planChangeRequest.subscriptionId));

        // Update box with new tier and limits
        await db.update(boxes)
            .set({
                subscriptionTier: planChangeRequest.toPlan!.tier as "seed" | "grow" | "scale",
                currentAthleteLimit: planChangeRequest.toPlan!.athleteLimit,
                currentCoachLimit: planChangeRequest.toPlan!.coachLimit,
                updatedAt: new Date()
            })
            .where(eq(boxes.id, planChangeRequest.boxId));

        const result = {
            success: true,
            planChangeRequest,
            proratedAmount
        };

        // --- INTEGRATION: Send Plan Change Confirmed Notification ---
        // Notify the user that their plan change has been successfully processed.
        try {
            await this.billingNotificationService.sendPlanChangeConfirmedNotification(
                planChangeRequest.boxId,
                planChangeRequest.fromPlan?.tier || 'unknown',
                planChangeRequest.toPlan?.tier || 'unknown',
                planChangeRequest.changeType,
                proratedAmount,
                planChangeRequest.requestedEffectiveDate || new Date(),
                planChangeRequest.id // Pass the request ID for deduplication
            );
            console.log(`Plan change confirmed notification sent for box ${planChangeRequest.boxId}`);
        } catch (error) {
            console.error(`Failed to send plan change confirmed notification for box ${planChangeRequest.boxId}:`, error);
            // Depending on requirements, you might want to alert or retry if this notification is critical
        }
        // --- END INTEGRATION ---

        return result;
    }

    /**
     * Cancel a plan change request
     */
    static async cancelPlanChangeRequest(
        planChangeRequestId: string,
        canceledByUserId: string,
        reason?: string
    ) {
        const planChangeRequest = await db.query.planChangeRequests.findFirst({
            where: eq(planChangeRequests.id, planChangeRequestId),
            with: {
                fromPlan: true,
                toPlan: true,
                box: true // Fetch box details for notification
            }
        });

        if (!planChangeRequest) {
            throw new Error("Plan change request not found");
        }

        await db.update(planChangeRequests)
            .set({
                status: "canceled",
                rejectedReason: reason,
                updatedAt: new Date()
            })
            .where(eq(planChangeRequests.id, planChangeRequestId));

        // --- INTEGRATION: Send Plan Change Canceled Notification ---
        // Notify the user that their plan change request has been canceled.
        try {
            await this.billingNotificationService.sendPlanChangeCanceledNotification(
                planChangeRequest.boxId,
                planChangeRequest.fromPlan?.tier || 'unknown',
                planChangeRequest.toPlan?.tier || 'unknown',
                planChangeRequest.changeType,
                reason
            );
            console.log(`Plan change canceled notification sent for box ${planChangeRequest.boxId}`);
        } catch (error) {
            console.error(`Failed to send plan change canceled notification for box ${planChangeRequest.boxId}:`, error);
            // Depending on requirements, you might want to alert if this notification fails.
        }
        // --- END INTEGRATION ---

        return { success: true };
    }

    /**
     * Get pending plan change requests for a box
     */
    static async getPendingPlanChanges(boxId: string) {
        return await db.query.planChangeRequests.findMany({
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
    }

    /**
     * Get plan change history for a box
     */
    static async getPlanChangeHistory(boxId: string, limit: number = 10) {
        return await db.query.subscriptionChanges.findMany({
            where: eq(subscriptionChanges.boxId, boxId),
            with: {
                fromPlan: true,
                toPlan: true
            },
            orderBy: desc(subscriptionChanges.createdAt),
            limit
        });
    }

    /**
     * Determine change type based on plan prices
     */
    private static determineChangeType(
        fromPrice: number,
        toPrice: number
    ): PlanChangeType {
        if (toPrice > fromPrice) return "upgrade";
        if (toPrice < fromPrice) return "downgrade";
        return "lateral";
    }

    /**
     * Calculate proration amount
     */
    private static calculateProration(
        subscription: any,
        toPlan: any,
        prorationType: string
    ): number {
        // Simplified proration calculation
        // In a real implementation, this would be more complex
        if (prorationType === "immediate") {
            const currentPeriodStart = new Date(subscription.currentPeriodStart);
            const currentPeriodEnd = new Date(subscription.currentPeriodEnd);
            const now = new Date();

            const totalDays = Math.ceil((currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / (1000 * 60 * 60 * 24));
            const remainingDays = Math.ceil((currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

            const currentPlanDailyRate = subscription.amount / totalDays;
            const newPlanDailyRate = toPlan.monthlyPrice / totalDays;

            const proratedRefund = currentPlanDailyRate * remainingDays;
            const proratedCharge = newPlanDailyRate * remainingDays;

            return Math.round(proratedCharge - proratedRefund);
        }

        return 0; // No proration for other types
    }
}
