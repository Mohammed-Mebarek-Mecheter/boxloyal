// lib/services/billing/overage-billing-service.ts
import { db } from "@/db";
import {
    boxes,
    subscriptions,
    overageBilling,
    orders as orderTable,
    subscriptionPlans
} from "@/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import type { OverageCalculation } from "./types";
import { UsageTrackingService } from "./usage-tracking-service";
// Import the BillingNotificationService
import { BillingNotificationService } from "@/lib/services/notifications/billing-notifications-service";

export class OverageBillingService {
    // Overage rates (in cents)
    private static readonly OVERAGE_RATES = {
        athlete: 100, // $1 per athlete over limit
        coach: 100    // $1 per coach over limit
    };

    // Instantiate the BillingNotificationService
    private static billingNotificationService = new BillingNotificationService();

    /**
     * Calculate overage for a specific billing period
     */
    static async calculateOverageForPeriod(
        boxId: string,
        subscriptionId: string,
        billingPeriodStart: Date,
        billingPeriodEnd: Date
    ): Promise<OverageCalculation | null> {
        const [box, subscription] = await Promise.all([
            db.query.boxes.findFirst({
                where: eq(boxes.id, boxId),
            }),
            db.query.subscriptions.findFirst({
                where: eq(subscriptions.id, subscriptionId),
                with: { plan: true }
            })
        ]);

        if (!box || !subscription || !subscription.plan) {
            throw new Error("Box, subscription, or plan not found");
        }

        // Calculate current usage
        const usage = await UsageTrackingService.calculateUsage(boxId, subscription.plan, box);

        const athleteOverage = Math.max(0, usage.athletes - usage.athleteLimit);
        const coachOverage = Math.max(0, usage.coaches - usage.coachLimit);

        // Return null if no overage
        if (athleteOverage === 0 && coachOverage === 0) {
            return null;
        }

        // Get overage rates from plan or use defaults
        const athleteOverageRate = subscription.plan.athleteOveragePrice ?? this.OVERAGE_RATES.athlete;
        const coachOverageRate = subscription.plan.coachOveragePrice ?? this.OVERAGE_RATES.coach;

        const totalOverageAmount = (athleteOverage * athleteOverageRate) + (coachOverage * coachOverageRate);

        return {
            boxId,
            subscriptionId,
            billingPeriodStart,
            billingPeriodEnd,
            athleteOverage,
            coachOverage,
            athleteOverageRate,
            coachOverageRate,
            totalOverageAmount
        };
    }

    /**
     * Create overage billing record in database
     */
    static async createOverageBilling(calculation: OverageCalculation) {
        const [box] = await db.select().from(boxes).where(eq(boxes.id, calculation.boxId));

        if (!box || !box.isOverageEnabled) {
            throw new Error("Box not found or overage billing not enabled");
        }

        // Check if overage billing record already exists for this period
        const existingOverageBilling = await db.query.overageBilling.findFirst({
            where: and(
                eq(overageBilling.boxId, calculation.boxId),
                eq(overageBilling.billingPeriodStart, calculation.billingPeriodStart),
                eq(overageBilling.billingPeriodEnd, calculation.billingPeriodEnd)
            )
        });

        if (existingOverageBilling) {
            return existingOverageBilling;
        }

        // Get current member counts for the record
        const usage = await UsageTrackingService.calculateUsage(calculation.boxId);

        // Create the overage billing record
        const [overageBillingRecord] = await db
            .insert(overageBilling)
            .values({
                boxId: calculation.boxId,
                subscriptionId: calculation.subscriptionId,
                billingPeriodStart: calculation.billingPeriodStart,
                billingPeriodEnd: calculation.billingPeriodEnd,
                athleteLimit: usage.athleteLimit,
                coachLimit: usage.coachLimit,
                athleteCount: usage.athletes,
                coachCount: usage.coaches,
                athleteOverage: calculation.athleteOverage,
                coachOverage: calculation.coachOverage,
                athleteOverageRate: calculation.athleteOverageRate,
                coachOverageRate: calculation.coachOverageRate,
                athleteOverageAmount: calculation.athleteOverage * calculation.athleteOverageRate,
                coachOverageAmount: calculation.coachOverage * calculation.coachOverageRate,
                totalOverageAmount: calculation.totalOverageAmount,
                status: "calculated",
                calculationMethod: "end_of_period",
                metadata: {
                    athleteOverage: calculation.athleteOverage,
                    coachOverage: calculation.coachOverage,
                    athleteOverageRate: calculation.athleteOverageRate,
                    coachOverageRate: calculation.coachOverageRate,
                    calculatedAt: new Date().toISOString()
                }
            })
            .returning();

        return overageBillingRecord;
    }

