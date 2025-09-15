// src/index.ts
import { env } from "cloudflare:workers";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "./lib/context";
import { appRouter } from "@/routers";
import { auth } from "./lib/auth";
import { type Env, Hono } from "hono";
import { cors } from "hono/cors";
import { timing } from "hono/timing";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "@/lib/logger";
import {
    runDailyAnalyticsTasks,
    runMonthlyAnalyticsTasks,
    runWeeklyAnalyticsTasks,
    runEmergencyBoxRecalculation,
    runAnalyticsHealthCheck
} from "@/lib/services/analytics/scheduled-tasks";
import {
    handleAnalyticsEvent,
    handleBatchAnalyticsEvents,
    type QStashAnalyticsEvent
} from "@/lib/services/analytics/qstash-event-handler";

const app = new Hono();

// Security and logging middleware
app.use(timing());
app.use(secureHeaders());

// CORS configuration
app.use(
    "/*",
    cors({
        origin: env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: [
            "Content-Type",
            "Authorization",
            "X-Requested-With",
            "X-Request-ID"
        ],
        credentials: true,
        maxAge: 86400, // 24 hours
    }),
);

// Health check endpoint
app.get("/health", (c) => {
    return c.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: env.APP_VERSION || "development",
    });
});

// Analytics system health check
app.get("/health/analytics", async (c) => {
    try {
        const healthCheck = await runAnalyticsHealthCheck();

        const statusCode = healthCheck.status === 'healthy' ? 200 :
            healthCheck.status === 'degraded' ? 200 : 503;

        return c.json(healthCheck, statusCode);
    } catch (error) {
        logger.error("Analytics health check failed", error);
        return c.json({
            status: "unhealthy",
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: new Date().toISOString()
        }, 503);
    }
});

// Authentication routes
app.on(["POST", "GET"], "/api/auth/**", (c) => {
    logger.info("Auth request", {
        method: c.req.method,
        path: c.req.path
    });
    return auth.handler(c.req.raw);
});

// tRPC server
app.use(
    "/trpc/*",
    trpcServer({
        router: appRouter,
        createContext: (_opts, context) => {
            return createContext({ context });
        },
        onError: ({ error, path, type, ctx }) => {
            logger.error(`tRPC error on ${type} ${path}`, error, {
                userId: ctx.session?.user?.id,
            });
        },
    }),
);

// API status endpoint
app.get("/api", (c) => {
    return c.json({
        message: "BoxLoyal API",
        version: env.APP_VERSION || "development",
        environment: env.NODE_ENV || "development",
    });
});

// --- Analytics Event Processing Endpoints ---

// Single analytics event processing
app.post('/api/analytics/events', async (c) => {
    try {
        const eventPayload: QStashAnalyticsEvent = await c.req.json();
        console.log("Received analytics event:", eventPayload);

        const result = await handleAnalyticsEvent(eventPayload, c.env);

        const statusCode = result.success ? 200 : 400;
        return c.json({
            success: result.success,
            result,
            message: result.success ? "Event processed successfully" : "Event processing failed"
        }, statusCode);
    } catch (error) {
        logger.error("Error processing analytics event:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Processing failed",
            message: "Invalid event payload or processing error"
        }, 400);
    }
});

// Batch analytics event processing
app.post('/api/analytics/events/batch', async (c) => {
    try {
        const { events }: { events: QStashAnalyticsEvent[] } = await c.req.json();

        if (!Array.isArray(events) || events.length === 0) {
            return c.json({
                success: false,
                error: "Invalid events array"
            }, 400);
        }

        console.log(`Received batch of ${events.length} analytics events`);

        const batchResult = await handleBatchAnalyticsEvents(events, c.env);

        return c.json({
            success: batchResult.summary.failed === 0,
            batchResult,
            message: `Processed ${batchResult.summary.total} events. Success: ${batchResult.summary.successful}, Failed: ${batchResult.summary.failed}`
        });
    } catch (error) {
        logger.error("Error processing batch analytics events:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Batch processing failed"
        }, 500);
    }
});

// QStash webhook endpoint (legacy support)
app.post('/process-analytics-event', async (c) => {
    try {
        const eventPayload: QStashAnalyticsEvent = await c.req.json();
        console.log("Received QStash analytics event:", eventPayload);

        const result = await handleAnalyticsEvent(eventPayload, c.env);
        return c.json({
            success: result.success,
            message: result.success ? "Event processed" : "Processing failed",
            result
        });
    } catch (error) {
        logger.error("Error processing QStash event:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Processing failed"
        }, 500);
    }
});

// --- Manual Analytics Triggers (for testing/debugging) ---

// Trigger emergency recalculation for a specific box
app.post('/api/analytics/emergency/:boxId', async (c) => {
    try {
        const boxId = c.req.param('boxId');
        const { tasks } = await c.req.json();

        if (!boxId) {
            return c.json({ success: false, error: "Box ID is required" }, 400);
        }

        console.log(`Manual emergency recalculation triggered for box ${boxId}`);

        await runEmergencyBoxRecalculation(boxId, tasks);

        return c.json({
            success: true,
            message: `Emergency recalculation completed for box ${boxId}`,
            boxId,
            tasks: tasks || ['daily', 'risk_scores']
        });
    } catch (error) {
        logger.error("Error in emergency recalculation:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Recalculation failed"
        }, 500);
    }
});

