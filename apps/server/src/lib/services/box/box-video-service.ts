// lib/services/box/box-video-service.ts
import {athletePrs, boxMemberships, videoConsents, videoSocialShares} from "@/db/schema";
import {db} from "@/db";
import {and, desc, eq, gte, sql} from "drizzle-orm";

export class BoxVideoService {
    /**
     * Get video celebration candidates for social sharing
     */
    static async getVideoCelebrationCandidates(
        boxId: string,
        days: number = 7
    ) {
        const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const candidates = await db
            .select({
                pr: athletePrs,
                athlete: {
                    displayName: boxMemberships.displayName,
                    publicId: boxMemberships.publicId
                }
            })
            .from(athletePrs)
            .innerJoin(boxMemberships, eq(athletePrs.membershipId, boxMemberships.id))
            .innerJoin(videoConsents, and(
                eq(videoConsents.prId, athletePrs.id),
                sql`'box_visibility' = ANY(${videoConsents.consentTypes})`,
                sql`${videoConsents.revokedAt} IS NULL`
            ))
            .leftJoin(videoSocialShares, eq(videoSocialShares.prId, athletePrs.id))
            .where(and(
                eq(athletePrs.boxId, boxId),
                sql`${athletePrs.gumletAssetId} IS NOT NULL`,
                eq(athletePrs.videoProcessingStatus, 'ready'),
                gte(athletePrs.achievedAt, dateFrom),
                sql`${videoSocialShares.id} IS NULL` // Not already shared
            ))
            .orderBy(desc(athletePrs.achievedAt))
            .limit(10);

        return candidates.map(({ pr, athlete }) => ({
            prId: pr.id,
            athleteName: athlete.displayName || 'Athlete',
            athletePublicId: athlete.publicId,
            achievement: `${pr.value}${pr.unit}${pr.reps ? ` for ${pr.reps} reps` : ''}`,
            videoReady: true,
            thumbnailUrl: pr.thumbnailUrl,
            celebrationScore: this.calculateCelebrationScore(pr),
            achievedAt: pr.achievedAt
        }));
    }

    /**
     * Calculate celebration score for prioritizing social shares
     */
    private static calculateCelebrationScore(pr: typeof athletePrs.$inferSelect): number {
        let score = 50; // Base score

        // Higher scores for milestone weights
        if (pr.unit === 'lbs' || pr.unit === 'kg') {
            const weight = parseFloat(pr.value);
            const milestones = pr.unit === 'lbs' ? [135, 185, 225, 275, 315, 405] : [60, 85, 100, 125, 140, 185];
            if (milestones.some(m => Math.abs(weight - m) < (pr.unit === 'lbs' ? 5 : 2.5))) {
                score += 30;
            }
        }

        // Recent achievements get higher priority
        const daysOld = Math.floor((Date.now() - pr.achievedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOld <= 1) score += 20;
        else if (daysOld <= 3) score += 10;

        // PRs with notes show more engagement
        if (pr.notes && pr.notes.length > 10) score += 10;

        return score;
    }
}
