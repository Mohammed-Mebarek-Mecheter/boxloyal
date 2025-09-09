// lib/services/athlete-service.ts - Enhanced version aligned with new schema
import { db } from "@/db";
import {
    athletePrs,
    athleteWellnessCheckins,
    athleteBenchmarks,
    wodFeedback,
    athleteBadges,
    movements,
    benchmarkWods,
    boxMemberships,
    athleteSorenessEntries,
    athletePainEntries,
    wodPainEntries,
    videoConsents,
    videoProcessingEvents,
    gumletWebhookEvents,
    wodAttendance,
    leaderboards,
    leaderboardEntries
} from "@/db/schema";
import { eq, and, desc, gte, lte, count, avg, sql } from "drizzle-orm";

export interface AthleteProfileData {
    profile: typeof boxMemberships.$inferSelect;
    recentPrs: Array<{
        pr: typeof athletePrs.$inferSelect;
        movement: typeof movements.$inferSelect;
    }>;
    recentBenchmarks: Array<{
        benchmark: typeof athleteBenchmarks.$inferSelect;
        benchmarkWod: typeof benchmarkWods.$inferSelect;
    }>;
    recentActivity: typeof athleteWellnessCheckins.$inferSelect[];
    badges: typeof athleteBadges.$inferSelect[];
    stats: {
        checkinStreak: number;
        totalCheckins: number;
        longestStreak: number;
        memberSince: Date;
        totalPrs: number;
        totalBenchmarks: number;
        attendanceRate: number;
        avgWellnessScore: number;
    };
}

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

export interface VideoUploadData {
    gumletAssetId: string;
    consentTypes: string[];
    thumbnailUrl?: string;
    videoDuration?: number;
    collectionId?: string;
    gumletMetadata?: any;
}

export interface RiskIndicators {
    membershipId: string;
    riskScore: number;
    riskFactors: Array<{
        type: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        description: string;
        value: number | string;
        trend: 'improving' | 'stable' | 'declining';
    }>;
    recommendations: string[];
    lastUpdated: Date;
}

