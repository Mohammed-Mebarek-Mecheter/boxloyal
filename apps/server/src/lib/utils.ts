// lib/utils.ts
import { TRPCError } from "@trpc/server";

export function createSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function generateInviteToken(): string {
    return crypto.randomUUID();
}

export function generatePublicId(): string {
    // In production, use CUID2 for better performance
    return crypto.randomUUID();
}

export function validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

export function calculateCheckinStreak(
    checkins: Array<{ checkinDate: Date }>
): number {
    if (!checkins.length) return 0;

    const sortedCheckins = checkins.sort(
        (a, b) => b.checkinDate.getTime() - a.checkinDate.getTime()
    );

    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    for (const checkin of sortedCheckins) {
        const checkinDate = new Date(checkin.checkinDate);
        checkinDate.setHours(0, 0, 0, 0);

        const daysDiff = Math.floor(
            (currentDate.getTime() - checkinDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysDiff === streak) {
            streak++;
            currentDate = checkinDate;
        } else if (daysDiff === streak + 1) {
            // Allow for one day gap (weekend/rest day)
            streak++;
            currentDate = checkinDate;
        } else {
            break;
        }
    }

    return streak;
}

export function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function parseWodTime(timeString: string): number {
    // Parse MM:SS format to total seconds
    const parts = timeString.split(":");
    if (parts.length !== 2) throw new Error("Invalid time format");

    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);

    return minutes * 60 + seconds;
}

export function calculateRiskScore(
    attendance: number,
    wellness: number,
    performance: number,
    engagement: number
): { score: number; level: "low" | "medium" | "high" | "critical" } {
    const score = (attendance * 0.3 + wellness * 0.25 + performance * 0.25 + engagement * 0.2);

    if (score >= 80) return { score, level: "low" };
    if (score >= 60) return { score, level: "medium" };
    if (score >= 40) return { score, level: "high" };
    return { score, level: "critical" };
}

export function isWithinGracePeriod(
    memberCount: number,
    limit: number,
    graceDays: number = 14
): boolean {
    // Allow exceeding limits for a grace period
    return memberCount <= limit * 1.1; // 10% buffer
}

export function sanitizeInput(input: string): string {
    return input.trim().replace(/[<>]/g, "");
}

// Error handling utilities
export function handleDbError(error: unknown): never {
    console.error("Database error:", error);

    if (error instanceof Error) {
        if (error.message.includes("unique constraint")) {
            throw new TRPCError({
                code: "CONFLICT",
                message: "Resource already exists",
            });
        }

        if (error.message.includes("foreign key constraint")) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Invalid reference",
            });
        }
    }

    throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database operation failed",
    });
}

// Validation schemas for common operations
import { z } from "zod";

export const boxIdSchema = z.object({
    boxId: z.string().uuid(),
});

export const paginationSchema = z.object({
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
    startDate: z.date().optional(),
    endDate: z.date().optional(),
});

export const athleteFilterSchema = z.object({
    role: z.enum(["owner", "head_coach", "coach", "athlete"]).optional(),
    isActive: z.boolean().optional(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
});

// Constants
export const CHECKIN_STREAK_GRACE_DAYS = 1;
export const TRIAL_DURATION_DAYS = 7;
export const INVITE_EXPIRY_DAYS = 7;
export const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB
export const SUPPORTED_VIDEO_FORMATS = [".mp4", ".mov", ".avi"];

// Feature flags for gradual rollout
export const FEATURE_FLAGS = {
    VIDEO_UPLOADS: process.env.FEATURE_VIDEO_UPLOADS === "true",
    ANALYTICS_V2: process.env.FEATURE_ANALYTICS_V2 === "true",
    SOCIAL_FEATURES: process.env.FEATURE_SOCIAL === "true",
    MOBILE_APP: process.env.FEATURE_MOBILE_APP === "true",
} as const;
