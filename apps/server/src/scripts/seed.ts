// scripts/seed.ts - Database seeding script
import { db } from "@/db";
import {
    movements,
    benchmarkWods,
    subscriptionPlans
} from "@/db/schema";
import {logger} from "@/lib/logger";

async function seedDatabase() {
    try {
        logger.info("Starting database seed...");

        // Seed subscription plans
        const plans = [
            {
                name: "Starter",
                tier: "starter" as const,
                memberLimit: 200,
                coachLimit: 5,
                monthlyPrice: 15000, // $150 in cents
                annualPrice: 144000, // $1440 in cents (20% discount)
                features: JSON.stringify([
                    "Performance tracking",
                    "Wellness check-ins",
                    "Basic analytics",
                    "Email support"
                ]),
                isDefault: true,
            },
            {
                name: "Performance",
                tier: "performance" as const,
                memberLimit: 500,
                coachLimit: 15,
                monthlyPrice: 25000,
                annualPrice: 240000,
                features: JSON.stringify([
                    "All Starter features",
                    "Advanced analytics",
                    "Communication tools",
                    "Priority support",
                    "Integrations"
                ]),
            },
            {
                name: "Elite",
                tier: "elite" as const,
                memberLimit: 1000,
                coachLimit: 50,
                monthlyPrice: 40000,
                annualPrice: 384000,
                features: JSON.stringify([
                    "All Performance features",
                    "White-label options",
                    "Custom reporting",
                    "API access",
                    "Dedicated support"
                ]),
            },
        ];

        await db.insert(subscriptionPlans).values(plans).onConflictDoNothing();

        // Seed standard CrossFit movements
        const standardMovements = [
            // Squats
            { name: "Back Squat", category: "squat", unit: "lbs", isStandard: true, isLift: true },
            { name: "Front Squat", category: "squat", unit: "lbs", isStandard: true, isLift: true },
            { name: "Overhead Squat", category: "squat", unit: "lbs", isStandard: true, isLift: true },

            // Deadlifts
            { name: "Deadlift", category: "deadlift", unit: "lbs", isStandard: true, isLift: true },
            { name: "Sumo Deadlift", category: "deadlift", unit: "lbs", isStandard: true, isLift: true },

            // Presses
            { name: "Strict Press", category: "press", unit: "lbs", isStandard: true, isLift: true },
            { name: "Push Press", category: "press", unit: "lbs", isStandard: true, isLift: true },
            { name: "Jerk", category: "press", unit: "lbs", isStandard: true, isLift: true },
            { name: "Bench Press", category: "press", unit: "lbs", isStandard: true, isLift: true },

            // Olympic Lifts
            { name: "Clean", category: "olympic", unit: "lbs", isStandard: true, isLift: true },
            { name: "Snatch", category: "olympic", unit: "lbs", isStandard: true, isLift: true },
            { name: "Clean & Jerk", category: "olympic", unit: "lbs", isStandard: true, isLift: true },

            // Gymnastics
            { name: "Pull-ups", category: "gymnastics", unit: "reps", isStandard: true, isSkill: true },
            { name: "Muscle-ups", category: "gymnastics", unit: "reps", isStandard: true, isSkill: true },
            { name: "Handstand Push-ups", category: "gymnastics", unit: "reps", isStandard: true, isSkill: true },
            { name: "Double Unders", category: "gymnastics", unit: "reps", isStandard: true, isSkill: true },

            // Cardio
            { name: "Row", category: "cardio", unit: "meters", isStandard: true, isTimeBased: true },
            { name: "Run", category: "cardio", unit: "meters", isStandard: true, isTimeBased: true },
            { name: "Bike", category: "cardio", unit: "calories", isStandard: true, isTimeBased: true },
        ];

        await db.insert(movements).values(standardMovements).onConflictDoNothing();

        // Seed benchmark WODs
        const benchmarks = [
            // Girls
            { name: "Fran", description: "21-15-9 Thrusters (95/65), Pull-ups", type: "time", category: "girls", isStandard: true },
            { name: "Grace", description: "30 Clean & Jerks (135/95) for time", type: "time", category: "girls", isStandard: true },
            { name: "Helen", description: "3 RFT: 400m Run, 21 KB Swings (53/35), 12 Pull-ups", type: "time", category: "girls", isStandard: true },
            { name: "Annie", description: "50-40-30-20-10 Double Unders, Sit-ups", type: "time", category: "girls", isStandard: true },

            // Hero WODs
            { name: "Murph", description: "1 mile run, 100 pull-ups, 200 push-ups, 300 squats, 1 mile run", type: "time", category: "hero", isStandard: true },
            { name: "DT", description: "5 RFT: 12 Deadlifts (155/105), 9 Hang Power Cleans, 6 Push Jerks", type: "time", category: "hero", isStandard: true },
        ];

        await db.insert(benchmarkWods).values(benchmarks).onConflictDoNothing();

        logger.info("Database seeded successfully");
    } catch (error) {
        logger.error("Database seed failed", error as Error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    seedDatabase().then(() => process.exit(0)).catch(() => process.exit(1));
}

export { seedDatabase };