export class AthleteService {
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
        } = {}
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
            promises.push(this.getRecentPRs(boxId, athleteId, days, limit));
        }

        if (includeBenchmarks) {
            promises.push(this.getRecentBenchmarks(boxId, athleteId, days, limit));
        }

        if (includeRecentActivity) {
            promises.push(this.getWellnessCheckins(boxId, athleteId, 7, 7));
        }

        if (includeBadges) {
            promises.push(this.getAthleteBadges(boxId, athleteId));
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

        // Update streak
        await this.updateCheckinStreak(athleteId);

        return checkin;
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
     * Get athlete badges with enhanced filtering
     */
    static async getAthleteBadges(boxId: string, athleteId: string, options: {
        includeHidden?: boolean;
        badgeType?: string;
        limit?: number;
    } = {}) {
        const { includeHidden = false, badgeType, limit = 50 } = options;

        const conditions = [
            eq(athleteBadges.boxId, boxId),
            eq(athleteBadges.membershipId, athleteId)
        ];

        if (!includeHidden) {
            conditions.push(eq(athleteBadges.isHidden, false));
        }

        if (badgeType) {
            conditions.push(eq(athleteBadges.badgeType, badgeType as any));
        }

        return db
            .select()
            .from(athleteBadges)
            .where(and(...conditions))
            .orderBy(desc(athleteBadges.awardedAt))
            .limit(limit);
    }

    /**
     * Log a PR with enhanced video support
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
            achievedAt?: Date;
            verifiedByCoach?: boolean;
            videoData?: VideoUploadData;
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
                achievedAt: options.achievedAt || new Date(),
                publicId,
                verifiedByCoach: options.verifiedByCoach || false,
                // Video fields
                gumletAssetId: options.videoData?.gumletAssetId,
                videoProcessingStatus: options.videoData ? 'upload_pending' : 'pending',
                thumbnailUrl: options.videoData?.thumbnailUrl,
                videoDuration: options.videoData?.videoDuration?.toString(),
                collectionId: options.videoData?.collectionId,
                gumletMetadata: options.videoData?.gumletMetadata,
            })
            .returning();

        // Handle video consent if video data is provided
        if (options.videoData) {
            await db.insert(videoConsents).values({
                membershipId: athleteId,
                prId: pr.id,
                consentTypes: options.videoData.consentTypes,
                givenAt: new Date(),
            });

            // Log initial video processing event
            await db.insert(videoProcessingEvents).values({
                prId: pr.id,
                gumletAssetId: options.videoData.gumletAssetId,
                eventType: 'upload_started',
                status: 'upload-pending',
                progress: 0,
            });
        }

        return pr;
    }

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

    /**
     * Award badges based on achievements (gamification feature)
     */
    static async awardBadge(
        boxId: string,
        athleteId: string,
        badgeData: {
            badgeType: string;
            title: string;
            description?: string;
            icon?: string;
            achievedValue?: string;
            tier?: number;
        }
    ) {
        // Check if badge already exists
        const existingBadge = await db
            .select()
            .from(athleteBadges)
            .where(
                and(
                    eq(athleteBadges.boxId, boxId),
                    eq(athleteBadges.membershipId, athleteId),
                    eq(athleteBadges.badgeType, badgeData.badgeType as any),
                    eq(athleteBadges.tier, badgeData.tier || 1)
                )
            )
            .limit(1);

        if (existingBadge.length > 0) {
            return existingBadge[0]; // Badge already awarded
        }

        const [badge] = await db
            .insert(athleteBadges)
            .values({
                boxId,
                membershipId: athleteId,
                badgeType: badgeData.badgeType as any,
                title: badgeData.title,
                description: badgeData.description,
                icon: badgeData.icon,
                achievedValue: badgeData.achievedValue,
                tier: badgeData.tier || 1,
                awardedAt: new Date(),
            })
            .returning();

        return badge;
    }

    /**
     * Process video webhook from Gumlet
     */
    static async processGumletWebhook(webhookData: {
        asset_id: string;
        status: string;
        progress?: number;
        webhook_id?: string;
        [key: string]: any;
    }) {
        // Store webhook event
        const [webhookEvent] = await db
            .insert(gumletWebhookEvents)
            .values({
                webhookId: webhookData.webhook_id,
                assetId: webhookData.asset_id,
                eventType: 'status',
                status: webhookData.status,
                progress: webhookData.progress,
                payload: webhookData,
            })
            .returning();

        // Update related PR record
        await db
            .update(athletePrs)
            .set({
                videoProcessingStatus: this.mapGumletStatusToEnum(webhookData.status),
                updatedAt: new Date(),
            })
            .where(eq(athletePrs.gumletAssetId, webhookData.asset_id));

        // Log processing event
        await db
            .insert(videoProcessingEvents)
            .values({
                prId: sql`(SELECT id FROM ${athletePrs} WHERE gumlet_asset_id = ${webhookData.asset_id} LIMIT 1)`,
                gumletAssetId: webhookData.asset_id,
                eventType: 'status_update',
                status: webhookData.status,
                progress: webhookData.progress,
                metadata: webhookData,
            });

        // Mark webhook as processed
        await db
            .update(gumletWebhookEvents)
            .set({
                processed: true,
                processedAt: new Date(),
            })
            .where(eq(gumletWebhookEvents.id, webhookEvent.id));

        return webhookEvent;
    }

    /**
     * Map Gumlet status to our enum values
     */
    private static mapGumletStatusToEnum(gumletStatus: string) {
        const statusMap: Record<string, any> = {
            'upload-pending': 'upload_pending',
            'processing': 'processing',
            'ready': 'ready',
            'error': 'error',
            'failed': 'error'
        };

        return statusMap[gumletStatus] || 'pending';
    }

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
