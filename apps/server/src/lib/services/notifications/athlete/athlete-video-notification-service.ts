// lib/services/notifications/athlete/athlete-video-notification-service.ts
import { db } from "@/db";
import {
    athletePrs,
    boxMemberships,
    prCoachFeedback,
    videoSocialShares
} from "@/db/schema";
import { eq, and, or } from "drizzle-orm";
import { NotificationService } from "@/lib/services/notifications";

export class AthleteVideoNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Notify about video processing status changes
     */
    async sendVideoProcessingNotification(
        prId: string,
        status: "uploaded" | "processing" | "ready" | "failed",
        options: { error?: string } = {}
    ) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        const statusMessages = {
            uploaded: "Video uploaded and queued for processing",
            processing: "Video is being processed",
            ready: "Video is ready to view",
            failed: "Video processing failed"
        };

        const notification = await this.notificationService.createNotification({
            boxId: pr.boxId,
            userId: pr.membership.user.id,
            membershipId: pr.membershipId,
            type: "pr_video_status",
            category: "engagement",
            priority: status === "failed" ? "high" : "normal",
            title: `PR Video ${status.charAt(0).toUpperCase() + status.slice(1)}`,
            message: `${statusMessages[status]}${options.error ? `: ${options.error}` : ''}`,
            actionUrl: `/athlete/prs/${pr.publicId}`,
            actionLabel: "View PR",
            channels: status === "failed" ? ["in_app", "email"] : ["in_app"],
            data: {
                prId: pr.id,
                movement: pr.movement.name,
                status,
                error: options.error
            },
            deduplicationKey: `pr_video_${prId}_${status}`,
        });

        return [notification];
    }

    /**
     * Notify athlete about coach feedback on their PR video
     */
    async sendCoachFeedbackNotification(feedbackId: string) {
        const feedback = await db.query.prCoachFeedback.findFirst({
            where: eq(prCoachFeedback.id, feedbackId),
            with: {
                pr: {
                    with: {
                        movement: true,
                        membership: {
                            with: {
                                user: true
                            }
                        }
                    }
                },
                coach: {
                    with: {
                        user: true
                    }
                }
            }
        });

        if (!feedback) return [];

        const notification = await this.notificationService.createNotification({
            boxId: feedback.pr.boxId,
            userId: feedback.pr.membership.user.id,
            membershipId: feedback.pr.membershipId,
            type: "coach_feedback_video",
            category: "engagement",
            priority: "high",
            title: `Coach Feedback on Your ${feedback.pr.movement.name} PR Video`,
            message: `${feedback.coach.displayName} provided feedback on your ${feedback.pr.value}${feedback.pr.unit} PR video`,
            actionUrl: `/athlete/prs/${feedback.pr.publicId}?feedback=${feedbackId}&timestamp=${feedback.videoTimestamp || 0}`,
            actionLabel: "View Feedback",
            channels: ["in_app", "email"],
            data: {
                prId: feedback.pr.id,
                movement: feedback.pr.movement.name,
                coachId: feedback.coach.id,
                coachName: feedback.coach.displayName,
                feedbackType: feedback.feedbackType,
                videoTimestamp: feedback.videoTimestamp,
                timestamp: feedback.createdAt
            },
            deduplicationKey: `coach_feedback_video_${feedbackId}`,
        });

        return [notification];
    }

    /**
     * Notify about video PR celebration/milestone
     */
    async sendVideoCelebrationNotification(
        prId: string,
        milestoneType: "first_video" | "video_verified" | "video_milestone" | "social_recognition",
        achievement: string,
        value: string
    ) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        const notification = await this.notificationService.createNotification({
            boxId: pr.boxId,
            userId: pr.membership.user.id,
            membershipId: pr.membershipId,
            type: "video_milestone",
            category: "engagement",
            priority: "high",
            title: `🎉 ${achievement}`,
            message: `${value} for your ${pr.movement.name} PR video!`,
            actionUrl: `/athlete/prs/${pr.publicId}`,
            actionLabel: "Celebrate Your Achievement",
            channels: ["in_app"],
            data: {
                prId: pr.id,
                movement: pr.movement.name,
                milestoneType,
                achievement,
                value
            },
            deduplicationKey: `video_milestone_${prId}_${milestoneType}`,
        });

        return [notification];
    }

    /**
     * Notify coaches about video PRs needing review
     */
    async sendVideoReviewNotification(prId: string, assignedCoachId: string) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        // Get coach membership details
        const coachMembership = await db.query.boxMemberships.findFirst({
            where: eq(boxMemberships.id, assignedCoachId),
            with: {
                user: true
            }
        });

        if (!coachMembership) return [];

        const notification = await this.notificationService.createNotification({
            boxId: pr.boxId,
            userId: coachMembership.user.id,
            membershipId: assignedCoachId,
            type: "video_review_assigned",
            category: "workflow",
            priority: "normal",
            title: "New PR Video Needs Review",
            message: `${pr.membership.displayName} uploaded a video for their ${pr.movement.name} PR`,
            actionUrl: `/coaching/prs/${pr.publicId}/review`,
            actionLabel: "Review Video",
            channels: ["in_app", "email"],
            data: {
                prId: pr.id,
                athleteId: pr.membership.user.id,
                athleteName: pr.membership.displayName,
                movement: pr.movement.name,
                value: pr.value,
                unit: pr.unit,
                assignedAt: new Date()
            },
            deduplicationKey: `video_review_${prId}_${assignedCoachId}`,
        });

        return [notification];
    }

    /**
     * Notify about social sharing of PR video
     */
    async sendSocialShareNotification(prId: string, platform: string, shareId: string) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        const share = await db.query.videoSocialShares.findFirst({
            where: eq(videoSocialShares.id, shareId)
        });

        const platformNames = {
            box_feed: "Box Feed",
            instagram: "Instagram",
            facebook: "Facebook"
        };

        const notification = await this.notificationService.createNotification({
            boxId: pr.boxId,
            userId: pr.membership.user.id,
            membershipId: pr.membershipId,
            type: "pr_video_social_share",
            category: "social",
            priority: "low",
            title: `Your PR Video was shared on ${platformNames[platform as keyof typeof platformNames] || platform}`,
            message: `Your ${pr.movement.name} achievement is getting attention!`,
            actionUrl: `/athlete/prs/${pr.publicId}/social`,
            actionLabel: "View Engagement",
            channels: ["in_app"],
            data: {
                prId: pr.id,
                movement: pr.movement.name,
                platform,
                shareId,
                sharedAt: share?.sharedAt || new Date()
            },
            deduplicationKey: `social_share_${prId}_${platform}_${shareId}`,
        });

        return [notification];
    }

    /**
     * Notify about video engagement (likes, comments, views milestones)
     */
    async sendVideoEngagementNotification(
        prId: string,
        engagementType: "views_milestone" | "likes_milestone" | "comments_milestone",
        milestone: number,
        currentCount: number
    ) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        const engagementTitles = {
            views_milestone: "Video Views Milestone",
            likes_milestone: "Video Likes Milestone",
            comments_milestone: "Video Comments Milestone"
        };

        const engagementMessages = {
            views_milestone: `Your ${pr.movement.name} PR video has reached ${currentCount} views!`,
            likes_milestone: `Your ${pr.movement.name} PR video has received ${currentCount} likes!`,
            comments_milestone: `Your ${pr.movement.name} PR video has ${currentCount} comments!`
        };

        const notification = await this.notificationService.createNotification({
            boxId: pr.boxId,
            userId: pr.membership.user.id,
            membershipId: pr.membershipId,
            type: "video_engagement",
            category: "social",
            priority: "low",
            title: engagementTitles[engagementType],
            message: engagementMessages[engagementType],
            actionUrl: `/athlete/prs/${pr.publicId}/engagement`,
            actionLabel: "See Engagement",
            channels: ["in_app"],
            data: {
                prId: pr.id,
                movement: pr.movement.name,
                engagementType,
                milestone,
                currentCount,
                achievedAt: new Date()
            },
            deduplicationKey: `video_engagement_${prId}_${engagementType}_${milestone}`,
        });

        return [notification];
    }

    /**
     * Notify coaches about high-engagement videos
     */
    async sendCoachEngagementAlert(
        prId: string,
        engagementType: "high_views" | "high_likes" | "high_comments",
        count: number
    ) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        const coaches = await this.getBoxCoaches(pr.boxId);
        const notifications = [];

        const engagementTitles = {
            high_views: "High Video Engagement Alert",
            high_likes: "High Video Likes Alert",
            high_comments: "High Video Comments Alert"
        };

        const engagementMessages = {
            high_views: `${pr.membership.displayName}'s ${pr.movement.name} PR video has ${count} views and is getting attention`,
            high_likes: `${pr.membership.displayName}'s ${pr.movement.name} PR video has ${count} likes`,
            high_comments: `${pr.membership.displayName}'s ${pr.movement.name} PR video has ${count} comments`
        };

        for (const coach of coaches) {
            const notification = await this.notificationService.createNotification({
                boxId: pr.boxId,
                userId: coach.userId,
                membershipId: coach.id,
                type: "coach_engagement_alert",
                category: "social",
                priority: "low",
                title: engagementTitles[engagementType],
                message: engagementMessages[engagementType],
                actionUrl: `/coaching/prs/${pr.publicId}/engagement`,
                actionLabel: "View Engagement",
                channels: ["in_app"],
                data: {
                    prId: pr.id,
                    athleteId: pr.membership.user.id,
                    athleteName: pr.membership.displayName,
                    movement: pr.movement.name,
                    engagementType,
                    count,
                    alertedAt: new Date()
                },
                deduplicationKey: `coach_engagement_${prId}_${engagementType}_${coach.id}`,
            });
            notifications.push(notification);
        }

        return notifications;
    }

    /**
     * Helper to get PR with details
     */
    private async getPRWithDetails(prId: string) {
        return await db.query.athletePrs.findFirst({
            where: eq(athletePrs.id, prId),
            with: {
                movement: true,
                membership: {
                    with: {
                        user: true
                    }
                }
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
                or(
                    eq(boxMemberships.role, "coach"),
                    eq(boxMemberships.role, "head_coach")
                ),
                eq(boxMemberships.isActive, true)
            ),
            with: {
                user: true
            }
        });
    }
}
