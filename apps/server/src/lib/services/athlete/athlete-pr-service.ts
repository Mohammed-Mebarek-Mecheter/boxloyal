// lib/services/athlete-pr-service.ts - Enhanced for Video Strategy
import { db } from "@/db";
import { athletePrs, movements, videoConsents, videoProcessingEvents, boxMemberships } from "@/db/schema";
import { eq, and, desc, gte, count, sql } from "drizzle-orm";
import { GumletService } from "../gumlet-service";
import { AthleteBadgeService } from "./athlete-badge-service";

export interface PRCelebrationData {
    showConfetti: boolean;
    badgesAwarded: Array<{
        type: string;
        title: string;
        description: string;
    }>;
    milestones: Array<{
        type: 'first_pr' | 'video_verified' | 'weight_milestone' | 'consistency';
        achievement: string;
        value: string;
    }>;
    socialShareData?: {
        title: string;
        description: string;
        imageUrl?: string;
    };
}

export interface VideoUploadData {
    gumletAssetId: string;
    consentTypes: string[];
    thumbnailUrl?: string;
    videoDuration?: number;
    collectionId?: string;
    gumletMetadata?: any;
}

export interface PRWithVideoData {
    pr: typeof athletePrs.$inferSelect;
    movement: typeof movements.$inferSelect;
    hasVideo: boolean;
    videoStatus?: string;
    playbackUrls?: any;
    thumbnailUrl?: string;
    celebrationData?: PRCelebrationData;
    coachFeedback?: Array<{
        id: string;
        feedback: string;
        timestamp: Date;
        coachName: string;
    }>;
}

export class AthletePRService {
    /**
     * Log a PR with enhanced celebration and video support
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
            triggerCelebration?: boolean;
        } = {}
    ) {
        const publicId = crypto.randomUUID();

        // Get movement details for celebration context
        const movement = await db
            .select()
            .from(movements)
            .where(eq(movements.id, movementId))
            .limit(1);

        if (!movement.length) {
            throw new Error("Movement not found");
        }

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
                isCelebrated: options.triggerCelebration !== false, // Default to true
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

            // Award "Video Verified" badge
            await AthleteBadgeService.awardBadge(boxId, athleteId, {
                badgeType: 'pr_achievement',
                title: 'Video Verified PR',
                description: 'Uploaded video proof for a personal record',
                icon: 'video-camera',
                achievedValue: `${movement[0].name} - ${value}${unit}`,
                tier: 1
            });
        }

        // Generate celebration data if requested
        let celebrationData: PRCelebrationData | undefined;
        if (options.triggerCelebration !== false) {
            celebrationData = await this.generateCelebrationData(
                boxId,
                athleteId,
                pr,
                movement[0],
                !!options.videoData
            );
        }

        return {
            pr,
            celebrationData
        };
    }

    /**
     * Generate celebration data for PR achievements
     */
    private static async generateCelebrationData(
        boxId: string,
        athleteId: string,
        pr: typeof athletePrs.$inferSelect,
        movement: typeof movements.$inferSelect,
        hasVideo: boolean
    ): Promise<PRCelebrationData> {
        const celebrationData: PRCelebrationData = {
            showConfetti: true,
            badgesAwarded: [],
            milestones: [],
        };

        // Check if this is first PR for this movement
        const prCount = await db
            .select({ count: count() })
            .from(athletePrs)
            .where(and(
                eq(athletePrs.boxId, boxId),
                eq(athletePrs.membershipId, athleteId),
                eq(athletePrs.movementId, movement.id)
            ));

        if (prCount[0].count === 1) {
            celebrationData.milestones.push({
                type: 'first_pr',
                achievement: `First ${movement.name} PR!`,
                value: `${pr.value}${pr.unit}`
            });

            // Award first PR badge
            const badge = await AthleteBadgeService.awardBadge(boxId, athleteId, {
                badgeType: 'pr_achievement',
                title: `First ${movement.name} PR`,
                description: `Achieved your first personal record in ${movement.name}`,
                icon: 'trophy',
                achievedValue: `${pr.value}${pr.unit}`,
                tier: 1
            });

            if (badge) {
                celebrationData.badgesAwarded.push({
                    type: 'first_pr',
                    title: badge.title,
                    description: badge.description || ''
                });
            }
        }

        // Video verification milestone
        if (hasVideo) {
            celebrationData.milestones.push({
                type: 'video_verified',
                achievement: 'Video Verified PR!',
                value: 'Proof uploaded'
            });
        }

        // Check for weight milestones (if it's a weight-based movement)
        if (pr.unit === 'lbs' || pr.unit === 'kg') {
            const weight = parseFloat(pr.value);
            const milestoneWeights = pr.unit === 'lbs' ? [100, 135, 185, 225, 275, 315, 405] : [45, 60, 85, 100, 125, 140, 185];

            const achievedMilestone = milestoneWeights.find(milestone =>
                weight >= milestone && weight < milestone + (pr.unit === 'lbs' ? 10 : 5)
            );

            if (achievedMilestone) {
                celebrationData.milestones.push({
                    type: 'weight_milestone',
                    achievement: `${achievedMilestone}${pr.unit} Club!`,
                    value: `${movement.name}`
                });
            }
        }

        // Social share data
        celebrationData.socialShareData = {
            title: `New ${movement.name} PR!`,
            description: `Just hit ${pr.value}${pr.unit}${pr.reps ? ` for ${pr.reps} reps` : ''} in ${movement.name}!`,
            imageUrl: pr.thumbnailUrl || ''
        };

        return celebrationData;
    }