// Manual trigger for daily analytics (for testing)
app.post('/api/analytics/manual/daily', async (c) => {
    try {
        console.log("Manual daily analytics trigger received");
        await runDailyAnalyticsTasks(c.env);
        return c.json({
            success: true,
            message: "Daily analytics tasks completed manually"
        });
    } catch (error) {
        logger.error("Error in manual daily analytics:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Daily analytics failed"
        }, 500);
    }
});

// Manual trigger for weekly analytics (for testing)
app.post('/api/analytics/manual/weekly', async (c) => {
    try {
        console.log("Manual weekly analytics trigger received");
        await runWeeklyAnalyticsTasks(c.env);
        return c.json({
            success: true,
            message: "Weekly analytics tasks completed manually"
        });
    } catch (error) {
        logger.error("Error in manual weekly analytics:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Weekly analytics failed"
        }, 500);
    }
});

// Manual trigger for monthly analytics (for testing)
app.post('/api/analytics/manual/monthly', async (c) => {
    try {
        console.log("Manual monthly analytics trigger received");
        await runMonthlyAnalyticsTasks(c.env);
        return c.json({
            success: true,
            message: "Monthly analytics tasks completed manually"
        });
    } catch (error) {
        logger.error("Error in manual monthly analytics:", error);
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Monthly analytics failed"
        }, 500);
    }
});

// --- Status and Monitoring Endpoints ---

// Get analytics processing status
app.get('/api/analytics/status', async (c) => {
    try {
        // This could be expanded to check queue status, recent processing times, etc.
        return c.json({
            status: "operational",
            lastUpdated: new Date().toISOString(),
            endpoints: {
                singleEvent: "/api/analytics/events",
                batchEvents: "/api/analytics/events/batch",
                emergencyRecalc: "/api/analytics/emergency/:boxId",
                healthCheck: "/health/analytics"
            },
            scheduledTasks: {
                daily: "0 2 * * * (Daily at 2 AM UTC)",
                weekly: "0 3 * * 0 (Sunday at 3 AM UTC)",
                monthly: "0 4 1 * * (1st of month at 4 AM UTC)"
            }
        });
    } catch (error) {
        logger.error("Error getting analytics status:", error);
        return c.json({
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error"
        }, 500);
    }
});

// Catch-all for unmatched routes
app.notFound((c) => {
    logger.warn("Route not found", {
        path: c.req.path,
        method: c.req.method
    });
    return c.json({ error: "Not found" }, 404);
});

// Global error handler
app.onError((err, c) => {
    logger.error("Unhandled error", err, {
        path: c.req.path,
        method: c.req.method
    });
    return c.json({ error: "Internal server error" }, 500);
});

// --- Scheduled Task Handler ---
export default {
    fetch: app.fetch,
    async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
        const cronExpression = controller.cron;
        const scheduledTime = new Date(controller.scheduledTime);

        console.log(`[Worker] Cron job triggered: ${cronExpression} at ${scheduledTime.toISOString()}`);

        // Use waitUntil to ensure task completion even if response is sent
        const taskPromise = (async () => {
            switch (cronExpression) {
                case "0 2 * * *": // Daily at 2 AM UTC
                    try {
                        console.log("[Worker] Starting daily analytics tasks");
                        await runDailyAnalyticsTasks(env);
                        console.log("[Worker] Daily analytics tasks completed successfully");
                    } catch (error) {
                        console.error("[Worker] Error in daily analytics tasks:", error);
                        // In a production system, you might want to send alerts here
                    }
                    break;

                case "0 3 * * 0": // Weekly on Sunday at 3 AM UTC
                    try {
                        console.log("[Worker] Starting weekly analytics tasks");
                        await runWeeklyAnalyticsTasks(env);
                        console.log("[Worker] Weekly analytics tasks completed successfully");
                    } catch (error) {
                        console.error("[Worker] Error in weekly analytics tasks:", error);
                        // In a production system, you might want to send alerts here
                    }
                    break;

                case "0 4 1 * *": // Monthly on the 1st at 4 AM UTC
                    try {
                        console.log("[Worker] Starting monthly analytics tasks");
                        await runMonthlyAnalyticsTasks(env);
                        console.log("[Worker] Monthly analytics tasks completed successfully");
                    } catch (error) {
                        console.error("[Worker] Error in monthly analytics tasks:", error);
                        // In a production system, you might want to send alerts here
                    }
                    break;

                case "0 1 * * *": // Daily cleanup at 1 AM UTC (optional additional task)
                    try {
                        console.log("[Worker] Starting daily cleanup tasks");
                        // Run cleanup tasks like expired risk scores
                        // This could be moved to a separate function
                        console.log("[Worker] Daily cleanup tasks completed successfully");
                    } catch (error) {
                        console.error("[Worker] Error in daily cleanup tasks:", error);
                    }
                    break;

                default:
                    console.warn(`[Worker] No handler defined for cron expression: ${cronExpression}`);
            }
        })();

        // Ensure the task completes even if the worker response is sent
        ctx.waitUntil(taskPromise);
    },
};