    /**
     * Create an overage order (since Polar doesn't have direct invoice API)
     */
    static async createOverageOrder(calculation: OverageCalculation) {
        if (calculation.totalOverageAmount === 0) {
            return null;
        }

        // Create the overage billing record first
        const overageBillingRecord = await this.createOverageBilling(calculation);

        // Create an order record for tracking
        const order = await db.insert(orderTable).values({
            boxId: calculation.boxId,
            polarOrderId: `overage_${calculation.boxId}_${Date.now()}`, // Temporary ID until Polar integration
            polarProductId: 'overage',
            orderType: 'overage',
            description: `Overage fees for ${calculation.billingPeriodStart.toISOString().split('T')[0]} to ${calculation.billingPeriodEnd.toISOString().split('T')[0]}`,
            status: 'pending',
            amount: calculation.totalOverageAmount,
            currency: 'USD',
            subtotalAmount: calculation.totalOverageAmount,
            taxAmount: 0,
            metadata: {
                type: 'overage',
                period_start: calculation.billingPeriodStart.toISOString(),
                period_end: calculation.billingPeriodEnd.toISOString(),
                athleteOverage: calculation.athleteOverage,
                coachOverage: calculation.coachOverage,
                athleteOverageRate: calculation.athleteOverageRate,
                coachOverageRate: calculation.coachOverageRate,
                overageBillingId: overageBillingRecord.id,
                breakdown: {
                    athleteOverageAmount: calculation.athleteOverage * calculation.athleteOverageRate,
                    coachOverageAmount: calculation.coachOverage * calculation.coachOverageRate,
                    totalOverageAmount: calculation.totalOverageAmount
                }
            }
        }).returning();

        return order[0];
    }

    /**
     * Get overage billing summary for a specific period
     */
    static async getOverageBillingSummary(
        boxId: string,
        billingPeriodStart: Date,
        billingPeriodEnd: Date
    ) {
        const overageBillingRecord = await db.query.overageBilling.findFirst({
            where: and(
                eq(overageBilling.boxId, boxId),
                eq(overageBilling.billingPeriodStart, billingPeriodStart),
                eq(overageBilling.billingPeriodEnd, billingPeriodEnd)
            )
        });

        if (!overageBillingRecord) {
            // Calculate current overage if no record exists
            const activeSubscription = await db.query.subscriptions.findFirst({
                where: and(
                    eq(subscriptions.boxId, boxId),
                    eq(subscriptions.status, "active")
                )
            });

            if (!activeSubscription) {
                return { overage: 0, amount: 0, message: "No active subscription found" };
            }

            const calculation = await this.calculateOverageForPeriod(
                boxId,
                activeSubscription.id,
                billingPeriodStart,
                billingPeriodEnd
            );

            return calculation || { overage: 0, amount: 0, message: "No overage calculated" };
        }

        return {
            ...overageBillingRecord,
            formattedAmounts: {
                athleteOverage: `$${(overageBillingRecord.athleteOverageAmount / 100).toFixed(2)}`,
                coachOverage: `$${(overageBillingRecord.coachOverageAmount / 100).toFixed(2)}`,
                total: `$${(overageBillingRecord.totalOverageAmount / 100).toFixed(2)}`
            },
            breakdown: {
                athlete: {
                    count: overageBillingRecord.athleteCount,
                    limit: overageBillingRecord.athleteLimit,
                    overage: overageBillingRecord.athleteOverage,
                    rate: overageBillingRecord.athleteOverageRate,
                    amount: overageBillingRecord.athleteOverageAmount
                },
                coach: {
                    count: overageBillingRecord.coachCount,
                    limit: overageBillingRecord.coachLimit,
                    overage: overageBillingRecord.coachOverage,
                    rate: overageBillingRecord.coachOverageRate,
                    amount: overageBillingRecord.coachOverageAmount
                }
            }
        };
    }

