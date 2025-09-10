// lib/services/athlete-pr-service.ts
import { db } from "@/db";
import { athletePrs, movements, videoConsents, videoProcessingEvents } from "@/db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { GumletService } from "../gumlet-service";
import type { VideoUploadData } from "./athlete-service";

export class AthletePRService {
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
}
