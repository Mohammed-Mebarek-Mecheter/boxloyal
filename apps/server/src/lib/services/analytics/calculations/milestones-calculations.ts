// src/lib/services/analytics/calculations/milestones-calculations.ts
import { db } from "@/db";
import {
    boxMemberships,
    athleteMilestones,
    athletePrs,
    athleteBenchmarks,
    athleteWellnessCheckins,
    wodAttendance,
    movements,
    benchmarkWods
} from "@/db/schema";
import {eq, and, gte, count, sql, desc, lt} from "drizzle-orm";

export interface MilestoneData {
    membershipId: string;
    athleteName: string;
    milestoneType: string;
    title: string;
    description: string;
    category: string;
    value: string;
    previousValue?: string;
    improvementPercent?: number;
    achievedAt: Date;
}

export interface MilestoneDetectionResult {
    boxId: string;
    milestonesDetected: MilestoneData[];
    totalMilestones: number;
    byType: Record<string, number>;
    processedAt: Date;
}

/**
 * Detect new milestones for all athletes in a box
 */
export async function detectNewMilestones(
    boxId: string,
    lookbackDays: number = 7
): Promise<MilestoneDetectionResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    console.log(`[Milestones] Detecting milestones for box ${boxId} since ${cutoffDate.toISOString()}`);

    const detectedMilestones: MilestoneData[] = [];

    // Get all active athletes
    const athletes = await db
        .select({
            membershipId: boxMemberships.id,
            athleteName: boxMemberships.displayName,
            joinedAt: boxMemberships.joinedAt
        })
        .from(boxMemberships)
        .where(and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.role, 'athlete'),
            eq(boxMemberships.isActive, true)
        ));

    console.log(`[Milestones] Processing ${athletes.length} athletes`);

    // Process each milestone type
    for (const athlete of athletes) {
        try {
            // 1. PR Milestones
            const prMilestones = await detectPRMilestones(athlete, cutoffDate);
            detectedMilestones.push(...prMilestones);

            // 2. Benchmark Milestones
            const benchmarkMilestones = await detectBenchmarkMilestones(athlete, cutoffDate);
            detectedMilestones.push(...benchmarkMilestones);

            // 3. Attendance Milestones
            const attendanceMilestones = await detectAttendanceMilestones(athlete, cutoffDate, lookbackDays);
            detectedMilestones.push(...attendanceMilestones);

            // 4. Consistency Milestones
            const consistencyMilestones = await detectConsistencyMilestones(athlete, cutoffDate);
            detectedMilestones.push(...consistencyMilestones);

            // 5. Community Milestones
            const communityMilestones = await detectCommunityMilestones(athlete, cutoffDate);
            detectedMilestones.push(...communityMilestones);

        } catch (error) {
            console.error(`[Milestones] Error processing milestones for athlete ${athlete.athleteName}:`, error);
        }
    }

    // Count by type
    const byType: Record<string, number> = {};
    detectedMilestones.forEach(milestone => {
        byType[milestone.milestoneType] = (byType[milestone.milestoneType] || 0) + 1;
    });

    console.log(`[Milestones] Detected ${detectedMilestones.length} total milestones for box ${boxId}`);
    console.log(`[Milestones] Breakdown by type:`, byType);

    return {
        boxId,
        milestonesDetected: detectedMilestones,
        totalMilestones: detectedMilestones.length,
        byType,
        processedAt: new Date()
    };
}

/**
 * Detect PR milestones for an athlete
 */
