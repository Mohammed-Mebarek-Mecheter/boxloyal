// lib/services/analytics/wellness-analytics-service.ts
import { db } from "@/db";
import {
    athleteWellnessCheckins,
    boxMemberships
} from "@/db/schema";
import {
    vwWellnessPerformanceCorrelation,
    mvWellnessTrends
} from "@/db/schema/views";
import { eq, desc, and, gte, count, avg, sql } from "drizzle-orm";

export interface WellnessTrend {
    boxId: string;
    membershipId: string;
    weekStart: Date;
    avgEnergy: number;
    avgSleep: number;
    avgStress: number;
    avgMotivation: number;
    avgReadiness: number;
    checkinCount: number;
}

export interface WellnessCorrelation {
    energyCorrelation: number;
    sleepCorrelation: number;
    stressCorrelation: number;
    sampleSize: number;
    period: {
        days: number;
        start: Date;
        end: Date;
    };
}

export interface WellnessInsights {
    summary: {
        totalCheckins: number;
        uniqueAthletes: number;
        avgEnergyLevel: number;
        avgStressLevel: number;
        avgWorkoutReadiness: number;
        checkinRate: number;
    };
    trends: {
        energyTrend: 'improving' | 'stable' | 'declining';
        stressTrend: 'improving' | 'stable' | 'declining';
        readinessTrend: 'improving' | 'stable' | 'declining';
    };
    alerts: Array<{
        type: string;
        severity: 'low' | 'medium' | 'high';
        message: string;
        affectedAthletes: number;
    }>;
    period: {
        days: number;
        start: Date;
        end: Date;
    };
}

export interface WellnessAlert {
    membershipId: string;
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
    value?: number;
    recommendation?: string;
}

