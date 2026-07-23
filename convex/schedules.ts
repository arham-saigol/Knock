import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { productHuntDay } from "./lib/time";

export const mainSync = internalAction({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.runQuery(internal.projects.listInternal, {});
    const slot = productHuntDay();
    for (const project of projects) {
      await ctx.scheduler.runAfter(0, internal.syncActions.runSync, {
        projectId: project._id,
        kind: "main",
        slot,
      });
    }
  },
});

export const startDrafts = internalAction({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.runQuery(internal.projects.listInternal, {});
    for (const project of projects) {
      await ctx.runMutation(internal.draftData.queueForProject, {
        projectId: project._id,
      });
    }
  },
});

export const lateSync = internalAction({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.runQuery(internal.projects.listInternal, {
      lateOnly: true,
    });
    const launchDay = productHuntDay(Date.now() - 24 * 60 * 60 * 1_000);
    for (const project of projects) {
      await ctx.scheduler.runAfter(0, internal.syncActions.runSync, {
        projectId: project._id,
        kind: "late",
        slot: launchDay,
        launchDay,
      });
    }
  },
});

export const cleanup = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.draftData.cleanupSkipped, {});
  },
});
