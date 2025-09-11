// lib/services/athlete-video-service.ts - Enhanced with Coach Feedback & Social Features
import { db } from "@/db";
import {
    athletePrs,
    movements,
    videoConsents,
    videoProcessingEvents,
    gumletWebhookEvents,
    boxMemberships,
    prCoachFeedback,
    videoSocialShares
} from "@/db/schema";
import { eq, and, desc, sql, count, gte } from "drizzle-orm";
import { GumletService } from "../gumlet-service";

export interface VideoUploadResult {
    gumletAssetId: string;
    uploadUrl: string;
    thumbnailUrls: string[];
    processingStatus: string;
    playbackUrls?: {
        hls: string;
        dash: string;
        mp4?: string;
    };
}

export interface PRVideoData {
    gumletAssetId: string;
    consentTypes: string[];
    thumbnailUrl?: string;
    videoDuration?: number;
    collectionId?: string;
    gumletMetadata?: any;
    videoFile?: Buffer | Blob | File;
    customThumbnailTime?: number;
}

export interface CoachFeedback {
    id: string;
    feedback: string;
    timestamp: Date;
    coachName: string;
    coachId: string;
    feedbackType: 'technique' | 'encouragement' | 'correction' | 'celebration';
    isPublic: boolean;
}

export interface SocialShareOptions {
    platform: 'box_feed' | 'instagram' | 'facebook';
    caption?: string;
    includeStats?: boolean;
    tagBoxMembers?: string[];
}

export interface VideoEngagementMetrics {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    averageWatchTime: number;
    completionRate: number;
    coachInteractions: number;
    memberInteractions: number;
}

interface CelebrationMilestone {
    type: string;
    achievement: string;
    value: string;
}

export class AthleteVideoService {
    /**
     * Initialize PR video with enhanced celebration metadata
     */
    static async initializePRVideo(
        boxId: string,
        athleteId: string,
        movementId: string,
        options: {
            title?: string;
            tags?: string[];
            expectedDuration?: number;
            quality?: 'standard' | 'hd' | 'premium';
            isForCelebration?: boolean;
            prValue?: number;
            prUnit?: string;
        } = {}
    ): Promise<VideoUploadResult> {
        // Get movement and athlete details for enhanced metadata
        const [movement, athlete] = await Promise.all([
            db.select().from(movements).where(eq(movements.id, movementId)).limit(1),
            db.select().from(boxMemberships).where(eq(boxMemberships.id, athleteId)).limit(1)
        ]);

        if (!movement.length || !athlete.length) {
            throw new Error("Movement or athlete not found");
        }

        const videoTitle = options.title ||
            (options.prValue ?
                `${movement[0].name} PR - ${options.prValue}${options.prUnit} - ${new Date().toLocaleDateString()}` :
                `${movement[0].name} - ${new Date().toLocaleDateString()}`);

        const videoOptions = {
            title: videoTitle,
            tags: [
                'pr',
                'crossfit',
                movement[0].name.toLowerCase().replace(/\s+/g, '-'),
                movement[0].category,
                ...(options.isForCelebration ? ['celebration', 'achievement'] : []),
                ...(options.tags || [])
            ],
            format: 'ABR' as const,
            generateThumbnail: true,
            thumbnailAtSecond: 3, // Better timing for lift videos
            enablePreviewThumbnails: true,
            keepOriginal: true,
            metadata: {
                boxId,
                athleteId,
                movementId,
                movementName: movement[0].name,
                category: movement[0].category,
                recordedAt: new Date().toISOString(),
                quality: options.quality || 'standard',
                isForCelebration: options.isForCelebration || false,
                prValue: options.prValue,
                prUnit: options.prUnit,
                athletePublicId: athlete[0].publicId
            }
        };

        const asset = await GumletService.createAssetForUpload(videoOptions);
        const playbackUrls = GumletService.getPlaybackUrls(asset.asset_id);
        const thumbnailUrls = GumletService.getThumbnailUrls(asset.asset_id);

        return {
            gumletAssetId: asset.asset_id,
            uploadUrl: asset.upload_url,
            thumbnailUrls,
            processingStatus: asset.status,
            playbackUrls
        };
    }

