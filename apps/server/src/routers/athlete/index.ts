// routers/athlete/index.ts
import { router } from "@/lib/trpc";
import { athletePerformanceRouter } from "./performance";
import { athleteWellnessRouter } from "./wellness";
import { athleteProfileRouter } from "./profile";

export const athleteRouter = router({
    performance: athletePerformanceRouter,
    wellness: athleteWellnessRouter,
    profile: athleteProfileRouter,
});