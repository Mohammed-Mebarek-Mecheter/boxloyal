// lib/services/notifications/athlete/athlete-pr-notification-service.ts
import { db } from "@/db";
import {
    athletePrs,
    boxMemberships,
    prCoachFeedback
} from "@/db/schema";
import { eq, and, or } from "drizzle-orm";
import { NotificationService } from "@/lib/services/notifications";

export class AthletePRNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Notify about new PR achievement
     */
    async sendNewPRNotification(
        prId: string,
        options: { includeCoaches?: boolean; includeAthlete?: boolean } = {
            includeCoaches: true,
            includeAthlete: true
        }
    ) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        const notifications = [];

        // Notify athlete about their own PR
        if (options.includeAthlete) {
            const athleteNotification = await this.notificationService.createNotification({
                boxId: pr.boxId,
                userId: pr.membership.user.id,
                membershipId: pr.membershipId,
                type: "pr_achieved",
                category: "engagement",
                priority: "high",
                title: `New ${pr.movement.name} PR!`,
                message: `You just hit ${pr.value}${pr.unit}${pr.reps ? ` for ${pr.reps} reps` : ''} in ${pr.movement.name}!`,
                actionUrl: `/athlete/prs/${pr.publicId}`,
                actionLabel: "View PR Details",
                channels: ["in_app"],
                data: {
                    prId: pr.id,
                    movement: pr.movement.name,
                    value: pr.value,
                    unit: pr.unit,
                    reps: pr.reps,
                    achievedAt: pr.achievedAt,
                    hasVideo: !!pr.gumletAssetId
                },
                deduplicationKey: `pr_achieved_${prId}_${Date.now()}`,
            });
            notifications.push(athleteNotification);
        }

        // Notify coaches about athlete's PR
        if (options.includeCoaches) {
            const coaches = await this.getBoxCoaches(pr.boxId);

            for (const coach of coaches) {
                const coachNotification = await this.notificationService.createNotification({
                    boxId: pr.boxId,
                    userId: coach.userId,
                    membershipId: coach.id,
                    type: "athlete_pr_achieved",
                    category: "workflow",
                    priority: "normal",
                    title: `${pr.membership.displayName} hit a new PR!`,
                    message: `${pr.membership.displayName} achieved ${pr.value}${pr.unit}${pr.reps ? ` for ${pr.reps} reps` : ''} in ${pr.movement.name}`,
                    actionUrl: `/coaching/prs/${pr.publicId}`,
                    actionLabel: "Review PR",
                    channels: ["in_app", "email"],
                    data: {
                        athleteId: pr.membership.user.id,
                        athleteName: pr.membership.displayName,
                        prId: pr.id,
                        movement: pr.movement.name,
                        value: pr.value,
                        unit: pr.unit,
                        reps: pr.reps,
                        achievedAt: pr.achievedAt,
                        hasVideo: !!pr.gumletAssetId
                    },
                    deduplicationKey: `coach_pr_alert_${prId}_${coach.id}`,
                });
                notifications.push(coachNotification);
            }
        }

        return notifications;
    }

    /**
     * Notify about PR video upload and processing status
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
     * Notify athlete about coach feedback on their PR
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
            type: "coach_feedback",
            category: "engagement",
            priority: "high",
            title: `Coach Feedback on Your ${feedback.pr.movement.name} PR`,
            message: `${feedback.coach.displayName} provided feedback on your ${feedback.pr.value}${feedback.pr.unit} PR`,
            actionUrl: `/athlete/prs/${feedback.pr.publicId}?feedback=${feedbackId}`,
            actionLabel: "View Feedback",
            channels: ["in_app", "email"],
            data: {
                prId: feedback.pr.id,
                movement: feedback.pr.movement.name,
                coachId: feedback.coach.id,
                coachName: feedback.coach.displayName,
                feedbackType: feedback.feedbackType,
                timestamp: feedback.createdAt
            },
            deduplicationKey: `coach_feedback_${feedbackId}`,
        });

        return [notification];
    }

    /**
     * Notify about PR celebration/milestone
     */
    async sendPRCelebrationNotification(
        prId: string,
        milestoneType: "first_pr" | "video_verified" | "weight_milestone" | "consistency",
        achievement: string,
        value: string
    ) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        const notification = await this.notificationService.createNotification({
            boxId: pr.boxId,
            userId: pr.membership.user.id,
            membershipId: pr.membershipId,
            type: "pr_milestone",
            category: "engagement",
            priority: "high",
            title: `🎉 ${achievement}`,
            message: `You've achieved ${value} in ${pr.movement.name}!`,
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
            deduplicationKey: `pr_milestone_${prId}_${milestoneType}`,
        });

        return [notification];
    }

    /**
     * Notify coaches about video PRs needing review
     */
    async sendVideoReviewNotification(prId: string, assignedCoachId: string) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        const notification = await this.notificationService.createNotification({
            boxId: pr.boxId,
            userId: pr.membership.user.id, // This should be the coach's user ID, not athlete's
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
     * Notify about social sharing of PR
     */
    async sendSocialShareNotification(prId: string, platform: string) {
        const pr = await this.getPRWithDetails(prId);
        if (!pr) return [];

        const notification = await this.notificationService.createNotification({
            boxId: pr.boxId,
            userId: pr.membership.user.id,
            membershipId: pr.membershipId,
            type: "pr_social_share",
            category: "social",
            priority: "low",
            title: `Your PR was shared on ${platform}`,
            message: `Your ${pr.movement.name} achievement is getting attention!`,
            actionUrl: `/athlete/prs/${pr.publicId}/social`,
            actionLabel: "View Engagement",
            channels: ["in_app"],
            data: {
                prId: pr.id,
                movement: pr.movement.name,
                platform,
                sharedAt: new Date()
            },
            deduplicationKey: `social_share_${prId}_${platform}`,
        });

        return [notification];
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