async function detectPRMilestones(
    athlete: { membershipId: string; athleteName: string; joinedAt: Date },
    cutoffDate: Date
): Promise<MilestoneData[]> {
    const milestones: MilestoneData[] = [];

    // Get recent PRs
    const recentPrs = await db
        .select({
            id: athletePrs.id,
            movementId: athletePrs.movementId,
            value: athletePrs.value,
            unit: athletePrs.unit,
            achievedAt: athletePrs.achievedAt,
            movementName: movements.name,
            movementCategory: movements.category
        })
        .from(athletePrs)
        .innerJoin(movements, eq(athletePrs.movementId, movements.id))
        .where(and(
            eq(athletePrs.membershipId, athlete.membershipId),
            gte(athletePrs.achievedAt, cutoffDate)
        ))
        .orderBy(desc(athletePrs.achievedAt));

    for (const pr of recentPrs) {
        // Get previous PR for this movement
        const previousPrs = await db
            .select({
                value: athletePrs.value,
                achievedAt: athletePrs.achievedAt
            })
            .from(athletePrs)
            .where(and(
                eq(athletePrs.membershipId, athlete.membershipId),
                eq(athletePrs.movementId, pr.movementId),
                sql`${athletePrs.achievedAt} < ${pr.achievedAt}`
            ))
            .orderBy(desc(athletePrs.achievedAt))
            .limit(1);

        const previousValue = previousPrs[0]?.value;
        const currentValue = parseFloat(pr.value);
        const prevValue = previousValue ? parseFloat(previousValue) : null;

        let improvementPercent: number | undefined;
        let isSignificantPR = false;

        // Calculate improvement and check significance
        if (prevValue && prevValue > 0) {
            improvementPercent = ((currentValue - prevValue) / prevValue) * 100;
            // Significant if >5% improvement or first PR
            isSignificantPR = improvementPercent >= 5;
        } else {
            // First PR is always significant
            isSignificantPR = true;
        }

        if (isSignificantPR) {
            const milestone: MilestoneData = {
                membershipId: athlete.membershipId,
                athleteName: athlete.athleteName,
                milestoneType: 'pr_achievement',
                title: `New ${pr.movementName} PR!`,
                description: `${athlete.athleteName} achieved a new personal record in ${pr.movementName}: ${currentValue}${pr.unit}${
                    improvementPercent ? ` (${improvementPercent.toFixed(1)}% improvement)` : ''
                }`,
                category: pr.movementCategory,
                value: `${currentValue}${pr.unit}`,
                previousValue: prevValue ? `${prevValue}${pr.unit}` : undefined,
                improvementPercent: improvementPercent ? Math.round(improvementPercent * 100) / 100 : undefined,
                achievedAt: pr.achievedAt
            };

            milestones.push(milestone);

            // Check for special PR milestones
            const specialMilestones = checkSpecialPRMilestones(pr, currentValue, athlete);
            milestones.push(...specialMilestones);
        }
    }

    return milestones;
}

/**
 * Check for special PR milestones (bodyweight, round numbers, etc.)
 */
function checkSpecialPRMilestones(
    pr: any,
    value: number,
    athlete: { membershipId: string; athleteName: string; joinedAt: Date }
): MilestoneData[] {
    const milestones: MilestoneData[] = [];
    const movementName = pr.movementName.toLowerCase();

    // Bodyweight milestones for key movements
    const bodyweightTargets = [135, 155, 185, 205, 225, 245, 275, 315, 365, 405, 455, 500];
    if (['deadlift', 'squat', 'bench press'].some(m => movementName.includes(m))) {
        const hitTarget = bodyweightTargets.find(target =>
            value >= target && value < target + 10 // Within 10 lbs of target
        );

        if (hitTarget) {
            milestones.push({
                membershipId: athlete.membershipId,
                athleteName: athlete.athleteName,
                milestoneType: 'pr_achievement',
                title: `${hitTarget}lb ${pr.movementName} Club!`,
                description: `${athlete.athleteName} has joined the ${hitTarget}lb ${pr.movementName} club with a lift of ${value}${pr.unit}!`,
                category: 'strength',
                value: `${value}${pr.unit}`,
                achievedAt: pr.achievedAt
            });
        }
    }

    return milestones;
}

/**
 * Detect benchmark workout milestones
 */
