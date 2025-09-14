// lib/services/notifications/queue-service.ts
import { Client } from "@upstash/qstash";

export interface QueueMessage {
    notificationId: string;
    priority: "low" | "normal" | "high" | "critical";
    scheduledFor?: Date;
    retryCount?: number;
    maxRetries?: number;
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

    constructor() {
        const token = process.env.QSTASH_TOKEN;
        if (!token) {
            throw new Error("QSTASH_TOKEN environment variable is required");
        }

        this.client = new Client({ token });
        this.baseUrl = process.env.NOTIFICATION_WEBHOOK_URL || "https://your-domain.com";
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

                const response = await fetch('https://qstash.upstash.io/v2/queues/', {
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
                    throw new Error(`Failed to create queue: ${response.statusText}`);
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
     * Queue notification for processing
     */
    async queueNotification(notificationId: string, priority: "low" | "normal" | "high" | "critical" = "normal") {
        const queueName = QueueService.QUEUES[priority];
        const webhookUrl = `${this.baseUrl}/webhooks/notifications/process`;

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
     * Schedule notification for future delivery
     */
    async scheduleNotification(notificationId: string, scheduledFor: Date) {
        const webhookUrl = `${this.baseUrl}/webhooks/notifications/process`;
        const delay = Math.max(0, scheduledFor.getTime() - Date.now());

        const message: QueueMessage = {
            notificationId,
            priority: "normal",
            scheduledFor,
        };

        try {
            await this.client.publishJSON({
                queueName: QueueService.QUEUES.scheduled,
                url: webhookUrl,
                body: message,
                delay: Math.floor(delay / 1000), // QStash expects seconds
                headers: {
                    "X-Notification-ID": notificationId,
                    "X-Scheduled-For": scheduledFor.toISOString(),
                },
            });

            console.log(`Scheduled notification ${notificationId} for ${scheduledFor.toISOString()}`);

            return { success: true, scheduledFor, notificationId };
        } catch (error) {
            console.error(`Failed to schedule notification ${notificationId}:`, error);
            throw error;
        }
    }

    /**
     * Queue notification retry
     */
    async queueRetry(notificationId: string, retryCount: number, delaySeconds: number = 60) {
        const webhookUrl = `${this.baseUrl}/webhooks/notifications/retry`;

        const message: QueueMessage = {
            notificationId,
            priority: "normal",
            retryCount,
            maxRetries: 3,
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
        const webhookUrl = `${this.baseUrl}/webhooks/notifications/batch`;

        const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        try {
            await this.client.publishJSON({
                queueName,
                url: webhookUrl,
                body: {
                    batchId,
                    notificationIds,
                    priority,
                },
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
                const response = await fetch(`https://qstash.upstash.io/v2/queues/${queueName}`, {
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
                    stats[priority] = {
                        name: queueName,
                        error: `HTTP ${response.status}`,
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
            const response = await fetch(`https://qstash.upstash.io/v2/queues/${queueName}/pause`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`
                }
            });

            if (response.ok) {
                console.log(`Paused queue ${queueName}`);
                return { success: true, queue: queueName, action: 'paused' };
            } else {
                throw new Error(`Failed to pause queue: ${response.statusText}`);
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
            const response = await fetch(`https://qstash.upstash.io/v2/queues/${queueName}/resume`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`
                }
            });

            if (response.ok) {
                console.log(`Resumed queue ${queueName}`);
                return { success: true, queue: queueName, action: 'resumed' };
            } else {
                throw new Error(`Failed to resume queue: ${response.statusText}`);
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
    private getBatchDelay(priority: string): number {
        switch (priority) {
            case 'critical': return 0;
            case 'high': return 30; // 30 seconds
            case 'normal': return 120; // 2 minutes
            case 'low': return 300; // 5 minutes
            default: return 120;
        }
    }
}
