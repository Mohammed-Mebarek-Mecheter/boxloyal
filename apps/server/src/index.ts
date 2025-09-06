// src/index.ts
import { env } from "cloudflare:workers";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "./lib/context";
import { appRouter } from "@/routers";
import { auth } from "./lib/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { timing } from "hono/timing";
import { secureHeaders } from "hono/secure-headers";
import {logger} from "@/lib/logger";

const app = new Hono();

// Security and logging middleware
app.use(timing());
app.use(secureHeaders());

// CORS configuration
app.use(
    "/*",
    cors({
        origin: env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: [
            "Content-Type",
            "Authorization",
            "X-Requested-With",
            "X-Request-ID"
        ],
        credentials: true,
        maxAge: 86400, // 24 hours
    }),
);

// Health check endpoint
app.get("/health", (c) => {
    return c.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: env.APP_VERSION || "development",
    });
});

// Authentication routes
app.on(["POST", "GET"], "/api/auth/**", (c) => {
    logger.info("Auth request", {
        method: c.req.method,
        path: c.req.path
    });
    return auth.handler(c.req.raw);
});

// tRPC server
app.use(
    "/trpc/*",
    trpcServer({
        router: appRouter,
        createContext: (_opts, context) => {
            return createContext({ context });
        },
        onError: ({ error, path, type, ctx }) => {
            logger.error(`tRPC error on ${type} ${path}`, error, {
                userId: ctx.session?.user?.id,
            });
        },
    }),
);

// API status endpoint
app.get("/api", (c) => {
    return c.json({
        message: "BoxLoyal API",
        version: env.APP_VERSION || "development",
        environment: env.NODE_ENV || "development",
    });
});

// Catch-all for unmatched routes
app.notFound((c) => {
    logger.warn("Route not found", {
        path: c.req.path,
        method: c.req.method
    });
    return c.json({ error: "Not found" }, 404);
});

// Global error handler
app.onError((err, c) => {
    logger.error("Unhandled error", err, {
        path: c.req.path,
        method: c.req.method
    });
    return c.json({ error: "Internal server error" }, 500);
});

export default app;