async function detectBenchmarkMilestones(
    athlete: { membershipId: string; athleteName: string; joinedAt: Date },
    cutoffDate: Date
): Promise<MilestoneData[]> {
    const milestones: MilestoneData[] = [];

    // Get recent benchmark results
    const recentBenchmarks = await db
        .select({
            id: athleteBenchmarks.id,
            benchmarkId: athleteBenchmarks.benchmarkId,
            value: athleteBenchmarks.value,
            valueType: athleteBenchmarks.valueType,
            achievedAt: athleteBenchmarks.achievedAt,
            benchmarkName: benchmarkWods.name,
            benchmarkCategory: benchmarkWods.category
        })
        .from(athleteBenchmarks)
        .innerJoin(benchmarkWods, eq(athleteBenchmarks.benchmarkId, benchmarkWods.id))
        .where(and(
            eq(athleteBenchmarks.membershipId, athlete.membershipId),
            gte(athleteBenchmarks.achievedAt, cutoffDate)
        ))
        .orderBy(desc(athleteBenchmarks.achievedAt));

    for (const benchmark of recentBenchmarks) {
        // Get previous results for this benchmark
        const previousResults = await db
            .select({
                value: athleteBenchmarks.value,
                achievedAt: athleteBenchmarks.achievedAt
            })
            .from(athleteBenchmarks)
            .where(and(
                eq(athleteBenchmarks.membershipId, athlete.membershipId),
                eq(athleteBenchmarks.benchmarkId, benchmark.benchmarkId),
                sql`${athleteBenchmarks.achievedAt} < ${benchmark.achievedAt}`
            ))
            .orderBy(desc(athleteBenchmarks.achievedAt))
            .limit(1);

        const isFirstAttempt = previousResults.length === 0;
        const currentValue = parseFloat(benchmark.value);
        const previousValue = previousResults[0] ? parseFloat(previousResults[0].value) : null;

        let improvementPercent: number | undefined;
        let isSignificantImprovement = false;

        if (previousValue && benchmark.valueType === 'time') {
            // For time-based benchmarks, lower is better
            improvementPercent = ((previousValue - currentValue) / previousValue) * 100;
            isSignificantImprovement = improvementPercent >= 2; // 2% time improvement
        } else if (previousValue && benchmark.valueType !== 'time') {
            // For reps/rounds, higher is better
            improvementPercent = ((currentValue - previousValue) / previousValue) * 100;
            isSignificantImprovement = improvementPercent >= 5; // 5% improvement
        }

        if (isFirstAttempt || isSignificantImprovement) {
            const timeDisplay = benchmark.valueType === 'time'
                ? formatTime(currentValue)
                : `${currentValue} ${benchmark.valueType === 'rounds_reps' ? 'rounds+reps' : 'reps'}`;

            const milestone: MilestoneData = {
                membershipId: athlete.membershipId,
                athleteName: athlete.athleteName,
                milestoneType: isFirstAttempt ? 'benchmark_completion' : 'benchmark_improvement',
                title: isFirstAttempt
                    ? `First ${benchmark.benchmarkName} Completed!`
                    : `${benchmark.benchmarkName} PR!`,
                description: isFirstAttempt
                    ? `${athlete.athleteName} completed ${benchmark.benchmarkName} for the first time: ${timeDisplay}`
                    : `${athlete.athleteName} improved their ${benchmark.benchmarkName} time: ${timeDisplay}${
                        improvementPercent ? ` (${improvementPercent.toFixed(1)}% improvement)` : ''
                    }`,
                category: benchmark.benchmarkCategory,
                value: timeDisplay,
                previousValue: previousValue ? (benchmark.valueType === 'time' ? formatTime(previousValue) : previousValue.toString()) : undefined,
                improvementPercent: improvementPercent ? Math.round(improvementPercent * 100) / 100 : undefined,
                achievedAt: benchmark.achievedAt
            };

            milestones.push(milestone);
        }
    }

    return milestones;
}

/**
 * Detect attendance milestones
 */
async function detectAttendanceMilestones(
    athlete: { membershipId: string; athleteName: string; joinedAt: Date },
    cutoffDate: Date,
    lookbackDays: number
): Promise<MilestoneData[]> {
    const milestones: MilestoneData[] = [];

    // Get total attendance count
    const totalAttendance = await db
        .select({ count: count() })
        .from(wodAttendance)
        .where(and(
            eq(wodAttendance.membershipId, athlete.membershipId),
            eq(wodAttendance.status, 'attended')
        ));

    const attendanceCount = totalAttendance[0]?.count || 0;

    // Check for attendance milestones (50, 100, 250, 500, 1000, etc.)
    const attendanceMilestones = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];

    for (const milestone of attendanceMilestones) {
        if (attendanceCount >= milestone) {
            // Check if we recently crossed this milestone
            const lookbackCutoff = new Date();
            lookbackCutoff.setDate(lookbackCutoff.getDate() - lookbackDays);

            const lookbackCutoffStr = lookbackCutoff.toISOString().split("T")[0];

            const recentAttendanceForMilestone = await db
                .select({ count: count() })
                .from(wodAttendance)
                .where(and(
                    eq(wodAttendance.membershipId, athlete.membershipId),
                    eq(wodAttendance.status, 'attended'),
                    lt(wodAttendance.attendanceDate, lookbackCutoffStr)
                ));

            const previousCount = recentAttendanceForMilestone[0]?.count || 0;

            // If we crossed this milestone in the recent period
            if (previousCount < milestone && attendanceCount >= milestone) {
                milestones.push({
                    membershipId: athlete.membershipId,
                    athleteName: athlete.athleteName,
                    milestoneType: 'attendance',
                    title: `${milestone} Workout Milestone!`,
                    description: `${athlete.athleteName} has completed ${milestone} workouts! Celebrating consistent dedication to fitness.`,
                    category: 'community',
                    value: milestone.toString(),
                    achievedAt: new Date(), // Use current date as we don't know exact crossing date
                });
                break; // Only award the highest milestone reached
            }
        }
    }

    return milestones;
}

