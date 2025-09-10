// lib/cron/scheduler.ts
import { BillingService } from "@/lib/services/billing-service";
import { PolarService } from "@/lib/services/polar-service";
import { db } from "@/db";
import { boxes, subscriptions, gracePeriods, billingEvents } from "@/db/schema";
import { eq, and, lte, gte, or } from "drizzle-orm";

/**
 * Background job scheduler for Cloudflare Workers Cron Triggers
 *
 * To set up cron triggers, add these to your wrangler.jsonc:
 * {
 *   "triggers": {
 *     "crons": [
 *       "0 2 1 * *",    // Monthly overage billing (1st day, 2 AM UTC)
 *       "0 1 * * *",    // Daily grace period checks (1 AM UTC)
 *       "0 3 * * 0",    // Weekly retention cleanup (Sunday 3 AM UTC)
 *       "0 4 * * *",    // Daily sync check (4 AM UTC)
 *       "*/15 * * * *"  // Retry failed billing events every 15 minutes
*     ]
*   }
* }
*/

export class CronScheduler {
    /**
     * Route cron jobs based on the cron pattern
     */
    static async handleScheduledEvent(controller: ScheduledController): Promise<Response> {
        const cronPattern = controller.cron;
        const scheduledTime = new Date(controller.scheduledTime);

        console.log(`Processing cron job: ${cronPattern} at ${scheduledTime.toISOString()}`);

        try {
            switch (cronPattern) {
                case "0 2 1 * *": // Monthly overage billing
                    await this.processMonthlyOverageBilling();
                    break;

                case "0 1 * * *": // Daily grace period checks
                    await this.processGracePeriodChecks();
                    break;

                case "0 3 * * 0": // Weekly retention cleanup
                    await this.processWeeklyMaintenance();
                    break;

                case "0 4 * * *": // Daily sync check
                    await this.processDailySyncCheck();
                    break;

                case "*/15 * * * *": // Retry failed billing events
                    await this.retryFailedBillingEvents();
                    break;

                default:
                    console.warn(`Unknown cron pattern: ${cronPattern}`);
            }

            return new Response("OK", { status: 200 });
        } catch (error) {
            console.error(`Cron job failed for pattern ${cronPattern}:`, error);
            return new Response(`Error: ${error instanceof Error ? error.message : String(error)}`, {
                status: 500
            });
        }
    }

    /**
     * Process monthly overage billing for all eligible boxes
     * Runs on the 1st of every month at 2 AM UTC
     */
    private static async processMonthlyOverageBilling(): Promise<void> {
        console.log("Starting monthly overage billing process");

        try {
            // Find all active boxes with overage enabled
            const eligibleBoxes = await db.query.boxes.findMany({
                where: and(
                    eq(boxes.isOverageEnabled, true),
                    eq(boxes.status, "active")
                ),
                with: {
                    subscriptions: {
                        where: eq(subscriptions.status, "active"),
                        with: {
                            plan: true,
                            customerProfile: true,
                        },
                        limit: 1,
                        orderBy: (subscriptions, { desc }) => [desc(subscriptions.createdAt)]
                    }
                }
            });

            console.log(`Found ${eligibleBoxes.length} boxes eligible for overage billing`);

            let processedCount = 0;
            let errorCount = 0;

            for (const box of eligibleBoxes) {
                try {
                    const activeSubscription = box.subscriptions[0];
                    if (!activeSubscription) {
                        console.warn(`Box ${box.id} has no active subscription, skipping overage billing`);
                        continue;
                    }

                    // Calculate overage for the current billing period
                    const overageBilling = await BillingService.calculateOverageBilling(box.id);

                    if (overageBilling && overageBilling.totalOverageAmount > 0) {
                        // Create invoice via Polar API
                        await PolarService.createInvoice({
                            customerId: activeSubscription.customerProfile!.polarCustomerId!,
                            amount: overageBilling.totalOverageAmount,
                            currency: activeSubscription.currency || "USD",
                            description: `Overage charges for ${new Date().toLocaleDateString('en-US', {
                                month: 'long',
                                year: 'numeric'
                            })}`,
                            metadata: {
                                boxId: box.id,
                                subscriptionId: activeSubscription.id,
                                overageBillingId: overageBilling.id,
                                athleteOverage: overageBilling.athleteOverage,
                                coachOverage: overageBilling.coachOverage,
                                billingPeriod: `${overageBilling.billingPeriodStart}-${overageBilling.billingPeriodEnd}`
                            }
                        });

                        console.log(`Created overage invoice for box ${box.id}: $${(overageBilling.totalOverageAmount / 100).toFixed(2)}`);
                        processedCount++;
                    }

                } catch (error) {
                    console.error(`Failed to process overage billing for box ${box.id}:`, error);
                    errorCount++;

                    // Track the error
                    await BillingService.trackUsage(box.id, [{
                        eventType: "overage_billed",
                        quantity: 1,
                        billable: false,
                        metadata: {
                            error: error instanceof Error ? error.message : String(error),
                            status: "failed"
                        }
                    }]);
                }
            }

            console.log(`Monthly overage billing completed: ${processedCount} processed, ${errorCount} errors`);

        } catch (error) {
            console.error("Failed to process monthly overage billing:", error);
            throw error;
        }
    }

