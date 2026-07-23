import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";

export const claim = internalMutation({
  args: { projectLaunchId: v.id("projectLaunches") },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (
      !projectLaunch ||
      projectLaunch.stage !== "drafting" ||
      !projectLaunch.contactEmail
    ) {
      return null;
    }
    const existing = await ctx.db
      .query("drafts")
      .withIndex("by_project_launch", (q) =>
        q
          .eq("projectId", projectLaunch.projectId)
          .eq("projectLaunchId", projectLaunch._id),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(projectLaunch._id, {
        status:
          existing.status === "sent"
            ? "sent"
            : existing.status === "skipped"
              ? "skipped"
              : "ready",
        stage: existing.status === "sent" ? "complete" : "review",
        updatedAt: Date.now(),
      });
      return null;
    }
    const now = Date.now();
    if (
      projectLaunch.draftStartedAt &&
      now - projectLaunch.draftStartedAt < 10 * 60_000
    )
      return null;
    await ctx.db.patch(projectLaunch._id, {
      draftStartedAt: now,
      updatedAt: now,
    });
    return now;
  },
});

export const bundle = internalQuery({
  args: { projectLaunchId: v.id("projectLaunches") },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (!projectLaunch) return null;
    const [project, launch] = await Promise.all([
      ctx.db.get(projectLaunch.projectId),
      ctx.db.get(projectLaunch.launchId),
    ]);
    if (!project || !launch) return null;
    return { projectLaunch, project, launch };
  },
});

export const save = internalMutation({
  args: {
    projectLaunchId: v.id("projectLaunches"),
    draftStartedAt: v.number(),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (
      !projectLaunch ||
      projectLaunch.stage !== "drafting" ||
      projectLaunch.draftStartedAt !== args.draftStartedAt
    )
      return;
    const existing = await ctx.db
      .query("drafts")
      .withIndex("by_project_launch", (q) =>
        q
          .eq("projectId", projectLaunch.projectId)
          .eq("projectLaunchId", projectLaunch._id),
      )
      .unique();
    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("drafts", {
        ownerId: projectLaunch.ownerId,
        projectId: projectLaunch.projectId,
        projectLaunchId: projectLaunch._id,
        launchId: projectLaunch.launchId,
        subject: args.subject,
        body: args.body,
        status: "ready",
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(projectLaunch._id, {
      status: "ready",
      stage: "review",
      draftStartedAt: undefined,
      failure: undefined,
      updatedAt: now,
    });
  },
});

export const fail = internalMutation({
  args: {
    projectLaunchId: v.id("projectLaunches"),
    draftStartedAt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (
      !projectLaunch ||
      projectLaunch.stage !== "drafting" ||
      projectLaunch.draftStartedAt !== args.draftStartedAt
    )
      return;
    await ctx.db.patch(projectLaunch._id, {
      status: "failed",
      stage: "complete",
      draftStartedAt: undefined,
      failure: args.error.slice(0, 1_000),
      updatedAt: Date.now(),
    });
  },
});

export const queueForProject = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const processing = await ctx.db
      .query("projectLaunches")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "processing"),
      )
      .collect();
    for (const projectLaunch of processing) {
      if (projectLaunch.stage !== "drafting" || !projectLaunch.contactEmail)
        continue;
      await ctx.scheduler.runAfter(0, internal.draftActions.generateDraft, {
        projectLaunchId: projectLaunch._id,
      });
    }
    return processing.filter(
      (projectLaunch) => projectLaunch.stage === "drafting",
    ).length;
  },
});

export const cleanupSkipped = internalMutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    const now = Date.now();
    const drafts = await ctx.db
      .query("drafts")
      .withIndex("by_status_and_delete_at", (q) =>
        q.eq("status", "skipped").gte("deleteAt", 0).lte("deleteAt", now),
      )
      .take(100);
    for (const draft of drafts) {
      await ctx.db.delete(draft._id);
    }
    if (drafts.length === 100) {
      await ctx.scheduler.runAfter(0, internal.draftData.cleanupSkipped, {});
    }
    return null;
  },
});
