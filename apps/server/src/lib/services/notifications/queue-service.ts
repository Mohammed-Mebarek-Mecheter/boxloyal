// lib/services/notifications/queue-service.ts
import { Client } from "@upstash/qstash";

export interface QueueMessage {
    notificationId: string;
    priority: "low" | "normal" | "high" | "critical";
    scheduledFor?: Date;
    retryCount?: number;
    maxRetries?: number;
    // Optional: Include job type for more specific processing in the webhook handler
    jobType?: string;
    // Optional: Include payload data if needed directly in the message
    payload?: Record<string, any>;
}

interface QueueStatsResponse {
    lag?: number;
    parallelism?: number;
    createdAt?: number;
    updatedAt?: number;
    name?: string;
}

export class QueueService {
    private client: Client;
    private baseUrl: string;

    // Queue names for different priorities
    private static readonly QUEUES = {
        critical: "notifications-critical",
        high: "notifications-high",
        normal: "notifications-normal",
        low: "notifications-low",
        scheduled: "notifications-scheduled",
        retry: "notifications-retry",
    } as const;

    // QStash API base URL
    private static readonly QSTASH_API_URL = "https://qstash.upstash.io/v2";

    constructor() {
        const token = process.env.QSTASH_TOKEN;
        if (!token) {
            throw new Error("QSTASH_TOKEN environment variable is required");
        }

        this.client = new Client({ token });
        // Remove trailing slash and potential extra space
        this.baseUrl = (process.env.NOTIFICATION_WEBHOOK_URL || "https://your-domain.com").replace(/\/\s*$/, '');
    }

    /**
     * Initialize notification queues
     */
    async initializeQueues() {
        const queues = Object.values(QueueService.QUEUES);
        const results = [];

        for (const queueName of queues) {
            try {
                // Create or update queue with appropriate parallelism
                const parallelism = this.getQueueParallelism(queueName);

                const response = await fetch(`${QueueService.QSTASH_API_URL}/queues/`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        queueName,
                        parallelism,
                    })
                });

