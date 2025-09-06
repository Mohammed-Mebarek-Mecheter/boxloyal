// lib/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import {AuthenticationError, BoxLoyalError, toTRPCError} from "./errors";
import {logger} from "@/lib/logger";
import {metrics} from "@/lib/monitoring";

export const t = initTRPC.context<Context>().create({
    errorFormatter({ shape, error }) {
        return {
            ...shape,
            data: {
                ...shape.data,
                // Add additional error context in development
                ...(process.env.NODE_ENV === "development" && {
                    stack: error.stack,
                }),
            },
        };
    },
});

// Enhanced middleware with logging and metrics
const loggingMiddleware = t.middleware(async ({ path, type, next, ctx }) => {
    const start = Date.now();
    const requestId = crypto.randomUUID();

    logger.info(`tRPC ${type} ${path} started`, {
        requestId,
        userId: ctx.session?.user?.id,
    });

    try {
        const result = await next();

        const duration = Date.now() - start;
        metrics.timing(`trpc.${path}`, duration, {
            type,
            status: "success",
        });

        logger.info(`tRPC ${type} ${path} completed`, {
            requestId,
            duration,
            userId: ctx.session?.user?.id,
        });

        return result;
    } catch (error) {
        const duration = Date.now() - start;
        metrics.timing(`trpc.${path}`, duration, {
            type,
            status: "error",
        });

        // Convert BoxLoyalError to TRPCError
        if (error instanceof BoxLoyalError) {
            const trpcError = toTRPCError(error);

            logger.error(`tRPC ${type} ${path} failed`, error, {
                requestId,
                duration,
                userId: ctx.session?.user?.id,
                errorCode: error.code,
            });

            throw trpcError;
        }

        logger.error(`tRPC ${type} ${path} failed`, error as Error, {
            requestId,
            duration,
            userId: ctx.session?.user?.id,
        });

        throw error;
    }
});

export const router = t.router;
export const publicProcedure = t.procedure.use(loggingMiddleware);
export const protectedProcedure = t.procedure
    .use(loggingMiddleware)
    .use(({ ctx, next }) => {
        if (!ctx.session) {
            throw new AuthenticationError();
        }
        return next({
            ctx: {
                ...ctx,
                session: ctx.session,
            },
        });
    });
