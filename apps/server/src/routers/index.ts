// routers/index.ts
import { router } from "@/lib/trpc";
import { boxRouter } from "./box";
import { athleteRouter } from "./athlete";
import { analyticsRouter } from "./analytics";
import { billingRouter } from "./billing";
import { adminRouter } from "./admin";

export const appRouter = router({
    box: boxRouter,
    athlete: athleteRouter,
    analytics: analyticsRouter,
    billing: billingRouter,
    admin: adminRouter,
});

export type AppRouter = typeof appRouter;
