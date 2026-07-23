import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { productHuntDay } from "./lib/time";

const projectBatchSize = 10;

export const mainSync = internalAction({
  args: { cursor: v.optional(v.string()), slot: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const projects = await ctx.runQuery(internal.projects.listInternal, {
      paginationOpts: {
        numItems: projectBatchSize,
        cursor: args.cursor ?? null,
      },
    });
    const slot = args.slot ?? productHuntDay();
    for (const projectId of projects.page) {
      await ctx.scheduler.runAfter(0, internal.syncActions.runSync, {
        projectId,
        kind: "main",
        slot,
      });
    }
    if (!projects.isDone) {
      await ctx.scheduler.runAfter(0, internal.schedules.mainSync, {
        cursor: projects.continueCursor,
        slot,
      });
    }
    return null;
  },
});

export const startDrafts = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const projects = await ctx.runQuery(internal.projects.listInternal, {
      paginationOpts: {
        numItems: projectBatchSize,
        cursor: args.cursor ?? null,
      },
    });
    for (const projectId of projects.page) {
      await ctx.runMutation(internal.draftData.queueForProject, {
        projectId,
      });
    }
    if (!projects.isDone) {
      await ctx.scheduler.runAfter(0, internal.schedules.startDrafts, {
        cursor: projects.continueCursor,
      });
    }
    return null;
  },
});

export const lateSync = internalAction({
  args: {
    cursor: v.optional(v.string()),
    launchDay: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const projects = await ctx.runQuery(internal.projects.listInternal, {
      lateOnly: true,
      paginationOpts: {
        numItems: projectBatchSize,
        cursor: args.cursor ?? null,
      },
    });
    const launchDay =
      args.launchDay ?? productHuntDay(Date.now() - 24 * 60 * 60 * 1_000);
    for (const projectId of projects.page) {
      await ctx.scheduler.runAfter(0, internal.syncActions.runSync, {
        projectId,
        kind: "late",
        slot: launchDay,
        launchDay,
      });
    }
    if (!projects.isDone) {
      await ctx.scheduler.runAfter(0, internal.schedules.lateSync, {
        cursor: projects.continueCursor,
        launchDay,
      });
    }
    return null;
  },
});

export const cleanup = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.draftData.cleanupSkipped, {});
  },
});
