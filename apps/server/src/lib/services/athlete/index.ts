// lib/services/athlete/index.ts
import { AthleteCoreService } from './athlete-core-service';
import { AthletePRService } from './athlete-pr-service';
import { AthleteBenchmarkService } from './athlete-benchmark-service';
import { AthleteWellnessService } from './athlete-wellness-service';
import { AthleteBadgeService } from './athlete-badge-service';
import { AthleteLeaderboardService } from './athlete-leaderboard-service';
import { AthleteVideoService } from './athlete-video-service';
import { AthleteAttendanceService } from './athlete-attendance-service';

// Create a service registry with all dependencies
export const athleteServices = {
    coreService: AthleteCoreService,
    prService: AthletePRService,
    benchmarkService: AthleteBenchmarkService,
    wellnessService: AthleteWellnessService,
    badgeService: AthleteBadgeService,
    leaderboardService: AthleteLeaderboardService,
    videoService: AthleteVideoService,
    attendanceService: AthleteAttendanceService,
};

// Re-export for convenience
export { AthleteCoreService, AthletePRService, AthleteBenchmarkService, AthleteWellnessService, AthleteBadgeService, AthleteLeaderboardService, AthleteVideoService, AthleteAttendanceService };
