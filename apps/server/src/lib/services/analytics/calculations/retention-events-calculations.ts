// src/lib/services/analytics/calculations/retention-events-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    retentionEvents,
    athleteWellnessCheckins,
    wodAttendance
} from "@/db/schema";
import { eq, and, gte, lte, count, sql } from "drizzle-orm";

export interface RetentionEventData {
    boxId: string;
    membershipId: string;
    athleteName: string;
    eventType: 'churn' | 'reactivation' | 'pause' | 'at_risk' | 'recovered';
    reason: string | null;
    notes: string | null;
    eventDate: Date;
    previousStatus: string;
    cohortStartDate: Date;
    daysInCohort: number;
    riskIndicators: string[];
}

interface AthleteActivityData {
    membershipId: string;
    lastVisit: Date | null;
    lastCheckin: Date | null;
    recentAttendanceRate: number;
    recentCheckinRate: number;
    isActive: boolean;
    leftAt: Date | null;
}

/**
 * Get athlete activity data for retention analysis
 */
async function getAthleteActivityData(
    boxId: string,
    lookbackDays: number = 30
): Promise<AthleteActivityData[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    // Get all athletes in the box
    const athletes = await db
        .select({
            membershipId: boxMemberships.id,
            isActive: boxMemberships.isActive,
            leftAt: boxMemberships.leftAt,
            joinedAt: boxMemberships.joinedAt
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete')
        ));

    const activityData: AthleteActivityData[] = [];

    for (const athlete of athletes) {
        // Get last visit
        const lastVisit = await db
            .select({
                lastDate: sql<Date>`MAX(${wodAttendance.attendanceDate})`
            })
            .from(wodAttendance)
            .where(and(
                eq(wodAttendance.membershipId, athlete.membershipId),
                eq(wodAttendance.status, 'attended')
            ));

        // Get last checkin
        const lastCheckin = await db
            .select({
                lastDate: sql<Date>`MAX(${athleteWellnessCheckins.checkinDate})`
            })
            .from(athleteWellnessCheckins)
            .where(eq(athleteWellnessCheckins.membershipId, athlete.membershipId));

        // Get recent attendance rate
        const recentAttendance = await db
            .select({
                attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
                total: count()
            })
            .from(wodAttendance)
            .where(and(
                eq(wodAttendance.membershipId, athlete.membershipId),
                gte(wodAttendance.attendanceDate, sql`${cutoffDate}::date`)
            ));

        const recentAttendanceRate = recentAttendance[0]?.total > 0
            ? (recentAttendance[0].attended / recentAttendance[0].total) * 100
            : 0;

        // Get recent checkin rate
        const recentCheckins = await db
            .select({
                count: count()
            })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.membershipId, athlete.membershipId),
                gte(athleteWellnessCheckins.checkinDate, cutoffDate)
            ));

        const recentCheckinRate = (recentCheckins[0]?.count || 0) / lookbackDays * 100;

        activityData.push({
            membershipId: athlete.membershipId,
            lastVisit: lastVisit[0]?.lastDate || null,
            lastCheckin: lastCheckin[0]?.lastDate || null,
            recentAttendanceRate,
            recentCheckinRate,
            isActive: athlete.isActive,
            leftAt: athlete.leftAt
        });
    }

    return activityData;
}

/**
 * Detect retention events based on activity patterns and membership status changes
 */