    /**
     * Get recent PRs with enhanced video and celebration data
     */
    static async getRecentPRs(
        boxId: string,
        athleteId: string,
        days: number = 30,
        limit: number = 10,
        includeVideoData: boolean = true
    ): Promise<PRWithVideoData[]> {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);

        const prs = await db
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

        // Enhance with video data if requested
        const enhancedPrs = await Promise.all(
            prs.map(async ({ pr, movement }) => {
                const prData: PRWithVideoData = {
                    pr,
                    movement,
                    hasVideo: !!pr.gumletAssetId
                };

                if (includeVideoData && pr.gumletAssetId) {
                    prData.videoStatus = pr.videoProcessingStatus || '';
                    prData.thumbnailUrl = pr.thumbnailUrl || '';

                    if (pr.videoProcessingStatus === 'ready') {
                        prData.playbackUrls = GumletService.getPlaybackUrls(
                            pr.gumletAssetId,
                            pr.collectionId || undefined
                        );
                    }
                }

                return prData;
            })
        );

        return enhancedPrs;
    }

    /**
     * Get video-verified PRs for leaderboards and social features
     */
    static async getVideoVerifiedPRs(
        boxId: string,
        options: {
            movementId?: string;
            timeframe?: 'week' | 'month' | 'year' | 'all';
            limit?: number;
            minViews?: number;
        } = {}
    ) {
        const { movementId, timeframe = 'month', limit = 10 } = options;

        let dateFrom: Date | undefined;
        if (timeframe !== 'all') {
            dateFrom = new Date();
            switch (timeframe) {
                case 'week':
                    dateFrom.setDate(dateFrom.getDate() - 7);
                    break;
                case 'month':
                    dateFrom.setMonth(dateFrom.getMonth() - 1);
                    break;
                case 'year':
                    dateFrom.setFullYear(dateFrom.getFullYear() - 1);
                    break;
            }
        }

        const conditions = [
            eq(athletePrs.boxId, boxId),
            sql`${athletePrs.gumletAssetId} IS NOT NULL`,
            eq(athletePrs.videoProcessingStatus, 'ready')
        ];

        if (movementId) {
            conditions.push(eq(athletePrs.movementId, movementId));
        }

        if (dateFrom) {
            conditions.push(gte(athletePrs.achievedAt, dateFrom));
        }

        return db
            .select({
                pr: athletePrs,
                movement: movements,
                membership: {
                    publicId: boxMemberships.publicId,
                    // Only include name if consent allows
                }
            })
            .from(athletePrs)
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
            .innerJoin(videoConsents, and(
                eq(videoConsents.prId, athletePrs.id),
                sql`'box_visibility' = ANY(${videoConsents.consentTypes})`,
                sql`${videoConsents.revokedAt} IS NULL`
            ))
            .where(and(...conditions))
            .orderBy(desc(athletePrs.achievedAt))
            .limit(limit);
    }

    /**
     * Get PR timeline for visual progress tracking
     */
    static async getPRTimeline(
        boxId: string,
        athleteId: string,
        movementId: string,
        includeVideos: boolean = true
    ) {
        const conditions = [
            eq(athletePrs.boxId, boxId),
            eq(athletePrs.membershipId, athleteId),
            eq(athletePrs.movementId, movementId)
        ];

        if (includeVideos) {
            conditions.push(sql`${athletePrs.gumletAssetId} IS NOT NULL`);
        }

        const timeline = await db
            .select({
                pr: athletePrs,
                movement: movements
            })
            .from(athletePrs)
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .where(and(...conditions))
            .orderBy(athletePrs.achievedAt);

        // Calculate progress metrics
        const progressMetrics = timeline.map((item, index) => {
            const currentValue = parseFloat(item.pr.value);
            const improvement = index > 0 ?
                currentValue - parseFloat(timeline[index - 1].pr.value) : 0;
            const percentImprovement = index > 0 ?
                (improvement / parseFloat(timeline[index - 1].pr.value)) * 100 : 0;

            return {
                ...item,
                improvement,
                percentImprovement: Math.round(percentImprovement * 100) / 100,
                hasVideo: !!item.pr.gumletAssetId,
                playbackUrls: item.pr.gumletAssetId ?
                    GumletService.getPlaybackUrls(item.pr.gumletAssetId, item.pr.collectionId || undefined) : null
            };
        });

        return progressMetrics;
    }

    /**
     * Get monthly video-verified PR stats for gamification
     */
    static async getMonthlyVideoStats(boxId: string, athleteId: string) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const [videoVerifiedCount, totalPrCount] = await Promise.all([
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    eq(athletePrs.membershipId, athleteId),
                    gte(athletePrs.achievedAt, startOfMonth),
                    sql`${athletePrs.gumletAssetId} IS NOT NULL`
                )),

            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    eq(athletePrs.membershipId, athleteId),
                    gte(athletePrs.achievedAt, startOfMonth)
                ))
        ]);

        const videoVerificationRate = totalPrCount[0].count > 0 ?
            (videoVerifiedCount[0].count / totalPrCount[0].count) * 100 : 0;

        return {
            videoVerifiedPRs: videoVerifiedCount[0].count,
            totalPRs: totalPrCount[0].count,
            verificationRate: Math.round(videoVerificationRate),
            canEarnConsistencyBadge: videoVerifiedCount[0].count >= 3 // Threshold for consistency badge
        };
    }
}
