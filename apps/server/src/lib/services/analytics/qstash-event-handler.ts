// lib/services/analytics/qstash-event-handler.ts
import {
    calculateAthleteRiskScore,
    upsertAthleteRiskScore,
    updateBoxCurrentCounts,
    processBoxAnalyticsSnapshot
} from "./analytics-calculations";
import { db } from "@/db";
import { boxMemberships } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Env } from "hono";

// Define the structure of the event payload from QStash
export interface QStashAnalyticsEvent {
    athleteId?: string; // Can be membershipId or userId depending on context
    membershipId?: string; // Preferred - direct membership reference
    boxId?: string; // Optional, can be looked up if not provided
    eventType:
        | 'new_pr'
        | 'new_checkin'
        | 'new_attendance'
        | 'new_benchmark'
        | 'new_wod_feedback'
        | 'membership_updated'
        | 'membership_activated'
        | 'membership_deactivated'
        | 'box_analytics_requested'
        | 'emergency_recalculation'; // For manual triggers
    details?: {
        prValue?: number;
        movementName?: string;
        benchmarkName?: string;
        wellnessScore?: number;
        attendanceStatus?: string;
        previousValues?: any; // For comparison/trend analysis
        [key: string]: any;
    };
    priority?: 'low' | 'normal' | 'high' | 'critical'; // Processing priority
    timestamp: string; // ISO string
    source?: string; // Where the event originated (api, webhook, etc.)
}

interface EventProcessingResult {
    success: boolean;
    processed: string[]; // List of actions taken
    skipped: string[]; // List of actions skipped
    errors: string[]; // List of errors encountered
    metrics?: any;
    processingTime: number;
}

/**
 * Processes an analytics event received from QStash.
 * This function is called by the Hono route that receives QStash webhooks.
 */
export async function handleAnalyticsEvent(
    event: QStashAnalyticsEvent,
    env: Env
): Promise<EventProcessingResult> {
    const startTime = Date.now();
    const result: EventProcessingResult = {
        success: true,
        processed: [],
        skipped: [],
        errors: [],
        processingTime: 0
    };

    console.log("[QStash Handler] Received event:", {
        eventType: event.eventType,
        membershipId: event.membershipId,
        athleteId: event.athleteId,
        boxId: event.boxId,
        priority: event.priority || 'normal',
        source: event.source || 'unknown'
    });

    try {
        // Determine membership ID and box ID
        const { membershipId, boxId } = await resolveMembershipAndBox(event);

        if (!membershipId) {
            result.errors.push('Could not resolve membership ID from event');
            result.success = false;
            return result;
        }

        if (!boxId) {
            result.errors.push('Could not resolve box ID from event');
            result.success = false;
            return result;
        }

        console.log(`[QStash Handler] Processing ${event.eventType} for membership ${membershipId} in box ${boxId}`);

        // Handle different event types
        switch (event.eventType) {
            case 'new_pr':
                await handleNewPrEvent(membershipId, boxId, event, result);
                break;

            case 'new_checkin':
                await handleNewCheckinEvent(membershipId, boxId, event, result);
                break;

            case 'new_attendance':
                await handleNewAttendanceEvent(membershipId, boxId, event, result);
                break;

            case 'new_benchmark':
                await handleNewBenchmarkEvent(membershipId, boxId, event, result);
                break;

            case 'new_wod_feedback':
                await handleNewWodFeedbackEvent(membershipId, boxId, event, result);
                break;

            case 'membership_updated':
            case 'membership_activated':
            case 'membership_deactivated':
                await handleMembershipEvent(membershipId, boxId, event, result);
                break;

            case 'box_analytics_requested':
                await handleBoxAnalyticsEvent(boxId, event, result);
                break;

            case 'emergency_recalculation':
                await handleEmergencyRecalculationEvent(membershipId, boxId, event, result);
                break;

            default:
                result.errors.push(`Unknown event type: ${event.eventType}`);
                result.success = false;
                console.warn(`[QStash Handler] Unknown event type: ${event.eventType}`);
        }

        // Update processing time
        result.processingTime = Date.now() - startTime;

        // Log final result
        console.log(`[QStash Handler] Event processing completed in ${result.processingTime}ms:`, {
            success: result.success,
            processed: result.processed,
            skipped: result.skipped,
            errors: result.errors
        });

        return result;

    } catch (error) {
        result.processingTime = Date.now() - startTime;
        result.success = false;
        result.errors.push(error instanceof Error ? error.message : String(error));

        console.error(`[QStash Handler] Critical error processing event after ${result.processingTime}ms:`, {
            eventType: event.eventType,
            error,
            membershipId: event.membershipId,
            boxId: event.boxId
        });

        return result;
    }
}

/**
 * Resolve membership ID and box ID from various event formats
 */
