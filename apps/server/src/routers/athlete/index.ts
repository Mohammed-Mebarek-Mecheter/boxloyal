// routers/athlete/index.ts
import { router } from "@/lib/trpc";
import { athletePerformanceRouter } from "./performance";
import { athleteWellnessRouter } from "./wellness";
import { athleteProfileRouter } from "./profile";
import { athleteAttendanceRouter } from "./attendance";
import { athleteLeaderboardsRouter } from "./leaderboards";
import { athleteVideosRouter } from "./videos";

export const athleteRouter = router({
    performance: athletePerformanceRouter,
    wellness: athleteWellnessRouter,
    profile: athleteProfileRouter,
    attendance: athleteAttendanceRouter,
    leaderboards: athleteLeaderboardsRouter,
    videos: athleteVideosRouter,
});