    /**
     * Complete PR video upload with celebration triggers
     */
    static async completePRWithVideo(
        boxId: string,
        athleteId: string,
        movementId: string,
        prData: {
            value: number;
            unit: string;
            reps?: number;
            notes?: string;
            achievedAt?: Date;
        },
        videoData: PRVideoData,
        celebrationOptions: {
            notifyCoaches?: boolean;
            shareToBoxFeed?: boolean;
            autoGenerateShareText?: boolean;
        } = {}
    ) {
        // Upload video if provided
        if (videoData.videoFile) {
            // Get upload URL from existing asset
            const assetDetails = await GumletService.getAssetDetails(videoData.gumletAssetId);
            if (assetDetails && assetDetails.status === 'upload-pending') {
                // Use the upload_url from asset creation, not playback_url
                const uploadUrl = assetDetails.input?.title ?
                    `https://video.gumlet.io/upload/${videoData.gumletAssetId}` :
                    assetDetails.output?.playback_url;

                if (uploadUrl) {
                    await GumletService.uploadVideo(uploadUrl, videoData.videoFile);
                }
            }
        }

        // Custom thumbnail timing
        if (videoData.customThumbnailTime) {
            await GumletService.updateThumbnail(videoData.gumletAssetId, videoData.customThumbnailTime);
        }

        // Create PR with celebration enabled
        const { pr, celebrationData } = await this.logPrWithVideo(boxId, athleteId, movementId, prData, videoData);

        // Trigger celebration notifications
        if (celebrationOptions.notifyCoaches !== false) {
            await this.notifyCoachesOfNewPR(boxId, pr.id, celebrationData);
        }

        // Auto-share to box feed if requested and consent allows
        if (celebrationOptions.shareToBoxFeed &&
            videoData.consentTypes.includes('box_visibility')) {
            await this.shareToBoxFeed(pr.id, {
                autoGenerated: celebrationOptions.autoGenerateShareText !== false
            });
        }

        return { pr, celebrationData };
    }

    /**
     * Add coach feedback to a PR video
     */
    static async addCoachFeedback(
        prId: string,
        coachId: string,
        feedback: {
            text: string;
            type: 'technique' | 'encouragement' | 'correction' | 'celebration';
            isPublic?: boolean;
            videoTimestamp?: number;
        }
    ): Promise<CoachFeedback> {
        // Get coach details
        const coach = await db
            .select({
                id: boxMemberships.id,
                publicId: boxMemberships.publicId,
                displayName: boxMemberships.displayName,
                role: boxMemberships.role
            })
            .from(boxMemberships)
            .where(eq(boxMemberships.id, coachId))
            .limit(1);

        if (!coach.length || !['owner', 'head_coach', 'coach'].includes(coach[0].role)) {
            throw new Error("Invalid coach or insufficient permissions");
        }

        const [feedbackRecord] = await db
            .insert(prCoachFeedback)
            .values({
                prId,
                coachMembershipId: coachId,
                feedback: feedback.text,
                feedbackType: feedback.type,
                isPublic: feedback.isPublic ?? true,
                // Convert number to string for decimal field
                videoTimestamp: feedback.videoTimestamp ? feedback.videoTimestamp.toString() : null,
                createdAt: new Date()
            })
            .returning();

        return {
            id: feedbackRecord.id,
            feedback: feedbackRecord.feedback,
            timestamp: feedbackRecord.createdAt,
            coachName: coach[0].displayName || 'Coach',
            coachId: coach[0].id,
            feedbackType: feedbackRecord.feedbackType,
            isPublic: feedbackRecord.isPublic
        };
    }