/**
 * Detect consistency milestones (streaks, regular attendance)
 */
async function detectConsistencyMilestones(
    athlete: { membershipId: string; athleteName: string; joinedAt: Date },
    cutoffDate: Date
): Promise<MilestoneData[]> {
    const milestones: MilestoneData[] = [];

    // Get current checkin streak from membership table
    const membership = await db
        .select({
            checkinStreak: boxMemberships.checkinStreak,
            longestCheckinStreak: boxMemberships.longestCheckinStreak
        })
        .from(boxMemberships)
        .where(eq(boxMemberships.id, athlete.membershipId))
        .limit(1);

    const currentStreak = membership[0]?.checkinStreak || 0;
    const longestStreak = membership[0]?.longestCheckinStreak || 0;

    // Check for streak milestones
    const streakMilestones = [7, 14, 21, 30, 50, 75, 100];

    for (const milestone of streakMilestones) {
        if (currentStreak >= milestone && longestStreak < milestone) {
            // This is a new streak milestone
            milestones.push({
                membershipId: athlete.membershipId,
                athleteName: athlete.athleteName,
                milestoneType: 'consistency',
                title: `${milestone}-Day Check-in Streak!`,
                description: `${athlete.athleteName} has maintained a ${milestone}-day check-in streak! Consistency is key to progress.`,
                category: 'consistency',
                value: `${milestone} days`,
                achievedAt: new Date(),
            });
        }
    }

    // Check for monthly consistency (attending 3+ times per week for a month)
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const recentAttendance = await db
        .select({
            attendanceDate: wodAttendance.attendanceDate,
            count: count()
        })
        .from(wodAttendance)
        .where(and(
            eq(wodAttendance.membershipId, athlete.membershipId),
            eq(wodAttendance.status, 'attended'),
            gte(wodAttendance.attendanceDate, sql`${fourWeeksAgo}::date`)
        ))
        .groupBy(wodAttendance.attendanceDate)
        .orderBy(desc(wodAttendance.attendanceDate));

    // Calculate weekly attendance
    const weeklyAttendance = new Array(4).fill(0);
    recentAttendance.forEach(({ attendanceDate }) => {
        const daysAgo = Math.floor((new Date().getTime() - new Date(attendanceDate).getTime()) / (1000 * 60 * 60 * 24));
        const weekIndex = Math.floor(daysAgo / 7);
        if (weekIndex < 4) {
            weeklyAttendance[weekIndex]++;
        }
    });

    // If all 4 weeks have 3+ sessions
    if (weeklyAttendance.every(week => week >= 3)) {
        milestones.push({
            membershipId: athlete.membershipId,
            athleteName: athlete.athleteName,
            milestoneType: 'consistency',
            title: 'Monthly Consistency Champion!',
            description: `${athlete.athleteName} has attended 3+ workouts per week for the entire month! Outstanding consistency.`,
            category: 'consistency',
            value: '4 weeks',
            achievedAt: new Date(),
        });
    }

    return milestones;
}

/**
 * Detect community milestones (engagement, check-ins)
 */
