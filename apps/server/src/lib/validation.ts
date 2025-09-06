// lib/validation.ts - Centralized validation schemas
import { z } from "zod";

// Common validation patterns
export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().email();
export const slugSchema = z.string().regex(/^[a-z0-9-]+$/, "Invalid slug format");

// Box-related schemas
export const createBoxSchema = z.object({
    name: z.string().min(1).max(100),
    slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/),
    email: emailSchema,
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    website: z.string().url().optional().or(z.literal("")),
    description: z.string().max(500).optional(),
});

export const updateBoxSchema = createBoxSchema.partial().extend({
    boxId: uuidSchema,
});

// Athlete-related schemas
export const prLogSchema = z.object({
    boxId: uuidSchema,
    athleteId: uuidSchema.optional(),
    movementId: uuidSchema,
    value: z.number().positive(),
    unit: z.string().min(1).max(20),
    reps: z.number().int().min(1).max(1000).optional(),
    notes: z.string().max(500).optional(),
    achievedAt: z.coerce.date().optional(),
});

export const wellnessCheckinSchema = z.object({
    boxId: uuidSchema,
    energyLevel: z.number().int().min(1).max(10),
    sleepQuality: z.number().int().min(1).max(10),
    stressLevel: z.number().int().min(1).max(10),
    motivationLevel: z.number().int().min(1).max(10),
    workoutReadiness: z.number().int().min(1).max(10),
    soreness: z.record(z.string(), z.number().int().min(0).max(10)).optional(),
    hydrationLevel: z.number().int().min(1).max(10).optional(),
    nutritionQuality: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(1000).optional(),
});

// Invite schemas
export const inviteMemberSchema = z.object({
    boxId: uuidSchema,
    email: emailSchema,
    role: z.enum(["head_coach", "coach", "athlete"]),
});

// Analytics schemas
export const analyticsFilterSchema = z.object({
    boxId: uuidSchema,
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    athleteIds: z.array(uuidSchema).optional(),
});

// File upload schemas (for future video uploads)
export const videoUploadSchema = z.object({
    boxId: uuidSchema,
    prId: uuidSchema.optional(),
    visibility: z.enum(["private", "box", "public"]).default("private"),
    consentForPublicUse: z.boolean().default(false),
});
