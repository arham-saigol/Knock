import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Convex cron times are UTC. Pakistan Standard Time is UTC+5 year-round.
crons.daily(
  "main Product Hunt sync",
  { hourUTC: 9, minuteUTC: 45 },
  internal.schedules.mainSync,
);
crons.daily(
  "start daily drafts",
  { hourUTC: 10, minuteUTC: 5 },
  internal.schedules.startDrafts,
);
crons.daily(
  "optional late sync",
  { hourUTC: 18, minuteUTC: 45 },
  internal.schedules.lateSync,
);
crons.daily(
  "clean expired skipped drafts",
  { hourUTC: 19, minuteUTC: 0 },
  internal.schedules.cleanup,
);

export default crons;
