// lib/permissions.ts
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { boxMemberships, boxes } from "@/db/schema";
import type { Context } from "./context";

// Platform-level roles (separate from tenant roles)
export const platformRoleEnum = ["user", "admin", "super_admin"] as const;
export type PlatformRole = (typeof platformRoleEnum)[number];

// Extend user schema to include platform role
// Add this to your user table in auth.ts:
// platformRole: text("platform_role").default("user").notNull(),

export async function requireAuth(ctx: Context) {
    if (!ctx.session?.user) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Authentication required",
        });
    }
    return ctx.session.user;
}

export async function requireBoxMembership(ctx: Context, boxId: string) {
    const user = await requireAuth(ctx);

    const membership = await db
        .select()
        .from(boxMemberships)
        .where(
            and(
                eq(boxMemberships.boxId, boxId),
                eq(boxMemberships.userId, user.id),
                eq(boxMemberships.isActive, true)
            )
        )
        .limit(1);

    if (!membership.length) {
        throw new TRPCError({
            code: "FORBIDDEN",
            message: "Box membership required",
        });
    }

    return membership[0];
}

export async function requireBoxRole(
    ctx: Context,
    boxId: string,
    allowedRoles: Array<"owner" | "head_coach" | "coach" | "athlete">
) {
    const membership = await requireBoxMembership(ctx, boxId);

    if (!allowedRoles.includes(membership.role as any)) {
        throw new TRPCError({
            code: "FORBIDDEN",
            message: `Insufficient permissions. Required: ${allowedRoles.join(" or ")}`,
        });
    }

    return membership;
}

export async function requireBoxOwner(ctx: Context, boxId: string) {
    if (!ctx.session?.user) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Must be logged in",
        });
    }

    // Check if user is owner of this box
    const membership = await db.query.boxMemberships.findFirst({
        where: and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.userId, ctx.session.user.id),
            eq(boxMemberships.role, "owner"),
            eq(boxMemberships.isActive, true)
        ),
        with: {
            box: true,
        }
    });

    if (!membership) {
        throw new TRPCError({
            code: "FORBIDDEN",
            message: "Must be box owner to access this resource",
        });
    }

    return membership;
}

export async function requireBoxAccess(ctx: Context, boxId: string, allowedRoles: string[] = ["owner", "head_coach", "coach", "athlete"]) {
    if (!ctx.session?.user) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Must be logged in",
        });
    }

    const membership = await db.query.boxMemberships.findFirst({
        where: and(
            eq(boxMemberships.boxId, boxId),
            eq(boxMemberships.userId, ctx.session.user.id),
            eq(boxMemberships.isActive, true)
        ),
        with: {
            box: true,
        }
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
        throw new TRPCError({
            code: "FORBIDDEN",
            message: "Insufficient permissions to access this resource",
        });
    }

    return membership;
}

export async function requireBoxCoach(ctx: Context, boxId: string) {
    return requireBoxAccess(ctx, boxId, ["owner", "head_coach", "coach"]);
}

export async function checkSubscriptionLimits(boxId: string) {
    const box = await db.query.boxes.findFirst({
        where: eq(boxes.id, boxId),
    });

    if (!box) {
        throw new TRPCError({
            code: "NOT_FOUND",
            message: "Box not found",
        });
    }

    // Check if subscription is active
    if (box.subscriptionStatus !== "active" && box.subscriptionStatus !== "trial") {
        throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: "Active subscription required",
        });
    }

    // Check if trial has expired
    if (box.subscriptionStatus === "trial" && box.trialEndsAt && box.trialEndsAt < new Date()) {
        throw new TRPCError({
            code: "PAYMENT_REQUIRED",
            message: "Trial period has expired. Please upgrade to continue.",
        });
    }

    return box;
}

export async function requireCoachOrAbove(ctx: Context, boxId: string) {
    return requireBoxRole(ctx, boxId, ["owner", "head_coach", "coach"]);
}

export async function requirePlatformAdmin(ctx: Context) {
    const user = await requireAuth(ctx);

    // You'll need to add platformRole to your user schema
    // For now, you could check against a hardcoded admin list
    const adminEmails = ["admin@boxloyal.com"]; // Move to env vars

    if (!adminEmails.includes(user.email)) {
        throw new TRPCError({
            code: "FORBIDDEN",
            message: "Platform admin access required",
        });
    }

    return user;
}

// Helper to get user's active memberships
export async function getUserBoxMemberships(ctx: Context) {
    const user = await requireAuth(ctx);

    return db
        .select({
            membership: boxMemberships,
            box: boxes,
        })
        .from(boxMemberships)
        .innerJoin(boxes, eq(boxMemberships.boxId, boxes.id))
        .where(
            and(
                eq(boxMemberships.userId, user.id),
                eq(boxMemberships.isActive, true)
            )
        );
}

// Check if user can manage another user in the same box
export async function canManageUser(
    ctx: Context,
    boxId: string,
    targetUserId: string
) {
    const requesterMembership = await requireBoxMembership(ctx, boxId);

    // Owners and head coaches can manage anyone
    if (["owner", "head_coach"].includes(requesterMembership.role)) {
        return true;
    }

    // Coaches can only manage athletes
    if (requesterMembership.role === "coach") {
        const targetMembership = await db
            .select()
            .from(boxMemberships)
            .where(
                and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.userId, targetUserId),
                    eq(boxMemberships.isActive, true)
                )
            )
            .limit(1);

        return targetMembership[0]?.role === "athlete";
    }

    // Athletes can only manage themselves
    return requesterMembership.userId === targetUserId;
}
