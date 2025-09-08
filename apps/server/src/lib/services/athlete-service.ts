// lib/services/athlete-service.ts
import { db } from "@/db";
import {
    athletePrs,
    athleteWellnessCheckins,
    athleteBenchmarks,
    wodFeedback,
    athleteBadges,
    movements,
    benchmarkWods,
    boxMemberships
} from "@/db/schema";
import {eq, and, desc, gte, lte, count, avg, sql} from "drizzle-orm";

export interface AthleteProfileData {
    profile: typeof boxMemberships.$inferSelect;
    recentPrs: Array<{
        pr: typeof athletePrs.$inferSelect;
        movement: typeof movements.$inferSelect;
    }>;
    recentActivity: typeof athleteWellnessCheckins.$inferSelect[];
    stats: {
        checkinStreak: number;
        totalCheckins: number;
        longestStreak: number;
        memberSince: Date;
    };
}

export interface WellnessCheckinData {
    energyLevel: number;
    sleepQuality: number;
    stressLevel: number;
    motivationLevel: number;
    workoutReadiness: number;
    soreness?: Record<string, number>;
    painAreas?: Record<string, number>;
    hydrationLevel?: number;
    nutritionQuality?: number;
    outsideActivity?: string;
    mood?: string;
    notes?: string;
}

export class AthleteService {
    /**
     * Get comprehensive athlete profile with recent activity
     */
    static async getAthleteProfile(
        boxId: string,
        athleteId: string,
        options: {
            includePrs?: boolean;
            includeRecentActivity?: boolean;
        } = {}
    ): Promise<AthleteProfileData | null> {
        const { includePrs = true, includeRecentActivity = true } = options;

        // Get target athlete membership
        const targetMembership = await db
            .select()
            .from(boxMemberships)
            .where(eq(boxMemberships.id, athleteId))
            .limit(1);

        if (!targetMembership.length) {
            return null;
        }

        const profile = targetMembership[0];
        let recentPrs: Array<{
            pr: typeof athletePrs.$inferSelect;
            movement: typeof movements.$inferSelect;
        }> = [];
        let recentActivity: typeof athleteWellnessCheckins.$inferSelect[] = [];

        if (includePrs) {
            recentPrs = await this.getRecentPRs(boxId, athleteId, 30, 10);
        }

        if (includeRecentActivity) {
            recentActivity = await this.getWellnessCheckins(boxId, athleteId, 7, 7);
        }

        return {
            profile,
            recentPrs,
            recentActivity,
            stats: {
                checkinStreak: profile.checkinStreak,
                totalCheckins: profile.totalCheckins,
                longestStreak: profile.longestCheckinStreak,
                memberSince: profile.joinedAt,
            }
        };
    }

    /**
     * Get recent PRs for an athlete
     */
    static async getRecentPRs(
        boxId: string,
        athleteId: string,
        days: number = 30,
        limit: number = 10
    ) {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);

