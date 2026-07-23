import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { ownerTokenIdentifierFor } from "./lib/auth";

const draftLeaseMs = 10 * 60_000;
const draftRecoveryDelayMs = 30_000;
const maxDraftRecoveries = 1;

async function claimDraft(
  ctx: MutationCtx,
  projectLaunchId: Id<"projectLaunches">,
) {
  const projectLaunch = await ctx.db.get(projectLaunchId);
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
      draftRecoveryCount: undefined,
      updatedAt: Date.now(),
    });
    return null;
  }
  const now = Date.now();
  if (
    projectLaunch.draftStartedAt &&
    now - projectLaunch.draftStartedAt < draftLeaseMs
  )
    return null;
  await ctx.db.patch(projectLaunch._id, {
    draftStartedAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(draftLeaseMs, internal.draftData.recoverLease, {
    projectLaunchId: projectLaunch._id,
    draftStartedAt: now,
  });
  return now;
}

export const claim = internalMutation({
  args: { projectLaunchId: v.id("projectLaunches") },
  handler: (ctx, args) => claimDraft(ctx, args.projectLaunchId),
});

export const recoverLease = internalMutation({
  args: {
    projectLaunchId: v.id("projectLaunches"),
    draftStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (
      !projectLaunch ||
      projectLaunch.stage !== "drafting" ||
      projectLaunch.draftStartedAt !== args.draftStartedAt
    )
      return;
    const recoveryCount = projectLaunch.draftRecoveryCount ?? 0;
    const now = Date.now();
    if (recoveryCount >= maxDraftRecoveries) {
      await ctx.db.patch(projectLaunch._id, {
        status: "failed",
        stage: "complete",
        draftStartedAt: undefined,
        draftRecoveryCount: undefined,
        failure: "Draft worker timed out after retrying",
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(projectLaunch._id, {
      draftStartedAt: undefined,
      draftRecoveryCount: recoveryCount + 1,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      draftRecoveryDelayMs,
      internal.draftActions.generateDraft,
      { projectLaunchId: projectLaunch._id },
    );
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
        ownerTokenIdentifier: ownerTokenIdentifierFor(projectLaunch),
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
      draftRecoveryCount: undefined,
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
      draftRecoveryCount: undefined,
      failure: args.error.slice(0, 1_000),
      updatedAt: Date.now(),
    });
  },
});

export const queueForProject = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<number> => {
    const processing = await ctx.db
      .query("projectLaunches")
      .withIndex("by_project_status_and_stage_and_draft_started_at", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("status", "processing")
          .eq("stage", "drafting")
          .eq("draftStartedAt", undefined),
      )
      .take(20);
    let scheduled = 0;
    for (const projectLaunch of processing) {
      if (!projectLaunch.contactEmail) {
        await ctx.db.patch(projectLaunch._id, {
          status: "failed",
          stage: "complete",
          failure: "Draft contact details are incomplete",
          updatedAt: Date.now(),
        });
        continue;
      }
      const draftStartedAt = await claimDraft(ctx, projectLaunch._id);
      if (draftStartedAt === null) continue;
      await ctx.scheduler.runAfter(0, internal.draftActions.generateDraft, {
        projectLaunchId: projectLaunch._id,
        draftStartedAt,
      });
      scheduled += 1;
    }
    if (processing.length === 20) {
      await ctx.scheduler.runAfter(0, internal.draftData.queueForProject, args);
    }
    return scheduled;
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
