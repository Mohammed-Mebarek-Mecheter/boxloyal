// lib/services/notifications/athlete/index.ts

// Main orchestrator (backward compatible with the original service)
export { AthleteNotificationService, AthleteNotificationsOrchestrator } from './athlete-notifications-orchestrator';

// Individual domain services for direct use if needed
export { AthleteAttendanceNotificationService } from './athlete-attendance-notification-service';
export { AthleteBadgeNotificationService } from './athlete-badge-notification-service';
export { AthleteBenchmarkNotificationService } from './athlete-benchmark-notification-service';
export { AthleteLeaderboardNotificationService } from './athlete-leaderboard-notification-service';
export { AthletePRNotificationService } from './athlete-pr-notification-service';
export { AthleteVideoNotificationService } from './athlete-video-notification-service';
export { AthleteWellnessNotificationService } from './athlete-wellness-notification-service';
