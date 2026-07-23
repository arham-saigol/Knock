import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireIdentity, requireProject } from "./lib/auth";
import { cleanSingleLine } from "./lib/strings";

async function joinLaunch(
  ctx: QueryCtx,
  projectLaunch: Doc<"projectLaunches">,
) {
  const launch = await ctx.db.get(projectLaunch.launchId);
  const draft = await ctx.db
    .query("drafts")
    .withIndex("by_project_launch", (q) =>
      q
        .eq("projectId", projectLaunch.projectId)
        .eq("projectLaunchId", projectLaunch._id),
    )
    .unique();
  return launch ? { projectLaunch, launch, draft } : null;
}

export const today = query({
  args: { projectId: v.id("projects"), day: v.string() },
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId);
    const rows = await ctx.db
      .query("projectLaunches")
      .withIndex("by_project_day", (q) =>
        q.eq("projectId", args.projectId).eq("launchDay", args.day),
      )
      .order("desc")
      .collect();
    const joined = await Promise.all(
      rows
        .filter((row) => row.status !== "filtered")
        .map((row) => joinLaunch(ctx, row)),
    );
    return joined.filter((row) => row !== null);
  },
});

export const reviewQueue = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId);
    const drafts = await ctx.db
      .query("drafts")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "ready"),
      )
      .order("asc")
      .collect();
    return Promise.all(
      drafts.map(async (draft) => {
        const [launch, projectLaunch] = await Promise.all([
          ctx.db.get(draft.launchId),
          ctx.db.get(draft.projectLaunchId),
        ]);
        return { draft, launch, projectLaunch };
      }),
    );
  },
});

export const updateDraft = mutation({
  args: {
    draftId: v.id("drafts"),
    expectedVersion: v.number(),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const draft = await ctx.db.get(args.draftId);
    if (
      !draft ||
      draft.ownerId !== identity.subject ||
      draft.status !== "ready"
    ) {
      throw new ConvexError("Draft is no longer editable");
    }
    if (draft.version !== args.expectedVersion) {
      throw new ConvexError(
        "This draft changed in another session. Reload before editing.",
      );
    }
    const subject = cleanSingleLine(args.subject, 120);
    const body = args.body.replace(/\r\n/g, "\n").trim().slice(0, 5_000);
    if (!subject || !body)
      throw new ConvexError("Subject and body are required");
    await ctx.db.patch(draft._id, {
      subject,
      body,
      version: draft.version + 1,
      updatedAt: Date.now(),
    });
    return draft.version + 1;
  },
});

export const skip = mutation({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const draft = await ctx.db.get(args.draftId);
    if (
      !draft ||
      draft.ownerId !== identity.subject ||
      draft.status !== "ready"
    ) {
      throw new ConvexError("Draft is no longer available");
    }
    const project = await ctx.db.get(draft.projectId);
    if (!project) throw new ConvexError("Project not found");
    const now = Date.now();
    await ctx.db.patch(draft.projectLaunchId, {
      status: "skipped",
      stage: "review",
      updatedAt: now,
    });
    if (project.skipRetention === "delete") {
      await ctx.db.delete(draft._id);
    } else {
      const retentionDays = Number(project.skipRetention);
      await ctx.db.patch(draft._id, {
        status: "skipped",
        skippedAt: now,
        deleteAt: Number.isFinite(retentionDays)
          ? now + retentionDays * 86_400_000
          : undefined,
        updatedAt: now,
      });
    }
  },
});

export const retry = mutation({
  args: { projectLaunchId: v.id("projectLaunches") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (
      !projectLaunch ||
      projectLaunch.ownerId !== identity.subject ||
      projectLaunch.status !== "failed"
    ) {
      throw new ConvexError("Launch is not available for retry");
    }
    const draft = await ctx.db
      .query("drafts")
      .withIndex("by_project_launch", (q) =>
        q
          .eq("projectId", projectLaunch.projectId)
          .eq("projectLaunchId", projectLaunch._id),
      )
      .unique();
    if (draft?.status === "delivery_unknown") {
      throw new ConvexError(
        "Check the mailbox Sent folder before changing an unknown delivery",
      );
    }
    const now = Date.now();
    if (projectLaunch.scrapeMarkdown && projectLaunch.contactEmail && !draft) {
      await ctx.db.patch(projectLaunch._id, {
        status: "processing",
        stage: "drafting",
        draftStartedAt: undefined,
        failure: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.draftActions.generateDraft, {
        projectLaunchId: projectLaunch._id,
      });
      return;
    }
    if (projectLaunch.filterDecision === "keep") {
      await ctx.db.patch(projectLaunch._id, {
        status: "processing",
        stage: "scraping",
        researchStartedAt: undefined,
        researchCompletedAt: undefined,
        failure: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.researchActions.processLaunch, {
        projectLaunchId: projectLaunch._id,
      });
      return;
    }
    throw new ConvexError(
      "Run Sync now to retry this launch's filter decision",
    );
  },
});
