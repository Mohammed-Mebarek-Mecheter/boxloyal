// lib/services/analytics/analytics-calculations.ts
import {
    updateBoxCurrentCounts,
    cleanupExpiredRiskScores,
    recalculateAllRiskScoresForBox,
    processAthleteAlertsForBox,
    processBoxAnalyticsSnapshot,
    processAlertEffectiveness,
    processAutoEscalations,
    processAthleteSegmentAnalytics,
    processCoachPerformanceMetrics,
    processCohortAnalytics,
    processInterventionSuggestions,
    processInterventionOutcomes,
    processMilestones,
    processRetentionEvents,
    getBoxRiskFactorAnalytics,
    processWellnessPerformanceCorrelations
} from './calculations';

/**
 * Orchestration function to run full analytics pipeline for a box
 * This runs all analytics calculations in the proper sequence
 */
export async function runFullAnalyticsPipeline(boxId: string) {
    try {
        console.log(`[Analytics Pipeline] Starting full analytics pipeline for box ${boxId}`);
        const startTime = Date.now();

        // Step 1: Update current counts (for subscription management)
        console.log(`[Analytics Pipeline] Step 1: Updating box counts`);
        const countResults = await updateBoxCurrentCounts(boxId);

        // Step 2: Recalculate risk scores for all athletes
        console.log(`[Analytics Pipeline] Step 2: Recalculating risk scores`);
        const riskResults = await recalculateAllRiskScoresForBox(boxId);

        // Step 3: Process alerts based on updated risk scores
        console.log(`[Analytics Pipeline] Step 3: Processing alerts`);
        const alertResults = await processAthleteAlertsForBox(boxId);

        // Step 4: Process auto-escalations for alerts
        console.log(`[Analytics Pipeline] Step 4: Processing auto-escalations`);
        const escalationResults = await processAutoEscalations(boxId);

        // Step 5: Generate analytics snapshots for different periods
        console.log(`[Analytics Pipeline] Step 5: Generating analytics snapshots`);
        const snapshotResults = await Promise.allSettled([
            processBoxAnalyticsSnapshot(boxId, 'daily'),
            processBoxAnalyticsSnapshot(boxId, 'weekly'),
            processBoxAnalyticsSnapshot(boxId, 'monthly')
        ]);

        const successfulSnapshots = snapshotResults.filter(r => r.status === 'fulfilled').length;
        const failedSnapshots = snapshotResults.filter(r => r.status === 'rejected').length;

        // Step 6: Process advanced analytics (run in parallel where possible)
        console.log(`[Analytics Pipeline] Step 6: Processing advanced analytics`);
        const advancedAnalyticsResults = await Promise.allSettled([
            processAlertEffectiveness(boxId, 30),
            processAthleteSegmentAnalytics(boxId, 30),
            processCoachPerformanceMetrics(boxId, 30),
            processCohortAnalytics(boxId, 12, 24),
            processInterventionSuggestions(boxId),
            processInterventionOutcomes(boxId, 30, 30),
            processMilestones(boxId, 7),
            processRetentionEvents(boxId),
            getBoxRiskFactorAnalytics(boxId, 30),
            processWellnessPerformanceCorrelations(boxId, 90)
        ]);

        const successfulAdvanced = advancedAnalyticsResults.filter(r => r.status === 'fulfilled').length;
        const failedAdvanced = advancedAnalyticsResults.filter(r => r.status === 'rejected').length;

        // Step 7: Cleanup expired data
        console.log(`[Analytics Pipeline] Step 7: Cleaning up expired data`);
        await cleanupExpiredRiskScores();

        const endTime = Date.now();
        const executionTime = endTime - startTime;

        const pipelineResults = {
            boxId,
            executionTimeMs: executionTime,
            counts: countResults,
            riskScores: {
                totalAthletes: riskResults.totalAthletes,
                successful: riskResults.successful,
                failed: riskResults.failed
            },
            alerts: {
                generated: alertResults.alertsGenerated,
                updated: alertResults.alertsUpdated,
                totalActive: alertResults.totalActiveAlerts
            },
            escalations: {
                created: escalationResults.escalationsCreated,
                evaluated: escalationResults.alertsEvaluated
            },
            snapshots: {
                successful: successfulSnapshots,
                failed: failedSnapshots
            },
            advancedAnalytics: {
                successful: successfulAdvanced,
                failed: failedAdvanced
            },
            completedAt: new Date()
        };

        console.log(`[Analytics Pipeline] Completed full pipeline for box ${boxId} in ${executionTime}ms`);
        console.log(`[Analytics Pipeline] Results:`, JSON.stringify(pipelineResults, null, 2));

        return pipelineResults;
    } catch (error) {
        console.error(`[Analytics Pipeline] Critical error in full pipeline for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Quick analytics update - runs essential calculations only
 * Use this for more frequent updates without the full pipeline overhead
 */
export async function runQuickAnalyticsUpdate(boxId: string) {
    try {
        console.log(`[Analytics Pipeline] Starting quick analytics update for box ${boxId}`);
        const startTime = Date.now();

        // Only update counts and process high-priority alerts and escalations
        const [countResults, alertResults, escalationResults] = await Promise.all([
            updateBoxCurrentCounts(boxId),
            processAthleteAlertsForBox(boxId), // This uses existing risk scores
            processAutoEscalations(boxId)
        ]);

        const endTime = Date.now();
        const executionTime = endTime - startTime;

        const results = {
            boxId,
            executionTimeMs: executionTime,
            counts: countResults,
            alerts: {
                generated: alertResults.alertsGenerated,
                updated: alertResults.alertsUpdated,
                totalActive: alertResults.totalActiveAlerts
            },
            escalations: {
                created: escalationResults.escalationsCreated,
                evaluated: escalationResults.alertsEvaluated
            },
            completedAt: new Date()
        };

        console.log(`[Analytics Pipeline] Completed quick update for box ${boxId} in ${executionTime}ms`);
        return results;
    } catch (error) {
        console.error(`[Analytics Pipeline] Error in quick analytics update for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Run specific analytics module for a box
 * Useful for targeted processing or debugging
 */
export async function runSpecificAnalyticsModule(
    boxId: string,
    module: 'alert-effectiveness' | 'segment-analytics' | 'coach-performance' | 'cohort-analytics' | 'intervention-suggestions' | 'intervention-outcomes' | 'milestones' | 'retention-events' | 'risk-factor-analytics' | 'wellness-correlations',
    options?: any
) {
    try {
        console.log(`[Analytics Pipeline] Running ${module} for box ${boxId}`);
        const startTime = Date.now();

        let result;
        switch (module) {
            case 'alert-effectiveness':
                result = await processAlertEffectiveness(boxId, options?.lookbackDays || 30);
                break;
            case 'segment-analytics':
                result = await processAthleteSegmentAnalytics(boxId, options?.lookbackDays || 30);
                break;
            case 'coach-performance':
                result = await processCoachPerformanceMetrics(boxId, options?.lookbackDays || 30);
                break;
            case 'cohort-analytics':
                result = await processCohortAnalytics(boxId, options?.lookbackMonths || 12, options?.maxCohortAge || 24);
                break;
            case 'intervention-suggestions':
                result = await processInterventionSuggestions(boxId);
                break;
            case 'intervention-outcomes':
                result = await processInterventionOutcomes(boxId, options?.measurementDelayDays || 30, options?.measurementPeriodDays || 30);
                break;
            case 'milestones':
                result = await processMilestones(boxId, options?.lookbackDays || 7);
                break;
            case 'retention-events':
                result = await processRetentionEvents(boxId);
                break;
            case 'risk-factor-analytics':
                result = await getBoxRiskFactorAnalytics(boxId, options?.lookbackDays || 30);
                break;
            case 'wellness-correlations':
                result = await processWellnessPerformanceCorrelations(boxId, options?.lookbackDays || 90);
                break;
            default:
                throw new Error(`Unknown analytics module: ${module}`);
        }

        const endTime = Date.now();
        const executionTime = endTime - startTime;

        console.log(`[Analytics Pipeline] Completed ${module} for box ${boxId} in ${executionTime}ms`);
        return {
            boxId,
            module,
            executionTimeMs: executionTime,
            result,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics Pipeline] Error running ${module} for box ${boxId}:`, error);
        throw error;
    }
}
