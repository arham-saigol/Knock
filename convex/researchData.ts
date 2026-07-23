import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { contactSourceValidator, scrapedPageValidator } from "./validators";

export const bundle = internalQuery({
  args: { projectLaunchId: v.id("projectLaunches") },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (!projectLaunch) return null;
    const [project, launch, run] = await Promise.all([
      ctx.db.get(projectLaunch.projectId),
      ctx.db.get(projectLaunch.launchId),
      ctx.db.get(projectLaunch.syncRunId),
    ]);
    if (!project || !launch || !run) return null;
    return { projectLaunch, project, launch, run };
  },
});

export const claim = internalMutation({
  args: { projectLaunchId: v.id("projectLaunches") },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (!projectLaunch || projectLaunch.stage !== "scraping") return false;
    const now = Date.now();
    if (
      projectLaunch.researchStartedAt &&
      now - projectLaunch.researchStartedAt < 10 * 60_000
    ) {
      return false;
    }
    await ctx.db.patch(projectLaunch._id, {
      researchStartedAt: now,
      failure: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      10 * 60_000 + 5_000,
      internal.researchData.recoverLease,
      {
        projectLaunchId: projectLaunch._id,
        startedAt: now,
      },
    );
    return true;
  },
});

export const recoverLease = internalMutation({
  args: {
    projectLaunchId: v.id("projectLaunches"),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (
      !projectLaunch ||
      projectLaunch.stage !== "scraping" ||
      projectLaunch.researchStartedAt !== args.startedAt
    )
      return;
    await ctx.db.patch(projectLaunch._id, {
      status: "failed",
      stage: "complete",
      failure:
        "Website research exceeded its processing lease. Retry this launch.",
      researchCompletedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const claimFirecrawlAgent = internalMutation({
  args: { day: v.string() },
  handler: async (ctx, args) => {
    const usage = await ctx.db
      .query("agentUsage")
      .withIndex("by_day_kind", (q) =>
        q.eq("day", args.day).eq("kind", "firecrawl_contact"),
      )
      .unique();
    if (usage && usage.count >= 5) return false;
    const now = Date.now();
    if (usage) {
      await ctx.db.patch(usage._id, { count: usage.count + 1, updatedAt: now });
    } else {
      await ctx.db.insert("agentUsage", {
        day: args.day,
        kind: "firecrawl_contact",
        count: 1,
        updatedAt: now,
      });
    }
    return true;
  },
});

export const save = internalMutation({
  args: {
    projectLaunchId: v.id("projectLaunches"),
    scrapeMarkdown: v.string(),
    scrapedPages: v.array(scrapedPageValidator),
    contactEmail: v.optional(v.string()),
    contactSourceUrl: v.optional(v.string()),
    contactSource: v.optional(contactSourceValidator),
    contactEvidence: v.optional(v.string()),
    generateNow: v.boolean(),
  },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (!projectLaunch || projectLaunch.status === "sent") return;
    const now = Date.now();
    if (!args.contactEmail) {
      await ctx.db.patch(projectLaunch._id, {
        scrapeMarkdown: args.scrapeMarkdown,
        scrapedPages: args.scrapedPages,
        status: "no_email",
        stage: "complete",
        researchCompletedAt: now,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(projectLaunch._id, {
      scrapeMarkdown: args.scrapeMarkdown,
      scrapedPages: args.scrapedPages,
      contactEmail: args.contactEmail,
      contactSourceUrl: args.contactSourceUrl,
      contactSource: args.contactSource,
      contactEvidence: args.contactEvidence?.slice(0, 1_000),
      status: "processing",
      stage: "drafting",
      researchCompletedAt: now,
      updatedAt: now,
    });
    if (args.generateNow) {
      await ctx.scheduler.runAfter(0, internal.draftActions.generateDraft, {
        projectLaunchId: projectLaunch._id,
      });
    }
  },
});

export const savePendingAgent = internalMutation({
  args: {
    projectLaunchId: v.id("projectLaunches"),
    scrapeMarkdown: v.string(),
    scrapedPages: v.array(scrapedPageValidator),
  },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (!projectLaunch || projectLaunch.status === "sent") return;
    await ctx.db.patch(projectLaunch._id, {
      scrapeMarkdown: args.scrapeMarkdown,
      scrapedPages: args.scrapedPages,
      status: "processing",
      stage: "contact",
      researchCompletedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.researchActions.resolveContact, {
      projectLaunchId: projectLaunch._id,
    });
  },
});

export const finishAgent = internalMutation({
  args: {
    projectLaunchId: v.id("projectLaunches"),
    contactEmail: v.optional(v.string()),
    contactSourceUrl: v.optional(v.string()),
    contactEvidence: v.optional(v.string()),
    generateNow: v.boolean(),
  },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (!projectLaunch || projectLaunch.stage !== "contact") return;
    const now = Date.now();
    if (!args.contactEmail) {
      await ctx.db.patch(projectLaunch._id, {
        status: "no_email",
        stage: "complete",
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(projectLaunch._id, {
      contactEmail: args.contactEmail,
      contactSourceUrl: args.contactSourceUrl,
      contactSource: "firecrawl_agent",
      contactEvidence: args.contactEvidence?.slice(0, 1_000),
      status: "processing",
      stage: "drafting",
      updatedAt: now,
    });
    if (args.generateNow) {
      await ctx.scheduler.runAfter(0, internal.draftActions.generateDraft, {
        projectLaunchId: projectLaunch._id,
      });
    }
  },
});

export const fail = internalMutation({
  args: { projectLaunchId: v.id("projectLaunches"), error: v.string() },
  handler: async (ctx, args) => {
    const projectLaunch = await ctx.db.get(args.projectLaunchId);
    if (!projectLaunch || projectLaunch.status === "sent") return;
    await ctx.db.patch(projectLaunch._id, {
      status: "failed",
      stage: "complete",
      failure: args.error.slice(0, 1_000),
      researchCompletedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
