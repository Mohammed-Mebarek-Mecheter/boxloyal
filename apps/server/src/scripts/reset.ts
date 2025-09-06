// scripts/reset.ts - Database reset script (development only)
import { db } from "@/db";
import { sql } from "drizzle-orm";
import {logger} from "@/lib/logger";

async function resetDatabase() {
    if (process.env.NODE_ENV === "production") {
        throw new Error("Cannot reset production database");
    }

    try {
        logger.info("Resetting database...");

        // Drop all tables in reverse dependency order
        await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
        await db.execute(sql`CREATE SCHEMA public`);

        logger.info("Database reset complete");
    } catch (error) {
        logger.error("Database reset failed", error as Error);
        throw error;
    }
}

if (require.main === module) {
    resetDatabase().then(() => process.exit(0)).catch(() => process.exit(1));
}

export { resetDatabase };