    /**
     * Process monthly overage billing for all active subscriptions
     */
    static async processMonthlyOverageBilling() {
        const now = new Date();
        const billingPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const billingPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        // Get all active subscriptions with overage enabled boxes
        const activeSubscriptions = await db.query.subscriptions.findMany({
            where: eq(subscriptions.status, "active"),
            with: {
                box: true,
                plan: true
            }
        });

        const results = [];

        for (const subscription of activeSubscriptions) {
            if (!subscription.box?.isOverageEnabled) {
                results.push({
                    subscriptionId: subscription.id,
                    boxId: subscription.boxId,
                    success: true,
                    invoiceId: null,
                    amount: 0,
                    message: 'Overage billing not enabled'
                });
                continue;
            }

            try {
                const calculation = await this.calculateOverageForPeriod(
                    subscription.boxId,
                    subscription.id,
                    billingPeriodStart,
                    billingPeriodEnd
                );

                if (calculation) {
                    const order = await this.createOverageOrder(calculation);

                    // --- INTEGRATION: Send Overage Charges Notification ---
                    // This is the key integration point. After creating the overage billing/order,
                    // we notify the user.
                    try {
                        await this.billingNotificationService.sendOverageChargesNotification(
                            subscription.boxId,
                            billingPeriodStart,
                            billingPeriodEnd
                        );
                        console.log(`Overage charges notification sent for box ${subscription.boxId}`);
                    } catch (error) {
                        console.error(`Failed to send overage charges notification for box ${subscription.boxId}:`, error);
                        // Depending on requirements, you might want to alert or retry if this notification is critical
                    }
                    // --- END INTEGRATION ---

                    results.push({
                        subscriptionId: subscription.id,
                        boxId: subscription.boxId,
                        boxName: subscription.box.name,
                        success: true,
                        orderId: order?.id || null,
                        amount: calculation.totalOverageAmount,
                        athleteOverage: calculation.athleteOverage,
                        coachOverage: calculation.coachOverage,
                        formattedAmount: `$${(calculation.totalOverageAmount / 100).toFixed(2)}`
                    });
                } else {
                    results.push({
                        subscriptionId: subscription.id,
                        boxId: subscription.boxId,
                        boxName: subscription.box.name,
                        success: true,
                        orderId: null,
                        amount: 0,
                        message: 'No overage to bill'
                    });
                }
            } catch (error) {
                console.error(`Error processing overage billing for subscription ${subscription.id}:`, error);
                results.push({
                    subscriptionId: subscription.id,
                    boxId: subscription.boxId,
                    boxName: subscription.box?.name || 'Unknown',
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        return results;
    }

    /**
     * Mark overage billing as paid (called from webhook handler)
     */
    static async markOverageAsPaid(
        boxId: string,
        billingPeriodStart: Date,
        billingPeriodEnd: Date,
        paidAt: Date = new Date(),
        polarInvoiceId?: string
    ) {
        const result = await db.update(overageBilling)
            .set({
                status: 'paid',
                paidAt,
                polarInvoiceId,
                updatedAt: new Date()
            })
            .where(and(
                eq(overageBilling.boxId, boxId),
                eq(overageBilling.billingPeriodStart, billingPeriodStart),
                eq(overageBilling.billingPeriodEnd, billingPeriodEnd)
            ))
            .returning();

        // --- INTEGRATION: Send Payment Success Notification for Overage (Optional) ---
        // If you want to notify the user specifically that their overage invoice was paid,
        // you could add a call to a new notification method here.
        // This might be redundant if the main subscription payment success notification covers it.
        /*
        if (result[0]) {
             try {
                 // You would need the amount paid, which is in result[0].totalOverageAmount
                 // await this.billingNotificationService.sendOveragePaymentSuccessfulNotification(
                 //     boxId,
                 //     result[0].totalOverageAmount,
                 //     polarInvoiceId // or a generated ID for the overage order
                 // );
                 // console.log(`Overage payment success notification sent for box ${boxId}`);
             } catch (error) {
                 console.error(`Failed to send overage payment success notification for box ${boxId}:`, error);
             }
        }
        */
        // --- END INTEGRATION (Optional/Placeholder) ---

        return result[0];
    }

    /**
     * Mark overage billing as failed
     */
    static async markOverageAsFailed(
        boxId: string,
        billingPeriodStart: Date,
        billingPeriodEnd: Date,
        failureReason?: string
    ) {
        const result = await db.update(overageBilling)
            .set({
                status: 'failed',
                updatedAt: new Date()
            })
            .where(and(
                eq(overageBilling.boxId, boxId),
                eq(overageBilling.billingPeriodStart, billingPeriodStart),
                eq(overageBilling.billingPeriodEnd, billingPeriodEnd)
            ))
            .returning();

        // --- INTEGRATION: Send Payment Failed Notification for Overage (Optional) ---
        // If you want to notify the user specifically that their overage payment failed,
        // you could add a call to a new notification method here.
        // This might be redundant if the main subscription payment failure notification covers it,
        // or if the overage charges notification itself is the trigger for payment.
        /*
        if (result[0]) {
             try {
                 // You would need the amount that failed, which is in result[0].totalOverageAmount
                 // await this.billingNotificationService.sendOveragePaymentFailedNotification(
                 //     boxId,
                 //     result[0].totalOverageAmount,
                 //     failureReason
                 // );
                 // console.log(`Overage payment failed notification sent for box ${boxId}`);
             } catch (error) {
                 console.error(`Failed to send overage payment failed notification for box ${boxId}:`, error);
             }
        }
        */
        // --- END INTEGRATION (Optional/Placeholder) ---

        return result[0];
    }

    /**
     * Get all overage billing records for a box
     */
    static async getOverageBillingHistory(boxId: string, limit: number = 12) {
        return await db.query.overageBilling.findMany({
            where: eq(overageBilling.boxId, boxId),
            orderBy: desc(overageBilling.billingPeriodStart),
            limit,
            with: {
                subscription: {
                    with: {
                        plan: true
                    }
                }
            }
        });
    }

    /**
     * Get current month's overage calculation for a box
     */
    static async getCurrentMonthOverage(boxId: string) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const activeSubscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.boxId, boxId),
                eq(subscriptions.status, "active")
            )
        });