        return db
            .select({
                pr: athletePrs,
                movement: movements,
            })
            .from(athletePrs)
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .where(
                and(
                    eq(athletePrs.boxId, boxId),
                    eq(athletePrs.membershipId, athleteId),
                    gte(athletePrs.achievedAt, dateFrom)
                )
            )
            .orderBy(desc(athletePrs.achievedAt))
            .limit(limit);
    }

    /**
     * Get wellness check-ins for an athlete
     */
    static async getWellnessCheckins(
        boxId: string,
        athleteId: string,
        days: number = 7,
        limit: number = 7
    ) {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);

        return db
            .select()
            .from(athleteWellnessCheckins)
            .where(
                and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    eq(athleteWellnessCheckins.membershipId, athleteId),
                    gte(athleteWellnessCheckins.checkinDate, dateFrom)
                )
            )
            .orderBy(desc(athleteWellnessCheckins.checkinDate))
            .limit(limit);
    }

    /**
     * Submit a wellness check-in
     */
    static async submitWellnessCheckin(
        boxId: string,
        athleteId: string,
        data: WellnessCheckinData
    ) {
        // Check if already checked in today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const existingCheckin = await db
            .select()
            .from(athleteWellnessCheckins)
            .where(
                and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    eq(athleteWellnessCheckins.membershipId, athleteId),
                    gte(athleteWellnessCheckins.checkinDate, today),
                    lte(athleteWellnessCheckins.checkinDate, tomorrow)
                )
            )
            .limit(1);

        if (existingCheckin.length > 0) {
            throw new Error("You have already checked in today");
        }

        const [checkin] = await db
            .insert(athleteWellnessCheckins)
            .values({
                boxId,
                membershipId: athleteId,
                energyLevel: data.energyLevel,
                sleepQuality: data.sleepQuality,
                stressLevel: data.stressLevel,
                motivationLevel: data.motivationLevel,
                workoutReadiness: data.workoutReadiness,
                soreness: data.soreness ? JSON.stringify(data.soreness) : null,
                painAreas: data.painAreas ? JSON.stringify(data.painAreas) : null,
                hydrationLevel: data.hydrationLevel,
                nutritionQuality: data.nutritionQuality,
                outsideActivity: data.outsideActivity,
                mood: data.mood,
                notes: data.notes,
                checkinDate: new Date(),
            })
            .returning();

        // Update streak
        await this.updateCheckinStreak(athleteId);

        return checkin;
    }

    /**
     * Update athlete check-in streak
     */
    static async updateCheckinStreak(membershipId: string) {
        const membership = await db
            .select()
            .from(boxMemberships)
            .where(eq(boxMemberships.id, membershipId))
            .limit(1);

        if (!membership.length) {
            throw new Error("Membership not found");
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        // Check if there was a check-in yesterday
        const yesterdayCheckin = await db
            .select()
            .from(athleteWellnessCheckins)
            .where(
                and(
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    gte(athleteWellnessCheckins.checkinDate, yesterday),
                    lte(athleteWellnessCheckins.checkinDate, today)
                )
            )
            .limit(1);

        const currentMembership = membership[0];
        const newStreak = yesterdayCheckin.length > 0 ? currentMembership.checkinStreak + 1 : 1;
        const newLongestStreak = Math.max(currentMembership.longestCheckinStreak, newStreak);

        await db
            .update(boxMemberships)
            .set({
                lastCheckinDate: new Date(),
                totalCheckins: currentMembership.totalCheckins + 1,
                checkinStreak: newStreak,
                longestCheckinStreak: newLongestStreak,
                updatedAt: new Date(),
            })
            .where(eq(boxMemberships.id, membershipId));

        return {
            newStreak,
            newLongestStreak,
            totalCheckins: currentMembership.totalCheckins + 1,
        };
    }

    /**
     * Get athlete performance summary
     */
    static async getPerformanceSummary(boxId: string, athleteId: string, days: number = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [
            prCount,
            benchmarkCount,
            checkinCount,
            wodCount
        ] = await Promise.all([
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    eq(athletePrs.membershipId, athleteId),
                    gte(athletePrs.achievedAt, startDate)
                )),

            db.select({ count: count() })
                .from(athleteBenchmarks)
                .where(and(
                    eq(athleteBenchmarks.boxId, boxId),
                    eq(athleteBenchmarks.membershipId, athleteId),
                    gte(athleteBenchmarks.updatedAt, startDate)
                )),

            db.select({ count: count() })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    eq(athleteWellnessCheckins.membershipId, athleteId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),

            db.select({ count: count() })
                .from(wodFeedback)
                .where(and(
                    eq(wodFeedback.boxId, boxId),
                    eq(wodFeedback.membershipId, athleteId),
                    gte(wodFeedback.wodDate, startDate)
                ))
        ]);

        return {
            personalRecords: prCount[0].count,
            benchmarks: benchmarkCount[0].count,
            checkins: checkinCount[0].count,
            workouts: wodCount[0].count,
            period: {
                days,
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Get athlete badges
     */
    static async getAthleteBadges(boxId: string, athleteId: string) {
        return db
            .select()
            .from(athleteBadges)
            .where(
                and(
                    eq(athleteBadges.boxId, boxId),
                    eq(athleteBadges.membershipId, athleteId),
                    eq(athleteBadges.isHidden, false)
                )
            )
            .orderBy(desc(athleteBadges.awardedAt));
    }

    /**
     * Log a PR for an athlete
     */
    static async logPr(
        boxId: string,
        athleteId: string,
        movementId: string,
        value: number,
        unit: string,
        options: {
            reps?: number;
            notes?: string;
            coachNotes?: string;
            videoUrl?: string;
            videoVisibility?: "private" | "box" | "public";
            achievedAt?: Date;
            verifiedByCoach?: boolean;
        } = {}
    ) {
        const publicId = crypto.randomUUID();

        const [pr] = await db
            .insert(athletePrs)
            .values({
                boxId,
                membershipId: athleteId,
                movementId,
                value: value.toString(),
                unit,
                reps: options.reps,
                notes: options.notes,
                coachNotes: options.coachNotes,
                videoUrl: options.videoUrl,
                videoVisibility: options.videoVisibility || "private",
                achievedAt: options.achievedAt || new Date(),
                publicId,
                verifiedByCoach: options.verifiedByCoach || false,
            })
            .returning();

        return pr;
    }

    /**
     * Log benchmark result for an athlete
     */
    static async logBenchmarkResult(
        boxId: string,
        athleteId: string,
        benchmarkId: string,
        result: number,
        resultType: "time" | "rounds_reps" | "weight",
        options: {
            scaled?: boolean;
            scalingNotes?: string;
            notes?: string;
            coachNotes?: string;
            completedAt?: Date;
        } = {}
    ) {
        const publicId = crypto.randomUUID();

        const [benchmarkResult] = await db
            .insert(athleteBenchmarks)
            .values({
                boxId,
                membershipId: athleteId,
                benchmarkId,
                result: result.toString(),
                resultType,
                scaled: options.scaled || false,
                scalingNotes: options.scalingNotes,
                notes: options.notes,
                coachNotes: options.coachNotes,
                completedAt: options.completedAt || new Date(),
                publicId,
            })
            .returning();

        return benchmarkResult;
    }

    /**
     * Submit WOD feedback
     */
    static async submitWodFeedback(
        boxId: string,
        athleteId: string,
        data: {
            rpe: number;
            difficultyRating: number;
            enjoymentRating?: number;
            painDuringWorkout?: Record<string, number>;
            feltGoodMovements?: string;
            struggledMovements?: string;
            completed?: boolean;
            scalingUsed?: boolean;
            scalingDetails?: string;
            workoutTime?: number;
            result?: string;
            notes?: string;
            wodName?: string;
        }
    ) {
        const [feedback] = await db
            .insert(wodFeedback)
            .values({
                boxId,
                membershipId: athleteId,
                rpe: data.rpe,
                difficultyRating: data.difficultyRating,
                enjoymentRating: data.enjoymentRating,
                painDuringWorkout: data.painDuringWorkout ? JSON.stringify(data.painDuringWorkout) : null,
                feltGoodMovements: data.feltGoodMovements,
                struggledMovements: data.struggledMovements,
                completed: data.completed !== undefined ? data.completed : true,
                scalingUsed: data.scalingUsed !== undefined ? data.scalingUsed : false,
                scalingDetails: data.scalingDetails,
                workoutTime: data.workoutTime,
                result: data.result,
                notes: data.notes,
                wodName: data.wodName,
                wodDate: new Date(),
            })
            .returning();

        return feedback;
    }
}