    /**
     * Process grace period checks and notifications
     * Runs daily at 1 AM UTC
     */
    private static async processGracePeriodChecks(): Promise<void> {
        console.log("Starting daily grace period checks");

        try {
            const now = new Date();
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Find grace periods expiring in the next 24 hours
            const expiringGracePeriods = await db.query.gracePeriods.findMany({
                where: and(
                    eq(gracePeriods.resolved, false),
                    gte(gracePeriods.endsAt, now),
                    lte(gracePeriods.endsAt, tomorrow)
                ),
                with: {
                    box: {
                        columns: {
                            id: true,
                            name: true,
                            email: true,
                            subscriptionTier: true,
                        }
                    }
                }
            });

            console.log(`Found ${expiringGracePeriods.length} grace periods expiring in the next 24 hours`);

            for (const gracePeriod of expiringGracePeriods) {
                try {
                    // Send warning notification (implement email/notification service)
                    console.log(`Grace period ${gracePeriod.id} expiring for box ${gracePeriod.box.name} (${gracePeriod.reason})`);

                    // Track warning event
                    await BillingService.trackUsage(gracePeriod.boxId, [{
                        eventType: "grace_period_triggered",
                        quantity: 1,
                        metadata: {
                            gracePeriodId: gracePeriod.id,
                            reason: gracePeriod.reason,
                            expiresAt: gracePeriod.endsAt.toISOString(),
                            warningType: "24_hour_expiry"
                        }
                    }]);

                } catch (error) {
                    console.error(`Failed to process grace period ${gracePeriod.id}:`, error);
                }
            }

            // Auto-resolve expired grace periods that should be resolved automatically
            const expiredAutoResolveGracePeriods = await db.query.gracePeriods.findMany({
                where: and(
                    eq(gracePeriods.resolved, false),
                    eq(gracePeriods.autoResolve, true),
                    lte(gracePeriods.endsAt, now)
                )
            });

            for (const gracePeriod of expiredAutoResolveGracePeriods) {
                await BillingService.resolveGracePeriod(
                    gracePeriod.id,
                    "auto_resolved_expired",
                    undefined,
                    true
                );

                console.log(`Auto-resolved expired grace period ${gracePeriod.id}`);
            }

            console.log("Grace period checks completed");

        } catch (error) {
            console.error("Failed to process grace period checks:", error);
            throw error;
        }
    }

    /**
     * Weekly maintenance tasks
     * Runs every Sunday at 3 AM UTC
     */
    private static async processWeeklyMaintenance(): Promise<void> {
        console.log("Starting weekly maintenance tasks");

        try {
            // Clean up old processed billing events (keep 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const cleanupResult = await db
                .delete(billingEvents)
                .where(and(
                    eq(billingEvents.processed, true),
                    lte(billingEvents.createdAt, thirtyDaysAgo)
                ));

            console.log(`Cleaned up old billing events`);

            // Update box usage statistics
            const activeBoxes = await db.query.boxes.findMany({
                where: eq(boxes.status, "active")
            });

            let updatedBoxes = 0;
            for (const box of activeBoxes) {
                try {
                    // Recalculate and update current usage stats
                    const usage = await BillingService.calculateEnhancedUsage(box.id);

                    await db.update(boxes)
                        .set({
                            currentAthleteCount: usage.athletes,
                            currentCoachCount: usage.coaches,
                            currentAthleteOverage: usage.athleteOverage,
                            currentCoachOverage: usage.coachOverage,
                            updatedAt: new Date()
                        })
                        .where(eq(boxes.id, box.id));

                    updatedBoxes++;
                } catch (error) {
                    console.error(`Failed to update usage stats for box ${box.id}:`, error);
                }
            }

            console.log(`Weekly maintenance completed: updated ${updatedBoxes} box usage statistics`);

        } catch (error) {
            console.error("Failed to process weekly maintenance:", error);
            throw error;
        }
    }

