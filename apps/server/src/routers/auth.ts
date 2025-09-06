// routers/auth.ts
import { router, publicProcedure, protectedProcedure } from "@/lib/trpc";
import { getUserBoxMemberships } from "@/lib/permissions";

export const authRouter = router({
    me: protectedProcedure.query(({ ctx }) => {
        return ctx.session.user;
    }),

    myBoxes: protectedProcedure.query(async ({ ctx }) => {
        return getUserBoxMemberships(ctx);
    }),

    healthCheck: publicProcedure.query(() => {
        return "OK";
    }),
});
