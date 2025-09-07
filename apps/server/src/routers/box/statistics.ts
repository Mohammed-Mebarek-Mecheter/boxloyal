// routers/box/statistics.ts
import { protectedProcedure, router } from "@/lib/trpc";
import { z } from "zod";
import { requireCoachOrAbove } from "@/lib/permissions";
import { BoxService } from "@/lib/services/box-service";

export const boxStatisticsRouter = router({
    // Get box statistics (owner and coaches)
    getBoxStats: protectedProcedure
        .input(z.object({
            boxId: z.uuid(),
            period: z.enum(["week", "month", "quarter", "year"]).default("month"),
        }))
        .query(async ({ ctx, input }) => {
            await requireCoachOrAbove(ctx, input.boxId);

            return BoxService.getBoxStats(input.boxId, input.period);
        }),
});