// lib/services/athlete-video-service.ts
import { db } from "@/db";
import {
    athletePrs,
    movements,
    videoConsents,
    videoProcessingEvents,
    gumletWebhookEvents,
    boxMemberships
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { GumletService } from "../gumlet-service";
import type {
    VideoUploadOptions,
} from "../gumlet-service";

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

export interface VideoAnalytics {
    views: number;
    playTime: number;
    uniqueViewers: number;
    completionRate: number;
    engagementScore: number;
    peakViewingTime: number;
}

export interface FormAnalysisResult {
    technicalScore: number;
    recommendations: string[];
    keyPoints: Array<{
        timestamp: number;
        issue: string;
        severity: 'low' | 'medium' | 'high';
        suggestion: string;
    }>;
    comparisonMetrics?: {
        previousPR?: {
            improvement: number;
            technicalDifferences: string[];
        };
    };
}
export class AthleteVideoService {
    /**
     * Create video asset and get upload URL for PR recording
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
        } = {}
    ): Promise<VideoUploadResult> {
        // Get movement details for video metadata
        const movement = await db
            .select()
            .from(movements)
            .where(eq(movements.id, movementId))
            .limit(1);

        if (!movement.length) {
            throw new Error("Movement not found");
        }

        const videoOptions: VideoUploadOptions = {
            title: options.title || `${movement[0].name} PR - ${new Date().toLocaleDateString()}`,
            tags: [
                'pr',
                'crossfit',
                movement[0].name.toLowerCase().replace(/\s+/g, '-'),
                movement[0].category,
                ...(options.tags || [])
            ],
            format: 'ABR', // HLS + DASH for adaptive streaming
            generateThumbnail: true,
            thumbnailAtSecond: 2, // Default thumbnail at 2 seconds
            enablePreviewThumbnails: true,
            keepOriginal: true,
            metadata: {
                boxId,
                athleteId,
                movementId,
                movementName: movement[0].name,
                category: movement[0].category,
                recordedAt: new Date().toISOString(),
                quality: options.quality || 'standard'
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
     * Complete video upload and create PR record with video
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
            coachNotes?: string;
            achievedAt?: Date;
        },
        videoData: PRVideoData
    ) {
        // Upload video file if provided
        if (videoData.videoFile) {
            await GumletService.uploadVideo(
                (await GumletService.getAssetDetails(videoData.gumletAssetId)).output?.playback_url || '',
                videoData.videoFile
            );
        }

        // Update thumbnail if custom time specified
        if (videoData.customThumbnailTime) {
            await GumletService.updateThumbnail(videoData.gumletAssetId, videoData.customThumbnailTime);
        }

        // Log the PR with video data using existing method
        const pr = await this.logPrWithVideo(boxId, athleteId, movementId, prData, videoData);

        // Record initial video processing event
        await db.insert(videoProcessingEvents).values({
            prId: pr.id,
            gumletAssetId: videoData.gumletAssetId,
            eventType: 'upload_completed',
            status: 'processing',
            progress: 0,
            metadata: {
                uploadedAt: new Date().toISOString(),
                fileSize: videoData.gumletMetadata?.fileSize,
                duration: videoData.videoDuration
            }
        });

        return pr;
    }

    /**
     * Log a PR with video support (internal method)
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
            coachNotes?: string;
            achievedAt?: Date;
        },
        videoData: PRVideoData
    ) {
        const publicId = crypto.randomUUID();

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
                coachNotes: prData.coachNotes,
                achievedAt: prData.achievedAt || new Date(),
                publicId,
                verifiedByCoach: false,
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

        return pr;
    }

    /**
     * Get video processing status and details
     */
    static async getVideoStatus(gumletAssetId: string): Promise<{
        status: string;
        progress: number;
        playbackUrls?: any;
        thumbnailUrls?: string[];
        error?: string;
    }> {
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

    /**
     * Get video analytics for PR videos
     */
    static async getVideoAnalytics(gumletAssetId: string, timeframe: '24h' | '7d' | '30d' = '7d'): Promise<VideoAnalytics> {
        const analytics = await GumletService.getVideoAnalytics(gumletAssetId, timeframe);

        // Calculate engagement score based on completion rate and unique viewers
        const engagementScore = (analytics.completionRate * 0.6) +
            (Math.min(analytics.uniqueViewers / 10, 1) * 0.4) * 100;

        return {
            ...analytics,
            engagementScore: Math.round(engagementScore),
            peakViewingTime: analytics.playTime > 0 ? analytics.playTime / analytics.views : 0
        };
    }

    /**
     * Update video consent for a PR
     */
    static async updateVideoConsent(
        prId: string,
        membershipId: string,
        consentTypes: string[]
    ) {
        // First, revoke existing consent
        await db
            .update(videoConsents)
            .set({
                revokedAt: new Date(),
            })
            .where(and(
                eq(videoConsents.prId, prId),
                eq(videoConsents.membershipId, membershipId)
            ));

        // Create new consent record
        const [consent] = await db
            .insert(videoConsents)
            .values({
                membershipId,
                prId,
                consentTypes,
                givenAt: new Date()
            })
            .returning();

        return consent;
    }

    /**
     * Get athlete's video history with analytics
     */
    static async getAthleteVideoHistory(
        boxId: string,
        athleteId: string,
        options: {
            limit?: number;
            movementId?: string;
            includeAnalytics?: boolean;
            dateFrom?: Date;
            dateTo?: Date;
        } = {}
    ) {
        const { limit = 20, includeAnalytics = false } = options;

        const conditions = [
            eq(athletePrs.boxId, boxId),
            eq(athletePrs.membershipId, athleteId),
            sql`${athletePrs.gumletAssetId} IS NOT NULL`
        ];

        if (options.movementId) {
            conditions.push(eq(athletePrs.movementId, options.movementId));
        }

        if (options.dateFrom) {
            conditions.push(sql`${athletePrs.achievedAt} >= ${options.dateFrom}`);
        }

        if (options.dateTo) {
            conditions.push(sql`${athletePrs.achievedAt} <= ${options.dateTo}`);
        }

        const prs = await db
            .select({
                pr: athletePrs,
                movement: movements
            })
            .from(athletePrs)
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .where(and(...conditions))
            .orderBy(desc(athletePrs.achievedAt))
            .limit(limit);

        // Add video analytics if requested
        if (includeAnalytics) {
            const prsWithAnalytics = await Promise.all(
                prs.map(async ({ pr, movement }) => {
                    let analytics = null;
                    try {
                        analytics = await this.getVideoAnalytics(pr.gumletAssetId!);
                    } catch (error) {
                        console.warn(`Failed to get analytics for video ${pr.gumletAssetId}:`, error);
                    }

                    return {
                        pr,
                        movement,
                        videoAnalytics: analytics,
                        playbackUrls: GumletService.getPlaybackUrls(pr.gumletAssetId!, pr.collectionId || undefined)
                    };
                })
            );

            return prsWithAnalytics;
        }

        return prs.map(({ pr, movement }) => ({
            pr,
            movement,
            playbackUrls: GumletService.getPlaybackUrls(pr.gumletAssetId!, pr.collectionId || undefined)
        }));
    }

    /**
     * Get box video statistics
     */
    static async getBoxVideoStats(boxId: string, days: number = 30): Promise<{
        totalVideos: number;
        totalViews: number;
        totalPlayTime: number;
        averageCompletionRate: number;
        topMovements: Array<{ movement: string; videoCount: number; avgScore: number }>;
        recentActivity: Array<{ date: string; uploads: number; views: number }>;
    }> {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - days);

        // Get PRs with videos in the specified period
        const prsWithVideos = await db
            .select({
                pr: athletePrs,
                movement: movements
            })
            .from(athletePrs)
            .innerJoin(movements, eq(athletePrs.movementId, movements.id))
            .where(and(
                eq(athletePrs.boxId, boxId),
                sql`${athletePrs.gumletAssetId} IS NOT NULL`,
                sql`${athletePrs.achievedAt} >= ${dateFrom}`
            ));

        // Aggregate video analytics (mock implementation)
        const totalVideos = prsWithVideos.length;
        const mockStats = {
            totalViews: totalVideos * 8, // Average 8 views per video
            totalPlayTime: totalVideos * 120, // Average 2 minutes per video
            averageCompletionRate: 75 // 75% average completion rate
        };

        // Top movements by video count
        const movementStats = prsWithVideos.reduce((acc, { movement }) => {
            const key = movement.name;
            if (!acc[key]) {
                acc[key] = { count: 0, totalScore: 0 };
            }
            acc[key].count++;
            acc[key].totalScore += Math.random() * 30 + 70; // Mock technical score
            return acc;
        }, {} as Record<string, { count: number; totalScore: number }>);

        const topMovements = Object.entries(movementStats)
            .map(([movement, stats]) => ({
                movement,
                videoCount: stats.count,
                avgScore: Math.round(stats.totalScore / stats.count)
            }))
            .sort((a, b) => b.videoCount - a.videoCount)
            .slice(0, 5);

        // Recent activity (mock implementation)
        const recentActivity = Array.from({ length: 7 }, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - i);
            return {
                date: date.toISOString().split('T')[0],
                uploads: Math.floor(Math.random() * 5),
                views: Math.floor(Math.random() * 25)
            };
        });

        return {
            totalVideos,
            totalViews: mockStats.totalViews,
            totalPlayTime: mockStats.totalPlayTime,
            averageCompletionRate: mockStats.averageCompletionRate,
            topMovements,
            recentActivity
        };
    }

    /**
     * Batch process video status updates from webhooks
     */
    static async processVideoWebhookBatch(webhooks: Array<{
        asset_id: string;
        status: string;
        progress?: number;
        webhook_id?: string;
        metadata?: any;
    }>): Promise<{
        processed: number;
        failed: number;
        errors: string[];
    }> {
        const results = await Promise.allSettled(
            webhooks.map(webhook => this.processGumletWebhook(webhook))
        );

        const processed = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        const errors = results
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map(r => r.reason.message);

        return { processed, failed, errors };
    }

    /**
     * Get video consent status for a PR
     */
    static async getVideoConsentStatus(prId: string): Promise<{
        hasConsent: boolean;
        consentTypes: string[];
        givenAt?: Date;
        canView: boolean;
        canShare: boolean;
        isPublic: boolean;
    }> {
        const consent = await db
            .select()
            .from(videoConsents)
            .where(and(
                eq(videoConsents.prId, prId),
                sql`${videoConsents.revokedAt} IS NULL`
            ))
            .limit(1);

        if (!consent.length) {
            return {
                hasConsent: false,
                consentTypes: [],
                canView: false,
                canShare: false,
                isPublic: false
            };
        }

        const consentTypes = consent[0].consentTypes;

        return {
            hasConsent: true,
            consentTypes,
            givenAt: consent[0].givenAt,
            canView: consentTypes.includes('coaching') || consentTypes.includes('box_visibility'),
            canShare: consentTypes.includes('box_visibility'),
            isPublic: consentTypes.includes('public')
        };
    }

    /**
     * Create video highlight reel from multiple PRs
     */
    static async createHighlightReel(
        boxId: string,
        athleteId: string,
        prIds: string[],
        options: {
            title?: string;
            duration?: number;
            includeComparison?: boolean;
            musicTrack?: string;
        } = {}
    ): Promise<{
        gumletAssetId: string;
        processingStatus: string;
        estimatedCompletion: Date;
    }> {
        // This would integrate with a video editing service or Gumlet's video composition features
        // For now, we'll create a placeholder implementation

        const highlightAsset = await GumletService.createAssetForUpload({
            title: options.title || `${new Date().getFullYear()} Highlight Reel`,
            tags: ['highlight', 'compilation', 'progress'],
            format: 'ABR',
            metadata: {
                type: 'highlight_reel',
                sourceVideos: prIds,
                boxId,
                athleteId,
                createdAt: new Date().toISOString()
            }
        });

        // Log the creation for tracking
        await db.insert(videoProcessingEvents).values({
            prId: prIds[0], // Use first PR as reference
            gumletAssetId: highlightAsset.asset_id,
            eventType: 'highlight_creation',
            status: 'processing',
            progress: 0,
            metadata: {
                type: 'highlight_reel',
                sourcePRs: prIds,
                options
            }
        });

        const estimatedCompletion = new Date();
        estimatedCompletion.setMinutes(estimatedCompletion.getMinutes() + 15); // Estimate 15 minutes

        return {
            gumletAssetId: highlightAsset.asset_id,
            processingStatus: 'processing',
            estimatedCompletion
        };
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