export async function detectRetentionEvents(
    boxId: string,
    lookbackDays: number = 7
): Promise<RetentionEventData[]> {
    const activityData = await getAthleteActivityData(boxId, 30);
    const events: RetentionEventData[] = [];
    const now = new Date();

    // Get existing retention events to avoid duplicates
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const existingEvents = await db
        .select({
            membershipId: retentionEvents.membershipId,
            eventType: retentionEvents.eventType,
            eventDate: retentionEvents.eventDate
        })
        .from(retentionEvents)
        .where(and(
            eq(retentionEvents.boxId, boxId),
            gte(retentionEvents.eventDate, cutoffDate)
        ));

    const existingEventKeys = new Set(
        existingEvents.map(e => `${e.membershipId}-${e.eventType}-${e.eventDate.toDateString()}`)
    );

    for (const athlete of activityData) {
        const membership = await db
            .select({
                id: boxMemberships.id,
                displayName: boxMemberships.displayName,
                isActive: boxMemberships.isActive,
                leftAt: boxMemberships.leftAt,
                joinedAt: boxMemberships.joinedAt
            })
            .from(boxMemberships)
            .where(eq(boxMemberships.id, athlete.membershipId))
            .limit(1);

        if (!membership[0]) continue;

        const member = membership[0];
        const daysInCohort = Math.floor((now.getTime() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24));

        let riskIndicators: string[] = [];
        let eventType: RetentionEventData['eventType'] | null = null;
        let reason: string | null = null;
        let notes: string | null = null;
        let eventDate = now;
        let previousStatus = 'active';

        // Detect churn events
        if (!member.isActive && member.leftAt) {
            const daysSinceLeft = Math.floor((now.getTime() - member.leftAt.getTime()) / (1000 * 60 * 60 * 24));
            if (daysSinceLeft <= lookbackDays) {
                eventType = 'churn';
                eventDate = member.leftAt;
                previousStatus = 'active';

                // Determine churn reason based on activity patterns
                if (athlete.lastVisit) {
                    const daysSinceLastVisit = Math.floor((member.leftAt.getTime() - athlete.lastVisit.getTime()) / (1000 * 60 * 60 * 24));
                    if (daysSinceLastVisit > 30) {
                        reason = 'extended_absence';
                    } else if (athlete.recentAttendanceRate < 20) {
                        reason = 'low_attendance';
                    } else if (athlete.recentCheckinRate < 10) {
                        reason = 'low_engagement';
                    } else {
                        reason = 'unknown';
                    }
                } else {
                    reason = 'no_activity_recorded';
                }

                riskIndicators.push(`Left after ${daysInCohort} days`);
                if (athlete.recentAttendanceRate > 0) {
                    riskIndicators.push(`Final attendance rate: ${athlete.recentAttendanceRate.toFixed(1)}%`);
                }
            }
        }

        // Detect at-risk events (for active members)
        if (member.isActive && !eventType) {
            const daysSinceLastVisit = athlete.lastVisit
                ? Math.floor((now.getTime() - athlete.lastVisit.getTime()) / (1000 * 60 * 60 * 24))
                : null;

            const daysSinceLastCheckin = athlete.lastCheckin
                ? Math.floor((now.getTime() - athlete.lastCheckin.getTime()) / (1000 * 60 * 60 * 24))
                : null;

            let atRiskScore = 0;

            // Long absence
            if (daysSinceLastVisit && daysSinceLastVisit > 14) {
                atRiskScore += daysSinceLastVisit;
                riskIndicators.push(`${daysSinceLastVisit} days since last visit`);
            }

            // Low attendance rate
            if (athlete.recentAttendanceRate < 30) {
                atRiskScore += (30 - athlete.recentAttendanceRate);
                riskIndicators.push(`Low attendance: ${athlete.recentAttendanceRate.toFixed(1)}%`);
            }

            // Low checkin rate
            if (athlete.recentCheckinRate < 20) {
                atRiskScore += (20 - athlete.recentCheckinRate);
                riskIndicators.push(`Low checkin rate: ${athlete.recentCheckinRate.toFixed(1)}%`);
            }

            // No checkins recently
            if (daysSinceLastCheckin && daysSinceLastCheckin > 21) {
                atRiskScore += Math.min(daysSinceLastCheckin, 30);
                riskIndicators.push(`${daysSinceLastCheckin} days since last wellness checkin`);
            }

            // Trigger at-risk event if score is high enough
            if (atRiskScore > 40 && riskIndicators.length > 0) {
                eventType = 'at_risk';
                reason = 'declining_engagement';
                notes = `Risk score: ${atRiskScore.toFixed(0)}. Primary concerns: ${riskIndicators.slice(0, 2).join(', ')}`;
            }
        }

        // Detect reactivation events (returning after extended absence)
        if (member.isActive && athlete.lastVisit) {
            const daysSinceLastVisit = Math.floor((now.getTime() - athlete.lastVisit.getTime()) / (1000 * 60 * 60 * 24));

            // Check if they had a recent attendance after a long gap
            if (daysSinceLastVisit <= 3 && athlete.recentAttendanceRate > 0) {
                // Look for previous period of inactivity
                const twoWeeksAgo = new Date();
                twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

                const olderAttendance = await db
                    .select({
                        attended: sql<number>`COUNT(CASE WHEN ${wodAttendance.status} = 'attended' THEN 1 END)`,
                        total: count()
                    })
                    .from(wodAttendance)
                    .where(and(
                        eq(wodAttendance.membershipId, athlete.membershipId),
                        lte(wodAttendance.attendanceDate, sql`${twoWeeksAgo}::date`),
                        gte(wodAttendance.attendanceDate, sql`(${twoWeeksAgo}::date - interval '30 days')`)
                    ));

                const olderAttendanceRate = olderAttendance[0]?.total > 0
                    ? (olderAttendance[0].attended / olderAttendance[0].total) * 100
                    : 0;

                // If they had low attendance before but are active now, it's a reactivation
                if (olderAttendanceRate < 20 && athlete.recentAttendanceRate > 50) {
                    eventType = 'reactivation';
                    previousStatus = 'inactive';
                    reason = 'returned_after_absence';
                    notes = `Returned with ${athlete.recentAttendanceRate.toFixed(1)}% attendance after period of ${olderAttendanceRate.toFixed(1)}% attendance`;
                }
            }
        }

        // Create event if detected and not already recorded
        if (eventType) {
            const eventKey = `${athlete.membershipId}-${eventType}-${eventDate.toDateString()}`;

            if (!existingEventKeys.has(eventKey)) {
                events.push({
                    boxId,
                    membershipId: athlete.membershipId,
                    athleteName: member.displayName,
                    eventType,
                    reason,
                    notes,
                    eventDate,
                    previousStatus,
                    cohortStartDate: member.joinedAt,
                    daysInCohort,
                    riskIndicators
                });
            }
        }
    }

    return events;
}

