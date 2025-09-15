import { Cron } from 'cron';
import { db } from '@/db';
import { BoxAnalyticsService } from '@/lib/services/analytics/box-analytics-service';
import { RetentionAnalyticsService } from '@/lib/services/analytics/retention-analytics-service';
import { RiskAnalyticsService } from '@/lib/services/analytics/risk-analytics-service';

// Daily analytics aggregation (runs at 2 AM UTC)
const dailyCron = new Cron('0 2 * * *', async () => {
    console.log('Running daily analytics aggregation...');

    try {
        // Get all active boxes
        const boxes = await db.select().from(boxes).where(eq(boxes.status, 'active'));

        for (const box of boxes) {
            // Update box analytics
            await BoxAnalyticsService.aggregateDailyMetrics(box.id);

            // Update risk scores
            await RiskAnalyticsService.calculateAllRiskScores(box.id);
        }

        console.log('Daily analytics completed successfully');
    } catch (error) {
        console.error('Error in daily analytics cron:', error);
    }
});

// Weekly retention analysis (runs Sunday at 3 AM UTC)
const weeklyCron = new Cron('0 3 * * 0', async () => {
    console.log('Running weekly retention analysis...');

    try {
        const boxes = await db.select().from(boxes).where(eq(boxes.status, 'active'));

        for (const box of boxes) {
            await RetentionAnalyticsService.calculateWeeklyRetention(box.id);
            await BoxAnalyticsService.aggregateWeeklyMetrics(box.id);
        }

        console.log('Weekly retention analysis completed');
    } catch (error) {
        console.error('Error in weekly retention cron:', error);
    }
});

// Monthly cohort analysis (runs 1st of month at 4 AM UTC)
const monthlyCron = new Cron('0 4 1 * *', async () => {
    console.log('Running monthly cohort analysis...');

    try {
        const boxes = await db.select().from(boxes).where(eq(boxes.status, 'active'));

        for (const box of boxes) {
            await RetentionAnalyticsService.calculateMonthlyCohorts(box.id);
            await BoxAnalyticsService.aggregateMonthlyMetrics(box.id);
        }

        console.log('Monthly cohort analysis completed');
    } catch (error) {
        console.error('Error in monthly cohort cron:', error);
    }
});

// Start all cron jobs
export function startAnalyticsCronJobs() {
    dailyCron.start();
    weeklyCron.start();
    monthlyCron.start();
    console.log('Analytics cron jobs started');
}
