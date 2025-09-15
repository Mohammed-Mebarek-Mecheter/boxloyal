// src/lib/workers/analytics/risk-score-worker.ts
import { RiskScoreService } from "@/lib/services/analytics/risk-score-service";
import { logger } from "@/lib/logger";

export interface RiskScoreMessage {
    type: "individual" | "batch" | "box";
    membershipId?: string;
    membershipIds?: string[];
    boxId?: string;
    priority?: "low" | "normal" | "high";
}

export class RiskScoreWorker {
    /**
     * Process individual risk score calculation
     */
    static async processIndividual(message: RiskScoreMessage): Promise<void> {
        if (!message.membershipId) {
            throw new Error("Missing membershipId for individual calculation");
        }

        logger.info("Processing individual risk score", { membershipId: message.membershipId });

        await RiskScoreService.calculateRiskScore(message.membershipId);

        logger.info("Individual risk score completed", { membershipId: message.membershipId });
    }

    /**
     * Process batch risk score calculations
     */
    static async processBatch(message: RiskScoreMessage): Promise<void> {
        if (!message.membershipIds || message.membershipIds.length === 0) {
            throw new Error("Missing or empty membershipIds for batch calculation");
        }

        logger.info("Processing batch risk scores", {
            count: message.membershipIds.length,
            priority: message.priority
        });

        const results = {
            total: message.membershipIds.length,
            successful: 0,
            failed: 0,
            errors: [] as Array<{ membershipId: string; error: string }>
        };

        // Process each membership
        for (const membershipId of message.membershipIds) {
            try {
                await RiskScoreService.calculateRiskScore(membershipId);
                results.successful++;
            } catch (error) {
                results.failed++;
                results.errors.push({
                    membershipId,
                    error: (error as Error).message
                });
                logger.error("Failed batch risk score calculation", error as Error, { membershipId });
            }
        }

        logger.info("Batch risk score processing completed", results);

        // Log errors if any
        if (results.errors.length > 0) {
            logger.warn("Batch processing had errors", {
                errorCount: results.errors.length,
                errors: results.errors.slice(0, 5) // Log first 5 errors
            });
        }
    }

    /**
     * Process entire box risk score calculations
     */
    static async processBox(message: RiskScoreMessage): Promise<void> {
        if (!message.boxId) {
            throw new Error("Missing boxId for box calculation");
        }

        logger.info("Processing box risk scores", { boxId: message.boxId });

        await RiskScoreService.calculateBoxRiskScores(message.boxId);

        logger.info("Box risk score processing completed", { boxId: message.boxId });
    }

    /**
     * Main worker entry point
     */
    static async process(message: RiskScoreMessage): Promise<void> {
        try {
            const startTime = Date.now();

            logger.info("Risk score worker started", {
                type: message.type,
                priority: message.priority
            });

            switch (message.type) {
                case "individual":
                    await this.processIndividual(message);
                    break;

                case "batch":
                    await this.processBatch(message);
                    break;

                case "box":
                    await this.processBox(message);
                    break;

                default:
                    throw new Error(`Unknown risk score calculation type: ${message.type}`);
            }

            const duration = Date.now() - startTime;
            logger.info("Risk score worker completed", {
                type: message.type,
                duration: `${duration}ms`
            });

        } catch (error) {
            logger.error("Risk score worker failed", error as Error, {
                message: JSON.stringify(message, null, 2)
            });
            throw error;
        }
    }
}