async function detectCommunityMilestones(
    athlete: { membershipId: string; athleteName: string; joinedAt: Date },
    cutoffDate: Date
): Promise<MilestoneData[]> {
    const milestones: MilestoneData[] = [];

    // Check for wellness check-in milestones
    const totalCheckins = await db
        .select({ count: count() })
        .from(athleteWellnessCheckins)
        .where(eq(athleteWellnessCheckins.membershipId, athlete.membershipId));

    const checkinCount = totalCheckins[0]?.count || 0;
    const checkinMilestones = [10, 25, 50, 100, 250, 500];

    for (const milestone of checkinMilestones) {
        if (checkinCount >= milestone) {
            // Check if this is recent
            const previousCheckins = await db
                .select({ count: count() })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.membershipId, athlete.membershipId),
                    sql`${athleteWellnessCheckins.checkinDate} < ${cutoffDate}`
                ));

            const previousCount = previousCheckins[0]?.count || 0;

            if (previousCount < milestone && checkinCount >= milestone) {
                milestones.push({
                    membershipId: athlete.membershipId,
                    athleteName: athlete.athleteName,
                    milestoneType: 'community',
                    title: `${milestone} Check-ins Completed!`,
                    description: `${athlete.athleteName} has completed ${milestone} wellness check-ins, showing great engagement with their fitness journey.`,
                    category: 'community',
                    value: milestone.toString(),
                    achievedAt: new Date(),
                });
                break;
            }
        }
    }

    // Check membership anniversary
    const membershipDays = Math.floor((new Date().getTime() - athlete.joinedAt.getTime()) / (1000 * 60 * 60 * 24));
    const anniversaryMilestones = [30, 90, 180, 365, 730]; // 1 month, 3 months, 6 months, 1 year, 2 years

    for (const milestone of anniversaryMilestones) {
        if (membershipDays >= milestone) {
            const cutoffDays = Math.floor((new Date().getTime() - cutoffDate.getTime()) / (1000 * 60 * 60 * 24));
            const previousMembershipDays = membershipDays - cutoffDays;

            if (previousMembershipDays < milestone && membershipDays >= milestone) {
                const description = milestone < 365
                    ? `${milestone} days as a member`
                    : `${Math.floor(milestone / 365)} year${milestone > 365 ? 's' : ''} as a member`;

                milestones.push({
                    membershipId: athlete.membershipId,
                    athleteName: athlete.athleteName,
                    milestoneType: 'community',
                    title: `Membership Anniversary!`,
                    description: `${athlete.athleteName} has been a dedicated member for ${description}. Thank you for being part of our community!`,
                    category: 'community',
                    value: description,
                    achievedAt: new Date(),
                });
                break;
            }
        }
    }

    return milestones;
}

/**
 * Format time in seconds to readable format
 */
function formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 100);

    if (minutes > 0) {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
        return milliseconds > 0
            ? `${remainingSeconds}.${milliseconds.toString().padStart(2, '0')}`
            : `${remainingSeconds}s`;
    }
}

/**
 * Store detected milestone in database
 */
export async function createMilestone(milestoneData: MilestoneData) {
    return await db.insert(athleteMilestones).values({
        boxId: milestoneData.membershipId, // Will be updated with actual boxId
        membershipId: milestoneData.membershipId,
        milestoneType: milestoneData.milestoneType,
        title: milestoneData.title,
        description: milestoneData.description,
        category: milestoneData.category,
        value: milestoneData.value,
        previousValue: milestoneData.previousValue || null,
        improvementPercent: milestoneData.improvementPercent?.toString() || null,
        achievedAt: milestoneData.achievedAt,
        createdAt: new Date(),
        updatedAt: new Date()
    });
}

/**
 * Process and store milestones for a box
 */
export async function processMilestones(boxId: string, lookbackDays: number = 7) {
    try {
        console.log(`[Analytics] Processing milestones for box ${boxId}`);

        const detectionResult = await detectNewMilestones(boxId, lookbackDays);

        // Store each milestone
        for (const milestone of detectionResult.milestonesDetected) {
            try {
                // Update milestone with boxId
                const milestoneWithBoxId = { ...milestone };

                // Get boxId from membership
                const membership = await db
                    .select({ boxId: boxMemberships.boxId })
                    .from(boxMemberships)
                    .where(eq(boxMemberships.id, milestone.membershipId))
                    .limit(1);

                if (membership[0]) {
                    await db.insert(athleteMilestones).values({
                        boxId: membership[0].boxId,
                        membershipId: milestone.membershipId,
                        milestoneType: milestone.milestoneType,
                        title: milestone.title,
                        description: milestone.description,
                        category: milestone.category,
                        value: milestone.value,
                        previousValue: milestone.previousValue || null,
                        improvementPercent: milestone.improvementPercent?.toString() || null,
                        achievedAt: milestone.achievedAt,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });

                    console.log(`[Analytics] Created milestone: ${milestone.title} for ${milestone.athleteName}`);
                } else {
                    console.warn(`[Analytics] Could not find boxId for membership ${milestone.membershipId}`);
                }
            } catch (error) {
                console.error(`[Analytics] Error storing milestone for ${milestone.athleteName}:`, error);
            }
        }

        console.log(`[Analytics] Successfully processed ${detectionResult.totalMilestones} milestones for box ${boxId}`);
        console.log(`[Analytics] Milestone breakdown:`, detectionResult.byType);

        return {
            boxId,
            milestonesProcessed: detectionResult.totalMilestones,
            byType: detectionResult.byType,
            completedAt: new Date()
        };
    } catch (error) {
        console.error(`[Analytics] Error processing milestones for box ${boxId}:`, error);
        throw error;
    }
}
