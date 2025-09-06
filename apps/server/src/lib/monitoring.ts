// lib/monitoring.ts
import {logger} from "@/lib/logger";

interface MetricPoint {
    name: string;
    value: number;
    tags?: Record<string, string>;
    timestamp?: Date;
}

class MetricsCollector {
    private metrics: MetricPoint[] = [];

    increment(name: string, tags?: Record<string, string>) {
        this.record(name, 1, tags);
    }

    record(name: string, value: number, tags?: Record<string, string>) {
        this.metrics.push({
            name,
            value,
            tags,
            timestamp: new Date(),
        });

        // In production, you'd send to monitoring service (DataDog, etc.)
        if (process.env.NODE_ENV === "development") {
            logger.debug(`METRIC: ${name}=${value}`, { tags });
        }
    }

    timing(name: string, duration: number, tags?: Record<string, string>) {
        this.record(`${name}.duration`, duration, tags);
    }

    // Helper for measuring function execution time
    async measure<T>(
        name: string,
        fn: () => Promise<T>,
        tags?: Record<string, string>
    ): Promise<T> {
        const start = Date.now();
        try {
            const result = await fn();
            this.timing(name, Date.now() - start, { ...tags, status: "success" });
            return result;
        } catch (error) {
            this.timing(name, Date.now() - start, { ...tags, status: "error" });
            throw error;
        }
    }
}

export const metrics = new MetricsCollector();
