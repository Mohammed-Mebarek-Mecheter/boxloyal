// lib/context.ts
import type { Context as HonoContext } from "hono";
import { auth } from "./auth";
import { db } from "@/db";
import { boxMemberships, boxes } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export type CreateContextOptions = {
    context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
    const session = await auth.api.getSession({
        headers: context.req.raw.headers,
    });

    // Preload user's box memberships for faster access
    let userBoxes: Array<{ membership: any; box: any }> = [];

    if (session?.user) {
        userBoxes = await db
            .select({
                membership: boxMemberships,
                box: boxes,
            })
            .from(boxMemberships)
            .innerJoin(boxes, eq(boxMemberships.boxId, boxes.id))
            .where(
                and(
                    eq(boxMemberships.userId, session.user.id),
                    eq(boxMemberships.isActive, true)
                )
            );
    }

    return {
        session,
        userBoxes,
    };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
