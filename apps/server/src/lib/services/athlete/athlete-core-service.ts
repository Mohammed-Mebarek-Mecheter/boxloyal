// lib/services/athlete-core-service.ts
import {
    athleteBadges,
    athleteBenchmarks,
    athletePrs,
    athleteWellnessCheckins,
    benchmarkWods,
    boxMemberships,
    movements,
    wodAttendance,
    wodFeedback
} from "@/db/schema";
import type { AthleteProfileData } from "@/lib/services/athlete/athlete-service";
import { db } from "@/db";
import { and, avg, count, eq, gte, lte, sql } from "drizzle-orm";

// Import interfaces for service dependencies
interface IAthletePRService {
    getRecentPRs(boxId: string, athleteId: string, days: number, limit: number): Promise<any>;
}

interface IAthleteBenchmarkService {
    getRecentBenchmarks(boxId: string, athleteId: string, days: number, limit: number): Promise<any>;
}

interface IAthleteWellnessService {
    getWellnessCheckins(boxId: string, athleteId: string, days: number, limit: number): Promise<any>;
}

interface IAthleteBadgeService {
    getAthleteBadges(boxId: string, athleteId: string, options?: any): Promise<any>;
}

export class AthleteCoreService {
    /**
     * Get comprehensive athlete profile with recent activity and analytics
     */
    static async getAthleteProfile(
        boxId: string,
        athleteId: string,
        options: {
            includePrs?: boolean;
            includeRecentActivity?: boolean;
            includeBenchmarks?: boolean;
            includeBadges?: boolean;
            includeStats?: boolean;
            days?: number;
            limit?: number;
        } = {},
        // Service dependencies
        services: {
            prService: IAthletePRService;
            benchmarkService: IAthleteBenchmarkService;
            wellnessService: IAthleteWellnessService;
            badgeService: IAthleteBadgeService;
        }
    ): Promise<AthleteProfileData | null> {
        const {
            includePrs = true,
            includeRecentActivity = true,
            includeBenchmarks = true,
            includeBadges = true,
            includeStats = true,
            days = 30,
            limit = 10
        } = options;

        // Get target athlete membership
        const targetMembership = await db
            .select()
            .from(boxMemberships)
            .where(
                and(
                    eq(boxMemberships.id, athleteId),
                    eq(boxMemberships.boxId, boxId)
                )
            )
            .limit(1);

        if (!targetMembership.length) {
            return null;
        }

        const profile = targetMembership[0];
        let recentPrs: Array<{
            pr: typeof athletePrs.$inferSelect;
            movement: typeof movements.$inferSelect;
        }> = [];
        let recentBenchmarks: Array<{
            benchmark: typeof athleteBenchmarks.$inferSelect;
            benchmarkWod: typeof benchmarkWods.$inferSelect;
        }> = [];
        let recentActivity: typeof athleteWellnessCheckins.$inferSelect[] = [];
        let badges: typeof athleteBadges.$inferSelect[] = [];
        let stats = {
            checkinStreak: profile.checkinStreak || 0,
            totalCheckins: profile.totalCheckins || 0,
            longestStreak: profile.longestCheckinStreak || 0,
            memberSince: profile.joinedAt,
            totalPrs: 0,
            totalBenchmarks: 0,
            attendanceRate: 0,
            avgWellnessScore: 0
        };

        // Fetch data in parallel for better performance
        const promises: Promise<any>[] = [];

        if (includePrs) {
            promises.push(services.prService.getRecentPRs(boxId, athleteId, days, limit));
        }

        if (includeBenchmarks) {
            promises.push(services.benchmarkService.getRecentBenchmarks(boxId, athleteId, days, limit));
        }

        if (includeRecentActivity) {
            promises.push(services.wellnessService.getWellnessCheckins(boxId, athleteId, 7, 7));
        }

        if (includeBadges) {
            promises.push(services.badgeService.getAthleteBadges(boxId, athleteId));
        }

        if (includeStats) {
            promises.push(this.getAthleteStats(boxId, athleteId, days));
        }

        const results = await Promise.all(promises);
        let resultIndex = 0;

        if (includePrs) {
            recentPrs = results[resultIndex++];
        }
        if (includeBenchmarks) {
            recentBenchmarks = results[resultIndex++];
        }
        if (includeRecentActivity) {
            recentActivity = results[resultIndex++];
        }
        if (includeBadges) {
            badges = results[resultIndex++];
        }
        if (includeStats) {
            const additionalStats = results[resultIndex++];
            stats = { ...stats, ...additionalStats };
        }

        return {
            profile,
            recentPrs,
            recentBenchmarks,
            recentActivity,
            badges,
            stats
        };
    }

    /**
     * Get athlete performance and engagement stats
     */
    static async getAthleteStats(boxId: string, athleteId: string, days: number = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [
            prCount,
            benchmarkCount,
            checkinCount,
            wodCount,
            attendanceData,
            avgWellness
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
                    gte(athleteBenchmarks.achievedAt, startDate)
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
                )),

            db.select({
                attended: count(),
                totalScheduled: sql<number>`COUNT(*) FILTER (WHERE ${wodAttendance.status} IN ('attended', 'no_show', 'late_cancel'))`
            })
                .from(wodAttendance)
                .where(and(
                    eq(wodAttendance.boxId, boxId),
                    eq(wodAttendance.membershipId, athleteId),
                    gte(wodAttendance.attendanceDate, sql`${startDate}::date`),
                    eq(wodAttendance.status, 'attended')
                )),

            db.select({
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgSleep: avg(athleteWellnessCheckins.sleepQuality),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
            })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    eq(athleteWellnessCheckins.membershipId, athleteId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                ))
        ]);

        const attendanceRate = attendanceData[0].totalScheduled > 0
            ? (attendanceData[0].attended / attendanceData[0].totalScheduled) * 100
            : 0;

        const avgWellnessScore = avgWellness[0].avgEnergy
            ? ((Number(avgWellness[0].avgEnergy) + Number(avgWellness[0].avgSleep) +
                (10 - Number(avgWellness[0].avgStress)) + Number(avgWellness[0].avgReadiness)) / 4)
            : 0;

        return {
            totalPrs: prCount[0].count,
            totalBenchmarks: benchmarkCount[0].count,
            totalCheckins: checkinCount[0].count,
            totalWorkouts: wodCount[0].count,
            attendanceRate: Math.round(attendanceRate),
            avgWellnessScore: Math.round(avgWellnessScore * 10) / 10,
            period: {
                days,
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Update athlete check-in streak with enhanced logic
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

        // Check if there was a check-in yesterday to continue streak
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
        const newLongestStreak = Math.max(currentMembership.longestCheckinStreak || 0, newStreak);

        await db
            .update(boxMemberships)
            .set({
                lastCheckinDate: new Date(),
                totalCheckins: (currentMembership.totalCheckins || 0) + 1,
                checkinStreak: newStreak,
                longestCheckinStreak: newLongestStreak,
                updatedAt: new Date(),
            })
            .where(eq(boxMemberships.id, membershipId));

        return {
            newStreak,
            newLongestStreak,
            totalCheckins: (currentMembership.totalCheckins || 0) + 1,
        };
    }
}
