import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Convex cron times are UTC. Pakistan Standard Time is UTC+5 year-round.
crons.cron("main Product Hunt sync", "45 9 * * *", internal.schedules.mainSync);
crons.cron("start daily drafts", "5 10 * * *", internal.schedules.startDrafts);
crons.cron("optional late sync", "15 8 * * *", internal.schedules.lateSync);
crons.cron(
  "clean expired skipped drafts",
  "0 19 * * *",
  internal.schedules.cleanup,
);

export default crons;