/**
 * Process and store retention events
 */
export async function processRetentionEvents(boxId: string) {
    try {
        console.log(`[Analytics] Detecting retention events for box ${boxId}`);

        const events = await detectRetentionEvents(boxId);

        console.log(`[Analytics] Found ${events.length} new retention events for box ${boxId}`);

        const results = {
            boxId,
            eventsProcessed: events.length,
            churnEvents: 0,
            atRiskEvents: 0,
            reactivationEvents: 0,
            otherEvents: 0,
            completedAt: new Date()
        };

        for (const event of events) {
            // Insert the retention event
            await db.insert(retentionEvents).values({
                boxId: event.boxId,
                membershipId: event.membershipId,
                eventType: event.eventType,
                reason: event.reason,
                notes: event.notes,
                eventDate: event.eventDate,
                previousStatus: event.previousStatus,
                cohortStartDate: event.cohortStartDate,
                daysInCohort: event.daysInCohort,
                createdAt: new Date()
            });

            // Update counters
            switch (event.eventType) {
                case 'churn':
                    results.churnEvents++;
                    break;
                case 'at_risk':
                    results.atRiskEvents++;
                    break;
                case 'reactivation':
                    results.reactivationEvents++;
                    break;
                default:
                    results.otherEvents++;
                    break;
            }

            console.log(`[Analytics] ${event.eventType.toUpperCase()} event: ${event.athleteName} (${event.daysInCohort} days in cohort) - ${event.reason || 'No reason specified'}`);
        }

        console.log(`[Analytics] Processed retention events for box ${boxId}: ${results.churnEvents} churn, ${results.atRiskEvents} at-risk, ${results.reactivationEvents} reactivation`);

        return results;
    } catch (error) {
        console.error(`[Analytics] Error processing retention events for box ${boxId}:`, error);
        throw error;
    }
}

/**
 * Get retention cohort analysis
 */
