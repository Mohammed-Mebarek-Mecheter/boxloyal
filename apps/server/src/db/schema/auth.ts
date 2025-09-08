// db/schema/auth.ts - Production-ready enhanced version
import {
    pgTable,
    text,
    timestamp,
    boolean,
    json,
    index,
    check,
    integer
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// USER TABLE
export const user = pgTable("user", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull(),
    image: text("image"),
    metadata: json("metadata"),

    // Enhanced fields
    isActive: boolean("is_active").default(true).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    // Timestamps with defaults
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    emailIdx: index("user_email_idx").on(table.email),
    isActiveIdx: index("user_is_active_idx").on(table.isActive),
    createdAtIdx: index("user_created_at_idx").on(table.createdAt),
    lastLoginAtIdx: index("user_last_login_at_idx").on(table.lastLoginAt),
    activeVerifiedIdx: index("user_active_verified_idx").on(table.isActive, table.emailVerified),
}));

// SESSION TABLE
export const session = pgTable("session", {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),

    // Enhanced session tracking
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    deviceId: text("device_id"),

    // User reference
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),

    // Enhanced fields
    isActive: boolean("is_active").default(true).notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),

    // Timestamps with defaults
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    userIdIdx: index("session_user_id_idx").on(table.userId),
    expiresAtIdx: index("session_expires_at_idx").on(table.expiresAt),
    isActiveIdx: index("session_is_active_idx").on(table.isActive),
    deviceIdIdx: index("session_device_id_idx").on(table.deviceId),
    lastAccessedAtIdx: index("session_last_accessed_at_idx").on(table.lastAccessedAt),
    userActiveIdx: index("session_user_active_idx").on(table.userId, table.isActive),
    activeNotExpiredIdx: index("session_active_not_expired_idx").on(table.isActive, table.expiresAt),
}));

// ACCOUNT TABLE
export const account = pgTable("account", {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),

    // OAuth tokens
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),

    // Password for email/password auth (make sure to hash!)
    password: text("password"),

    // Enhanced fields
    isActive: boolean("is_active").default(true).notNull(),

    // Timestamps with defaults
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    accountIdIdx: index("account_account_id_idx").on(table.accountId),
    providerIdIdx: index("account_provider_id_idx").on(table.providerId),
    userIdIdx: index("account_user_id_idx").on(table.userId),
    isActiveIdx: index("account_is_active_idx").on(table.isActive),
    accessTokenExpiresAtIdx: index("account_access_token_expires_at_idx").on(table.accessTokenExpiresAt),
    refreshTokenExpiresAtIdx: index("account_refresh_token_expires_at_idx").on(table.refreshTokenExpiresAt),
    userProviderIdx: index("account_user_provider_idx").on(table.userId, table.providerId),
    providerAccountIdx: index("account_provider_account_idx").on(table.providerId, table.accountId),
}));

// VERIFICATION TABLE
export const verification = pgTable("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    // Enhanced fields
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    isUsed: boolean("is_used").default(false).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),

    // Timestamps with defaults
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    identifierIdx: index("verification_identifier_idx").on(table.identifier),
    valueIdx: index("verification_value_idx").on(table.value),
    expiresAtIdx: index("verification_expires_at_idx").on(table.expiresAt),
    isUsedIdx: index("verification_is_used_idx").on(table.isUsed),
    identifierNotUsedIdx: index("verification_identifier_not_used_idx").on(table.identifier, table.isUsed),
    valueNotExpiredIdx: index("verification_value_not_expired_idx").on(table.value, table.expiresAt, table.isUsed),
    // Constraints
    attemptsRange: check(
        "verification_attempts_range",
        sql`${table.attempts} >= 0 AND ${table.attempts} <= ${table.maxAttempts}`
    ),
    maxAttemptsPositive: check(
        "verification_max_attempts_positive",
        sql`${table.maxAttempts} > 0`
    ),
}));

// RELATIONS
export const userRelations = relations(user, ({ many }) => ({
    sessions: many(session, { relationName: "user_sessions" }),
    accounts: many(account, { relationName: "user_accounts" }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
    user: one(user, {
        fields: [session.userId],
        references: [user.id],
        relationName: "user_sessions"
    }),
}));

export const accountRelations = relations(account, ({ one }) => ({
    user: one(user, {
        fields: [account.userId],
        references: [user.id],
        relationName: "user_accounts"
    }),
}));