        if (!activeSubscription) {
            return null;
        }

        return await this.calculateOverageForPeriod(
            boxId,
            activeSubscription.id,
            monthStart,
            monthEnd
        );
    }

    /**
     * Enable overage billing for a box
     */
    static async enableOverageBilling(boxId: string) {
        const result = await db.update(boxes)
            .set({
                isOverageEnabled: true,
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId))
            .returning();

        // --- INTEGRATION: Send Notification for Overage Billing Enabled ---
        // As determined necessary based on notification system requirements.
        try {
            await this.billingNotificationService.sendOverageBillingEnabledNotification(boxId);
            console.log(`Overage billing enabled notification sent for box ${boxId}`);
        } catch (error) {
            console.error(`Failed to send overage billing enabled notification for box ${boxId}:`, error);
            // Depending on requirements, you might want to alert if this notification fails.
        }
        // --- END INTEGRATION ---

        return result[0];
    }

    /**
     * Disable overage billing for a box
     */
    static async disableOverageBilling(boxId: string) {
        const result = await db.update(boxes)
            .set({
                isOverageEnabled: false,
                updatedAt: new Date()
            })
            .where(eq(boxes.id, boxId))
            .returning();

        // --- INTEGRATION: Send Notification for Overage Billing Disabled ---
        // As determined necessary based on notification system requirements.
        try {
            await this.billingNotificationService.sendOverageBillingDisabledNotification(boxId);
            console.log(`Overage billing disabled notification sent for box ${boxId}`);
        } catch (error) {
            console.error(`Failed to send overage billing disabled notification for box ${boxId}:`, error);
            // Depending on requirements, you might want to alert if this notification fails.
        }
        // --- END INTEGRATION ---

        return result[0];
    }

    /**
     * Get overage billing statistics for admin dashboard
     */
    static async getOverageBillingStats(timeframe: "30d" | "90d" | "1y" = "30d") {
        const now = new Date();
        let startDate = new Date();

        switch (timeframe) {
            case "30d":
                startDate.setDate(now.getDate() - 30);
                break;
            case "90d":
                startDate.setDate(now.getDate() - 90);
                break;
            case "1y":
                startDate.setFullYear(now.getFullYear() - 1);
                break;
        }

        const overageBillings = await db.query.overageBilling.findMany({
            where: gte(overageBilling.createdAt, startDate),
            with: {
                box: {
                    columns: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        const totalOverageAmount = overageBillings.reduce((sum, billing) => sum + billing.totalOverageAmount, 0);
        const paidOverageAmount = overageBillings
            .filter(billing => billing.status === 'paid')
            .reduce((sum, billing) => sum + billing.totalOverageAmount, 0);

        const boxesWithOverage = new Set(overageBillings.map(billing => billing.boxId)).size;
        const averageOveragePerBox = boxesWithOverage > 0 ? totalOverageAmount / boxesWithOverage : 0;

        return {
            timeframe,
            period: { startDate, endDate: now },
            stats: {
                totalOverageAmount,
                paidOverageAmount,
                unpaidOverageAmount: totalOverageAmount - paidOverageAmount,
                boxesWithOverage,
                totalOverageBillings: overageBillings.length,
                averageOveragePerBox,
                formattedAmounts: {
                    total: `$${(totalOverageAmount / 100).toFixed(2)}`,
                    paid: `$${(paidOverageAmount / 100).toFixed(2)}`,
                    unpaid: `$${((totalOverageAmount - paidOverageAmount) / 100).toFixed(2)}`,
                    average: `$${(averageOveragePerBox / 100).toFixed(2)}`
                }
            }
        };
    }
}