export async function getRetentionCohortAnalysis(
    boxId: string,
    cohortPeriodMonths: number = 6
): Promise<{
    cohorts: { [key: string]: { totalAthletes: number; retainedAthletes: number; retentionRate: number; avgDaysToChurn: number } };
    overallRetentionRate: number;
    avgTimeToChurn: number;
    churnReasons: { [key: string]: number };
    atRiskPatterns: { [key: string]: number };
}> {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - cohortPeriodMonths);

    // Get all athletes who joined in the analysis period
    const cohortAthletes = await db
        .select({
            membershipId: boxMemberships.id,
            joinedAt: boxMemberships.joinedAt,
            isActive: boxMemberships.isActive,
            leftAt: boxMemberships.leftAt
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            gte(boxMemberships.joinedAt, cutoffDate)
        ));

    // Get retention events for analysis
    const retentionEventData = await db
        .select({
            membershipId: retentionEvents.membershipId,
            eventType: retentionEvents.eventType,
            reason: retentionEvents.reason,
            eventDate: retentionEvents.eventDate,
            daysInCohort: retentionEvents.daysInCohort
        })
        .from(retentionEvents)
        .where(and(
            eq(retentionEvents.boxId, boxId),
            gte(retentionEvents.eventDate, cutoffDate)
        ));

    // Group by cohort (month joined)
    const cohorts: { [key: string]: { totalAthletes: number; retainedAthletes: number; retentionRate: number; avgDaysToChurn: number } } = {};

    cohortAthletes.forEach(athlete => {
        const cohortKey = `${athlete.joinedAt.getFullYear()}-${athlete.joinedAt.getMonth() + 1}`;

        if (!cohorts[cohortKey]) {
            cohorts[cohortKey] = { totalAthletes: 0, retainedAthletes: 0, retentionRate: 0, avgDaysToChurn: 0 };
        }

        cohorts[cohortKey].totalAthletes++;

        if (athlete.isActive) {
            cohorts[cohortKey].retainedAthletes++;
        }
    });

    // Calculate retention rates
    Object.keys(cohorts).forEach(cohortKey => {
        const cohort = cohorts[cohortKey];
        cohort.retentionRate = cohort.totalAthletes > 0
            ? Math.round((cohort.retainedAthletes / cohort.totalAthletes) * 10000) / 100
            : 0;

        // Calculate average days to churn for this cohort
        const cohortChurnEvents = retentionEventData.filter(e =>
            e.eventType === 'churn' &&
            cohortAthletes.some(a => a.membershipId === e.membershipId &&
                `${a.joinedAt.getFullYear()}-${a.joinedAt.getMonth() + 1}` === cohortKey)
        );

        cohort.avgDaysToChurn = cohortChurnEvents.length > 0
            ? Math.round(cohortChurnEvents.reduce((sum, e) => sum + e.daysInCohort, 0) / cohortChurnEvents.length)
            : 0;
    });

    // Overall metrics
    const totalAthletes = cohortAthletes.length;
    const retainedAthletes = cohortAthletes.filter(a => a.isActive).length;
    const overallRetentionRate = totalAthletes > 0
        ? Math.round((retainedAthletes / totalAthletes) * 10000) / 100
        : 0;

    const churnEvents = retentionEventData.filter(e => e.eventType === 'churn');
    const avgTimeToChurn = churnEvents.length > 0
        ? Math.round(churnEvents.reduce((sum, e) => sum + e.daysInCohort, 0) / churnEvents.length)
        : 0;

    // Churn reasons analysis
    const churnReasons: { [key: string]: number } = {};
    churnEvents.forEach(event => {
        const reason = event.reason || 'unknown';
        churnReasons[reason] = (churnReasons[reason] || 0) + 1;
    });

    // At-risk patterns analysis
    const atRiskPatterns: { [key: string]: number } = {};
    retentionEventData.filter(e => e.eventType === 'at_risk').forEach(event => {
        const reason = event.reason || 'unknown';
        atRiskPatterns[reason] = (atRiskPatterns[reason] || 0) + 1;
    });

    return {
        cohorts,
        overallRetentionRate,
        avgTimeToChurn,
        churnReasons,
        atRiskPatterns
    };
}