    /**
     * Daily sync check to ensure data consistency
     * Runs daily at 4 AM UTC
     */
    private static async processDailySyncCheck(): Promise<void> {
        console.log("Starting daily sync check");

        try {
            // Find subscriptions that haven't been synced with Polar in over 24 hours
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const staleSubscriptions = await db.query.subscriptions.findMany({
                where: and(
                    eq(subscriptions.status, "active"),
                    or(
                        lte(subscriptions.lastSyncedAt, yesterday),
                        eq(subscriptions.lastSyncedAt, null)
                    )
                ),
                with: {
                    customerProfile: true,
                    box: {
                        columns: {
                            id: true,
                            name: true,
                        }
                    }
                },
                limit: 50 // Process in batches to avoid timeout
            });

            console.log(`Found ${staleSubscriptions.length} subscriptions needing sync check`);

            let syncedCount = 0;
            let errorCount = 0;

            for (const subscription of staleSubscriptions) {
                try {
                    if (!subscription.polarSubscriptionId) {
                        console.warn(`Subscription ${subscription.id} has no Polar subscription ID`);
                        continue;
                    }

                    // Fetch current subscription state from Polar
                    const polarSubscription = await PolarService.getSubscription(subscription.polarSubscriptionId);

                    if (polarSubscription) {
                        // Update local subscription with latest data
                        await db.update(subscriptions)
                            .set({
                                status: polarSubscription.status,
                                currentPeriodEnd: new Date(polarSubscription.currentPeriodEnd * 1000),
                                cancelAtPeriodEnd: polarSubscription.cancelAtPeriodEnd || false,
                                lastSyncedAt: new Date(),
                                updatedAt: new Date()
                            })
                            .where(eq(subscriptions.id, subscription.id));

                        syncedCount++;
                        console.log(`Synced subscription ${subscription.id} with Polar`);
                    }

                } catch (error) {
                    console.error(`Failed to sync subscription ${subscription.id}:`, error);
                    errorCount++;
                }
            }

            console.log(`Daily sync check completed: ${syncedCount} synced, ${errorCount} errors`);

        } catch (error) {
            console.error("Failed to process daily sync check:", error);
            throw error;
        }
    }

    /**
     * Retry failed billing events
     * Runs every 15 minutes
     */
    private static async retryFailedBillingEvents(): Promise<void> {
        console.log("Processing failed billing event retries");

        try {
            const now = new Date();

            // Find billing events that are ready for retry
            const eventsToRetry = await db.query.billingEvents.findMany({
                where: and(
                    eq(billingEvents.status, "failed"),
                    eq(billingEvents.processed, false),
                    lte(billingEvents.nextRetryAt, now)
                ),
                limit: 20 // Process in small batches
            });

            console.log(`Found ${eventsToRetry.length} billing events ready for retry`);

            let retriedCount = 0;
            let permanentFailures = 0;

            for (const event of eventsToRetry) {
                try {
                    // Check if we've exceeded max retries
                    if (event.retryCount >= event.maxRetries) {
                        await db.update(billingEvents)
                            .set({
                                status: "permanently_failed",
                                updatedAt: new Date()
                            })
                            .where(eq(billingEvents.id, event.id));

                        permanentFailures++;
                        continue;
                    }

                    // Retry processing the event
                    await BillingService.processBillingEvent(
                        event.boxId,
                        event.eventType,
                        event.polarEventId!,
                        event.data as Record<string, any>
                    );

                    retriedCount++;
                    console.log(`Successfully retried billing event ${event.id}`);

                } catch (error) {
                    console.error(`Retry failed for billing event ${event.id}:`, error);

                    // Update retry count and next retry time
                    const nextRetryAt = new Date();
                    nextRetryAt.setMinutes(nextRetryAt.getMinutes() + Math.pow(2, event.retryCount + 1) * 5);

                    await db.update(billingEvents)
                        .set({
                            retryCount: event.retryCount + 1,
                            nextRetryAt: event.retryCount + 1 < event.maxRetries ? nextRetryAt : null,
                            lastAttemptAt: new Date(),
                            processingError: error instanceof Error ? error.message : String(error)
                        })
                        .where(eq(billingEvents.id, event.id));
                }
            }

            console.log(`Billing event retries completed: ${retriedCount} succeeded, ${permanentFailures} permanent failures`);

        } catch (error) {
            console.error("Failed to process billing event retries:", error);
            throw error;
        }
    }

