// db/schema/index.ts
export * from "./auth";
export * from "./core";
export * from "./athletes";
export * from "./analytics";
export * from "./billing";
export * from "./videos";
export * from "./demo";
export * from "./notifications";

// Re-export all tables for easy importing
import * as auth from "./auth";
import * as core from "./core";
import * as athletes from "./athletes";
import * as analytics from "./analytics";
import * as billing from "./billing";
import * as videos from "./videos";
import * as demo from "./demo";
import * as notifications from "./notifications";

export const schema = {
    ...auth,
    ...core,
    ...athletes,
    ...analytics,
    ...billing,
    ...videos,
    ...demo,
    ...notifications
};
