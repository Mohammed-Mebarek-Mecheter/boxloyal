// lib/services/athlete-wellness-service.ts
import { db } from "@/db";
import {
    athleteWellnessCheckins,
    athleteSorenessEntries,
    athletePainEntries,
    wodFeedback,
    wodPainEntries
} from "@/db/schema";
import {eq, and, gte, lte, desc} from "drizzle-orm";

export interface WellnessCheckinData {
    energyLevel: number;
    sleepQuality: number;
    stressLevel: number;
    motivationLevel: number;
    workoutReadiness: number;
    hydrationLevel?: number;
    nutritionQuality?: number;
    outsideActivity?: string;
    mood?: string;
    notes?: string;
    sorenessEntries?: Array<{
        bodyPart: string;
        severity: number;
        notes?: string;
    }>;
    painEntries?: Array<{
        bodyPart: string;
        severity: number;
        painType?: string;
        notes?: string;
    }>;
}

export interface WodFeedbackData {
    rpe: number;
    difficultyRating: number;
    enjoymentRating?: number;
    feltGoodMovements?: string;
    struggledMovements?: string;
    completed?: boolean;
    scalingUsed?: boolean;
    scalingDetails?: string;
    workoutDurationMinutes?: number;
    result?: string;
    notes?: string;
    coachNotes?: string;
    wodName: string;
    painEntries?: Array<{
        bodyPart: string;
        severity: number;
        painType?: string;
        notes?: string;
    }>;
}

export class AthleteWellnessService {
    /**
     * Get wellness check-ins with normalized soreness and pain data
     */
    static async getWellnessCheckins(
        boxId: string,
        athleteId: string,
        days: number = 7,
        limit: number = 7
    ) {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);

        const checkins = await db
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

        // Fetch associated soreness and pain entries for each checkin
        for (const checkin of checkins) {
            const [sorenessEntries, painEntries] = await Promise.all([
                db
                    .select()
                    .from(athleteSorenessEntries)
                    .where(eq(athleteSorenessEntries.checkinId, checkin.id)),
                db
                    .select()
                    .from(athletePainEntries)
                    .where(eq(athletePainEntries.checkinId, checkin.id))
            ]);

            (checkin as any).sorenessEntries = sorenessEntries;
            (checkin as any).painEntries = painEntries;
        }

        return checkins;
    }

    /**
     * Submit a comprehensive wellness check-in with normalized tracking
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

        // Create the wellness checkin
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
                hydrationLevel: data.hydrationLevel,
                nutritionQuality: data.nutritionQuality,
                outsideActivity: data.outsideActivity,
                mood: data.mood,
                notes: data.notes,
                checkinDate: new Date(),
            })
            .returning();

        // Add soreness entries if provided
        if (data.sorenessEntries && data.sorenessEntries.length > 0) {
            const sorenessValues = data.sorenessEntries.map(entry => ({
                checkinId: checkin.id,
                bodyPart: entry.bodyPart as any,
                severity: entry.severity,
                notes: entry.notes,
            }));

            await db.insert(athleteSorenessEntries).values(sorenessValues);
        }

        // Add pain entries if provided
        if (data.painEntries && data.painEntries.length > 0) {
            const painValues = data.painEntries.map(entry => ({
                checkinId: checkin.id,
                bodyPart: entry.bodyPart as any,
                severity: entry.severity,
                painType: entry.painType,
                notes: entry.notes,
            }));

            await db.insert(athletePainEntries).values(painValues);
        }

        return checkin;
    }

    /**
     * Submit comprehensive WOD feedback with normalized pain tracking
     */
    static async submitWodFeedback(
        boxId: string,
        athleteId: string,
        data: WodFeedbackData
    ) {
        const [feedback] = await db
            .insert(wodFeedback)
            .values({
                boxId,
                membershipId: athleteId,
                rpe: data.rpe,
                difficultyRating: data.difficultyRating,
                enjoymentRating: data.enjoymentRating,
                feltGoodMovements: data.feltGoodMovements,
                struggledMovements: data.struggledMovements,
                completed: data.completed !== undefined ? data.completed : true,
                scalingUsed: data.scalingUsed !== undefined ? data.scalingUsed : false,
                scalingDetails: data.scalingDetails,
                workoutDurationMinutes: data.workoutDurationMinutes,
                result: data.result,
                notes: data.notes,
                coachNotes: data.coachNotes,
                wodName: data.wodName,
                wodDate: new Date(),
            })
            .returning();

        // Add pain entries if provided
        if (data.painEntries && data.painEntries.length > 0) {
            const painValues = data.painEntries.map(entry => ({
                feedbackId: feedback.id,
                bodyPart: entry.bodyPart as any,
                severity: entry.severity,
                painType: entry.painType,
                notes: entry.notes,
            }));

            await db.insert(wodPainEntries).values(painValues);
        }

        return feedback;
    }
}
