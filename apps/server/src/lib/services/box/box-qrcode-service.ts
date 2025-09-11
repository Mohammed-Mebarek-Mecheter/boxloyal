// lib/services/box/box-qrcode-service.ts
import {db} from "@/db";
import {boxQrCodes} from "@/db/schema";
import {and, desc, eq} from "drizzle-orm";
import {TRPCError} from "@trpc/server";

export class BoxQrCodeService {
    /**
     * Create QR code for easy signup
     */
    static async createQrCode(params: {
        boxId: string;
        name: string;
        createdByUserId: string;
    }) {
        const { boxId, name, createdByUserId } = params;

        const publicId = crypto.randomUUID();
        const code = crypto.randomUUID().slice(0, 8).toUpperCase();

        const [qrCode] = await db
            .insert(boxQrCodes)
            .values({
                boxId,
                name,
                code,
                publicId,
                isActive: true,
                createdByUserId,
            })
            .returning();

        return qrCode;
    }

    /**
     * Get QR codes for a box
     */
    static async getQrCodes(boxId: string, activeOnly: boolean = true) {
        const conditions = [eq(boxQrCodes.boxId, boxId)];

        if (activeOnly) {
            conditions.push(eq(boxQrCodes.isActive, true));
        }

        return db
            .select()
            .from(boxQrCodes)
            .where(and(...conditions))
            .orderBy(desc(boxQrCodes.createdAt));
    }

    /**
     * Deactivate a QR code
     */
    static async deactivateQrCode(boxId: string, qrCodeId: string) {
        const [updated] = await db
            .update(boxQrCodes)
            .set({
                isActive: false,
                updatedAt: new Date(),
            })
            .where(and(
                eq(boxQrCodes.id, qrCodeId),
                eq(boxQrCodes.boxId, boxId)
            ))
            .returning();

        if (!updated) {
            throw new TRPCError({ code: "NOT_FOUND", message: "QR code not found" });
        }

        return updated;
    }
}
