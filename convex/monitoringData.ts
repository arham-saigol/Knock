import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const register = internalMutation({
  args: {
    monitorId: v.string(),
    checkId: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("monitorEvents")
      .withIndex("by_check", (q) => q.eq("checkId", args.checkId))
      .unique();
    if (existing) {
      if (
        existing.status === "completed" ||
        existing.attemptCount >= 3 ||
        (existing.status === "processing" &&
          Date.now() - existing.receivedAt < 10 * 60_000)
      )
        return false;
      await ctx.db.patch(existing._id, {
        status: "processing",
        attemptCount: existing.attemptCount + 1,
        error: undefined,
        receivedAt: Date.now(),
      });
      return true;
    }
    await ctx.db.insert("monitorEvents", {
      monitorId: args.monitorId,
      checkId: args.checkId,
      projectId: args.projectId,
      status: "processing",
      attemptCount: 1,
      changeCount: 0,
      receivedAt: Date.now(),
    });
    return true;
  },
});

export const complete = internalMutation({
  args: { checkId: v.string(), changeCount: v.number() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("monitorEvents")
      .withIndex("by_check", (q) => q.eq("checkId", args.checkId))
      .unique();
    if (!event) return;
    await ctx.db.patch(event._id, {
      status: "completed",
      changeCount: args.changeCount,
      error: undefined,
      completedAt: Date.now(),
    });
  },
});

export const fail = internalMutation({
  args: {
    checkId: v.string(),
    error: v.string(),
    retryable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("monitorEvents")
      .withIndex("by_check", (q) => q.eq("checkId", args.checkId))
      .unique();
    if (!event) return;
    if (args.retryable !== false && event.attemptCount < 3) {
      await ctx.db.patch(event._id, {
        status: "processing",
        attemptCount: event.attemptCount + 1,
        error: args.error.slice(0, 1_000),
        receivedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(
        60_000,
        internal.monitoringActions.processCheck,
        {
          monitorId: event.monitorId,
          checkId: event.checkId,
          projectId: event.projectId,
        },
      );
      return;
    }
    await ctx.db.patch(event._id, {
      status: "failed",
      error: args.error.slice(0, 1_000),
      completedAt: Date.now(),
    });
  },
});