export class WellnessAnalyticsService {
    /**
     * Get wellness trends over time - Using mv_wellness_trends
     */
    static async getWellnessTrends(
        boxId: string,
        membershipId?: string,
        weeks: number = 12
    ): Promise<WellnessTrend[]> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (weeks * 7));

        const conditions = [
            eq(mvWellnessTrends.boxId, boxId),
            gte(mvWellnessTrends.weekStart, startDate)
        ];

        if (membershipId) {
            conditions.push(eq(mvWellnessTrends.membershipId, membershipId));
        }

        const wellnessData = await db
            .select()
            .from(mvWellnessTrends)
            .where(and(...conditions))
            .orderBy(desc(mvWellnessTrends.weekStart));

        // Transform the data to ensure no null values
        return wellnessData.map(item => ({
            boxId: item.boxId || boxId,
            membershipId: item.membershipId || membershipId || '',
            weekStart: item.weekStart || new Date(),
            avgEnergy: item.avgEnergy ? parseFloat(item.avgEnergy.toString()) : 0,
            avgSleep: item.avgSleep ? parseFloat(item.avgSleep.toString()) : 0,
            avgStress: item.avgStress ? parseFloat(item.avgStress.toString()) : 0,
            avgMotivation: item.avgMotivation ? parseFloat(item.avgMotivation.toString()) : 0,
            avgReadiness: item.avgReadiness ? parseFloat(item.avgReadiness.toString()) : 0,
            checkinCount: item.totalCheckins || 0
        }));
    }

    /**
     * Get correlation between wellness and performance - Using vw_wellness_performance_correlation
     */
    static async getWellnessPerformanceCorrelation(
        boxId: string,
        days: number = 30
    ): Promise<WellnessCorrelation> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const correlationData = await db
            .select()
            .from(vwWellnessPerformanceCorrelation)
            .where(eq(vwWellnessPerformanceCorrelation.boxId, boxId));

        // Handle potential null values
        const energyCorrelation = correlationData[0]?.energyPrCorrelation ?
            parseFloat(correlationData[0].energyPrCorrelation.toString()) : 0;
        const sleepCorrelation = correlationData[0]?.sleepPrCorrelation ?
            parseFloat(correlationData[0].sleepPrCorrelation.toString()) : 0;
        const stressCorrelation = correlationData[0]?.stressPrCorrelation ?
            parseFloat(correlationData[0].stressPrCorrelation.toString()) : 0;
        const dataPoints = correlationData[0]?.dataPoints || 0;

        return {
            energyCorrelation,
            sleepCorrelation,
            stressCorrelation,
            sampleSize: dataPoints,
            period: {
                days,
                start: startDate,
                end: new Date(),
            }
        };
    }

    /**
     * Get comprehensive wellness insights for a box
     */
    static async getWellnessInsights(
        boxId: string,
        days: number = 30
    ): Promise<WellnessInsights> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [currentPeriodData, previousPeriodData, totalAthletes, lowEnergyAthletes, highStressAthletes] = await Promise.all([
            // Current period wellness data
            db.select({
                totalCheckins: count(),
                uniqueAthletes: sql<number>`COUNT(DISTINCT ${athleteWellnessCheckins.membershipId})`,
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
            })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),
            // Previous period for trend analysis
            db.select({
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
            })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    sql`${athleteWellnessCheckins.checkinDate} >= ${sql`${startDate}::timestamp - INTERVAL '${days} days'`}`,
                    sql`${athleteWellnessCheckins.checkinDate} < ${startDate}`
                )),
            // Total active athletes for checkin rate calculation
            db.select({ count: count() })
                .from(boxMemberships)
                .where(and(
                    eq(boxMemberships.boxId, boxId),
                    eq(boxMemberships.isActive, true),
                    eq(boxMemberships.role, 'athlete')
                )),
            // Low energy athletes (< 5)
            db.select({
                count: sql<number>`COUNT(DISTINCT ${athleteWellnessCheckins.membershipId})`
            })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate),
                    sql`${athleteWellnessCheckins.energyLevel} < 5`
                )),
            // High stress athletes (> 7)
            db.select({
                count: sql<number>`COUNT(DISTINCT ${athleteWellnessCheckins.membershipId})`
            })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    gte(athleteWellnessCheckins.checkinDate, startDate),
                    sql`${athleteWellnessCheckins.stressLevel} > 7`
                ))
        ]);

        const current = currentPeriodData[0];
        const previous = previousPeriodData[0];

        // Calculate trends
        const energyTrend = this.calculateTrend(
            Number(current?.avgEnergy || 0),
            Number(previous?.avgEnergy || 0)
        );
        const stressTrend = this.calculateTrend(
            Number(previous?.avgStress || 0), // Inverted for stress (lower is better)
            Number(current?.avgStress || 0)
        );
        const readinessTrend = this.calculateTrend(
            Number(current?.avgReadiness || 0),
            Number(previous?.avgReadiness || 0)
        );

        // Generate alerts
        const alerts: Array<{
            type: string;
            severity: 'low' | 'medium' | 'high';
            message: string;
            affectedAthletes: number;
        }> = [];

        const lowEnergyCount = lowEnergyAthletes[0]?.count || 0;
        const highStressCount = highStressAthletes[0]?.count || 0;
        const totalActiveAthletes = totalAthletes[0]?.count || 1;

        if (lowEnergyCount > totalActiveAthletes * 0.3) {
            alerts.push({
                type: 'low_energy',
                severity: 'high',
                message: `${lowEnergyCount} athletes reporting low energy levels`,
                affectedAthletes: lowEnergyCount
            });
        }
        if (highStressCount > totalActiveAthletes * 0.25) {
            alerts.push({
                type: 'high_stress',
                severity: 'medium',
                message: `${highStressCount} athletes reporting high stress levels`,
                affectedAthletes: highStressCount
            });
        }

        const checkinRate = totalActiveAthletes > 0
            ? Math.round((current?.totalCheckins || 0) / (totalActiveAthletes * days) * 100)
            : 0;

        if (checkinRate < 30) {
            alerts.push({
                type: 'low_checkin_rate',
                severity: checkinRate < 15 ? 'high' : 'medium',
                message: `Low wellness check-in rate: ${checkinRate}%`,
                affectedAthletes: totalActiveAthletes - (current?.uniqueAthletes || 0)
            });
        }

        return {
            summary: {
                totalCheckins: current?.totalCheckins || 0,
                uniqueAthletes: current?.uniqueAthletes || 0,
                avgEnergyLevel: Math.round(Number(current?.avgEnergy || 0) * 10) / 10,
                avgStressLevel: Math.round(Number(current?.avgStress || 0) * 10) / 10,
                avgWorkoutReadiness: Math.round(Number(current?.avgReadiness || 0) * 10) / 10,
                checkinRate
            },
            trends: {
                energyTrend,
                stressTrend,
                readinessTrend
            },
            alerts,
            period: {
                days,
                start: startDate,
                end: new Date()
            }
        };
    }

    /**
     * Get athlete wellness summary
     */
    static async getAthleteWellnessSummary(
        boxId: string,
        membershipId: string,
        days: number = 30
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const [currentData, previousData, recentCheckins] = await Promise.all([
            // Current period data
            db.select({
                checkinCount: count(),
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgSleep: avg(athleteWellnessCheckins.sleepQuality),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgMotivation: avg(athleteWellnessCheckins.motivationLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
            })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                )),
            // Previous period for comparison
            db.select({
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness)
            })
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    sql`${athleteWellnessCheckins.checkinDate} >= ${sql`${startDate}::timestamp - INTERVAL '${days} days'`}`,
                    sql`${athleteWellnessCheckins.checkinDate} < ${startDate}`
                )),
            // Recent checkins for trend analysis
            db.select()
                .from(athleteWellnessCheckins)
                .where(and(
                    eq(athleteWellnessCheckins.boxId, boxId),
                    eq(athleteWellnessCheckins.membershipId, membershipId),
                    gte(athleteWellnessCheckins.checkinDate, startDate)
                ))
                .orderBy(desc(athleteWellnessCheckins.checkinDate))
                .limit(10)
        ]);

        const current = currentData[0];
        const previous = previousData[0];

        return {
            summary: {
                checkinCount: current?.checkinCount || 0,
                checkinFrequency: Math.round((current?.checkinCount || 0) / days * 100) / 100,
                avgEnergy: Math.round(Number(current?.avgEnergy || 0) * 10) / 10,
                avgSleep: Math.round(Number(current?.avgSleep || 0) * 10) / 10,
                avgStress: Math.round(Number(current?.avgStress || 0) * 10) / 10,
                avgMotivation: Math.round(Number(current?.avgMotivation || 0) * 10) / 10,
                avgReadiness: Math.round(Number(current?.avgReadiness || 0) * 10) / 10
            },
            trends: {
                energyTrend: this.calculateTrend(
                    Number(current?.avgEnergy || 0),
                    Number(previous?.avgEnergy || 0)
                ),
                stressTrend: this.calculateTrend(
                    Number(previous?.avgStress || 0), // Inverted for stress
                    Number(current?.avgStress || 0)
                ),
                readinessTrend: this.calculateTrend(
                    Number(current?.avgReadiness || 0),
                    Number(previous?.avgReadiness || 0)
                )
            },
            recentCheckins: recentCheckins.map(checkin => ({
                date: checkin.checkinDate,
                energy: checkin.energyLevel,
                sleep: checkin.sleepQuality,
                stress: checkin.stressLevel,
                motivation: checkin.motivationLevel,
                readiness: checkin.workoutReadiness
            })),
            period: {
                days,
                start: startDate,
                end: new Date()
            }
        };
    }

    /**
     * Get wellness patterns and insights
     */
    static async getWellnessPatterns(
        boxId: string,
        membershipId?: string,
        days: number = 90
    ) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const conditions = [
            eq(athleteWellnessCheckins.boxId, boxId),
            gte(athleteWellnessCheckins.checkinDate, startDate)
        ];

        if (membershipId) {
            conditions.push(eq(athleteWellnessCheckins.membershipId, membershipId));
        }

        // Get daily patterns
        const dailyPatterns = await db
            .select({
                dayOfWeek: sql<number>`EXTRACT(DOW FROM ${athleteWellnessCheckins.checkinDate})`,
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness),
                checkinCount: count()
            })
            .from(athleteWellnessCheckins)
            .where(and(...conditions))
            .groupBy(sql`EXTRACT(DOW FROM ${athleteWellnessCheckins.checkinDate})`);

        // Get hourly patterns (if timestamp includes time)
        const hourlyPatterns = await db
            .select({
                hour: sql<number>`EXTRACT(HOUR FROM ${athleteWellnessCheckins.checkinDate})`,
                checkinCount: count()
            })
            .from(athleteWellnessCheckins)
            .where(and(...conditions))
            .groupBy(sql`EXTRACT(HOUR FROM ${athleteWellnessCheckins.checkinDate})`)
            .orderBy(sql`EXTRACT(HOUR FROM ${athleteWellnessCheckins.checkinDate})`);

        return {
            dailyPatterns: dailyPatterns.map(pattern => ({
                dayOfWeek: pattern.dayOfWeek,
                dayName: this.getDayName(pattern.dayOfWeek),
                avgEnergy: Math.round(Number(pattern.avgEnergy || 0) * 10) / 10,
                avgStress: Math.round(Number(pattern.avgStress || 0) * 10) / 10,
                avgReadiness: Math.round(Number(pattern.avgReadiness || 0) * 10) / 10,
                checkinCount: pattern.checkinCount
            })),
            hourlyPatterns: hourlyPatterns.map(pattern => ({
                hour: pattern.hour,
                checkinCount: pattern.checkinCount
            })),
            insights: this.generateWellnessInsights(dailyPatterns),
            period: { days, start: startDate, end: new Date() }
        };
    }

    /**
     * Calculate trend direction
     */
    private static calculateTrend(current: number, previous: number): 'improving' | 'stable' | 'declining' {
        if (previous === 0) return 'stable';
        const change = ((current - previous) / previous) * 100;
        if (change > 5) return 'improving';
        if (change < -5) return 'declining';
        return 'stable';
    }

    /**
     * Get day name from day of week number
     */
    private static getDayName(dayOfWeek: number): string {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[dayOfWeek] || 'Unknown';
    }

    /**
     * Generate wellness insights from patterns
     */
    private static generateWellnessInsights(dailyPatterns: Array<{ dayOfWeek: number; avgEnergy: string | null; avgStress: string | null; avgReadiness: string | null }>): string[] {
        const insights: string[] = [];

        // Find best and worst days for energy
        const energyByDay = dailyPatterns
            .filter(p => p.avgEnergy !== null)
            .map(p => ({ day: p.dayOfWeek, energy: Number(p.avgEnergy) }))
            .sort((a, b) => b.energy - a.energy);

        if (energyByDay.length > 0) {
            const bestDay = this.getDayName(energyByDay[0].day);
            const worstDay = this.getDayName(energyByDay[energyByDay.length - 1].day);
            insights.push(`Highest energy levels typically on ${bestDay}, lowest on ${worstDay}`);
        }

        // Find stress patterns
        const stressByDay = dailyPatterns
            .filter(p => p.avgStress !== null)
            .map(p => ({ day: p.dayOfWeek, stress: Number(p.avgStress) }))
            .sort((a, b) => a.stress - b.stress);

        if (stressByDay.length > 0) {
            const leastStressDay = this.getDayName(stressByDay[0].day);
            const mostStressDay = this.getDayName(stressByDay[stressByDay.length - 1].day);
            insights.push(`Lowest stress typically on ${leastStressDay}, highest on ${mostStressDay}`);
        }

        return insights;
    }

    /**
     * Calculate simple Pearson correlation coefficient
     */
    private static calculateSimpleCorrelation(x: number[], y: number[]): number {
        if (x.length !== y.length || x.length === 0) return 0;

        const xMean = x.reduce((a, b) => a + b, 0) / x.length;
        const yMean = y.reduce((a, b) => a + b, 0) / y.length;

        let numerator = 0;
        let denominatorX = 0;
        let denominatorY = 0;

        for (let i = 0; i < x.length; i++) {
            numerator += (x[i] - xMean) * (y[i] - yMean);
            denominatorX += Math.pow(x[i] - xMean, 2);
            denominatorY += Math.pow(y[i] - yMean, 2);
        }

        const denominator = Math.sqrt(denominatorX * denominatorY);
        return denominator === 0 ? 0 : numerator / denominator;
    }

    /**
     * Get wellness alerts for athletes
     */
    static async getWellnessAlerts(
        boxId: string,
        options: {
            severity?: 'low' | 'medium' | 'high';
            days?: number;
            limit?: number;
        } = {}
    ): Promise<WellnessAlert[]> {
        const { severity, days = 7, limit = 20 } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get recent wellness data for analysis
        const recentWellness = await db
            .select({
                membershipId: athleteWellnessCheckins.membershipId,
                avgEnergy: avg(athleteWellnessCheckins.energyLevel),
                avgStress: avg(athleteWellnessCheckins.stressLevel),
                avgReadiness: avg(athleteWellnessCheckins.workoutReadiness),
                checkinCount: count()
            })
            .from(athleteWellnessCheckins)
            .where(and(
                eq(athleteWellnessCheckins.boxId, boxId),
                gte(athleteWellnessCheckins.checkinDate, startDate)
            ))
            .groupBy(athleteWellnessCheckins.membershipId);

        const alerts: WellnessAlert[] = [];

        for (const wellness of recentWellness) {
            const avgEnergy = Number(wellness.avgEnergy || 0);
            const avgStress = Number(wellness.avgStress || 0);
            const avgReadiness = Number(wellness.avgReadiness || 0);
            const checkinCount = wellness.checkinCount;

            // Critical energy alert
            if (avgEnergy < 3) {
                alerts.push({
                    membershipId: wellness.membershipId,
                    type: 'critical_low_energy',
                    severity: 'high',
                    message: `Critically low energy levels (${avgEnergy.toFixed(1)}/10)`,
                    value: avgEnergy,
                    recommendation: 'Schedule immediate wellness check-in'
                });
            }

            // High stress alert
            if (avgStress > 8) {
                alerts.push({
                    membershipId: wellness.membershipId,
                    type: 'high_stress',
                    severity: avgStress > 9 ? 'high' : 'medium',
                    message: `High stress levels (${avgStress.toFixed(1)}/10)`,
                    value: avgStress,
                    recommendation: 'Consider stress management techniques'
                });
            }

            // Low readiness alert
            if (avgReadiness < 4) {
                alerts.push({
                    membershipId: wellness.membershipId,
                    type: 'low_readiness',
                    severity: avgReadiness < 3 ? 'high' : 'medium',
                    message: `Low workout readiness (${avgReadiness.toFixed(1)}/10)`,
                    value: avgReadiness,
                    recommendation: 'Review training load and recovery'
                });
            }

            // Inconsistent check-ins
            if (checkinCount < days * 0.3) {
                alerts.push({
                    membershipId: wellness.membershipId,
                    type: 'inconsistent_checkins',
                    severity: 'low',
                    message: `Inconsistent wellness tracking (${checkinCount} in ${days} days)`,
                    value: checkinCount,
                    recommendation: 'Encourage daily wellness check-ins'
                });
            }
        }

        // Filter by severity if specified
        let filteredAlerts = severity
            ? alerts.filter(alert => alert.severity === severity)
            : alerts;

        // Sort by severity and limit results
        const severityOrder: { [key: string]: number } = { high: 3, medium: 2, low: 1 };
        filteredAlerts = filteredAlerts
            .sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity])
            .slice(0, limit);

        return filteredAlerts;
    }
}
