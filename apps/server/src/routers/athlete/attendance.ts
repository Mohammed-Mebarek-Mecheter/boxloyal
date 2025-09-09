// routers/athlete/attendance.ts - New router for attendance tracking
import { router, protectedProcedure } from "@/lib/trpc";
import { z } from "zod";
import { AthleteService } from "@/lib/services/athlete-service";
import {
    requireBoxMembership,
    checkSubscriptionLimits,
    canAccessAthleteData,
    requireCoachOrAbove
} from "@/lib/permissions";
import { TRPCError } from "@trpc/server";

export const athleteAttendanceRouter = router({
    // Record WOD attendance
    recordAttendance: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            wodName: z.string().min(1).max(100),
            wodTime: z.date(),
            attendanceDate: z.date(),
            status: z.enum(["attended", "no_show", "late_cancel", "excused"]),
            checkedInAt: z.date().optional(),
            durationMinutes: z.number().positive().optional(),
            scaled: z.boolean().default(false),
            rx: z.boolean().default(false),
            score: z.string().max(100).optional(),
            notes: z.string().max(500).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Only coaches can record attendance for others
            if (input.athleteId && input.athleteId !== membership.id) {
                await requireCoachOrAbove(ctx, input.boxId);
            }

            return AthleteService.recordAttendance(
                input.boxId,
                targetAthleteId,
                {
                    wodName: input.wodName,
                    wodTime: input.wodTime,
                    attendanceDate: input.attendanceDate,
                    status: input.status,
                    checkedInAt: input.checkedInAt,
                    durationMinutes: input.durationMinutes,
                    scaled: input.scaled,
                    rx: input.rx,
                    score: input.score,
                    notes: input.notes,
                    coachMembershipId: membership.id,
                }
            );
        }),

    // Get attendance history
    getAttendanceHistory: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            days: z.number().min(1).max(365).default(30),
            status: z.enum(["attended", "no_show", "late_cancel", "excused"]).optional(),
            limit: z.number().min(1).max(100).default(50),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' attendance"
                    });
                }
            }

            // This would require implementing getAttendanceHistory in AthleteService
            // For now, return placeholder
            return {
                attendance: [],
                summary: {
                    totalSessions: 0,
                    attendedSessions: 0,
                    attendanceRate: 0,
                    noShows: 0,
                    lateCancellations: 0,
                }
            };
        }),

    // Get attendance analytics
    getAttendanceAnalytics: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            athleteId: z.uuid().optional(),
            period: z.enum(["week", "month", "quarter", "year"]).default("month"),
            groupBy: z.enum(["day", "week", "month"]).default("week"),
        }))
        .query(async ({ ctx, input }) => {
            const membership = await requireBoxMembership(ctx, input.boxId);
            const targetAthleteId = input.athleteId || membership.id;

            // Permission check
            if (input.athleteId && input.athleteId !== membership.id) {
                const canAccess = await canAccessAthleteData(ctx, input.boxId, input.athleteId);
                if (!canAccess) {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Cannot view other athletes' attendance analytics"
                    });
                }
            }

            // Placeholder for attendance analytics
            return {
                trends: [],
                summary: {
                    attendanceRate: 0,
                    consistencyScore: 0,
                    avgSessionsPerWeek: 0,
                    longestStreak: 0,
                    currentStreak: 0,
                }
            };
        }),

    // Bulk record attendance (for coaches)
    bulkRecordAttendance: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            wodName: z.string().min(1).max(100),
            wodTime: z.date(),
            attendanceDate: z.date(),
            attendanceRecords: z.array(z.object({
                athleteId: z.uuid(),
                status: z.enum(["attended", "no_show", "late_cancel", "excused"]),
                checkedInAt: z.date().optional(),
                durationMinutes: z.number().positive().optional(),
                scaled: z.boolean().default(false),
                rx: z.boolean().default(false),
                score: z.string().max(100).optional(),
                notes: z.string().max(500).optional(),
            })).min(1).max(50),
        }))
        .mutation(async ({ ctx, input }) => {
            await checkSubscriptionLimits(input.boxId);
            const membership = await requireCoachOrAbove(ctx, input.boxId);

            // Record attendance for each athlete
            const results = await Promise.all(
                input.attendanceRecords.map(record =>
                    AthleteService.recordAttendance(
                        input.boxId,
                        record.athleteId,
                        {
                            wodName: input.wodName,
                            wodTime: input.wodTime,
                            attendanceDate: input.attendanceDate,
                            status: record.status,
                            checkedInAt: record.checkedInAt,
                            durationMinutes: record.durationMinutes,
                            scaled: record.scaled,
                            rx: record.rx,
                            score: record.score,
                            notes: record.notes,
                            coachMembershipId: membership.id,
                        }
                    )
                )
            );

            return {
                recordedCount: results.length,
                attendanceRecords: results,
            };
        }),
});