    /**
     * Health check for all cron services
     */
    static async healthCheck(): Promise<{
        status: 'healthy' | 'degraded' | 'unhealthy';
        checks: Record<string, { status: string; message: string; timestamp: string }>;
        summary: string;
    }> {
        const checks: Record<string, { status: string; message: string; timestamp: string }> = {};
        const timestamp = new Date().toISOString();

        try {
            // Check Polar API connectivity
            const polarHealth = await PolarService.healthCheck();
            checks.polar_api = {
                status: polarHealth.status,
                message: polarHealth.message,
                timestamp
            };

            // Check database connectivity
            try {
                await db.query.boxes.findFirst({ limit: 1 });
                checks.database = {
                    status: 'healthy',
                    message: 'Database connection successful',
                    timestamp
                };
            } catch (error) {
                checks.database = {
                    status: 'unhealthy',
                    message: `Database connection failed: ${error instanceof Error ? error.message : String(error)}`,
                    timestamp
                };
            }

            // Check for stuck billing events
            try {
                const stuckEvents = await db.query.billingEvents.findMany({
                    where: and(
                        eq(billingEvents.status, "processing"),
                        lte(billingEvents.lastAttemptAt, new Date(Date.now() - 30 * 60 * 1000)) // 30 minutes ago
                    ),
                    limit: 1
                });

                checks.billing_queue = {
                    status: stuckEvents.length > 0 ? 'degraded' : 'healthy',
                    message: stuckEvents.length > 0
                        ? `${stuckEvents.length} events stuck in processing state`
                        : 'Billing queue processing normally',
                    timestamp
                };
            } catch (error) {
                checks.billing_queue = {
                    status: 'unhealthy',
                    message: `Failed to check billing queue: ${error instanceof Error ? error.message : String(error)}`,
                    timestamp
                };
            }

            // Check for overdue grace periods
            try {
                const overdueGracePeriods = await db.query.gracePeriods.findMany({
                    where: and(
                        eq(gracePeriods.resolved, false),
                        lte(gracePeriods.endsAt, new Date())
                    ),
                    limit: 1
                });

                checks.grace_periods = {
                    status: overdueGracePeriods.length > 10 ? 'degraded' : 'healthy',
                    message: overdueGracePeriods.length > 0
                        ? `${overdueGracePeriods.length} overdue grace periods need attention`
                        : 'Grace periods processing normally',
                    timestamp
                };
            } catch (error) {
                checks.grace_periods = {
                    status: 'unhealthy',
                    message: `Failed to check grace periods: ${error instanceof Error ? error.message : String(error)}`,
                    timestamp
                };
            }

            // Determine overall status
            const unhealthyCount = Object.values(checks).filter(check => check.status === 'unhealthy').length;
            const degradedCount = Object.values(checks).filter(check => check.status === 'degraded').length;

            let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
            let summary: string;

            if (unhealthyCount > 0) {
                overallStatus = 'unhealthy';
                summary = `${unhealthyCount} critical issue(s) detected`;
            } else if (degradedCount > 0) {
                overallStatus = 'degraded';
                summary = `${degradedCount} degraded service(s) detected`;
            } else {
                overallStatus = 'healthy';
                summary = 'All cron services operating normally';
            }

            return {
                status: overallStatus,
                checks,
                summary
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                checks: {
                    system: {
                        status: 'unhealthy',
                        message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
                        timestamp
                    }
                },
                summary: 'System health check failed'
            };
        }
    }
}