                if (response.ok) {
                    results.push({ queue: queueName, status: 'created', parallelism });
                } else if (response.status === 412) {
                    results.push({ queue: queueName, status: 'exists', parallelism });
                } else {
                    const errorText = await response.text();
                    throw new Error(`Failed to create queue (${response.status}): ${errorText}`);
                }
            } catch (error) {
                console.error(`Failed to initialize queue ${queueName}:`, error);
                results.push({
                    queue: queueName,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return results;
    }

    /**
     * Queue notification for immediate processing
     */
    async queueNotification(notificationId: string, priority: "low" | "normal" | "high" | "critical" = "normal") {
        const queueName = QueueService.QUEUES[priority];
        // Use a dedicated endpoint for processing individual notifications
        const webhookUrl = `${this.baseUrl}/api/notifications/webhook/process`;

        const message: QueueMessage = {
            notificationId,
            priority,
        };

        try {
            await this.client.publishJSON({
                queueName,
                url: webhookUrl,
                body: message,
                headers: {
                    "X-Notification-ID": notificationId,
                    "X-Priority": priority,
                },
                // Add delay for non-critical messages to batch them
                delay: priority === "critical" ? 0 : this.getBatchDelay(priority),
            });

            console.log(`Queued notification ${notificationId} to ${queueName}`);

            return { success: true, queueName, notificationId };
        } catch (error) {
            console.error(`Failed to queue notification ${notificationId}:`, error);
            throw error;
        }
    }

    /**
     * Schedule notification for future delivery using QStash Schedules
     * This is the key enhancement to enable time-based notifications.
     */
    async scheduleNotification(notificationId: string, scheduledFor: Date, priority: "low" | "normal" | "high" | "critical" = "normal") {
        const webhookUrl = `${this.baseUrl}/api/notifications/webhook/process`;

        const message: QueueMessage = {
            notificationId,
            priority,
            scheduledFor,
            jobType: "scheduled_notification"
        };

        // Ensure the schedule time is in the future
        const scheduleTimeMs = scheduledFor.getTime();
        const nowMs = Date.now();
        if (scheduleTimeMs <= nowMs) {
            console.warn(`Schedule time for notification ${notificationId} is in the past or now. Queuing immediately.`);
            return this.queueNotification(notificationId, priority);
        }

        try {
            // Use QStash Schedules API - fixed URL and response handling
            const response = await fetch(`${QueueService.QSTASH_API_URL}/schedules/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`,
                    'Content-Type': 'application/json',
                    'Upstash-Callback': webhookUrl
                },
                body: JSON.stringify({
                    destination: webhookUrl,
                    cron: `@at(${new Date(scheduleTimeMs).toISOString()})`,
                    body: JSON.stringify(message),
                    headers: {
                        "X-Notification-ID": notificationId,
                        "X-Priority": priority,
                        "X-Scheduled-For": scheduledFor.toISOString(),
                        "Content-Type": "application/json"
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to schedule notification via QStash API (${response.status}): ${errorText}`);
            }

            const scheduleData = await response.json() as { scheduleId: string };
            const scheduleId = scheduleData.scheduleId;

            console.log(`Scheduled notification ${notificationId} for ${scheduledFor.toISOString()} with schedule ID ${scheduleId}`);

            return { success: true, scheduledFor, notificationId, scheduleId };
        } catch (error) {
            console.error(`Failed to schedule notification ${notificationId}:`, error);
            throw error;
        }
    }


    /**
     * Queue notification retry
     */
    async queueRetry(notificationId: string, retryCount: number, delaySeconds: number = 60) {
        const webhookUrl = `${this.baseUrl}/api/notifications/webhook/retry`;

        const message: QueueMessage = {
            notificationId,
            priority: "normal", // Retries can potentially use a specific priority queue if needed
            retryCount,
            maxRetries: 3,
            jobType: "retry_notification"
        };

        try {
            await this.client.publishJSON({
                queueName: QueueService.QUEUES.retry,
                url: webhookUrl,
                body: message,
                delay: delaySeconds,
                headers: {
                    "X-Notification-ID": notificationId,
                    "X-Retry-Count": retryCount.toString(),
                },
            });

            console.log(`Queued retry ${retryCount} for notification ${notificationId}`);

            return { success: true, retryCount, delaySeconds };
        } catch (error) {
            console.error(`Failed to queue retry for notification ${notificationId}:`, error);
            throw error;
        }
    }

    /**
     * Queue batch notification processing
     */
    async queueBatch(notificationIds: string[], priority: "low" | "normal" | "high" | "critical" = "normal") {
        const queueName = QueueService.QUEUES[priority];
        const webhookUrl = `${this.baseUrl}/api/notifications/webhook/batch`;

        const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const message: QueueMessage = {
            notificationId: batchId, // Use batchId as a pseudo-notificationId for tracking
            priority,
            jobType: "batch_notification",
            payload: {
                batchId,
                notificationIds,
            }
        };

        try {
            await this.client.publishJSON({
                queueName,
                url: webhookUrl,
                body: message, // Send the structured message
                headers: {
                    "X-Batch-ID": batchId,
                    "X-Batch-Size": notificationIds.length.toString(),
                    "X-Priority": priority,
                },
            });

            console.log(`Queued batch ${batchId} with ${notificationIds.length} notifications`);

            return { success: true, batchId, count: notificationIds.length };
        } catch (error) {
            console.error(`Failed to queue notification batch:`, error);
            throw error;
        }
    }

    /**
     * Get queue statistics
     */
    async getQueueStats() {
        const stats: Record<string, any> = {};

        for (const [priority, queueName] of Object.entries(QueueService.QUEUES)) {
            try {
                const response = await fetch(`${QueueService.QSTASH_API_URL}/queues/${queueName}`, {
                    headers: {
                        'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`
                    }
                });

                if (response.ok) {
                    const data = await response.json() as QueueStatsResponse;
                    stats[priority] = {
                        name: queueName,
                        lag: data.lag || 0,
                        parallelism: data.parallelism || 1,
                        createdAt: data.createdAt,
                        updatedAt: data.updatedAt,
                    };
                } else {
                    const errorText = await response.text();
                    stats[priority] = {
                        name: queueName,
                        error: `HTTP ${response.status}: ${errorText}`,
                    };
                }
            } catch (error) {
                stats[priority] = {
                    name: queueName,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }

        return stats;
    }

    /**
     * Pause a queue
     */
    async pauseQueue(priority: keyof typeof QueueService.QUEUES) {
        const queueName = QueueService.QUEUES[priority];

        try {
            const response = await fetch(`${QueueService.QSTASH_API_URL}/queues/${queueName}/pause`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`
                }
            });

            if (response.ok) {
                console.log(`Paused queue ${queueName}`);
                return { success: true, queue: queueName, action: 'paused' };
            } else {
                const errorText = await response.text();
                throw new Error(`Failed to pause queue (${response.status}): ${errorText}`);
            }
        } catch (error) {
            console.error(`Failed to pause queue ${queueName}:`, error);
            throw error;
        }
    }

    /**
     * Resume a queue
     */
    async resumeQueue(priority: keyof typeof QueueService.QUEUES) {
        const queueName = QueueService.QUEUES[priority];

        try {
            const response = await fetch(`${QueueService.QSTASH_API_URL}/queues/${queueName}/resume`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`
                }
            });

            if (response.ok) {
                console.log(`Resumed queue ${queueName}`);
                return { success: true, queue: queueName, action: 'resumed' };
            } else {
                const errorText = await response.text();
                throw new Error(`Failed to resume queue (${response.status}): ${errorText}`);
            }
        } catch (error) {
            console.error(`Failed to resume queue ${queueName}:`, error);
            throw error;
        }
    }

    /**
     * Get parallelism setting for queue
     */
    private getQueueParallelism(queueName: string): number {
        // Set parallelism based on queue priority
        if (queueName.includes('critical')) return 10;
        if (queueName.includes('high')) return 8;
        if (queueName.includes('normal')) return 5;
        if (queueName.includes('low')) return 3;
        if (queueName.includes('retry')) return 2;
        return 5; // default
    }

    /**
     * Get batch delay for non-critical notifications
     */
    private getBatchDelay(priority: "low" | "normal" | "high" | "critical"): number {
        switch (priority) {
            case 'critical': return 0;
            case 'high': return 30; // 30 seconds
            case 'normal': return 120; // 2 minutes
            case 'low': return 300; // 5 minutes
            default: return 120;
        }
    }

    /**
     * Cancel a scheduled notification (using QStash Schedule ID)
     * @param scheduleId The ID of the schedule returned by scheduleNotification
     */
    async cancelScheduledNotification(scheduleId: string) {
        try {
            const response = await fetch(`${QueueService.QSTASH_API_URL}/schedules/${scheduleId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`
                }
            });

            if (response.ok) {
                console.log(`Cancelled scheduled notification with schedule ID ${scheduleId}`);
                return { success: true, scheduleId };
            } else {
                const errorText = await response.text();
                throw new Error(`Failed to cancel scheduled notification (${response.status}): ${errorText}`);
            }
        } catch (error) {
            console.error(`Failed to cancel scheduled notification ${scheduleId}:`, error);
            throw error;
        }
    }
}
