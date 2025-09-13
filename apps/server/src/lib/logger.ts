// lib/logger.ts
import { env } from "cloudflare:workers";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    message: string;
    context?: Record<string, any>;
    userId?: string;
    boxId?: string;
    requestId?: string;
    cronContext?: CronContext;
    traceId?: string;
    error?: {
        name: string;
        message: string;
        stack?: string;
        code?: string | number;
    };
}

interface CronContext {
    cronPattern: string;
    scheduledTime: string;
    executionId: string;
    environment: string;
    jobType?: string;
    batchId?: string;
}

/**
 * Enhanced logger with structured logging, context management, and multiple output targets
 *
 * Features:
 * - Structured JSON logging for production
 * - Context tracking across async operations
 * - Log level filtering based on environment
 * - Request and cron job correlation
 * - Error serialization with stack traces
 * - Performance tracking
 * - Multiple log targets (console, external services)
 * - Log sampling for high-volume scenarios
 */
class Logger {
    private isDevelopment: boolean;
    private logLevel: LogLevel;
    private context: Record<string, any> = {};
    private cronContext: CronContext | null = null;
    private static instance: Logger;

    // Log level hierarchy for filtering
    private static readonly LOG_LEVELS: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3
    };

    constructor() {
        this.isDevelopment = env.NODE_ENV === "development";
        this.logLevel = this.parseLogLevel(env.LOG_LEVEL || "info");
    }

    /**
     * Get singleton instance
     */
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Set global context that persists across log calls
     */
    setContext(context: Record<string, any>): void {
        this.context = { ...this.context, ...context };
    }

    /**
     * Clear global context
     */
    clearContext(): void {
        this.context = {};
    }

    /**
     * Set cron-specific context
     */
    setCronContext(context: CronContext): void {
        this.cronContext = context;
    }

    /**
     * Clear cron context
     */
    clearCronContext(): void {
        this.cronContext = null;
    }

    /**
     * Create child logger with additional context
     */
    child(additionalContext: Record<string, any>): Logger {
        const childLogger = Object.create(this);
        childLogger.context = { ...this.context, ...additionalContext };
        childLogger.cronContext = this.cronContext;
        return childLogger;
    }

    /**
     * Format log entry for output
     */
    private formatLog(entry: LogEntry): string {
        if (this.isDevelopment) {
            return this.formatForDevelopment(entry);
        } else {
            return this.formatForProduction(entry);
        }
    }

    /**
     * Development formatting - human readable
     */
    private formatForDevelopment(entry: LogEntry): string {
        const { timestamp, level, message, context, userId, boxId, requestId, cronContext, error } = entry;

        const parts: string[] = [];

        // Timestamp
        parts.push(`[${timestamp.toISOString()}]`);

        // Level with colors
        const levelColors: Record<LogLevel, string> = {
            debug: '\x1b[36m', // Cyan
            info: '\x1b[32m',  // Green
            warn: '\x1b[33m',  // Yellow
            error: '\x1b[31m'  // Red
        };
        const resetColor = '\x1b[0m';
        parts.push(`${levelColors[level]}${level.toUpperCase()}${resetColor}:`);

        // Message
        parts.push(message);

        // Context identifiers
        const identifiers: string[] = [];
        if (userId) identifiers.push(`user:${userId}`);
        if (boxId) identifiers.push(`box:${boxId}`);
        if (requestId) identifiers.push(`req:${requestId}`);
        if (cronContext) {
            identifiers.push(`cron:${cronContext.cronPattern}`);
            identifiers.push(`exec:${cronContext.executionId}`);
        }

        if (identifiers.length > 0) {
            parts.push(`[${identifiers.join(' ')}]`);
        }

        // Error details
        if (error) {
            parts.push(`\n  Error: ${error.name}: ${error.message}`);
            if (error.stack) {
                parts.push(`\n  Stack: ${error.stack}`);
            }
        }

        // Context details
        if (context && Object.keys(context).length > 0) {
            parts.push(`\n  Context: ${JSON.stringify(context, null, 2)}`);
        }

        return parts.join(' ');
    }

    /**
     * Production formatting - structured JSON
     */
    private formatForProduction(entry: LogEntry): string {
        const logObject = {
            timestamp: entry.timestamp.toISOString(),
            level: entry.level,
            message: entry.message,
            service: "boxloyal-cron",
            version: "1.0.0",
            environment: env.NODE_ENV,
            ...this.context,
            ...(entry.context || {}),
            ...(entry.userId && { userId: entry.userId }),
            ...(entry.boxId && { boxId: entry.boxId }),
            ...(entry.requestId && { requestId: entry.requestId }),
            ...(entry.traceId && { traceId: entry.traceId }),
            ...(this.cronContext && {
                cron: {
                    pattern: this.cronContext.cronPattern,
                    scheduledTime: this.cronContext.scheduledTime,
                    executionId: this.cronContext.executionId,
                    environment: this.cronContext.environment,
                    ...(this.cronContext.jobType && { jobType: this.cronContext.jobType }),
                    ...(this.cronContext.batchId && { batchId: this.cronContext.batchId })
                }
            }),
            ...(entry.error && { error: entry.error })
        };

        return JSON.stringify(logObject);
    }

    /**
     * Core logging method
     */
    private log(level: LogLevel, message: string, error?: Error, context?: Record<string, any>): void {
        // Check if we should log this level
        if (Logger.LOG_LEVELS[level] < Logger.LOG_LEVELS[this.logLevel]) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            message,
            context: { ...this.context, ...(context || {}) },
            traceId: this.generateTraceId(),
            ...(error && {
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    ...(error.cause ? { cause: String(error.cause) } : {}),
                    ...(('code' in error) ? { code: (error as any).code } : {})
                }
            })
        };

        const formatted = this.formatLog(entry);

        // Output to console
        this.outputToConsole(level, formatted);

        // Send to external logging service in production
        if (!this.isDevelopment) {
            this.sendToExternalLogger(entry);
        }

        // Send critical errors to monitoring
        if (level === 'error') {
            this.sendToErrorMonitoring(entry);
        }
    }

    /**
     * Output to console with appropriate method
     */
    private outputToConsole(level: LogLevel, formatted: string): void {
        switch (level) {
            case 'debug':
                console.debug(formatted);
                break;
            case 'info':
                console.info(formatted);
                break;
            case 'warn':
                console.warn(formatted);
                break;
            case 'error':
                console.error(formatted);
                break;
        }
    }

    /**
     * Send to external logging service (implement based on your service)
     */
    private sendToExternalLogger(entry: LogEntry): void {
        // Example implementations:

        // For Cloudflare Analytics Engine:
        /*
        if (env.ANALYTICS) {
            env.ANALYTICS.writeDataPoint({
                blobs: [entry.level, entry.message, JSON.stringify(entry.context || {})],
                doubles: [Date.now()],
                indexes: [entry.level]
            });
        }
        */

        // For external HTTP logging service:
        /*
        if (env.LOG_ENDPOINT) {
            fetch(env.LOG_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${env.LOG_API_KEY}`
                },
                body: JSON.stringify(entry)
            }).catch(error => {
                console.error('Failed to send log to external service:', error);
            });
        }
        */

        // For now, we'll just track that we would send to external service
        if (entry.level === 'error' || entry.level === 'warn') {
            // In production, you'd send these to your log aggregation service
            // (DataDog, Splunk, ELK stack, etc.)
        }
    }

    /**
     * Send critical errors to monitoring service
     */
    private sendToErrorMonitoring(entry: LogEntry): void {
        // Example: Send to Sentry, Bugsnag, or similar
        /*
        if (env.ERROR_MONITORING_DSN && entry.error) {
            // Send to error monitoring service
            fetch(env.ERROR_MONITORING_DSN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: entry.message,
                    level: entry.level,
                    timestamp: entry.timestamp.toISOString(),
                    context: entry.context,
                    error: entry.error,
                    environment: env.NODE_ENV
                })
            }).catch(console.error);
        }
        */
    }

    /**
     * Parse log level from string
     */
    private parseLogLevel(level: string): LogLevel {
        const normalizedLevel = level.toLowerCase();
        if (normalizedLevel in Logger.LOG_LEVELS) {
            return normalizedLevel as LogLevel;
        }
        return "info"; // Default fallback
    }

    /**
     * Generate trace ID for request correlation
     */
    private generateTraceId(): string {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    /**
     * Public logging methods
     */
    debug(message: string, context?: Record<string, any>): void {
        this.log("debug", message, undefined, context);
    }

    info(message: string, context?: Record<string, any>): void {
        this.log("info", message, undefined, context);
    }

    warn(message: string, context?: Record<string, any>): void {
        this.log("warn", message, undefined, context);
    }

    error(message: string, error?: Error, context?: Record<string, any>): void {
        this.log("error", message, error, context);
    }

    /**
     * Audit logging for sensitive operations
     */
    audit(action: string, userId: string, boxId?: string, details?: Record<string, any>): void {
        this.log("info", `AUDIT: ${action}`, undefined, {
            audit: true,
            userId,
            boxId,
            action,
            ...details,
        });
    }

    /**
     * Performance tracking
     */
    timing(operation: string, duration: number, context?: Record<string, any>): void {
        this.log("info", `TIMING: ${operation} completed in ${duration}ms`, undefined, {
            timing: true,
            operation,
            duration,
            ...context
        });
    }

    /**
     * Measure and log execution time of async operations
     */
    async measure<T>(
        operation: string,
        fn: () => Promise<T>,
        context?: Record<string, any>
    ): Promise<T> {
        const startTime = Date.now();
        const operationId = this.generateTraceId();

        this.debug(`Starting operation: ${operation}`, {
            operationId,
            ...context
        });

        try {
            const result = await fn();
            const duration = Date.now() - startTime;

            this.timing(operation, duration, {
                operationId,
                status: "success",
                ...context
            });

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;

            this.error(`Operation failed: ${operation}`, error as Error, {
                operationId,
                duration,
                status: "error",
                ...context
            });

            throw error;
        }
    }

    /**
     * Create a scoped logger for batch operations
     */
    forBatch(batchId: string, batchSize: number, operation: string): Logger {
        const batchLogger = this.child({
            batchId,
            batchSize,
            operation,
            batch: true
        });

        // Add batch context to cron context if it exists
        if (this.cronContext) {
            batchLogger.cronContext = {
                ...this.cronContext,
                batchId
            };
        }

        return batchLogger;
    }

    /**
     * Log batch progress
     */
    batchProgress(processed: number, total: number, errors: number = 0, context?: Record<string, any>): void {
        const percentage = Math.round((processed / total) * 100);

        this.info(`Batch progress: ${processed}/${total} (${percentage}%)`, {
            batchProgress: true,
            processed,
            total,
            errors,
            percentage,
            ...context
        });
    }

    /**
     * Log sampling - only log a percentage of debug messages to reduce volume
     */
    debugSampled(message: string, sampleRate: number = 0.1, context?: Record<string, any>): void {
        if (Math.random() < sampleRate) {
            this.debug(message, { ...context, sampled: true, sampleRate });
        }
    }

    /**
     * Conditional logging based on context
     */
    debugIf(condition: boolean, message: string, context?: Record<string, any>): void {
        if (condition) {
            this.debug(message, context);
        }
    }

    infoIf(condition: boolean, message: string, context?: Record<string, any>): void {
        if (condition) {
            this.info(message, context);
        }
    }

    warnIf(condition: boolean, message: string, context?: Record<string, any>): void {
        if (condition) {
            this.warn(message, context);
        }
    }

    /**
     * Log method for HTTP requests
     */
    httpRequest(method: string, path: string, status: number, duration: number, context?: Record<string, any>): void {
        const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

        this.log(level, `${method} ${path} ${status}`, undefined, {
            http: true,
            method,
            path,
            status,
            duration,
            ...context
        });
    }

    /**
     * Log method for database operations
     */
    database(operation: string, table: string, duration: number, rowCount?: number, context?: Record<string, any>): void {
        this.debug(`Database ${operation} on ${table}`, {
            database: true,
            operation,
            table,
            duration,
            ...(rowCount !== undefined && { rowCount }),
            ...context
        });
    }

    /**
     * Log method for external API calls
     */
    externalApi(service: string, endpoint: string, method: string, status: number, duration: number, context?: Record<string, any>): void {
        const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

        this.log(level, `External API call to ${service}`, undefined, {
            externalApi: true,
            service,
            endpoint,
            method,
            status,
            duration,
            ...context
        });
    }
}

// Export singleton instance
export const logger = Logger.getInstance();