    /**
     * Get coach feedback for a PR
     */
    static async getCoachFeedback(
        prId: string,
        viewerMembershipId: string,
        includePrivate: boolean = false
    ): Promise<CoachFeedback[]> {
        const conditions = [eq(prCoachFeedback.prId, prId)];

        if (!includePrivate) {
            conditions.push(eq(prCoachFeedback.isPublic, true));
        }

        const feedback = await db
            .select({
                feedback: prCoachFeedback,
                coach: {
                    id: boxMemberships.id,
                    displayName: boxMemberships.displayName,
                    publicId: boxMemberships.publicId
                }
            })
            .from(prCoachFeedback)
            .innerJoin(boxMemberships, eq(prCoachFeedback.coachMembershipId, boxMemberships.id))
            .where(and(...conditions))
            .orderBy(prCoachFeedback.createdAt);

        return feedback.map(({ feedback: f, coach }) => ({
            id: f.id,
            feedback: f.feedback,
            timestamp: f.createdAt,
            coachName: coach.displayName || 'Coach',
            coachId: coach.id,
            feedbackType: f.feedbackType,
            isPublic: f.isPublic
        }));
    }

    /**
     * Share PR video to box social feed
     */
    static async shareToBoxFeed(
        prId: string,
        options: {
            caption?: string;
            autoGenerated?: boolean;
            includeStats?: boolean;
        } = {}
    ) {
        // Get PR details for auto-caption generation
        const prDetails = await db
            .select({
                pr: athletePrs,
                movement: movements,
                athlete: {
                    displayName: boxMemberships.displayName,
                    publicId: boxMemberships.publicId
                }
            })
            .from(athletePrs)
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
            .where(eq(athletePrs.id, prId))
            .limit(1);

        if (!prDetails.length) {
            throw new Error("PR not found");
        }

        const { pr, movement, athlete } = prDetails[0];

        let caption = options.caption;
        if (!caption && options.autoGenerated !== false) {
            caption = `🎉 ${athlete.displayName || 'Athlete'} just hit a new ${movement.name} PR! ` +
                `${pr.value}${pr.unit}${pr.reps ? ` for ${pr.reps} reps` : ''} ` +
                `${pr.notes ? `\n"${pr.notes}"` : ''} #CrossFit #PR #${movement.name.replace(/\s+/g, '')}`;
        }

        const [share] = await db
            .insert(videoSocialShares)
            .values({
                prId,
                platform: 'box_feed',
                caption,
                shareType: 'pr_celebration',
                isAutoGenerated: options.autoGenerated ?? true,
                sharedAt: new Date()
            })
            .returning();

        return share;
    }

    /**
     * Get box social feed with video PRs
     */
    static async getBoxSocialFeed(
        boxId: string,
        options: {
            limit?: number;
            days?: number;
            includePrivate?: boolean;
            viewerMembershipId?: string;
        } = {}
    ) {
        const { limit = 20, days = 30, viewerMembershipId } = options;

        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);

        // Get PRs shared to box feed
        const feedItems = await db
            .select({
                pr: athletePrs,
                movement: movements,
                athlete: {
                    displayName: boxMemberships.displayName,
                    publicId: boxMemberships.publicId
                },
                share: videoSocialShares
            })
            .from(athletePrs)
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
            .innerJoin(videoSocialShares, eq(videoSocialShares.prId, athletePrs.id))
            .innerJoin(videoConsents, and(
                eq(videoConsents.prId, athletePrs.id),
                sql`'box_visibility' = ANY(${videoConsents.consentTypes})`,
                sql`${videoConsents.revokedAt} IS NULL`
            ))
            .where(and(
                eq(athletePrs.boxId, boxId),
                eq(videoSocialShares.platform, 'box_feed'),
                gte(videoSocialShares.sharedAt, dateFrom),
                sql`${athletePrs.gumletAssetId} IS NOT NULL`,
                eq(athletePrs.videoProcessingStatus, 'ready')
            ))
            .orderBy(desc(videoSocialShares.sharedAt))
            .limit(limit);

