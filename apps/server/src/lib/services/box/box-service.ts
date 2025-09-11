// lib/services/box-service.ts (facade)
import { BoxCoreService } from './box-core-service';
import { BoxMemberService } from './box-member-service';
import { BoxInviteService } from './box-invite-service';
import { BoxQrCodeService } from './box-qrcode-service';
import { BoxApprovalService } from './box-approval-service';
import { BoxCoachService } from './box-coach-service';
import { BoxVideoService } from './box-video-service';

export class BoxService {
    // Core service methods
    static updateBox = BoxCoreService.updateBox;
    static getBoxStats = BoxCoreService.getBoxStats;
    static getDashboard = BoxCoreService.getDashboard;

    // Member service methods
    static getMembers = BoxMemberService.getMembers;
    static removeMember = BoxMemberService.removeMember;

    // Invite service methods
    static createInvitation = BoxInviteService.createInvitation;
    static getPendingInvites = BoxInviteService.getPendingInvites;
    static cancelInvite = BoxInviteService.cancelInvite;

    // QR code service methods
    static createQrCode = BoxQrCodeService.createQrCode;
    static getQrCodes = BoxQrCodeService.getQrCodes;
    static deactivateQrCode = BoxQrCodeService.deactivateQrCode;

    // Approval service methods
    static getApprovalQueue = BoxApprovalService.getApprovalQueue;
    static processApproval = BoxApprovalService.processApproval;

    // Coach service methods
    static getCoachModerationQueue = BoxCoachService.getCoachModerationQueue;
    static getInterventionInsights = BoxCoachService.getInterventionInsights;
    static createVideoReviewNotification = BoxCoachService.createVideoReviewNotification;

    // Video service methods
    static getVideoCelebrationCandidates = BoxVideoService.getVideoCelebrationCandidates;
}
