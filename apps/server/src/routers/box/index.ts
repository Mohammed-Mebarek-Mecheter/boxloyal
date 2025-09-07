// routers/box/index.ts
import { router } from "@/lib/trpc";
import { boxManagementRouter } from "./management";
import { boxMembersRouter } from "./members";
import { boxStatisticsRouter } from "./statistics";

export const boxRouter = router({
    management: boxManagementRouter,
    members: boxMembersRouter,
    statistics: boxStatisticsRouter,
});