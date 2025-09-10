// lib/services/athlete-benchmark-service.ts
import { db } from "@/db";
import { athleteBenchmarks, benchmarkWods } from "@/db/schema";
import { eq, and, desc, gte } from "drizzle-orm";

export class AthleteBenchmarkService {
    /**
     * Log benchmark result with consistent naming
     */
    static async logBenchmarkResult(
        boxId: string,
        athleteId: string,
        benchmarkId: string,
        value: number,
        valueType: "time" | "rounds_reps" | "weight",
        options: {
            scaled?: boolean;
            scalingNotes?: string;
            notes?: string;
            coachNotes?: string;
            achievedAt?: Date;
        } = {}
    ) {
        const publicId = crypto.randomUUID();

        const [benchmarkResult] = await db
            .insert(athleteBenchmarks)
            .values({
                boxId,
                membershipId: athleteId,
                benchmarkId,
                value: value.toString(),
                valueType,
                scaled: options.scaled || false,
                scalingNotes: options.scalingNotes,
                notes: options.notes,
                coachNotes: options.coachNotes,
                achievedAt: options.achievedAt || new Date(),
                publicId,
            })
            .returning();

        return benchmarkResult;
    }

    /**
     * Get recent benchmark results for an athlete
     */
    static async getRecentBenchmarks(
        boxId: string,
        athleteId: string,
        days: number = 30,
        limit: number = 10
    ) {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);

        return db
            .select({
                benchmark: athleteBenchmarks,
                benchmarkWod: benchmarkWods,
            })
            .from(athleteBenchmarks)
            .innerJoin(benchmarkWods, eq(athleteBenchmarks.benchmarkId, benchmarkWods.id))
            .where(
                and(
                    eq(athleteBenchmarks.boxId, boxId),
                    eq(athleteBenchmarks.membershipId, athleteId),
                    gte(athleteBenchmarks.achievedAt, dateFrom)
                )
            )
            .orderBy(desc(athleteBenchmarks.achievedAt))
            .limit(limit);
    }
}