async function resolveMembershipAndBox(
    event: QStashAnalyticsEvent
): Promise<{ membershipId: string | null; boxId: string | null }> {

    // If we already have both, return them
    if (event.membershipId && event.boxId) {
        return { membershipId: event.membershipId, boxId: event.boxId };
    }

    // If we have membershipId but not boxId, look up the box
    if (event.membershipId && !event.boxId) {
        try {
            const membership = await db.select({ boxId: boxMemberships.boxId })
                .from(boxMemberships)
                .where(eq(boxMemberships.id, event.membershipId))
                .limit(1);

            if (membership[0]) {
                return { membershipId: event.membershipId, boxId: membership[0].boxId };
            }
        } catch (error) {
            console.error('[QStash Handler] Error looking up box from membershipId:', error);
        }
    }

    // If we have athleteId (userId) and optionally boxId, look up membership
    if (event.athleteId) {
        try {
            let query = db.select({
                id: boxMemberships.id,
                boxId: boxMemberships.boxId
            })
                .from(boxMemberships)
                .where(eq(boxMemberships.userId, event.athleteId));

            // If boxId is specified, filter by it
            if (event.boxId) {
                query = query.where(eq(boxMemberships.boxId, event.boxId));
            }

            const memberships = await query.limit(1);

            if (memberships[0]) {
                return {
                    membershipId: memberships[0].id,
                    boxId: memberships[0].boxId
                };
            }
        } catch (error) {
            console.error('[QStash Handler] Error looking up membership from athleteId:', error);
        }
    }

    console.warn('[QStash Handler] Could not resolve membership and box from event:', {
        membershipId: event.membershipId,
        athleteId: event.athleteId,
        boxId: event.boxId
    });

    return { membershipId: null, boxId: null };
}

/**
 * Handle new PR events - trigger risk score recalculation
 */
