// lib/services/notifications/athlete/athlete-benchmark-notification-service.ts
import { db } from "@/db";
import {
    athleteBenchmarks,
    boxMemberships,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NotificationService } from "@/lib/services/notifications";

export class AthleteBenchmarkNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Send notification for new benchmark result
     */
    async sendNewBenchmarkNotification(benchmarkId: string) {
        const benchmark = await this.getBenchmarkWithDetails(benchmarkId);
        if (!benchmark) return null;

        const notification = await this.notificationService.createNotification({
            boxId: benchmark.boxId,
            userId: benchmark.membership.user.id,
            membershipId: benchmark.membershipId,
            type: "benchmark_result",
            category: "engagement",
            priority: "normal",
            title: `📊 New Benchmark Result: ${benchmark.benchmarkWod.name}`,
            message: `You completed ${benchmark.benchmarkWod.name} with a score of ${benchmark.value}${this.getUnitForValueType(benchmark.valueType)}`,
            actionUrl: `/athlete/benchmarks/${benchmark.publicId}`,
            actionLabel: "View Benchmark",
            channels: ["in_app"],
            data: {
                benchmarkId: benchmark.id,
                benchmarkName: benchmark.benchmarkWod.name,
                value: benchmark.value,
                valueType: benchmark.valueType,
                scaled: benchmark.scaled,
                achievedAt: benchmark.achievedAt
            },
            deduplicationKey: `benchmark_${benchmarkId}`,
        });

        return notification;
    }

    /**
     * Send notification to coaches about athlete benchmark result
     */
    async sendCoachBenchmarkNotification(benchmarkId: string) {
        const benchmark = await this.getBenchmarkWithDetails(benchmarkId);
        if (!benchmark) return null;

        const coaches = await this.getBoxCoaches(benchmark.boxId);
        const notifications = [];

        for (const coach of coaches) {
            const notification = await this.notificationService.createNotification({
                boxId: benchmark.boxId,
                userId: coach.userId,
                membershipId: coach.id,
                type: "athlete_benchmark_result",
                category: "workflow",
                priority: "normal",
                title: `${benchmark.membership.displayName} Completed ${benchmark.benchmarkWod.name}`,
                message: `${benchmark.membership.displayName} scored ${benchmark.value}${this.getUnitForValueType(benchmark.valueType)} on ${benchmark.benchmarkWod.name}`,
                actionUrl: `/coaching/benchmarks/${benchmark.publicId}`,
                actionLabel: "Review Result",
                channels: ["in_app"],
                data: {
                    athleteId: benchmark.membershipId,
                    athleteName: benchmark.membership.displayName,
                    benchmarkId: benchmark.id,
                    benchmarkName: benchmark.benchmarkWod.name,
                    value: benchmark.value,
                    valueType: benchmark.valueType,
                    scaled: benchmark.scaled,
                    achievedAt: benchmark.achievedAt
                },
                deduplicationKey: `coach_benchmark_${benchmarkId}_${coach.id}`,
            });

            notifications.push(notification);
        }

        return notifications;
    }

    /**
     * Send notification for benchmark personal best
     */
    async sendPersonalBestNotification(benchmarkId: string, previousBest: string) {
        const benchmark = await this.getBenchmarkWithDetails(benchmarkId);
        if (!benchmark) return null;

        const notification = await this.notificationService.createNotification({
            boxId: benchmark.boxId,
            userId: benchmark.membership.user.id,
            membershipId: benchmark.membershipId,
            type: "benchmark_personal_best",
            category: "engagement",
            priority: "high",
            title: `🎯 Personal Best on ${benchmark.benchmarkWod.name}!`,
            message: `You set a new personal record of ${benchmark.value}${this.getUnitForValueType(benchmark.valueType)}, beating your previous best of ${previousBest}!`,
            actionUrl: `/athlete/benchmarks/${benchmark.publicId}`,
            actionLabel: "View Achievement",
            channels: ["in_app", "email"],
            data: {
                benchmarkId: benchmark.id,
                benchmarkName: benchmark.benchmarkWod.name,
                newValue: benchmark.value,
                previousBest,
                valueType: benchmark.valueType,
                scaled: benchmark.scaled,
                achievedAt: benchmark.achievedAt
            },
            deduplicationKey: `benchmark_pb_${benchmarkId}`,
        });

        return notification;
    }

    /**
     * Send notification for benchmark consistency achievement
     */
    async sendBenchmarkConsistencyNotification(athleteId: string, benchmarkName: string, timesCompleted: number) {
        const athlete = await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, athleteId),
            with: {
                user: true,
                box: true
            }
        });

        if (!athlete) return null;

        const notification = await this.notificationService.createNotification({
            boxId: athlete.boxId,
            userId: athlete.user.id,
            membershipId: athleteId,
            type: "benchmark_consistency",
            category: "engagement",
            priority: "normal",
            title: `📈 Benchmark Consistency: ${benchmarkName}`,
            message: `You've completed ${benchmarkName} ${timesCompleted} times! Keep tracking your progress.`,
            actionUrl: `/athlete/benchmarks`,
            actionLabel: "View Benchmarks",
            channels: ["in_app"],
            data: {
                benchmarkName,
                timesCompleted,
                achievedAt: new Date()
            },
            deduplicationKey: `benchmark_consistency_${athleteId}_${benchmarkName}_${timesCompleted}`,
        });

        return notification;
    }

    /**
     * Send notification for benchmark RX achievement
     */
    async sendRxAchievementNotification(benchmarkId: string) {
        const benchmark = await this.getBenchmarkWithDetails(benchmarkId);
        if (!benchmark || benchmark.scaled) return null;

        const notification = await this.notificationService.createNotification({
            boxId: benchmark.boxId,
            userId: benchmark.membership.user.id,
            membershipId: benchmark.membershipId,
            type: "benchmark_rx_achievement",
            category: "engagement",
            priority: "high",
            title: `💪 RX Achievement on ${benchmark.benchmarkWod.name}!`,
            message: `You completed ${benchmark.benchmarkWod.name} as prescribed (RX)! Amazing work!`,
            actionUrl: `/athlete/benchmarks/${benchmark.publicId}`,
            actionLabel: "View Achievement",
            channels: ["in_app", "email"],
            data: {
                benchmarkId: benchmark.id,
                benchmarkName: benchmark.benchmarkWod.name,
                value: benchmark.value,
                valueType: benchmark.valueType,
                achievedAt: benchmark.achievedAt
            },
            deduplicationKey: `benchmark_rx_${benchmarkId}`,
        });

        return notification;
    }

    /**
     * Helper to get benchmark with details
     */
    private async getBenchmarkWithDetails(benchmarkId: string) {
        return await db.query.athleteBenchmarks.findFirst({
            where: eq(athleteBenchmarks.id, benchmarkId),
            with: {
                membership: {
                    with: {
                        user: true
                    }
                },
                benchmarkWod: true
            }
        });
    }

    /**
     * Helper to get box coaches
     */
    private async getBoxCoaches(boxId: string) {
        return await db.query.boxMemberships.findMany({
            where: and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                eq(boxMemberships.role, "coach")
            ),
            with: {
                user: true
            }
        });
    }

    /**
     * Helper to get unit for value type
     */
    private getUnitForValueType(valueType: string): string {
        switch (valueType) {
            case "time": return "s";
            case "weight": return "lbs";
            case "rounds_reps": return " reps";
            default: return "";
        }
    }
}
