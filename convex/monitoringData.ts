import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const monitorLeaseMs = 10 * 60_000;
const monitorRetryDelayMs = 60_000;

export const register = internalMutation({
  args: {
    monitorId: v.string(),
    checkId: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (
      !project ||
      !project.monitorEnabled ||
      project.monitorId !== args.monitorId
    )
      return null;
    const existing = await ctx.db
      .query("monitorEvents")
      .withIndex("by_check", (q) => q.eq("checkId", args.checkId))
      .unique();
    if (existing) {
      if (
        existing.status === "completed" ||
        existing.attemptCount >= 3 ||
        (existing.status === "processing" &&
          Date.now() - existing.receivedAt < monitorLeaseMs)
      )
        return null;
      const receivedAt = Date.now();
      await ctx.db.patch(existing._id, {
        status: "processing",
        attemptCount: existing.attemptCount + 1,
        error: undefined,
        receivedAt,
      });
      await ctx.scheduler.runAfter(
        monitorLeaseMs,
        internal.monitoringData.recoverLease,
        { checkId: existing.checkId, receivedAt },
      );
      return receivedAt;
    }
    const receivedAt = Date.now();
    await ctx.db.insert("monitorEvents", {
      monitorId: args.monitorId,
      checkId: args.checkId,
      projectId: args.projectId,
      status: "processing",
      attemptCount: 1,
      changeCount: 0,
      receivedAt,
    });
    await ctx.scheduler.runAfter(
      monitorLeaseMs,
      internal.monitoringData.recoverLease,
      { checkId: args.checkId, receivedAt },
    );
    return receivedAt;
  },
});

export const complete = internalMutation({
  args: {
    checkId: v.string(),
    receivedAt: v.number(),
    changeCount: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("monitorEvents")
      .withIndex("by_check", (q) => q.eq("checkId", args.checkId))
      .unique();
    if (
      !event ||
      event.status !== "processing" ||
      event.receivedAt !== args.receivedAt
    )
      return;
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
    receivedAt: v.number(),
    error: v.string(),
    retryable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("monitorEvents")
      .withIndex("by_check", (q) => q.eq("checkId", args.checkId))
      .unique();
    if (
      !event ||
      event.status !== "processing" ||
      event.receivedAt !== args.receivedAt
    )
      return;
    if (args.retryable !== false && event.attemptCount < 3) {
      const receivedAt = Date.now();
      await ctx.db.patch(event._id, {
        status: "processing",
        attemptCount: event.attemptCount + 1,
        error: args.error.slice(0, 1_000),
        receivedAt,
      });
      await ctx.scheduler.runAfter(
        monitorRetryDelayMs,
        internal.monitoringActions.processCheck,
        {
          monitorId: event.monitorId,
          checkId: event.checkId,
          projectId: event.projectId,
          receivedAt,
        },
      );
      await ctx.scheduler.runAfter(
        monitorRetryDelayMs + monitorLeaseMs,
        internal.monitoringData.recoverLease,
        { checkId: event.checkId, receivedAt },
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

export const recoverLease = internalMutation({
  args: { checkId: v.string(), receivedAt: v.number() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("monitorEvents")
      .withIndex("by_check", (q) => q.eq("checkId", args.checkId))
      .unique();
    if (
      !event ||
      event.status !== "processing" ||
      event.receivedAt !== args.receivedAt
    )
      return;
    const now = Date.now();
    if (event.attemptCount >= 3) {
      await ctx.db.patch(event._id, {
        status: "failed",
        error: "Monitor check worker timed out after retrying",
        completedAt: now,
      });
      return;
    }
    await ctx.db.patch(event._id, {
      attemptCount: event.attemptCount + 1,
      error: "Monitor check worker lease expired",
      receivedAt: now,
    });
    await ctx.scheduler.runAfter(
      monitorRetryDelayMs,
      internal.monitoringActions.processCheck,
      {
        monitorId: event.monitorId,
        checkId: event.checkId,
        projectId: event.projectId,
        receivedAt: now,
      },
    );
    await ctx.scheduler.runAfter(
      monitorRetryDelayMs + monitorLeaseMs,
      internal.monitoringData.recoverLease,
      { checkId: event.checkId, receivedAt: now },
    );
  },
});
