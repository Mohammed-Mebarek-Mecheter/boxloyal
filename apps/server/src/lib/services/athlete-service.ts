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
import {eq, and, desc, gte, count, lte} from "drizzle-orm";

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
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            recentPrs = await db
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
                        gte(athletePrs.achievedAt, thirtyDaysAgo)
                    )
                )
                .orderBy(desc(athletePrs.achievedAt))
                .limit(10);
        }

        if (includeRecentActivity) {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            recentActivity = await db
                .select()
                .from(athleteWellnessCheckins)
                .where(
                    and(
                        eq(athleteWellnessCheckins.boxId, boxId),
                        eq(athleteWellnessCheckins.membershipId, athleteId),
                        gte(athleteWellnessCheckins.checkinDate, sevenDaysAgo)
                    )
                )
                .orderBy(desc(athleteWellnessCheckins.checkinDate))
                .limit(7);
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
                    gte(athleteBenchmarks.completedAt, startDate)
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
}
