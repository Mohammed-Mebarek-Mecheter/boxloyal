// lib/services/athlete-badge-service.ts
import {athleteBadges} from "@/db/schema";
import {and, desc, eq} from "drizzle-orm";
import {db} from "@/db";

export class AthleteBadgeService {
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
}
