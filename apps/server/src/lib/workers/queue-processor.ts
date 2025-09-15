// src/lib/workers/queue-processor.ts
import { RiskScoreWorker, type RiskScoreMessage } from "./analytics/risk-score-worker";
import { logger } from "@/lib/logger";

export interface QueueMessage {
    id: string;
    type: string;
    priority: "low" | "normal" | "high" | "critical";
    data: Record<string, any>;
    createdAt: number;
    attemptCount?: number;
    maxAttempts?: number;
}

export interface ProcessingResult {
    success: boolean;
    messageId: string;
    messageType: string;
    duration: number;
    error?: string;
    shouldRetry?: boolean;
}

export class QueueProcessor {
    private static readonly MAX_RETRY_ATTEMPTS = 3;
    private static readonly RETRY_DELAYS = {
        1: 30,    // 30 seconds
        2: 300,   // 5 minutes
        3: 1800   // 30 minutes
    } as const;

    /**
     * Main entry point for processing queue messages
     */
    static async process(rawMessage: any): Promise<ProcessingResult> {
        const startTime = Date.now();
        let message: QueueMessage;

        try {
            // Parse and validate message
            message = this.parseMessage(rawMessage);

            logger.info("Queue processor started", {
                messageId: message.id,
                type: message.type,
                priority: message.priority,
                attemptCount: message.attemptCount || 1
            });

            // Route message to appropriate worker
            await this.routeMessage(message);

            const duration = Date.now() - startTime;

            logger.info("Queue processor completed successfully", {
                messageId: message.id,
                type: message.type,
                duration: `${duration}ms`
            });

            return {
                success: true,
                messageId: message.id,
                messageType: message.type,
                duration
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            const messageId = message?.id || 'unknown';
            const messageType = message?.type || 'unknown';
            const attemptCount = message?.attemptCount || 1;

            logger.error("Queue processor failed", error as Error, {
                messageId,
                type: messageType,
                attemptCount,
                duration: `${duration}ms`
            });

            // Determine if we should retry
            const shouldRetry = attemptCount < this.MAX_RETRY_ATTEMPTS && this.isRetryableError(error as Error);

            return {
                success: false,
                messageId,
                messageType,
                duration,
                error: (error as Error).message,
                shouldRetry
            };
        }
    }

    /**
     * Parse and validate incoming message
     */
    private static parseMessage(rawMessage: any): QueueMessage {
        // Handle different message formats
        let messageData: any;

        if (typeof rawMessage === 'string') {
            try {
                messageData = JSON.parse(rawMessage);
            } catch {
                throw new Error("Invalid JSON message format");
            }
        } else if (typeof rawMessage === 'object' && rawMessage !== null) {
            messageData = rawMessage;
        } else {
            throw new Error("Invalid message format");
        }

        // Extract message properties (handle both direct format and nested format)
        const id = messageData.id || messageData.messageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const type = messageData.type || messageData.jobType || 'unknown';
        const priority = messageData.priority || 'normal';
        const data = messageData.data || messageData.payload || messageData;
        const createdAt = messageData.createdAt || messageData.timestamp || Date.now();
        const attemptCount = messageData.attemptCount || 1;
        const maxAttempts = messageData.maxAttempts || this.MAX_RETRY_ATTEMPTS;

        // Validate required fields
        if (!type) {
            throw new Error("Message type is required");
        }

        return {
            id,
            type,
            priority,
            data,
            createdAt,
            attemptCount,
            maxAttempts
        };
    }

    /**
     * Route message to appropriate worker based on type
     */
    private static async routeMessage(message: QueueMessage): Promise<void> {
        switch (message.type) {
            case 'risk_score_calculation':
            case 'risk_score_individual':
                await this.processRiskScoreIndividual(message);
                break;

            case 'risk_score_batch':
                await this.processRiskScoreBatch(message);
                break;

            case 'risk_score_box':
                await this.processRiskScoreBox(message);
                break;

            // Add other worker types here as you expand
            case 'box_aggregates':
                await this.processBoxAggregates(message);
                break;

            case 'cohort_analysis':
                await this.processCohortAnalysis(message);
                break;

            default:
                logger.warn("Unknown message type received", {
                    type: message.type,
                    messageId: message.id
                });
                throw new Error(`Unknown message type: ${message.type}`);
        }
    }

    /**
     * Process individual risk score calculation
     */
    private static async processRiskScoreIndividual(message: QueueMessage): Promise<void> {
        const riskScoreMessage: RiskScoreMessage = {
            type: "individual",
            membershipId: message.data.membershipId,
            priority: message.priority
        };

        if (!riskScoreMessage.membershipId) {
            throw new Error("membershipId is required for individual risk score calculation");
        }

        await RiskScoreWorker.process(riskScoreMessage);
    }

    /**
     * Process batch risk score calculations
     */
    private static async processRiskScoreBatch(message: QueueMessage): Promise<void> {
        const riskScoreMessage: RiskScoreMessage = {
            type: "batch",
            membershipIds: message.data.membershipIds,
            priority: message.priority
        };

        if (!riskScoreMessage.membershipIds || !Array.isArray(riskScoreMessage.membershipIds)) {
            throw new Error("membershipIds array is required for batch risk score calculation");
        }

        await RiskScoreWorker.process(riskScoreMessage);
    }

    /**
     * Process box-wide risk score calculations
     */
    private static async processRiskScoreBox(message: QueueMessage): Promise<void> {
        const riskScoreMessage: RiskScoreMessage = {
            type: "box",
            boxId: message.data.boxId,
            priority: message.priority
        };

        if (!riskScoreMessage.boxId) {
            throw new Error("boxId is required for box risk score calculation");
        }

        await RiskScoreWorker.process(riskScoreMessage);
    }

    /**
     * Process box aggregates (placeholder for future implementation)
     */
    private static async processBoxAggregates(message: QueueMessage): Promise<void> {
        logger.info("Box aggregates processing", { messageId: message.id });
        // TODO: Implement BoxAggregatesWorker when ready
        throw new Error("Box aggregates processing not yet implemented");
    }

    /**
     * Process cohort analysis (placeholder for future implementation)
     */
    private static async processCohortAnalysis(message: QueueMessage): Promise<void> {
        logger.info("Cohort analysis processing", { messageId: message.id });
        // TODO: Implement CohortAnalysisWorker when ready
        throw new Error("Cohort analysis processing not yet implemented");
    }

    /**
     * Determine if an error is retryable
     */
    private static isRetryableError(error: Error): boolean {
        const retryablePatterns = [
            /network/i,
            /timeout/i,
            /connection/i,
            /rate limit/i,
            /temporary/i,
            /service unavailable/i,
            /internal server error/i
        ];

        const nonRetryablePatterns = [
            /not found/i,
            /unauthorized/i,
            /forbidden/i,
            /bad request/i,
            /validation/i,
            /missing.*required/i,
            /invalid.*format/i
        ];

        const errorMessage = error.message.toLowerCase();

        // Check non-retryable patterns first
        if (nonRetryablePatterns.some(pattern => pattern.test(errorMessage))) {
            return false;
        }

        // Check retryable patterns
        if (retryablePatterns.some(pattern => pattern.test(errorMessage))) {
            return true;
        }

        // Default to retryable for unknown errors (conservative approach)
        return true;
    }

    /**
     * Get retry delay for attempt number
     */
    static getRetryDelay(attemptCount: number): number {
        return this.RETRY_DELAYS[attemptCount as keyof typeof this.RETRY_DELAYS] || 1800;
    }

    /**
     * Create a retry message
     */
    static createRetryMessage(originalMessage: QueueMessage, error: Error): QueueMessage {
        return {
            ...originalMessage,
            id: `${originalMessage.id}_retry_${originalMessage.attemptCount || 1}`,
            attemptCount: (originalMessage.attemptCount || 1) + 1,
            data: {
                ...originalMessage.data,
                originalError: error.message,
                originalAttempt: originalMessage.attemptCount || 1
            }
        };
    }
}
