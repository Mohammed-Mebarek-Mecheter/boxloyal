// lib/services/athlete-attendance-service.ts
import { db } from "@/db";
import {wodAttendance} from "@/db/schema";
import {sql} from "drizzle-orm";

export class AthleteAttendanceService {
    /**
     * Track WOD attendance
     */
    static async recordAttendance(
        boxId: string,
        athleteId: string,
        attendanceData: {
            wodName: string;
            wodTime: Date;
            attendanceDate: Date;
            status: 'attended' | 'no_show' | 'late_cancel' | 'excused';
            checkedInAt?: Date;
            durationMinutes?: number;
            scaled?: boolean;
            rx?: boolean;
            score?: string;
            notes?: string;
            coachMembershipId?: string;
        }
    ) {
        const [attendance] = await db
            .insert(wodAttendance)
            .values({
                boxId,
                membershipId: athleteId,
                wodName: attendanceData.wodName,
                wodTime: sql`${attendanceData.wodTime.toISOString()}::timestamp with time zone`,
                attendanceDate: sql`${attendanceData.attendanceDate.toISOString().split('T')[0]}::date`,
                status: attendanceData.status,
                checkedInAt: attendanceData.checkedInAt ? sql`${attendanceData.checkedInAt.toISOString()}::timestamp with time zone` : null,
                durationMinutes: attendanceData.durationMinutes,
                scaled: attendanceData.scaled || false,
                rx: attendanceData.rx || false,
                score: attendanceData.score,
                notes: attendanceData.notes,
                coachMembershipId: attendanceData.coachMembershipId,
            })
            .returning();

        return attendance;
    }
}
