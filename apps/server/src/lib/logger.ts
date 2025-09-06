// lib/logger.ts
import {env} from "cloudflare:workers";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    message: string;
    context?: Record<string, any>;
    userId?: string;
    boxId?: string;
    requestId?: string;
}

class Logger {
    private isDevelopment = env.NODE_ENV === "development";

    private formatLog(entry: LogEntry): string {
        const { timestamp, level, message, context, userId, boxId, requestId } = entry;

        const contextStr = context ? JSON.stringify(context) : "";
        const userStr = userId ? `user:${userId}` : "";
        const boxStr = boxId ? `box:${boxId}` : "";
        const reqStr = requestId ? `req:${requestId}` : "";

        const metadata = [userStr, boxStr, reqStr].filter(Boolean).join(" ");

        return `[${timestamp.toISOString()}] ${level.toUpperCase()}: ${message} ${metadata} ${contextStr}`.trim();
    }

    private log(level: LogLevel, message: string, context?: Record<string, any>) {
        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            message,
            context,
        };

        const formatted = this.formatLog(entry);

        if (this.isDevelopment) {
            console[level === "debug" ? "log" : level](formatted);
        } else {
            // In production, you'd send to external logging service
            console.log(formatted);
        }
    }

    debug(message: string, context?: Record<string, any>) {
        this.log("debug", message, context);
    }

    info(message: string, context?: Record<string, any>) {
        this.log("info", message, context);
    }

    warn(message: string, context?: Record<string, any>) {
        this.log("warn", message, context);
    }

    error(message: string, error?: Error, context?: Record<string, any>) {
        this.log("error", message, {
            ...context,
            error: error?.message,
            stack: error?.stack,
        });
    }

    // Audit logging for sensitive operations
    audit(action: string, userId: string, boxId?: string, details?: Record<string, any>) {
        this.log("info", `AUDIT: ${action}`, {
            audit: true,
            userId,
            boxId,
            ...details,
        });
    }
}

export const logger = new Logger();
