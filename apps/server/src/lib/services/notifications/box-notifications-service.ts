// lib/services/notifications/box-notifications-service.ts
import { NotificationService } from "./notification-service";
import { db } from "@/db";
import {
    boxes,
    boxMemberships,
    approvalQueue,
    athletePrs,
    athleteWellnessCheckins,
    boxInvites,
    boxQrCodes,
    user
} from "@/db/schema";
import { eq, and, or, gte, count, desc, sql } from "drizzle-orm";
import type { InterventionInsight } from "@/lib/services/box/types";

export class BoxNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Send new member signup approval request to box owners/coaches
     */
    async sendSignupApprovalRequest(boxId: string, approvalId: string) {
        const [box, approval] = await Promise.all([
            this.getBoxWithStaff(boxId),
            db.query.approvalQueue.findFirst({
                where: eq(approvalQueue.id, approvalId),
                with: {
                    user: {
                        columns: {
                            id: true,
                            name: true,
                            email: true,
                        }
                    }
                }
            })
        ]);

        if (!box || !approval) return [];

        const applicantName = approval.user?.name || approval.user?.email || "New applicant";
        const title = "New Membership Request";
        const message = `${applicantName} wants to join ${box.name} as ${approval.requestedRole === "athlete" ? "an athlete" : "a coach"}.

${approval.requestMessage ? `Message: "${approval.requestMessage}"` : ""}

Review their application and decide whether to approve or reject their membership request.

Quick action helps keep potential members engaged!`;

        const notifications = [];

        // Send to owners and head coaches
        for (const membership of box.memberships) {
            if (membership.role === "owner" || membership.role === "head_coach") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "member_approval_request",
                    category: "engagement",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/box/${box.publicId}/approvals/${approvalId}`,
                    actionLabel: "Review Application",
                    channels: ["in_app", "email"],
                    data: {
                        approvalId,
                        applicantName,
                        applicantEmail: approval.user?.email,
                        requestedRole: approval.requestedRole,
                        requestMessage: approval.requestMessage,
                        submittedAt: approval.submittedAt,
                    },
                    deduplicationKey: `approval_request_${approvalId}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send welcome notification to newly approved members
     */
    async sendNewMemberWelcome(boxId: string, membershipId: string) {
        const [box, membership] = await Promise.all([
            db.query.boxes.findFirst({ where: eq(boxes.id, boxId) }),
            db.query.boxMemberships.findFirst({
                where: eq(boxMemberships.id, membershipId),
                with: {
                    user: {
                        columns: {
                            id: true,
                            name: true,
                            email: true,
                        }
                    }
                }
            })
        ]);

        if (!box || !membership) return [];

        const memberName = membership.user?.name || "New member";
        const title = `Welcome to ${box.name}!`;
        const message = `Welcome ${memberName}! You're now officially part of ${box.name}.

${membership.role === "athlete"
            ? `Start tracking your progress by:
• Logging your first PR
• Completing daily wellness check-ins
• Setting your fitness goals

Your coaches are here to help you succeed!`
            : `You can now help athletes achieve their goals:
• Review PR videos and provide feedback
• Monitor athlete wellness and engagement
• Identify members who need extra support

Let's help our athletes thrive!`
        }`;

        const notification = await this.notificationService.createNotification({
            boxId,
            userId: membership.userId,
            membershipId: membership.id,
            type: "member_welcome",
            category: "engagement",
            priority: "normal",
            title,
            message,
            actionUrl: `/box/${box.publicId}/dashboard`,
            actionLabel: "Get Started",
            channels: ["in_app", "email"],
            data: {
                memberRole: membership.role,
                joinedAt: membership.joinedAt,
                boxName: box.name,
            },
            deduplicationKey: `welcome_${membershipId}`,
        });

        return [notification];
    }

    /**
     * Send at-risk athlete alert to coaches
     */
    async sendAtRiskAthleteAlert(boxId: string, athleteMembershipId: string, riskFactors: string[]) {
        const [box, athlete] = await Promise.all([
            this.getBoxWithStaff(boxId),
            db.query.boxMemberships.findFirst({
                where: eq(boxMemberships.id, athleteMembershipId),
                with: {
                    user: {
                        columns: {
                            id: true,
                            name: true,
                            email: true,
                        }
                    }
                }
            })
        ]);

        if (!box || !athlete) return [];

        const athleteName = athlete.displayName || athlete.user?.name || "Athlete";
        const daysSinceLastCheckin = athlete.lastCheckinDate
            ? Math.floor((Date.now() - athlete.lastCheckinDate.getTime()) / (1000 * 60 * 60 * 24))
            : 999;

        const title = `${athleteName} Needs Attention`;
        const message = `${athleteName} is showing signs of disengagement that could lead to them leaving.

Risk factors:
${riskFactors.map(factor => `• ${factor}`).join('\n')}

${daysSinceLastCheckin < 999
            ? `Last check-in: ${daysSinceLastCheckin} days ago`
            : 'No recent check-ins recorded'
        }

Consider reaching out personally to re-engage them before they become a churn risk.

Early intervention saves memberships!`;

        const notifications = [];

        // Send to coaches and owners
        for (const membership of box.memberships) {
            if (membership.role !== "athlete") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "athlete_at_risk",
                    category: "retention",
                    priority: "high",
                    title,
                    message,
                    actionUrl: `/box/${box.publicId}/members/${athlete.publicId}`,
                    actionLabel: "View Athlete Profile",
                    channels: ["in_app", "email"],
                    data: {
                        athleteId: athleteMembershipId,
                        athleteName,
                        riskFactors,
                        daysSinceLastCheckin,
                        lastCheckinDate: athlete.lastCheckinDate,
                        checkinStreak: athlete.checkinStreak,
                    },
                    deduplicationKey: `at_risk_${athleteMembershipId}_${Date.now()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send PR video review request to coaches
     */
    async sendPrVideoReviewRequest(boxId: string, prId: string) {
        const [box, prData] = await Promise.all([
            this.getBoxWithStaff(boxId),
            db.select({
                pr: athletePrs,
                athlete: {
                    id: boxMemberships.id,
                    displayName: boxMemberships.displayName,
                    publicId: boxMemberships.publicId,
                },
                user: {
                    name: user.name,
                    email: user.email,
                }
            })
                .from(athletePrs)
                .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
                .innerJoin(user, eq(boxMemberships.userId, user.id))
                .where(eq(athletePrs.id, prId))
                .limit(1)
        ]);

        if (!box || !prData.length) return [];

        const { pr, athlete, user: athleteUser } = prData[0];
        const athleteName = athlete.displayName || athleteUser.name || "Athlete";

        const title = "New PR Video to Review";
        const message = `${athleteName} just uploaded a PR video that needs your feedback!

Achievement: ${pr.value}${pr.unit}${pr.reps ? ` for ${pr.reps} reps` : ''}
${pr.notes ? `Notes: "${pr.notes}"` : ''}

Providing timely feedback keeps athletes motivated and shows you care about their progress.

Quick reviews = engaged athletes!`;

        const notifications = [];

        // Send to coaches and owners
        for (const membership of box.memberships) {
            if (membership.role !== "athlete") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "pr_video_review",
                    category: "workflow",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/box/${box.publicId}/prs/${pr.publicId}/review`,
                    actionLabel: "Review Video",
                    channels: ["in_app"],
                    data: {
                        prId,
                        athleteId: athlete.id,
                        athleteName,
                        prValue: pr.value,
                        prUnit: pr.unit,
                        prReps: pr.reps,
                        hasVideo: pr.videoProcessingStatus === "ready",
                        thumbnailUrl: pr.thumbnailUrl,
                    },
                    deduplicationKey: `pr_review_${prId}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send milestone celebration notification
     */
    async sendMilestoneCelebration(
        boxId: string,
        athleteMembershipId: string,
        milestoneType: "checkin_streak" | "pr_milestone" | "anniversary",
        milestoneValue: number
    ) {
        const [box, athlete] = await Promise.all([
            this.getBoxWithStaff(boxId),
            db.query.boxMemberships.findFirst({
                where: eq(boxMemberships.id, athleteMembershipId),
                with: {
                    user: {
                        columns: {
                            id: true,
                            name: true,
                            email: true,
                        }
                    }
                }
            })
        ]);

        if (!box || !athlete) return [];

        const athleteName = athlete.displayName || athlete.user?.name || "Athlete";

        const milestoneMessages = {
            checkin_streak: {
                title: `${athleteName} Hit a ${milestoneValue}-Day Streak! 🔥`,
                message: `${athleteName} just achieved a ${milestoneValue}-day check-in streak! This shows incredible consistency and dedication.

This is a perfect opportunity to:
• Celebrate their commitment publicly
• Use them as an inspiration for other athletes
• Reinforce positive behavior with recognition

Consistent athletes stay longer and achieve more!`
            },
            pr_milestone: {
                title: `${athleteName} Hit a Major PR! 💪`,
                message: `${athleteName} just achieved a significant personal record milestone!

This achievement represents:
• Months of hard work and dedication  
• Trust in your coaching methods
• Proof of progress that builds confidence

Consider celebrating this publicly to motivate other athletes!`
            },
            anniversary: {
                title: `${athleteName}'s ${milestoneValue}-Month Anniversary! 🎉`,
                message: `${athleteName} has been a loyal member for ${milestoneValue} months! This is a retention win worth celebrating.

Long-term members like ${athleteName}:
• Refer new athletes to your box
• Create community culture
• Provide stable revenue

Consider reaching out personally to thank them for their loyalty!`
            }
        };

        const { title, message } = milestoneMessages[milestoneType];

        const notifications = [];

        // Send to coaches and owners
        for (const membership of box.memberships) {
            if (membership.role !== "athlete") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "milestone_celebration",
                    category: "engagement",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/box/${box.publicId}/members/${athlete.publicId}`,
                    actionLabel: "View Profile",
                    channels: ["in_app"],
                    data: {
                        athleteId: athleteMembershipId,
                        athleteName,
                        milestoneType,
                        milestoneValue,
                        achievedAt: new Date(),
                    },
                    deduplicationKey: `milestone_${athleteMembershipId}_${milestoneType}_${milestoneValue}`,
                });

                notifications.push(notification);
            }
        }

        // Also send to the athlete themselves
        const athleteNotification = await this.notificationService.createNotification({
            boxId,
            userId: athlete.userId,
            membershipId: athlete.id,
            type: "personal_milestone",
            category: "engagement",
            priority: "normal",
            title: title.replace(`${athleteName} `, "You ").replace(`${athleteName}'s`, "Your"),
            message: message.replace(new RegExp(athleteName, 'g'), 'You').replace(/their/g, 'your').replace(/them/g, 'you'),
            actionUrl: `/box/${box.publicId}/dashboard`,
            actionLabel: "View Your Progress",
            channels: ["in_app"],
            data: {
                milestoneType,
                milestoneValue,
                achievedAt: new Date(),
            },
            deduplicationKey: `personal_milestone_${athleteMembershipId}_${milestoneType}_${milestoneValue}`,
        });

        notifications.push(athleteNotification);

        return notifications;
    }

    /**
     * Send wellness concern alert to coaches
     */
    async sendWellnessConcernAlert(boxId: string, athleteMembershipId: string, concernType: "low_energy" | "high_stress" | "poor_sleep" | "multiple_concerns") {
        const [box, athlete] = await Promise.all([
            this.getBoxWithStaff(boxId),
            db.query.boxMemberships.findFirst({
                where: eq(boxMemberships.id, athleteMembershipId),
                with: {
                    user: {
                        columns: {
                            id: true,
                            name: true,
                            email: true,
                        }
                    }
                }
            })
        ]);

        if (!box || !athlete) return [];

        const athleteName = athlete.displayName || athlete.user?.name || "Athlete";

        const concernMessages = {
            low_energy: {
                title: `${athleteName} Reporting Low Energy`,
                message: `${athleteName} has reported consistently low energy levels over the past few days.

This could indicate:
• Overtraining or inadequate recovery
• Nutritional deficiencies
• External stress factors
• Potential illness

Consider checking in with them about their training load, sleep, and overall wellbeing.`
            },
            high_stress: {
                title: `${athleteName} Showing High Stress Levels`,
                message: `${athleteName} has been reporting elevated stress levels recently.

High stress can affect:
• Training performance and recovery
• Injury risk
• Overall gym experience and retention

A personal check-in might help identify stressors and adjust their program accordingly.`
            },
            poor_sleep: {
                title: `${athleteName} Having Sleep Issues`,
                message: `${athleteName} has been reporting poor sleep quality consistently.

Poor sleep impacts:
• Athletic performance
• Recovery between sessions
• Mood and motivation
• Injury risk

Consider discussing sleep hygiene and recovery strategies.`
            },
            multiple_concerns: {
                title: `${athleteName} Needs Wellness Check-In`,
                message: `${athleteName} is showing multiple wellness concerns that suggest they may need extra support right now.

Multiple red flags often indicate:
• Life stress affecting gym performance
• Risk of burnout or overtraining
• Potential for taking a break or quitting

Personal attention now could prevent losing this athlete.`
            }
        };

        const { title, message } = concernMessages[concernType];

        const notifications = [];

        // Send to coaches and owners
        for (const membership of box.memberships) {
            if (membership.role !== "athlete") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "wellness_concern",
                    category: "retention",
                    priority: concernType === "multiple_concerns" ? "high" : "normal",
                    title,
                    message,
                    actionUrl: `/box/${box.publicId}/members/${athlete.publicId}/wellness`,
                    actionLabel: "View Wellness Data",
                    channels: ["in_app", "email"],
                    data: {
                        athleteId: athleteMembershipId,
                        athleteName,
                        concernType,
                        detectedAt: new Date(),
                    },
                    deduplicationKey: `wellness_concern_${athleteMembershipId}_${concernType}_${new Date().toDateString()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send QR code usage notification to owners
     */
    async sendQrCodeSignup(boxId: string, qrCodeId: string, newMemberEmail: string) {
        const [box, qrCode] = await Promise.all([
            this.getBoxWithOwners(boxId),
            db.query.boxQrCodes.findFirst({
                where: eq(boxQrCodes.id, qrCodeId)
            })
        ]);

        if (!box || !qrCode) return [];

        const title = "QR Code Sign-up Success!";
        const message = `Someone just signed up using your "${qrCode.name}" QR code!

New member: ${newMemberEmail}
QR Code: ${qrCode.name}
Total QR uses: ${qrCode.usageCount + 1}

${box.requireApproval
            ? "They'll appear in your approval queue for review."
            : "They've been automatically added to your box."
        }

QR codes are working to grow your membership!`;

        const notifications = [];

        // Send to owners
        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "qr_code_signup",
                    category: "engagement",
                    priority: "low",
                    title,
                    message,
                    actionUrl: `/box/${box.publicId}/qr-codes`,
                    actionLabel: "Manage QR Codes",
                    channels: ["in_app"],
                    data: {
                        qrCodeId,
                        qrCodeName: qrCode.name,
                        newMemberEmail,
                        usageCount: qrCode.usageCount + 1,
                        requiresApproval: box.requireApproval,
                    },
                    deduplicationKey: `qr_signup_${qrCodeId}_${Date.now()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send invitation accepted notification
     */
    async sendInvitationAccepted(boxId: string, inviteId: string) {
        const [box, invite] = await Promise.all([
            this.getBoxWithOwners(boxId),
            db.query.boxInvites.findFirst({
                where: eq(boxInvites.id, inviteId),
                with: {
                    invitedBy: {
                        columns: {
                            id: true,
                            name: true,
                            email: true,
                        }
                    }
                }
            })
        ]);

        if (!box || !invite) return [];

        const title = "Invitation Accepted!";
        const message = `Great news! ${invite.email} accepted your invitation to join ${box.name} as ${invite.role === "athlete" ? "an athlete" : "a coach"}.

They're now an active member of your box and can start ${invite.role === "athlete" ? "tracking their fitness journey" : "helping athletes achieve their goals"}.

Successful invitations help grow your community!`;

        const notifications = [];

        // Send to the person who sent the invite
        if (invite.invitedBy) {
            const notification = await this.notificationService.createNotification({
                boxId,
                userId: invite.invitedBy.id,
                membershipId: null, // Will be resolved by notification service
                type: "invitation_accepted",
                category: "engagement",
                priority: "low",
                title,
                message,
                actionUrl: `/box/${box.publicId}/members`,
                actionLabel: "View Members",
                channels: ["in_app"],
                data: {
                    inviteId,
                    invitedEmail: invite.email,
                    invitedRole: invite.role,
                    acceptedAt: invite.acceptedAt,
                },
                deduplicationKey: `invite_accepted_${inviteId}`,
            });

            notifications.push(notification);
        }

        return notifications;
    }

    /**
     * Send daily coach digest with actionable insights
     */
    async sendDailyCoachDigest(boxId: string) {
        const [box, dashboardData] = await Promise.all([
            this.getBoxWithStaff(boxId),
            this.getCoachDigestData(boxId)
        ]);

        if (!box) return [];

        const {
            atRiskCount,
            pendingPrReviews,
            newMilestones,
            wellnessConcerns,
            newApprovals
        } = dashboardData;

        // Only send if there's something actionable
        if (atRiskCount === 0 && pendingPrReviews === 0 && newMilestones === 0 && wellnessConcerns === 0 && newApprovals === 0) {
            return [];
        }

        const title = "Your Daily Action Items";
        let message = `Here's what needs your attention at ${box.name} today:\n\n`;

        const actionItems = [];

        if (atRiskCount > 0) {
            actionItems.push(`• ${atRiskCount} athlete${atRiskCount > 1 ? 's' : ''} at risk of churning`);
        }

        if (pendingPrReviews > 0) {
            actionItems.push(`• ${pendingPrReviews} PR video${pendingPrReviews > 1 ? 's' : ''} waiting for feedback`);
        }

        if (wellnessConcerns > 0) {
            actionItems.push(`• ${wellnessConcerns} wellness concern${wellnessConcerns > 1 ? 's' : ''} flagged`);
        }

        if (newApprovals > 0) {
            actionItems.push(`• ${newApprovals} new membership request${newApprovals > 1 ? 's' : ''} to review`);
        }

        if (newMilestones > 0) {
            actionItems.push(`• ${newMilestones} milestone${newMilestones > 1 ? 's' : ''} to celebrate`);
        }

        message += actionItems.join('\n');
        message += '\n\nTaking action on these items helps keep athletes engaged and prevents churn!';

        const notifications = [];

        // Send to coaches and owners
        for (const membership of box.memberships) {
            if (membership.role !== "athlete") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "daily_coach_digest",
                    category: "workflow",
                    priority: "normal",
                    title,
                    message,
                    actionUrl: `/box/${box.publicId}/dashboard`,
                    actionLabel: "Review Action Items",
                    channels: ["in_app", "email"],
                    data: {
                        atRiskCount,
                        pendingPrReviews,
                        newMilestones,
                        wellnessConcerns,
                        newApprovals,
                        digestDate: new Date().toDateString(),
                    },
                    deduplicationKey: `daily_digest_${boxId}_${new Date().toDateString()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send weekly box performance summary to owners
     */
    async sendWeeklyBoxSummary(boxId: string) {
        const [box, weeklyStats] = await Promise.all([
            this.getBoxWithOwners(boxId),
            this.getWeeklyBoxStats(boxId)
        ]);

        if (!box) return [];

        const {
            newMembers,
            churnedMembers,
            avgCheckinRate,
            totalPrs,
            interventionsCompleted,
            retentionRate
        } = weeklyStats;

        const title = "Weekly Box Performance Summary";
        const message = `Here's how ${box.name} performed this week:

📈 Growth:
• ${newMembers} new member${newMembers !== 1 ? 's' : ''} added
• ${churnedMembers} member${churnedMembers !== 1 ? 's' : ''} left

💪 Engagement:
• ${avgCheckinRate.toFixed(1)} average check-ins per member
• ${totalPrs} new PRs recorded

👥 Retention:
• ${retentionRate.toFixed(1)}% retention rate
• ${interventionsCompleted} at-risk interventions completed

${retentionRate >= 75
            ? "Great retention this week! Your efforts are keeping athletes engaged."
            : retentionRate >= 60
                ? "Retention is moderate. Focus on identifying and helping at-risk athletes."
                : "Retention needs attention. Consider increasing personal outreach and engagement strategies."
        }`;

        const notifications = [];

        // Send to owners
        for (const membership of box.memberships) {
            if (membership.role === "owner") {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "weekly_box_summary",
                    category: "system",
                    priority: "low",
                    title,
                    message,
                    actionUrl: `/box/${box.publicId}/analytics`,
                    actionLabel: "View Full Analytics",
                    channels: ["email"],
                    data: {
                        weeklyStats,
                        weekOf: new Date().toISOString(),
                    },
                    deduplicationKey: `weekly_summary_${boxId}_${new Date().getFullYear()}_${Math.floor((Date.now() - new Date().getTimezoneOffset()*60000) / (7*24*60*60*1000))}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send system alert for critical box issues
     */
    async sendSystemAlert(
        boxId: string,
        alertType: "payment_method_expiring" | "high_churn_rate" | "low_engagement" | "coach_inactive",
        alertData: any
    ) {
        const box = await this.getBoxWithOwners(boxId);
        if (!box) return [];

        const alertMessages = {
            payment_method_expiring: {
                title: "Payment Method Expires Soon",
                message: `Your payment method expires on ${alertData.expirationDate}. Update it now to avoid service interruption.`,
                priority: "high" as const,
                actionLabel: "Update Payment Method",
                actionUrl: `/billing/payment-methods?boxId=${boxId}`
            },
            high_churn_rate: {
                title: "High Member Churn Detected",
                message: `Your churn rate has increased to ${alertData.churnRate}% this month. This is above the healthy benchmark of 5-10%.

Consider:
• Increasing personal outreach to at-risk athletes
• Reviewing your onboarding process
• Analyzing exit feedback for common issues`,
                priority: "high" as const,
                actionLabel: "View Retention Analytics",
                actionUrl: `/box/${box.publicId}/retention`
            },
            low_engagement: {
                title: "Member Engagement Below Average",
                message: `Overall member engagement has dropped ${alertData.engagementDrop}% compared to last month.

Low engagement often leads to churn. Consider:
• Running a member survey
• Increasing social activities and challenges
• Personal check-ins with inactive members`,
                priority: "normal" as const,
                actionLabel: "View Engagement Data",
                actionUrl: `/box/${box.publicId}/engagement`
            },
            coach_inactive: {
                title: "Coach Needs Attention",
                message: `${alertData.coachName} hasn't been active in reviewing PRs or responding to athlete needs recently.

Inactive coaching reduces athlete satisfaction and increases churn risk.`,
                priority: "normal" as const,
                actionLabel: "View Coach Activity",
                actionUrl: `/box/${box.publicId}/coaches/${alertData.coachId}`
            }
        };

        const alert = alertMessages[alertType];
        const notifications = [];

        // Send to owners (and head coaches for non-billing alerts)
        for (const membership of box.memberships) {
            if (membership.role === "owner" || (alertType !== "payment_method_expiring" && membership.role === "head_coach")) {
                const notification = await this.notificationService.createNotification({
                    boxId,
                    userId: membership.userId,
                    membershipId: membership.id,
                    type: "system_alert",
                    category: alertType.includes("payment") ? "billing" : "system",
                    priority: alert.priority,
                    title: alert.title,
                    message: alert.message,
                    actionUrl: alert.actionUrl,
                    actionLabel: alert.actionLabel,
                    channels: ["in_app", "email"],
                    data: {
                        alertType,
                        alertData,
                        detectedAt: new Date(),
                    },
                    deduplicationKey: `system_alert_${boxId}_${alertType}_${new Date().toDateString()}`,
                });

                notifications.push(notification);
            }
        }

        return notifications;
    }

    /**
     * Send bulk notification for multiple box events
     */
    async sendBoxEventNotifications(events: Array<{
        type: string;
        boxId: string;
        data: any;
    }>) {
        const results = [];

        for (const event of events) {
            try {
                let notifications = [];

                switch (event.type) {
                    case 'signup_approval_request':
                        notifications = await this.sendSignupApprovalRequest(
                            event.boxId,
                            event.data.approvalId
                        );
                        break;

                    case 'new_member_welcome':
                        notifications = await this.sendNewMemberWelcome(
                            event.boxId,
                            event.data.membershipId
                        );
                        break;

                    case 'at_risk_athlete':
                        notifications = await this.sendAtRiskAthleteAlert(
                            event.boxId,
                            event.data.athleteMembershipId,
                            event.data.riskFactors
                        );
                        break;

                    case 'pr_video_review':
                        notifications = await this.sendPrVideoReviewRequest(
                            event.boxId,
                            event.data.prId
                        );
                        break;

                    case 'milestone_celebration':
                        notifications = await this.sendMilestoneCelebration(
                            event.boxId,
                            event.data.athleteMembershipId,
                            event.data.milestoneType,
                            event.data.milestoneValue
                        );
                        break;

                    case 'wellness_concern':
                        notifications = await this.sendWellnessConcernAlert(
                            event.boxId,
                            event.data.athleteMembershipId,
                            event.data.concernType
                        );
                        break;

                    case 'qr_code_signup':
                        notifications = await this.sendQrCodeSignup(
                            event.boxId,
                            event.data.qrCodeId,
                            event.data.newMemberEmail
                        );
                        break;

                    case 'invitation_accepted':
                        notifications = await this.sendInvitationAccepted(
                            event.boxId,
                            event.data.inviteId
                        );
                        break;

                    case 'daily_coach_digest':
                        notifications = await this.sendDailyCoachDigest(event.boxId);
                        break;

                    case 'weekly_box_summary':
                        notifications = await this.sendWeeklyBoxSummary(event.boxId);
                        break;

                    case 'system_alert':
                        notifications = await this.sendSystemAlert(
                            event.boxId,
                            event.data.alertType,
                            event.data.alertData
                        );
                        break;

                    default:
                        console.warn(`Unknown box event type: ${event.type}`);
                        continue;
                }

                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    notificationCount: notifications?.length || 0,
                    success: true,
                });

            } catch (error) {
                console.error(`Failed to send ${event.type} notification for box ${event.boxId}:`, error);
                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return results;
    }

    /**
     * Helper method to get box with staff memberships
     */
    private async getBoxWithStaff(boxId: string) {
        return await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
            with: {
                memberships: {
                    where: or(
                        eq(boxMemberships.role, "owner"),
                        eq(boxMemberships.role, "head_coach"),
                        eq(boxMemberships.role, "coach")
                    ),
                    with: {
                        user: {
                            columns: {
                                id: true,
                                name: true,
                                email: true,
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Helper method to get box with owner memberships only
     */
    private async getBoxWithOwners(boxId: string) {
        return await db.query.boxes.findFirst({
            where: eq(boxes.id, boxId),
            with: {
                memberships: {
                    where: eq(boxMemberships.role, "owner"),
                    with: {
                        user: {
                            columns: {
                                id: true,
                                name: true,
                                email: true,
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Helper method to get coach digest data
     */
    private async getCoachDigestData(boxId: string) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const [
            atRiskMembers,
            pendingPrReviews,
            wellnessConcerns,
            newApprovals,
            newMilestones
        ] = await Promise.all([
            // At-risk members count
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    eq(boxMemberships.role, "athlete"),
                    sql`(${boxMemberships.lastCheckinDate} < NOW() - INTERVAL '14 days' OR ${boxMemberships.lastCheckinDate} IS NULL)`
                )),

            // Pending PR reviews
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    sql`${athletePrs.gumletAssetId} IS NOT NULL`,
                    eq(athletePrs.videoProcessingStatus, 'ready'),
                    sql`${athletePrs.coachNotes} IS NULL OR ${athletePrs.coachNotes} = ''`,
                    gte(athletePrs.achievedAt, yesterday)
                )),

            // Wellness concerns (placeholder - would need actual wellness schema)
            Promise.resolve([{ count: 0 }]),

            // New approval requests
            db.select({ count: count() })
                .from(approvalQueue)
                .where(and(
                    eq(approvalQueue.boxId, boxId),
                    eq(approvalQueue.status, "pending"),
                    gte(approvalQueue.submittedAt, yesterday)
                )),

            // New milestones (placeholder - would need milestone tracking)
            Promise.resolve([{ count: 0 }])
        ]);

        return {
            atRiskCount: atRiskMembers[0].count,
            pendingPrReviews: pendingPrReviews[0].count,
            newMilestones: newMilestones[0].count,
            wellnessConcerns: wellnessConcerns[0].count,
            newApprovals: newApprovals[0].count,
        };
    }

    /**
     * Helper method to get weekly box statistics
     */
    private async getWeeklyBoxStats(boxId: string) {
        const today = new Date();
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);

        const [
            newMembers,
            churnedMembers,
            totalPrs,
            avgCheckinData
        ] = await Promise.all([
            // New members this week
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    gte(boxMemberships.joinedAt, weekAgo)
                )),

            // Churned members this week
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, false),
                    gte(boxMemberships.leftAt, weekAgo)
                )),

            // Total PRs this week
            db.select({ count: count() })
                .from(athletePrs)
                .where(and(
                    eq(athletePrs.boxId, boxId),
                    gte(athletePrs.achievedAt, weekAgo)
                )),

            // Average check-in data
            db.select({
                avgStreak: sql<number>`AVG(${boxMemberships.checkinStreak})`,
                totalMembers: count()
            })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    eq(boxMemberships.role, "athlete")
                ))
        ]);

        const totalActiveMembers = avgCheckinData[0].totalMembers;
        const retentionRate = totalActiveMembers > 0
            ? ((totalActiveMembers - churnedMembers[0].count) / totalActiveMembers) * 100
            : 100;

        return {
            newMembers: newMembers[0].count,
            churnedMembers: churnedMembers[0].count,
            avgCheckinRate: avgCheckinData[0].avgStreak || 0,
            totalPrs: totalPrs[0].count,
            interventionsCompleted: 0, // Placeholder - would need intervention tracking
            retentionRate
        };
    }
}