        // Add engagement metrics and coach feedback for each item
        const enhancedFeedItems = await Promise.all(
            feedItems.map(async (item) => {
                const [coachFeedback, engagementMetrics] = await Promise.all([
                    this.getCoachFeedback(item.pr.id, viewerMembershipId || '', false),
                    this.getVideoEngagementMetrics(item.pr.gumletAssetId!)
                ]);

                return {
                    ...item,
                    playbackUrls: GumletService.getPlaybackUrls(
                        item.pr.gumletAssetId!,
                        item.pr.collectionId || undefined
                    ),
                    thumbnailUrl: item.pr.thumbnailUrl,
                    coachFeedback,
                    engagementMetrics,
                    canInteract: !!viewerMembershipId
                };
            })
        );

        return enhancedFeedItems;
    }

    /**
     * Get video engagement metrics for analytics
     */
    static async getVideoEngagementMetrics(gumletAssetId: string): Promise<VideoEngagementMetrics> {
        try {
            const analytics = await GumletService.getVideoAnalytics(gumletAssetId, '30d');

            // Get coach interactions count
            const coachInteractions = await db
                .select({ count: count() })
                .from(prCoachFeedback)
                .innerJoin(athletePrs, eq(prCoachFeedback.prId, athletePrs.id))
                .where(eq(athletePrs.gumletAssetId, gumletAssetId));

            const coachCount = coachInteractions.length > 0 ? coachInteractions[0].count : 0;

            return {
                views: analytics.views,
                likes: 0, // To be implemented with likes feature
                comments: coachCount,
                shares: 0, // To be implemented with shares tracking
                averageWatchTime: analytics.playTime / Math.max(analytics.views, 1),
                completionRate: analytics.completionRate,
                coachInteractions: coachCount,
                memberInteractions: 0 // To be implemented
            };
        } catch (error) {
            return {
                views: 0,
                likes: 0,
                comments: 0,
                shares: 0,
                averageWatchTime: 0,
                completionRate: 0,
                coachInteractions: 0,
                memberInteractions: 0
            };
        }
    }

    /**
     * Notify coaches of new PR video for intervention opportunities
     */
    private static async notifyCoachesOfNewPR(
        boxId: string,
        prId: string,
        celebrationData?: any
    ) {
        // Get all active coaches for the box
        const coaches = await db
            .select({
                id: boxMemberships.id,
                userId: boxMemberships.userId,
                displayName: boxMemberships.displayName,
                role: boxMemberships.role
            })
            .from(boxMemberships)
            .where(and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.isActive, true),
                sql`${boxMemberships.role} IN ('owner', 'head_coach', 'coach')`
            ));

        // Get PR details for notification
        const prDetails = await db
            .select({
                pr: athletePrs,
                movement: movements,
                athlete: {
                    displayName: boxMemberships.displayName,
                    publicId: boxMemberships.publicId
                }
            })
            .from(athletePrs)
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
            .where(eq(athletePrs.id, prId))
            .limit(1);

        if (!prDetails.length) return;

        const { pr, movement, athlete } = prDetails[0];

        // Create notifications for coaches (implement your notification system here)
        const notifications = coaches.map(coach => ({
            recipientId: coach.userId,
            type: 'new_pr_video',
            title: 'New PR Video to Review',
            message: `${athlete.displayName || 'An athlete'} just logged a ${movement.name} PR with video!`,
            data: {
                prId: pr.id,
                athleteName: athlete.displayName,
                movement: movement.name,
                value: `${pr.value}${pr.unit}`,
                hasVideo: true,
                celebrationData
            },
            actionUrl: `/coach/review-pr/${pr.publicId}`,
            createdAt: new Date()
        }));

        // TODO: Implement actual notification sending
        console.log('Coach notifications created:', notifications.length);
        return notifications;
    }

    /**
     * Log PR with video data (private method)
     */
    private static async logPrWithVideo(
        boxId: string,
        athleteId: string,
        movementId: string,
        prData: {
            value: number;
            unit: string;
            reps?: number;
            notes?: string;
            achievedAt?: Date;
        },
        videoData: PRVideoData
    ) {
        const publicId = crypto.randomUUID();

        // Get movement for celebration context
        const movement = await db
            .select()
            .from(movements)
            .where(eq(movements.id, movementId))
            .limit(1);

        const [pr] = await db
            .insert(athletePrs)
            .values({
                boxId,
                membershipId: athleteId,
                movementId,
                value: prData.value.toString(),
                unit: prData.unit,
                reps: prData.reps,
                notes: prData.notes,
                achievedAt: prData.achievedAt || new Date(),
                publicId,
                verifiedByCoach: false,
                isCelebrated: true, // Always celebrate video PRs
                // Video fields
                gumletAssetId: videoData.gumletAssetId,
                videoProcessingStatus: 'upload_pending',
                thumbnailUrl: videoData.thumbnailUrl,
                videoDuration: videoData.videoDuration?.toString(),
                collectionId: videoData.collectionId,
                gumletMetadata: videoData.gumletMetadata,
            })
            .returning();

        // Handle video consent
        await db.insert(videoConsents).values({
            membershipId: athleteId,
            prId: pr.id,
            consentTypes: videoData.consentTypes,
            givenAt: new Date(),
        });

        // Log initial video processing event
        await db.insert(videoProcessingEvents).values({
            prId: pr.id,
            gumletAssetId: videoData.gumletAssetId,
            eventType: 'upload_started',
            status: 'upload-pending',
            progress: 0,
        });

        // Generate celebration data
        const celebrationData = movement.length > 0 ?
            await this.generateCelebrationData(boxId, athleteId, pr, movement[0], true) : null;

        return { pr, celebrationData };
    }

    /**
     * Generate celebration data for video PRs
     */
    private static async generateCelebrationData(
        boxId: string,
        athleteId: string,
        pr: typeof athletePrs.$inferSelect,
        movement: typeof movements.$inferSelect,
        hasVideo: boolean
    ) {
        const celebrationData: {
            showConfetti: boolean;
            badgesAwarded: any[];
            milestones: CelebrationMilestone[];
            socialShareData: {
                title: string;
                description: string;
                imageUrl?: string;
            };
        } = {
            showConfetti: true,
            badgesAwarded: [],
            milestones: [],
            socialShareData: {
                title: `New ${movement.name} PR!`,
                description: `Just hit ${pr.value}${pr.unit}${pr.reps ? ` for ${pr.reps} reps` : ''} in ${movement.name}!`,
                imageUrl: pr.thumbnailUrl || ''
            }
        };

        // Check if this is first video-verified PR
        const videoVerifiedCount = await db
            .select({ count: count() })
            .from(athletePrs)
            .where(and(
                eq(athletePrs.boxId, boxId),
                eq(athletePrs.membershipId, athleteId),
                sql`${athletePrs.gumletAssetId} IS NOT NULL`
            ));

        if (videoVerifiedCount[0].count === 1) {
            celebrationData.milestones.push({
                type: 'video_verified',
                achievement: 'First Video Verified PR!',
                value: 'Journey documented'
            });
        }

        return celebrationData;
    }

    /**
     * Get athlete's video journey for progress visualization
     */
    static async getAthleteVideoJourney(
        boxId: string,
        athleteId: string,
        options: {
            movementId?: string;
            timeframe?: 'month' | 'quarter' | 'year' | 'all';
            includeCoachFeedback?: boolean;
            limit?: number;
        } = {}
    ) {
        const { movementId, timeframe = 'all', includeCoachFeedback = true, limit = 50 } = options;

        let dateFrom: Date | undefined;
        if (timeframe !== 'all') {
            dateFrom = new Date();
            switch (timeframe) {
                case 'month':
                    dateFrom.setMonth(dateFrom.getMonth() - 1);
                    break;
                case 'quarter':
                    dateFrom.setMonth(dateFrom.getMonth() - 3);
                    break;
                case 'year':
                    dateFrom.setFullYear(dateFrom.getFullYear() - 1);
                    break;
            }
        }

        const conditions = [
            eq(athletePrs.boxId, boxId),
            eq(athletePrs.membershipId, athleteId),
            sql`${athletePrs.gumletAssetId} IS NOT NULL`
        ];

        if (movementId) {
            conditions.push(eq(athletePrs.movementId, movementId));
        }

        if (dateFrom) {
            conditions.push(gte(athletePrs.achievedAt, dateFrom));
        }

        const journey = await db
            .select({
                pr: athletePrs,
                movement: movements
            })
            .from(athletePrs)
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .where(and(...conditions))
            .orderBy(athletePrs.achievedAt)
            .limit(limit);

        // Enhance with video data and coach feedback
        const enhancedJourney = await Promise.all(
            journey.map(async ({ pr, movement }) => {
                const playbackUrls = GumletService.getPlaybackUrls(
                    pr.gumletAssetId!,
                    pr.collectionId || undefined
                );

                // Add explicit type for coachFeedback
                let coachFeedback: CoachFeedback[] = [];
                if (includeCoachFeedback) {
                    coachFeedback = await this.getCoachFeedback(pr.id, athleteId, false);
                }

                return {
                    pr,
                    movement,
                    playbackUrls,
                    thumbnailUrl: pr.thumbnailUrl,
                    coachFeedback,
                    videoReady: pr.videoProcessingStatus === 'ready'
                };
            })
        );

        return enhancedJourney;
    }

    /**
     * Create coach feedback summary for intervention insights
     */
    static async getCoachFeedbackSummary(
        boxId: string,
        athleteId: string,
        days: number = 30
    ) {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);

        const feedbackSummary = await db
            .select({
                feedback: prCoachFeedback,
                movement: movements,
                pr: {
                    achievedAt: athletePrs.achievedAt,
                    value: athletePrs.value,
                    unit: athletePrs.unit
                }
            })
            .from(prCoachFeedback)
            .innerJoin(athletePrs, eq(prCoachFeedback.prId, athletePrs.id))
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .where(and(
                eq(athletePrs.boxId, boxId),
                eq(athletePrs.membershipId, athleteId),
                gte(prCoachFeedback.createdAt, dateFrom)
            ))
            .orderBy(desc(prCoachFeedback.createdAt));

        // Analyze feedback patterns
        const feedbackByType = feedbackSummary.reduce((acc, item) => {
            const type = item.feedback.feedbackType;
            if (!acc[type]) acc[type] = [];
            acc[type].push(item);
            return acc;
        }, {} as Record<string, any[]>);

        const insights = {
            totalFeedback: feedbackSummary.length,
            feedbackByType,
            recentTechniqueConcerns: feedbackByType.correction?.length || 0,
            encouragementReceived: feedbackByType.encouragement?.length || 0,
            celebrationsReceived: feedbackByType.celebration?.length || 0,
            coachEngagementScore: feedbackSummary.length > 0 ?
                (feedbackByType.encouragement?.length || 0) + (feedbackByType.celebration?.length || 0) : 0
        };

        return insights;
    }

    // Keep existing methods from original service
    static async getVideoStatus(gumletAssetId: string) {
        try {
            const assetDetails = await GumletService.getAssetDetails(gumletAssetId);

            return {
                status: assetDetails.status,
                progress: assetDetails.progress,
                playbackUrls: assetDetails.output ? {
                    hls: assetDetails.output.playback_url,
                    dash: assetDetails.output.dash_playbook_url,
                } : undefined,
                thumbnailUrls: assetDetails.output?.thumbnail_url
            };
        } catch (error: any) {
            return {
                status: 'error',
                progress: 0,
                error: error.message
            };
        }
    }

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

    static mapGumletStatusToEnum(gumletStatus: string) {
        const statusMap: Record<string, any> = {
            'upload-pending': 'upload_pending',
            'processing': 'processing',
            'ready': 'ready',
            'error': 'error',
            'failed': 'error'
        };

        return statusMap[gumletStatus] || 'pending';
    }
}
