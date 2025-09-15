// lib/services/analytics/scheduled-tasks.ts
import { db } from "@/db";
import { boxes } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
    processBoxAnalyticsSnapshot,
    recalculateAllRiskScoresForBox,
    cleanupExpiredRiskScores,
    updateBoxCurrentCounts,
    type AnalyticsPeriod
} from "./analytics-calculations";

interface TaskResult {
    boxId: string;
    success: boolean;
    error?: any;
    metrics?: any;
}

/**
 * Runs daily analytics tasks for all boxes.
 * Triggered by Cloudflare Cron: "0 2 * * *" (Daily at 2 AM)
 */
export async function runDailyAnalyticsTasks(env: any): Promise<void> {
    console.log("[Scheduled Task] Starting Daily Analytics Tasks");
    const startTime = Date.now();

    try {
        // Get all boxes that need analytics processing
        const allBoxes = await db.select({
            id: boxes.id,
            name: boxes.name,
            status: boxes.status
        }).from(boxes).where(eq(boxes.status, 'active'));

        console.log(`[Scheduled Task] Found ${allBoxes.length} active boxes for daily processing.`);

        if (allBoxes.length === 0) {
            console.log("[Scheduled Task] No active boxes found. Skipping daily tasks.");
            return;
        }

        const results: TaskResult[] = [];

        // Process each box sequentially to avoid overwhelming the database
        for (const { id: boxId, name: boxName } of allBoxes) {
            const boxStartTime = Date.now();

            try {
                console.log(`[Scheduled Task] Processing daily analytics for box: ${boxName} (${boxId})`);

                // 1. Update box current counts (for subscription management)
                const countMetrics = await updateBoxCurrentCounts(boxId);
                console.log(`[Scheduled Task] Updated counts for box ${boxName}: ${countMetrics.athleteCount} athletes, ${countMetrics.coachCount} coaches`);

                // 2. Calculate and store daily analytics snapshot
                await processBoxAnalyticsSnapshot(boxId, "daily");

                const boxDuration = Date.now() - boxStartTime;
                console.log(`[Scheduled Task] Completed daily analytics for box ${boxName} in ${boxDuration}ms`);

                results.push({
                    boxId,
                    success: true,
                    metrics: { ...countMetrics, processingTime: boxDuration }
                });

            } catch (error) {
                const boxDuration = Date.now() - boxStartTime;
                console.error(`[Scheduled Task] Failed daily analytics for box ${boxName} (${boxId}) after ${boxDuration}ms:`, error);

                results.push({
                    boxId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        // 3. Cleanup expired risk scores (global task)
        try {
            await cleanupExpiredRiskScores();
            console.log("[Scheduled Task] Completed expired risk score cleanup");
        } catch (error) {
            console.error("[Scheduled Task] Error cleaning up expired risk scores:", error);
        }

        // Summary
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const totalDuration = Date.now() - startTime;

        console.log(`[Scheduled Task] Completed Daily Analytics Tasks in ${totalDuration}ms. Success: ${successful}, Failed: ${failed}`);

        // Log failures for monitoring
        if (failed > 0) {
            const failures = results.filter(r => !r.success);
            console.error("[Scheduled Task] Daily task failures:", failures);
        }

    } catch (error) {
        const totalDuration = Date.now() - startTime;
        console.error(`[Scheduled Task] Critical error in runDailyAnalyticsTasks after ${totalDuration}ms:`, error);
        throw error;
    }
}

/**
 * Runs weekly analytics tasks for all boxes.
 * Triggered by Cloudflare Cron: "0 3 * * 0" (Weekly on Sunday at 3 AM)
 */
export async function runWeeklyAnalyticsTasks(env: any): Promise<void> {
    console.log("[Scheduled Task] Starting Weekly Analytics Tasks");
    const startTime = Date.now();

    try {
        const allBoxes = await db.select({
            id: boxes.id,
            name: boxes.name,
            status: boxes.status,
            currentAthleteCount: boxes.currentAthleteCount
        }).from(boxes).where(eq(boxes.status, 'active'));

        console.log(`[Scheduled Task] Found ${allBoxes.length} active boxes for weekly processing.`);

        const results: TaskResult[] = [];
        let totalRiskScoresUpdated = 0;

        for (const { id: boxId, name: boxName, currentAthleteCount } of allBoxes) {
            const boxStartTime = Date.now();

            try {
                console.log(`[Scheduled Task] Processing weekly analytics for box: ${boxName} (${boxId}) with ${currentAthleteCount} athletes`);

                // 1. Calculate weekly analytics snapshot
                await processBoxAnalyticsSnapshot(boxId, "weekly");
                console.log(`[Scheduled Task] Completed weekly snapshot for box ${boxName}`);

                // 2. Recalculate risk scores for all athletes
                if (currentAthleteCount > 0) {
                    const riskResults = await recalculateAllRiskScoresForBox(boxId);
                    totalRiskScoresUpdated += riskResults.successful;
                    console.log(`[Scheduled Task] Updated ${riskResults.successful}/${riskResults.totalAthletes} risk scores for box ${boxName}`);
                } else {
                    console.log(`[Scheduled Task] Skipping risk score calculation for box ${boxName} - no athletes`);
                }

                const boxDuration = Date.now() - boxStartTime;
                console.log(`[Scheduled Task] Completed weekly analytics for box ${boxName} in ${boxDuration}ms`);

                results.push({
                    boxId,
                    success: true,
                    metrics: { athleteCount: currentAthleteCount, processingTime: boxDuration }
                });

            } catch (error) {
                const boxDuration = Date.now() - boxStartTime;
                console.error(`[Scheduled Task] Failed weekly analytics for box ${boxName} (${boxId}) after ${boxDuration}ms:`, error);

                results.push({
                    boxId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        // Summary
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const totalDuration = Date.now() - startTime;

        console.log(`[Scheduled Task] Completed Weekly Analytics Tasks in ${totalDuration}ms. Success: ${successful}, Failed: ${failed}`);
        console.log(`[Scheduled Task] Total risk scores updated across all boxes: ${totalRiskScoresUpdated}`);

        // Log failures for monitoring
        if (failed > 0) {
            const failures = results.filter(r => !r.success);
            console.error("[Scheduled Task] Weekly task failures:", failures);
        }

    } catch (error) {
        const totalDuration = Date.now() - startTime;
        console.error(`[Scheduled Task] Critical error in runWeeklyAnalyticsTasks after ${totalDuration}ms:`, error);
        throw error;
    }
}

/**
 * Runs monthly analytics tasks for all boxes.
 * Triggered by Cloudflare Cron: "0 4 1 * *" (Monthly on the 1st at 4 AM)
 */
export async function runMonthlyAnalyticsTasks(env: any): Promise<void> {
    console.log("[Scheduled Task] Starting Monthly Analytics Tasks");
    const startTime = Date.now();

    try {
        const allBoxes = await db.select({
            id: boxes.id,
            name: boxes.name,
            status: boxes.status
        }).from(boxes).where(eq(boxes.status, 'active'));

        console.log(`[Scheduled Task] Found ${allBoxes.length} active boxes for monthly processing.`);

        const results: TaskResult[] = [];

        for (const { id: boxId, name: boxName } of allBoxes) {
            const boxStartTime = Date.now();

            try {
                console.log(`[Scheduled Task] Processing monthly analytics for box: ${boxName} (${boxId})`);

                // 1. Calculate monthly analytics snapshot
                await processBoxAnalyticsSnapshot(boxId, "monthly");
                console.log(`[Scheduled Task] Completed monthly snapshot for box ${boxName}`);

                // 2. Additional monthly tasks can be added here:
                // - Cohort analysis
                // - Subscription health metrics
                // - Long-term trend analysis
                // - Revenue analytics

                const boxDuration = Date.now() - boxStartTime;
                console.log(`[Scheduled Task] Completed monthly analytics for box ${boxName} in ${boxDuration}ms`);

                results.push({
                    boxId,
                    success: true,
                    metrics: { processingTime: boxDuration }
                });

            } catch (error) {
                const boxDuration = Date.now() - boxStartTime;
                console.error(`[Scheduled Task] Failed monthly analytics for box ${boxName} (${boxId}) after ${boxDuration}ms:`, error);

                results.push({
                    boxId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        // Summary
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const totalDuration = Date.now() - startTime;

        console.log(`[Scheduled Task] Completed Monthly Analytics Tasks in ${totalDuration}ms. Success: ${successful}, Failed: ${failed}`);

        // Log failures for monitoring
        if (failed > 0) {
            const failures = results.filter(r => !r.success);
            console.error("[Scheduled Task] Monthly task failures:", failures);
        }

    } catch (error) {
        const totalDuration = Date.now() - startTime;
        console.error(`[Scheduled Task] Critical error in runMonthlyAnalyticsTasks after ${totalDuration}ms:`, error);
        throw error;
    }
}

/**
 * Emergency task to recalculate analytics for a specific box
 * Can be triggered manually or via API
 */
export async function runEmergencyBoxRecalculation(
    boxId: string,
    tasks: ('daily' | 'weekly' | 'monthly' | 'risk_scores')[] = ['daily', 'risk_scores']
): Promise<void> {
    console.log(`[Emergency Task] Starting emergency recalculation for box ${boxId}, tasks: ${tasks.join(', ')}`);
    const startTime = Date.now();

    try {
        // Verify box exists and is active
        const box = await db.select({
            id: boxes.id,
            name: boxes.name,
            status: boxes.status
        }).from(boxes).where(eq(boxes.id, boxId)).limit(1);

        if (!box[0]) {
            throw new Error(`Box ${boxId} not found`);
        }

        if (box[0].status !== 'active') {
            throw new Error(`Box ${boxId} is not active (status: ${box[0].status})`);
        }

        const boxName = box[0].name;
        console.log(`[Emergency Task] Processing emergency tasks for box: ${boxName} (${boxId})`);

        // Execute requested tasks
        for (const task of tasks) {
            const taskStartTime = Date.now();

            try {
                switch (task) {
                    case 'daily':
                        await processBoxAnalyticsSnapshot(boxId, 'daily');
                        break;
                    case 'weekly':
                        await processBoxAnalyticsSnapshot(boxId, 'weekly');
                        break;
                    case 'monthly':
                        await processBoxAnalyticsSnapshot(boxId, 'monthly');
                        break;
                    case 'risk_scores':
                        await recalculateAllRiskScoresForBox(boxId);
                        break;
                    default:
                        console.warn(`[Emergency Task] Unknown task type: ${task}`);
                }

                const taskDuration = Date.now() - taskStartTime;
                console.log(`[Emergency Task] Completed ${task} task for box ${boxName} in ${taskDuration}ms`);

            } catch (error) {
                const taskDuration = Date.now() - taskStartTime;
                console.error(`[Emergency Task] Failed ${task} task for box ${boxName} after ${taskDuration}ms:`, error);
                throw error; // Re-throw to fail the entire emergency task
            }
        }

        const totalDuration = Date.now() - startTime;
        console.log(`[Emergency Task] Completed emergency recalculation for box ${boxName} in ${totalDuration}ms`);

    } catch (error) {
        const totalDuration = Date.now() - startTime;
        console.error(`[Emergency Task] Critical error in emergency recalculation for box ${boxId} after ${totalDuration}ms:`, error);
        throw error;
    }
}

/**
 * Health check for analytics system
 */
export async function runAnalyticsHealthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, { status: 'pass' | 'fail'; message: string; duration?: number }>;
}> {
    console.log('[Health Check] Starting analytics system health check');
    const startTime = Date.now();

    const checks: Record<string, { status: 'pass' | 'fail'; message: string; duration?: number }> = {};

    // Check database connectivity
    try {
        const dbStartTime = Date.now();
        const result = await db.select({ count: count() }).from(boxes).limit(1);
        const dbDuration = Date.now() - dbStartTime;

        checks.database = {
            status: 'pass',
            message: `Database accessible, ${result[0]?.count ?? 0} boxes found`,
            duration: dbDuration
        };
    } catch (error) {
        checks.database = {
            status: 'fail',
            message: `Database error: ${error instanceof Error ? error.message : String(error)}`
        };
    }

    // Check if recent analytics exist
    try {
        const recentStartTime = Date.now();
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        const recentAnalytics = await db.select({ count: count() })
            .from(boxAnalytics)
            .where(gte(boxAnalytics.createdAt, oneDayAgo));

        const recentDuration = Date.now() - recentStartTime;

        checks.recent_analytics = {
            status: recentAnalytics[0]?.count > 0 ? 'pass' : 'fail',
            message: `${recentAnalytics[0]?.count ?? 0} analytics records in last 24 hours`,
            duration: recentDuration
        };
    } catch (error) {
        checks.recent_analytics = {
            status: 'fail',
            message: `Error checking recent analytics: ${error instanceof Error ? error.message : String(error)}`
        };
    }

    // Check if recent risk scores exist
    try {
        const riskStartTime = Date.now();
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        const recentRiskScores = await db.select({ count: count() })
            .from(athleteRiskScores)
            .where(gte(athleteRiskScores.calculatedAt, oneDayAgo));

        const riskDuration = Date.now() - riskStartTime;

        checks.recent_risk_scores = {
            status: recentRiskScores[0]?.count > 0 ? 'pass' : 'fail',
            message: `${recentRiskScores[0]?.count ?? 0} risk scores calculated in last 24 hours`,
            duration: riskDuration
        };
    } catch (error) {
        checks.recent_risk_scores = {
            status: 'fail',
            message: `Error checking recent risk scores: ${error instanceof Error ? error.message : String(error)}`
        };
    }

    // Determine overall status
    const failedChecks = Object.values(checks).filter(check => check.status === 'fail').length;
    const totalChecks = Object.keys(checks).length;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (failedChecks === 0) {
        status = 'healthy';
    } else if (failedChecks < totalChecks) {
        status = 'degraded';
    } else {
        status = 'unhealthy';
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[Health Check] Analytics health check completed in ${totalDuration}ms. Status: ${status}`);

    return { status, checks };
}
