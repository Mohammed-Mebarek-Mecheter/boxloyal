// lib/services/notifications/athlete-notifications-service.ts
import { NotificationService } from "./notification-service";
import { db } from "@/db";
import {
    boxMemberships,
    athletePrs,
    athleteWellnessCheckins,
    athleteBadges,
    movements,
    boxes,
    prCoachFeedback,
    wodAttendance,
    athleteBenchmarks,
    benchmarkWods
} from "@/db/schema";
import { eq, and, desc, gte, count, sql } from "drizzle-orm";

export interface AthleteNotificationContext {
    athlete: {
        id: string;
        userId: string;
        displayName: string;
        publicId: string;
        checkinStreak: number;
        longestCheckinStreak: number;
    };
    box: {
        id: string;
        name: string;
        publicId: string;
    };
}

export class AthleteNotificationService {
    private notificationService: NotificationService;

    constructor() {
        this.notificationService = new NotificationService();
    }

    /**
     * Send streak maintenance reminder to prevent breaks
     */
    async sendStreakMaintenanceReminder(boxId: string, athleteId: string, streakLength: number) {
        const context = await this.getAthleteContext(boxId, athleteId);
        if (!context) return null;

        const title = `Don't break your ${streakLength}-day streak!`;
        let message = `You're on an amazing ${streakLength}-day wellness check-in streak! `;

        if (streakLength >= 30) {
            message += `This is incredible consistency - you're in the top 10% of athletes. `;
        } else if (streakLength >= 14) {
            message += `You're building great habits - keep it going! `;
        } else if (streakLength >= 7) {
            message += `You're on a roll - one week down! `;
        }

        message += `Take 2 minutes to check in today and keep your momentum going.`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.athlete.userId,
            membershipId: athleteId,
            type: "streak_maintenance",
            category: "engagement",
            priority: "normal",
            title,
            message,
            actionUrl: `/athlete/wellness/checkin`,
            actionLabel: "Check In Now",
            channels: ["in_app", "email"],
            data: {
                streakLength,
                streakType: "wellness_checkin",
                isLongestStreak: streakLength >= context.athlete.longestCheckinStreak,
            },
            deduplicationKey: `streak_reminder_${athleteId}_${new Date().toDateString()}`,
        });
    }

    /**
     * Send streak break recovery encouragement
     */
    async sendStreakBreakRecovery(boxId: string, athleteId: string, brokenStreakLength: number) {
        const context = await this.getAthleteContext(boxId, athleteId);
        if (!context) return null;

        const title = "Ready to start a new streak?";
        let message = `Your ${brokenStreakLength}-day streak ended, but that's totally normal - even the best athletes have off days! `;

        if (brokenStreakLength >= 30) {
            message += `That ${brokenStreakLength}-day streak was exceptional. You've proven you can build incredible habits. `;
        } else if (brokenStreakLength >= 7) {
            message += `${brokenStreakLength} days shows real commitment. `;
        }

        message += `The best time to start building consistency again is right now. Your coaches believe in you!`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.athlete.userId,
            membershipId: athleteId,
            type: "streak_recovery",
            category: "engagement",
            priority: "normal",
            title,
            message,
            actionUrl: `/athlete/wellness/checkin`,
            actionLabel: "Start New Streak",
            channels: ["in_app"],
            data: {
                brokenStreakLength,
                longestStreak: context.athlete.longestCheckinStreak,
                encouragementLevel: brokenStreakLength >= 30 ? "high" : brokenStreakLength >= 7 ? "medium" : "gentle",
            },
            deduplicationKey: `streak_recovery_${athleteId}_${Date.now()}`,
        });
    }

    /**
     * Send badge achievement celebration
     */
    async sendBadgeAchievement(boxId: string, athleteId: string, badge: typeof athleteBadges.$inferSelect) {
        const context = await this.getAthleteContext(boxId, athleteId);
        if (!context) return null;

        const title = `🏆 Badge Earned: ${badge.title}`;
        let message = `Congratulations! You just earned the "${badge.title}" badge`;

        if (badge.description) {
            message += ` for ${badge.description.toLowerCase()}`;
        }

        message += `.\n\n`;

        // Add context based on badge type
        if (badge.badgeType === "pr_achievement") {
            message += `Your dedication to documenting progress with video proof is paying off. Keep recording those PRs!`;
        } else if (badge.badgeType === "consistency") {
            message += `Your consistent check-ins show real commitment to your fitness journey. This kind of dedication sets you apart!`;
        } else if (badge.badgeType === "community") {
            message += `Your engagement with coaches and the ${context.box.name} community is making everyone stronger!`;
        }

        return await this.notificationService.createNotification({
            boxId,
            userId: context.athlete.userId,
            membershipId: athleteId,
            type: "badge_earned",
            category: "social",
            priority: "normal",
            title,
            message,
            actionUrl: `/athlete/profile/badges`,
            actionLabel: "View All Badges",
            channels: ["in_app"],
            data: {
                badgeId: badge.id,
                badgeTitle: badge.title,
                badgeType: badge.badgeType,
                badgeTier: badge.tier,
                achievedValue: badge.achievedValue,
                isFirstBadge: false, // Will be set by caller if needed
            },
            deduplicationKey: `badge_earned_${badge.id}`,
        });
    }

    /**
     * Send coach feedback notification for PR videos
     */
    async sendCoachFeedbackReceived(
        boxId: string,
        athleteId: string,
        prId: string,
        feedback: {
            id: string;
            coachName: string;
            feedbackText: string;
            feedbackType: string;
            prMovement: string;
            prValue: string;
            prUnit: string;
        }
    ) {
        const context = await this.getAthleteContext(boxId, athleteId);
        if (!context) return null;

        let title = "";
        let message = "";

        switch (feedback.feedbackType) {
            case "celebration":
                title = `🎉 Coach ${feedback.coachName} celebrated your PR!`;
                message = `Amazing work on your ${feedback.prMovement} PR of ${feedback.prValue}${feedback.prUnit}!\n\n`;
                message += `Coach ${feedback.coachName} says: "${feedback.feedbackText}"\n\n`;
                message += `Keep up the incredible work - your progress is inspiring!`;
                break;

            case "encouragement":
                title = `💪 Encouragement from Coach ${feedback.coachName}`;
                message = `Coach ${feedback.coachName} left you some motivation on your ${feedback.prMovement} PR:\n\n`;
                message += `"${feedback.feedbackText}"\n\n`;
                message += `Your coaches are here to support your journey every step of the way!`;
                break;

            case "technique":
                title = `🎯 Technique Tips from Coach ${feedback.coachName}`;
                message = `Coach ${feedback.coachName} reviewed your ${feedback.prMovement} PR video and has some helpful insights:\n\n`;
                message += `"${feedback.feedbackText}"\n\n`;
                message += `This kind of personalized feedback is how you'll reach the next level!`;
                break;

            case "correction":
                title = `⚠️ Important Form Notes from Coach ${feedback.coachName}`;
                message = `Coach ${feedback.coachName} wants to help you improve your ${feedback.prMovement} technique:\n\n`;
                message += `"${feedback.feedbackText}"\n\n`;
                message += `Taking time to perfect form now will lead to bigger PRs and injury prevention later!`;
                break;

            default:
                title = `📝 Feedback from Coach ${feedback.coachName}`;
                message = `Coach ${feedback.coachName} reviewed your ${feedback.prMovement} PR:\n\n`;
                message += `"${feedback.feedbackText}"`;
        }

        return await this.notificationService.createNotification({
            boxId,
            userId: context.athlete.userId,
            membershipId: athleteId,
            type: "coach_feedback",
            category: "engagement",
            priority: feedback.feedbackType === "correction" ? "high" : "normal",
            title,
            message,
            actionUrl: `/athlete/prs/${prId}`,
            actionLabel: "View PR & Feedback",
            channels: ["in_app", "email"],
            data: {
                prId,
                feedbackId: feedback.id,
                coachName: feedback.coachName,
                feedbackType: feedback.feedbackType,
                movementName: feedback.prMovement,
                prValue: feedback.prValue,
                prUnit: feedback.prUnit,
            },
            deduplicationKey: `coach_feedback_${feedback.id}`,
        });
    }

    /**
     * Send weekly progress report
     */
    async sendWeeklyProgressReport(boxId: string, athleteId: string, progressData: {
        checkinCount: number;
        prCount: number;
        benchmarkCount: number;
        attendanceCount: number;
        avgWellnessScore: number;
        improvements: string[];
        nextGoals: string[];
    }) {
        const context = await this.getAthleteContext(boxId, athleteId);
        if (!context) return null;

        const title = "Your Week at a Glance";

        let message = `Here's how you performed this week at ${context.box.name}:\n\n`;

        // Activity Summary
        message += `📊 WEEKLY ACTIVITY:\n`;
        message += `• ${progressData.checkinCount} wellness check-ins\n`;
        message += `• ${progressData.prCount} new personal records\n`;
        message += `• ${progressData.benchmarkCount} benchmark tests\n`;
        message += `• ${progressData.attendanceCount} classes attended\n`;

        if (progressData.avgWellnessScore > 0) {
            message += `• ${progressData.avgWellnessScore.toFixed(1)}/10 average wellness score\n`;
        }

        // Improvements
        if (progressData.improvements.length > 0) {
            message += `\n🎯 KEY IMPROVEMENTS:\n`;
            progressData.improvements.forEach(improvement => {
                message += `• ${improvement}\n`;
            });
        }

        // Next Goals
        if (progressData.nextGoals.length > 0) {
            message += `\n🚀 FOCUS AREAS:\n`;
            progressData.nextGoals.forEach(goal => {
                message += `• ${goal}\n`;
            });
        }

        message += `\nGreat job this week! Consistent effort like this is how champions are made.`;

        return await this.notificationService.createNotification({
            boxId,
            userId: context.athlete.userId,
            membershipId: athleteId,
            type: "weekly_progress_report",
            category: "engagement",
            priority: "low",
            title,
            message,
            actionUrl: `/athlete/progress`,
            actionLabel: "View Detailed Progress",
            channels: ["in_app", "email"],
            data: {
                weekOf: new Date().toISOString(),
                checkinCount: progressData.checkinCount,
                prCount: progressData.prCount,
                benchmarkCount: progressData.benchmarkCount,
                attendanceCount: progressData.attendanceCount,
                avgWellnessScore: progressData.avgWellnessScore,
                improvements: progressData.improvements,
                nextGoals: progressData.nextGoals,
            },
            deduplicationKey: `weekly_report_${athleteId}_${this.getWeekIdentifier()}`,
        });
    }

    /**
     * Send goal progression update
     */
    async sendGoalProgressUpdate(
        boxId: string,
        athleteId: string,
        goal: {
            id: string;
            name: string;
            currentValue: number;
            targetValue: number;
            unit: string;
            progressPercent: number;
            movement?: string;
            targetDate?: Date;
        }
    ) {
        const context = await this.getAthleteContext(boxId, athleteId);
        if (!context) return null;

        let title = "";
        let message = "";

        if (goal.progressPercent >= 90) {
            title = `🎯 Almost there! ${goal.progressPercent.toFixed(0)}% to your goal`;
            message = `You're so close to achieving your ${goal.name} goal! `;
            message += `Current: ${goal.currentValue}${goal.unit}, Target: ${goal.targetValue}${goal.unit}\n\n`;
            message += `Just ${(goal.targetValue - goal.currentValue).toFixed(1)}${goal.unit} to go. `;
            message += `You've got this - push through and make it happen!`;
        } else if (goal.progressPercent >= 75) {
            title = `💪 Great progress! ${goal.progressPercent.toFixed(0)}% to your goal`;
            message = `You're making excellent progress on your ${goal.name} goal! `;
            message += `You've gone from your starting point to ${goal.currentValue}${goal.unit} - that's ${goal.progressPercent.toFixed(0)}% complete.\n\n`;
            message += `Keep up the momentum. The finish line is getting closer!`;
        } else if (goal.progressPercent >= 50) {
            title = `📈 Halfway there! ${goal.progressPercent.toFixed(0)}% to your goal`;
            message = `You've reached the halfway point on your ${goal.name} goal - that's a major milestone! `;
            message += `Current progress: ${goal.currentValue}${goal.unit} of ${goal.targetValue}${goal.unit}\n\n`;
            message += `The hardest part is often getting started, and you're well past that. Keep building on this foundation!`;
        } else {
            title = `🚀 Building momentum! ${goal.progressPercent.toFixed(0)}% progress`;
            message = `Every step counts toward your ${goal.name} goal. `;
            message += `You're now at ${goal.currentValue}${goal.unit}, making steady progress toward ${goal.targetValue}${goal.unit}.\n\n`;
            message += `Consistency beats perfection - keep showing up and the results will follow!`;
        }

        return await this.notificationService.createNotification({
            boxId,
            userId: context.athlete.userId,
            membershipId: athleteId,
            type: "goal_progress",
            category: "engagement",
            priority: goal.progressPercent >= 90 ? "high" : "normal",
            title,
            message,
            actionUrl: `/athlete/goals/${goal.id}`,
            actionLabel: "View Goal Details",
            channels: ["in_app"],
            data: {
                goalId: goal.id,
                goalName: goal.name,
                currentValue: goal.currentValue,
                targetValue: goal.targetValue,
                unit: goal.unit,
                progressPercent: goal.progressPercent,
                movement: goal.movement,
                targetDate: goal.targetDate?.toISOString(),
            },
            deduplicationKey: `goal_progress_${goal.id}_${this.getProgressTier(goal.progressPercent)}`,
        });
    }

    /**
     * Send recovery recommendation based on wellness data
     */
    async sendRecoveryRecommendation(
        boxId: string,
        athleteId: string,
        recommendation: {
            type: "rest_day" | "light_workout" | "focus_sleep" | "stress_management" | "hydration";
            reason: string;
            suggestion: string;
            severity: "low" | "medium" | "high";
            dataPoints: {
                energyLevel?: number;
                sleepQuality?: number;
                stressLevel?: number;
                soreness?: string[];
            };
        }
    ) {
        const context = await this.getAthleteContext(boxId, athleteId);
        if (!context) return null;

        let title = "";
        let message = "";

        switch (recommendation.type) {
            case "rest_day":
                title = "Consider a Rest Day";
                message = `Your body might be telling you something important. ${recommendation.reason}\n\n`;
                message += `${recommendation.suggestion}\n\n`;
                message += `Remember: rest is when your body gets stronger. Listen to what it's telling you.`;
                break;

            case "light_workout":
                title = "Light Workout Recommended";
                message = `Based on your recent check-ins, a lighter session might be perfect today. ${recommendation.reason}\n\n`;
                message += `${recommendation.suggestion}\n\n`;
                message += `Movement is medicine, but intensity should match how you feel.`;
                break;

            case "focus_sleep":
                title = "Sleep Recovery Priority";
                message = `Your sleep quality has been affecting your performance. ${recommendation.reason}\n\n`;
                message += `${recommendation.suggestion}\n\n`;
                message += `Quality sleep is your secret weapon for better workouts and faster recovery.`;
                break;

            case "stress_management":
                title = "Stress Management Suggestion";
                message = `High stress levels can impact your fitness progress. ${recommendation.reason}\n\n`;
                message += `${recommendation.suggestion}\n\n`;
                message += `Managing stress isn't just good for life - it's essential for athletic performance.`;
                break;

            case "hydration":
                title = "Hydration Focus Needed";
                message = `Your hydration levels may be impacting your performance. ${recommendation.reason}\n\n`;
                message += `${recommendation.suggestion}\n\n`;
                message += `Proper hydration is the foundation of every great workout.`;
                break;
        }

        return await this.notificationService.createNotification({
            boxId,
            userId: context.athlete.userId,
            membershipId: athleteId,
            type: "recovery_recommendation",
            category: "engagement",
            priority: recommendation.severity === "high" ? "high" : "normal",
            title,
            message,
            actionUrl: `/athlete/wellness`,
            actionLabel: "View Wellness Insights",
            channels: ["in_app"],
            data: {
                recommendationType: recommendation.type,
                reason: recommendation.reason,
                suggestion: recommendation.suggestion,
                severity: recommendation.severity,
                dataPoints: recommendation.dataPoints,
                recommendationDate: new Date().toISOString(),
            },
            deduplicationKey: `recovery_rec_${athleteId}_${recommendation.type}_${new Date().toDateString()}`,
        });
    }

    /**
     * Send class reminder notification
     */
    async sendClassReminder(
        boxId: string,
        athleteId: string,
        classInfo: {
            className: string;
            classTime: Date;
            coachName?: string;
            isBookmarked: boolean;
            reminderMinutes: number;
        }
    ) {
        const context = await this.getAthleteContext(boxId, athleteId);
        if (!context) return null;

        const timeUntilClass = Math.round((classInfo.classTime.getTime() - Date.now()) / (1000 * 60));
        const formatTime = classInfo.classTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let title = "";
        let message = "";

        if (timeUntilClass <= 30) {
            title = `Class starting soon! ${classInfo.className}`;
            message = `Your ${classInfo.className} class at ${formatTime} starts in ${timeUntilClass} minutes. `;
            if (classInfo.coachName) {
                message += `Coach ${classInfo.coachName} is ready for you! `;
            }
            message += `Time to grab your gear and head over!`;
        } else {
            title = `Reminder: ${classInfo.className} at ${formatTime}`;
            message = `Don't forget about your ${classInfo.className} class today at ${formatTime}. `;
            if (classInfo.coachName) {
                message += `Coach ${classInfo.coachName} has a great workout planned! `;
            }
            message += `See you there!`;
        }

        return await this.notificationService.createNotification({
            boxId,
            userId: context.athlete.userId,
            membershipId: athleteId,
            type: "class_reminder",
            category: "workflow",
            priority: timeUntilClass <= 30 ? "high" : "normal",
            title,
            message,
            actionUrl: `/athlete/schedule`,
            actionLabel: "View Schedule",
            channels: ["in_app"],
            data: {
                className: classInfo.className,
                classTime: classInfo.classTime.toISOString(),
                coachName: classInfo.coachName,
                timeUntilClass,
                isBookmarked: classInfo.isBookmarked,
            },
            deduplicationKey: `class_reminder_${athleteId}_${classInfo.classTime.toISOString()}`,
            scheduledFor: new Date(classInfo.classTime.getTime() - (classInfo.reminderMinutes * 60 * 1000)),
        });
    }

    /**
     * Helper method to get athlete context
     */
    private async getAthleteContext(boxId: string, athleteId: string): Promise<AthleteNotificationContext | null> {
        const athlete = await db
            .select({
                athlete: {
                    id: boxMemberships.id,
                    userId: boxMemberships.userId,
                    displayName: boxMemberships.displayName,
                    publicId: boxMemberships.publicId,
                    checkinStreak: boxMemberships.checkinStreak,
                    longestCheckinStreak: boxMemberships.longestCheckinStreak,
                },
                box: {
                    id: boxes.id,
                    name: boxes.name,
                    publicId: boxes.publicId,
                }
            })
            .from(boxMemberships)
            .innerJoin(boxes, eq(boxMemberships.boxId, boxes.id))
            .where(
                and(
                    eq(boxMemberships.id, athleteId),
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true)
                )
            )
            .limit(1);

        return athlete.length > 0 ? {
            athlete: {
                ...athlete[0].athlete,
                checkinStreak: athlete[0].athlete.checkinStreak || 0,
                longestCheckinStreak: athlete[0].athlete.longestCheckinStreak || 0,
            },
            box: athlete[0].box
        } : null;
    }

    /**
     * Helper method to get week identifier for deduplication
     */
    private getWeekIdentifier(): string {
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
        return startOfWeek.toISOString().split('T')[0];
    }

    /**
     * Helper method to determine progress tier for deduplication
     */
    private getProgressTier(progressPercent: number): string {
        if (progressPercent >= 90) return "90plus";
        if (progressPercent >= 75) return "75plus";
        if (progressPercent >= 50) return "50plus";
        if (progressPercent >= 25) return "25plus";
        return "under25";
    }

    /**
     * Send bulk athlete notifications
     */
    async sendAthleteEventNotifications(events: Array<{
        type: string;
        boxId: string;
        athleteId: string;
        data: any;
    }>) {
        const results = [];

        for (const event of events) {
            try {
                let notification = null;

                switch (event.type) {
                    case 'streak_maintenance':
                        notification = await this.sendStreakMaintenanceReminder(
                            event.boxId,
                            event.athleteId,
                            event.data.streakLength
                        );
                        break;

                    case 'streak_break_recovery':
                        notification = await this.sendStreakBreakRecovery(
                            event.boxId,
                            event.athleteId,
                            event.data.brokenStreakLength
                        );
                        break;

                    case 'badge_achievement':
                        notification = await this.sendBadgeAchievement(
                            event.boxId,
                            event.athleteId,
                            event.data.badge
                        );
                        break;

                    case 'coach_feedback':
                        notification = await this.sendCoachFeedbackReceived(
                            event.boxId,
                            event.athleteId,
                            event.data.prId,
                            event.data.feedback
                        );
                        break;

                    case 'milestone_achievement':
                        notification = await this.sendMilestoneAchievement(
                            event.boxId,
                            event.athleteId,
                            event.data.milestone
                        );
                        break;

                    case 'weekly_progress_report':
                        notification = await this.sendWeeklyProgressReport(
                            event.boxId,
                            event.athleteId,
                            event.data.progressData
                        );
                        break;

                    case 'goal_progress_update':
                        notification = await this.sendGoalProgressUpdate(
                            event.boxId,
                            event.athleteId,
                            event.data.goal
                        );
                        break;

                    case 'recovery_recommendation':
                        notification = await this.sendRecoveryRecommendation(
                            event.boxId,
                            event.athleteId,
                            event.data.recommendation
                        );
                        break;

                    case 'class_reminder':
                        notification = await this.sendClassReminder(
                            event.boxId,
                            event.athleteId,
                            event.data.classInfo
                        );
                        break;

                    default:
                        console.warn(`Unknown athlete event type: ${event.type}`);
                        continue;
                }

                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    athleteId: event.athleteId,
                    notificationSent: !!notification,
                    success: true,
                });

            } catch (error) {
                console.error(`Failed to send ${event.type} notification for athlete ${event.athleteId}:`, error);
                results.push({
                    eventType: event.type,
                    boxId: event.boxId,
                    athleteId: event.athleteId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return results;
    }
}
