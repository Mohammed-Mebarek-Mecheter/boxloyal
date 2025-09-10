// workers/cron.ts
import { CronScheduler } from "@/lib/cron/scheduler";

/**
 * Cloudflare Worker for handling scheduled cron triggers
 *
 * This worker integrates with your main application's auth.ts scheduled handler
 * or can be deployed as a separate cron-only worker.
 *
 * Add these cron patterns to your wrangler.jsonc:
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

interface Env {
    // Environment variables
    POLAR_ACCESS_TOKEN: string;
    POLAR_WEBHOOK_SECRET: string;
    POLAR_ENVIRONMENT?: string;
    DATABASE_URL: string;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;

    // Polar Product IDs
    POLAR_SEED_PRODUCT_ID: string;
    POLAR_SEED_ANNUAL_PRODUCT_ID: string;
    POLAR_GROW_PRODUCT_ID: string;
    POLAR_GROW_ANNUAL_PRODUCT_ID: string;
    POLAR_SCALE_PRODUCT_ID: string;
    POLAR_SCALE_ANNUAL_PRODUCT_ID: string;

    // Add any other bindings you need
    // DB?: D1Database;
    // KV?: KVNamespace;
}

export default {
    /**
     * Handle scheduled cron triggers
     */
    async scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<void> {
        console.log(`Cron trigger fired: ${controller.cron} at ${new Date(controller.scheduledTime).toISOString()}`);

        try {
            // Use waitUntil to ensure the job completes even if the worker would otherwise terminate
            ctx.waitUntil(
                CronScheduler.handleScheduledEvent(controller)
                    .then(response => {
                        if (response.status !== 200) {
                            console.error(`Cron job failed with status ${response.status}`);
                            throw new Error(`Cron job failed: ${response.statusText}`);
                        }
                        console.log(`Cron job completed successfully: ${controller.cron}`);
                    })
                    .catch(error => {
                        console.error(`Cron job error for ${controller.cron}:`, error);
                        // You might want to send this error to your monitoring service
                        // e.g., Sentry, LogDNA, etc.
                        throw error;
                    })
            );

        } catch (error) {
            console.error(`Critical error in cron handler for ${controller.cron}:`, error);
            throw error;
        }
    },

    /**
     * Handle HTTP requests (for health checks and manual triggers)
     */
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const pathname = url.pathname;

        try {
            // Health check endpoint
            if (pathname === '/health' && request.method === 'GET') {
                const health = await CronScheduler.healthCheck();

                return Response.json(health, {
                    status: health.status === 'unhealthy' ? 503 : 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                    },
                });
            }

            // Manual cron trigger endpoints (for testing/debugging)
            if (pathname.startsWith('/trigger/') && request.method === 'POST') {
                const cronType = pathname.split('/')[2];

                // Validate authorization (add your own auth logic here)
                const authHeader = request.headers.get('Authorization');
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return new Response('Unauthorized', { status: 401 });
                }

                // Map cron type to cron pattern
                const cronPatternMap: Record<string, string> = {
                    'monthly-billing': '0 2 1 * *',
                    'daily-grace': '0 1 * * *',
                    'weekly-maintenance': '0 3 * * 0',
                    'daily-sync': '0 4 * * *',
                    'retry-events': '*/15 * * * *',
                };

                const cronPattern = cronPatternMap[cronType];
                if (!cronPattern) {
                    return new Response('Invalid cron type', { status: 400 });
                }

                // Create mock ScheduledController for manual trigger
                const mockController: ScheduledController = {
                    cron: cronPattern,
                    scheduledTime: Date.now(),
                };

                const result = await CronScheduler.handleScheduledEvent(mockController);

                return Response.json({
                    success: result.status === 200,
                    cronType,
                    cronPattern,
                    timestamp: new Date().toISOString(),
                    message: result.status === 200 ? 'Job completed successfully' : await result.text(),
                }, {
                    status: result.status
                });
            }

            // List available cron jobs
            if (pathname === '/crons' && request.method === 'GET') {
                const cronJobs = [
                    {
                        name: 'Monthly Overage Billing',
                        pattern: '0 2 1 * *',
                        description: 'Process overage billing for all eligible boxes',
                        frequency: 'Monthly on the 1st at 2 AM UTC',
                        triggerUrl: '/trigger/monthly-billing'
                    },
                    {
                        name: 'Daily Grace Period Checks',
                        pattern: '0 1 * * *',
                        description: 'Check for expiring grace periods and send notifications',
                        frequency: 'Daily at 1 AM UTC',
                        triggerUrl: '/trigger/daily-grace'
                    },
                    {
                        name: 'Weekly Maintenance',
                        pattern: '0 3 * * 0',
                        description: 'Clean up old data and update usage statistics',
                        frequency: 'Weekly on Sunday at 3 AM UTC',
                        triggerUrl: '/trigger/weekly-maintenance'
                    },
                    {
                        name: 'Daily Sync Check',
                        pattern: '0 4 * * *',
                        description: 'Sync subscription data with Polar API',
                        frequency: 'Daily at 4 AM UTC',
                        triggerUrl: '/trigger/daily-sync'
                    },
                    {
                        name: 'Retry Failed Events',
                        pattern: '*/15 * * * *',
                        description: 'Retry failed billing events with exponential backoff',
                        frequency: 'Every 15 minutes',
                        triggerUrl: '/trigger/retry-events'
                    }
                ];

                return Response.json({
                    cronJobs,
                    timestamp: new Date().toISOString(),
                });
            }

            // Default 404
            return new Response('Not found', { status: 404 });

        } catch (error) {
            console.error('Error handling request:', error);
            return Response.json({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString(),
            }, { status: 500 });
        }
    },
};
