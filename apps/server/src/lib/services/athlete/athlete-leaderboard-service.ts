// lib/services/athlete/athlete-leaderboard-service.ts
import {boxMemberships, leaderboardEntries, leaderboards} from "@/db/schema";
import {db} from "@/db";
import {and, desc, eq, sql} from "drizzle-orm";

export class AthleteLeaderboardService {
    /**
     * Create a new leaderboard
     */
    static async createLeaderboard(
        boxId: string,
        createdByMembershipId: string,
        leaderboardData: {
            name: string;
            type: 'benchmark' | 'pr' | 'streak' | 'custom';
            category?: string;
            movementId?: string;
            benchmarkId?: string;
            periodStart?: Date;
            periodEnd?: Date;
            isActive?: boolean;
            maxEntries?: number;
        }
    ) {
        const [leaderboard] = await db
            .insert(leaderboards)
            .values({
                boxId,
                createdByMembershipId,
                name: leaderboardData.name,
                type: leaderboardData.type,
                category: leaderboardData.category,
                movementId: leaderboardData.movementId,
                benchmarkId: leaderboardData.benchmarkId,
                periodStart: leaderboardData.periodStart ? sql`${leaderboardData.periodStart.toISOString()}::timestamp with time zone` : null,
                periodEnd: leaderboardData.periodEnd ? sql`${leaderboardData.periodEnd.toISOString()}::timestamp with time zone` : null,
                isActive: leaderboardData.isActive ?? true,
                maxEntries: leaderboardData.maxEntries ?? 10,
            })
            .returning();

        return leaderboard;
    }

    /**
     * Add an entry to a leaderboard
     */
    static async addLeaderboardEntry(
        leaderboardId: string,
        membershipId: string,
        entryData: {
            value: number;
            rank: number;
            prId?: string;
            benchmarkId?: string;
            achievedAt: Date;
        }
    ) {
        const [entry] = await db
            .insert(leaderboardEntries)
            .values({
                leaderboardId,
                membershipId,
                value: entryData.value.toString(),
                rank: entryData.rank,
                prId: entryData.prId,
                benchmarkId: entryData.benchmarkId,
                achievedAt: sql`${entryData.achievedAt.toISOString()}::timestamp with time zone`,
            })
            .returning();

        return entry;
    }

    /**
     * Get leaderboard with entries
     */
    static async getLeaderboard(leaderboardId: string) {
        const leaderboard = await db
            .select()
            .from(leaderboards)
            .where(eq(leaderboards.id, leaderboardId))
            .leftJoin(leaderboardEntries, eq(leaderboardEntries.leaderboardId, leaderboards.id))
            .leftJoin(boxMemberships, eq(leaderboardEntries.membershipId, boxMemberships.id))
            .orderBy(leaderboardEntries.rank);

        return leaderboard;
    }

    /**
     * Get all active leaderboards for a box
     */
    static async getBoxLeaderboards(boxId: string) {
        const boxLeaderboards = await db
            .select()
            .from(leaderboards)
            .where(
                and(
                    eq(leaderboards.boxId, boxId),
                    eq(leaderboards.isActive, true)
                )
            )
            .orderBy(desc(leaderboards.createdAt));

        return boxLeaderboards;
    }

    /**
     * Update leaderboard entry rank
     */
    static async updateLeaderboardEntryRank(entryId: string, newRank: number) {
        const [updatedEntry] = await db
            .update(leaderboardEntries)
            .set({ rank: newRank })
            .where(eq(leaderboardEntries.id, entryId))
            .returning();

        return updatedEntry;
    }

    /**
     * Remove entry from leaderboard
     */
    static async removeLeaderboardEntry(entryId: string) {
        const [removedEntry] = await db
            .delete(leaderboardEntries)
            .where(eq(leaderboardEntries.id, entryId))
            .returning();

        return removedEntry;
    }

    /**
     * Deactivate a leaderboard
     */
    static async deactivateLeaderboard(leaderboardId: string) {
        const [deactivatedLeaderboard] = await db
            .update(leaderboards)
            .set({ isActive: false })
            .where(eq(leaderboards.id, leaderboardId))
            .returning();

        return deactivatedLeaderboard;
    }
}