async function handleNewPrEvent(
    membershipId: string,
    boxId: string,
    event: QStashAnalyticsEvent,
    result: EventProcessingResult
): Promise<void> {
    try {
        console.log(`[QStash Handler] Processing new PR for membership ${membershipId}`);

        // Recalculate risk score (PRs generally improve performance score)
        const riskScore = await calculateAthleteRiskScore(membershipId, boxId);
        await upsertAthleteRiskScore(riskScore);

        result.processed.push(`Updated risk score: ${riskScore.riskLevel} (${riskScore.overallRiskScore})`);

        // Log the PR details if available
        if (event.details?.prValue && event.details?.movementName) {
            console.log(`[QStash Handler] New PR: ${event.details.movementName} - ${event.details.prValue}`);
        }

    } catch (error) {
        result.errors.push(`Failed to process new PR: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Handle new wellness checkin events
 */
async function handleNewCheckinEvent(
    membershipId: string,
    boxId: string,
    event: QStashAnalyticsEvent,
    result: EventProcessingResult
): Promise<void> {
    try {
        console.log(`[QStash Handler] Processing new checkin for membership ${membershipId}`);

        // Recalculate risk score (checkins affect engagement and wellness scores)
        const riskScore = await calculateAthleteRiskScore(membershipId, boxId);
        await upsertAthleteRiskScore(riskScore);

        result.processed.push(`Updated risk score: ${riskScore.riskLevel} (${riskScore.overallRiskScore})`);

        // Log wellness score if available
        if (event.details?.wellnessScore) {
            console.log(`[QStash Handler] Wellness checkin score: ${event.details.wellnessScore}`);
        }

    } catch (error) {
        result.errors.push(`Failed to process new checkin: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Handle new attendance events
 */
async function handleNewAttendanceEvent(
    membershipId: string,
    boxId: string,
    event: QStashAnalyticsEvent,
    result: EventProcessingResult
): Promise<void> {
    try {
        console.log(`[QStash Handler] Processing new attendance for membership ${membershipId}`);

        // Recalculate risk score (attendance affects engagement score)
        const riskScore = await calculateAthleteRiskScore(membershipId, boxId);
        await upsertAthleteRiskScore(riskScore);

        result.processed.push(`Updated risk score: ${riskScore.riskLevel} (${riskScore.overallRiskScore})`);

        // Log attendance status if available
        if (event.details?.attendanceStatus) {
            console.log(`[QStash Handler] Attendance status: ${event.details.attendanceStatus}`);
        }

    } catch (error) {
        result.errors.push(`Failed to process new attendance: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Handle new benchmark events
 */
async function handleNewBenchmarkEvent(
    membershipId: string,
    boxId: string,
    event: QStashAnalyticsEvent,
    result: EventProcessingResult
): Promise<void> {
    try {
        console.log(`[QStash Handler] Processing new benchmark for membership ${membershipId}`);

        // Recalculate risk score (benchmarks affect performance score)
        const riskScore = await calculateAthleteRiskScore(membershipId, boxId);
        await upsertAthleteRiskScore(riskScore);

        result.processed.push(`Updated risk score: ${riskScore.riskLevel} (${riskScore.overallRiskScore})`);

        // Log benchmark details if available
        if (event.details?.benchmarkName) {
            console.log(`[QStash Handler] New benchmark: ${event.details.benchmarkName}`);
        }

    } catch (error) {
        result.errors.push(`Failed to process new benchmark: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Handle new WOD feedback events
 */
async function handleNewWodFeedbackEvent(
    membershipId: string,
    boxId: string,
    event: QStashAnalyticsEvent,
    result: EventProcessingResult
): Promise<void> {
    try {
        console.log(`[QStash Handler] Processing new WOD feedback for membership ${membershipId}`);

        // WOD feedback can affect engagement and wellness scores
        const riskScore = await calculateAthleteRiskScore(membershipId, boxId);
        await upsertAthleteRiskScore(riskScore);

        result.processed.push(`Updated risk score: ${riskScore.riskLevel} (${riskScore.overallRiskScore})`);

    } catch (error) {
        result.errors.push(`Failed to process WOD feedback: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Handle membership-related events
 */
async function handleMembershipEvent(
    membershipId: string,
    boxId: string,
    event: QStashAnalyticsEvent,
    result: EventProcessingResult
): Promise<void> {
    try {
        console.log(`[QStash Handler] Processing membership event ${event.eventType} for membership ${membershipId}`);

        // Update box current counts (membership changes affect subscription limits)
        const countMetrics = await updateBoxCurrentCounts(boxId);
        result.processed.push(`Updated box counts: ${countMetrics.athleteCount} athletes, ${countMetrics.coachCount} coaches`);

        // For activation/deactivation, recalculate risk scores
        if (event.eventType === 'membership_activated') {
            const riskScore = await calculateAthleteRiskScore(membershipId, boxId);
            await upsertAthleteRiskScore(riskScore);
            result.processed.push(`Calculated initial risk score: ${riskScore.riskLevel}`);
        }

        result.metrics = countMetrics;

    } catch (error) {
        result.errors.push(`Failed to process membership event: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Handle box analytics requests
 */
async function handleBoxAnalyticsEvent(
    boxId: string,
    event: QStashAnalyticsEvent,
    result: EventProcessingResult
): Promise<void> {
    try {
        console.log(`[QStash Handler] Processing box analytics request for box ${boxId}`);

        // Determine which analytics to run based on event details
        const periods = event.details?.periods as string[] || ['daily'];

        for (const period of periods) {
            if (['daily', 'weekly', 'monthly'].includes(period)) {
                await processBoxAnalyticsSnapshot(boxId, period as any);
                result.processed.push(`Generated ${period} analytics snapshot`);
            } else {
                result.skipped.push(`Invalid period: ${period}`);
            }
        }

    } catch (error) {
        result.errors.push(`Failed to process box analytics: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Handle emergency recalculation events
 */
async function handleEmergencyRecalculationEvent(
    membershipId: string,
    boxId: string,
    event: QStashAnalyticsEvent,
    result: EventProcessingResult
): Promise<void> {
    try {
        console.log(`[QStash Handler] Processing emergency recalculation for membership ${membershipId}`);

        // Force recalculate risk score with extended lookback period
        const lookbackDays = event.details?.lookbackDays || 60;
        const riskScore = await calculateAthleteRiskScore(membershipId, boxId, lookbackDays);
        await upsertAthleteRiskScore(riskScore);

        result.processed.push(`Emergency risk score recalculation: ${riskScore.riskLevel} (${riskScore.overallRiskScore})`);
        result.processed.push(`Used ${lookbackDays} days lookback period`);

    } catch (error) {
        result.errors.push(`Failed emergency recalculation: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Batch event processor for handling multiple events efficiently
 */
export async function handleBatchAnalyticsEvents(
    events: QStashAnalyticsEvent[],
    env: Env
): Promise<{ results: EventProcessingResult[]; summary: { total: number; successful: number; failed: number } }> {
    console.log(`[QStash Handler] Processing batch of ${events.length} events`);
    const startTime = Date.now();

    const results: EventProcessingResult[] = [];

    // Process events in parallel but with concurrency limit
    const concurrency = 5;
    const batches: QStashAnalyticsEvent[][] = [];

    for (let i = 0; i < events.length; i += concurrency) {
        batches.push(events.slice(i, i + concurrency));
    }

    for (const batch of batches) {
        const batchResults = await Promise.all(
            batch.map(event => handleAnalyticsEvent(event, env))
        );
        results.push(...batchResults);
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalTime = Date.now() - startTime;

    console.log(`[QStash Handler] Batch processing completed in ${totalTime}ms. Success: ${successful}, Failed: ${failed}`);

    return {
        results,
        summary: {
            total: events.length,
            successful,
            failed
        }
    };
}

/**
 * Utility function to create analytics events for common actions
 */
export function createAnalyticsEvent(
    type: QStashAnalyticsEvent['eventType'],
    membershipId: string,
    boxId?: string,
    details?: any,
    priority: 'low' | 'normal' | 'high' | 'critical' = 'normal'
): QStashAnalyticsEvent {
    return {
        membershipId,
        boxId,
        eventType: type,
        details,
        priority,
        timestamp: new Date().toISOString(),
        source: 'api'
    };
}
