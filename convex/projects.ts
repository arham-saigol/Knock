import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireIdentity, requireProject } from "./lib/auth";
import { cleanSingleLine } from "./lib/strings";
import { normalizeDomain, validateSenderDomain } from "./lib/urls";
import {
  brandContextValidator,
  emptyBrandContext,
  skipRetentionValidator,
} from "./validators";

const cleanupPhaseValidator = v.union(
  v.literal("projectLaunches"),
  v.literal("deliveryAttempts"),
  v.literal("drafts"),
  v.literal("syncRuns"),
  v.literal("projectContextVersions"),
  v.literal("monitorEvents"),
);
const cleanupPhases = [
  "projectLaunches",
  "deliveryAttempts",
  "drafts",
  "syncRuns",
  "projectContextVersions",
  "monitorEvents",
] as const;
const CLEANUP_BATCH_SIZE = 8;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => requireProject(ctx, args.projectId),
});

export const contextVersions = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId);
    return ctx.db
      .query("projectContextVersions")
      .withIndex("by_project_created", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    domain: v.string(),
    senderName: v.string(),
    senderEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const name = cleanSingleLine(args.name, 80);
    const senderName = cleanSingleLine(args.senderName, 80);
    const canonicalDomain = normalizeDomain(args.domain);
    const senderEmail = validateSenderDomain(args.senderEmail, canonicalDomain);
    if (!name || !senderName)
      throw new ConvexError("Complete every project field");

    const duplicate = await ctx.db
      .query("projects")
      .withIndex("by_owner_domain", (q) =>
        q
          .eq("ownerId", identity.subject)
          .eq("canonicalDomain", canonicalDomain),
      )
      .unique();
    if (duplicate) throw new ConvexError("A project already uses this domain");

    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      ownerId: identity.subject,
      name,
      domain: `https://${canonicalDomain}`,
      canonicalDomain,
      senderName,
      senderEmail,
      brandContext: emptyBrandContext,
      contextGeneration: 1,
      contextStatus: "building",
      filterInstructions: "",
      draftInstructions: "",
      monitorEnabled: false,
      monitorGeneration: 0,
      lateSyncEnabled: true,
      skipRetention: "30",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.projectActions.buildInitialContext,
      {
        projectId,
        expectedGeneration: 1,
      },
    );
    return projectId;
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    domain: v.string(),
    senderName: v.string(),
    senderEmail: v.string(),
    brandContext: brandContextValidator,
    filterInstructions: v.string(),
    draftInstructions: v.string(),
    monitorEnabled: v.boolean(),
    lateSyncEnabled: v.boolean(),
    skipRetention: skipRetentionValidator,
  },
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId);
    const canonicalDomain = normalizeDomain(args.domain);
    const senderEmail = validateSenderDomain(args.senderEmail, canonicalDomain);
    const name = cleanSingleLine(args.name, 80);
    const senderName = cleanSingleLine(args.senderName, 80);
    if (!name || !senderName)
      throw new ConvexError("Complete every project field");

    if (canonicalDomain !== project.canonicalDomain) {
      const duplicate = await ctx.db
        .query("projects")
        .withIndex("by_owner_domain", (q) =>
          q
            .eq("ownerId", project.ownerId)
            .eq("canonicalDomain", canonicalDomain),
        )
        .unique();
      if (duplicate)
        throw new ConvexError("A project already uses this domain");
    }

    const now = Date.now();
    const contextChanged =
      JSON.stringify(project.brandContext) !==
      JSON.stringify(args.brandContext);
    const domainChanged = canonicalDomain !== project.canonicalDomain;
    const monitorChanged =
      args.monitorEnabled !== project.monitorEnabled ||
      domainChanged ||
      (args.monitorEnabled && Boolean(project.monitorError));
    const monitorGeneration =
      project.monitorGeneration + (monitorChanged ? 1 : 0);
    if (contextChanged && !args.brandContext.whatItDoes.trim()) {
      throw new ConvexError(
        "Brand context must describe what the product does",
      );
    }
    const contextGeneration =
      project.contextGeneration + (contextChanged || domainChanged ? 1 : 0);
    if (contextChanged) {
      await ctx.db.insert("projectContextVersions", {
        projectId: project._id,
        brandContext: args.brandContext,
        source: "manual_edit",
        createdAt: now,
      });
    }
    await ctx.db.patch(project._id, {
      name,
      domain: `https://${canonicalDomain}`,
      canonicalDomain,
      senderName,
      senderEmail,
      brandContext: args.brandContext,
      contextGeneration,
      contextStatus: domainChanged
        ? "building"
        : contextChanged
          ? "ready"
          : project.contextStatus,
      contextError:
        domainChanged || contextChanged ? undefined : project.contextError,
      filterInstructions: args.filterInstructions.trim().slice(0, 8_000),
      draftInstructions: args.draftInstructions.trim().slice(0, 8_000),
      monitorEnabled: args.monitorEnabled,
      monitorGeneration,
      lateSyncEnabled: args.lateSyncEnabled,
      skipRetention: args.skipRetention,
      updatedAt: now,
    });

    if (domainChanged) {
      await ctx.scheduler.runAfter(
        0,
        internal.projectActions.buildInitialContext,
        {
          projectId: project._id,
          expectedGeneration: contextGeneration,
        },
      );
    }
    if (monitorChanged) {
      await ctx.scheduler.runAfter(
        0,
        internal.projectActions.configureMonitor,
        {
          projectId: project._id,
          previousMonitorId: project.monitorId,
          expectedGeneration: monitorGeneration,
        },
      );
    }
  },
});

export const restoreContext = mutation({
  args: {
    projectId: v.id("projects"),
    versionId: v.id("projectContextVersions"),
  },
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.projectId !== args.projectId)
      throw new ConvexError("Version not found");
    const now = Date.now();
    await ctx.db.patch(args.projectId, {
      brandContext: version.brandContext,
      contextGeneration: project.contextGeneration + 1,
      contextStatus: "ready",
      contextError: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("projectContextVersions", {
      projectId: args.projectId,
      brandContext: version.brandContext,
      source: "restore",
      changeNote: `Restored version from ${new Date(version.createdAt).toISOString()}`,
      createdAt: now,
    });
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId);
    if (project.monitorId) {
      await ctx.scheduler.runAfter(0, internal.projectActions.deleteMonitor, {
        monitorId: project.monitorId,
      });
    }
    await ctx.db.delete(project._id);
    await ctx.scheduler.runAfter(0, internal.projects.cleanupProject, {
      projectId: project._id,
      phase: "projectLaunches",
    });
  },
});

export const cleanupProject = internalMutation({
  args: {
    projectId: v.id("projects"),
    phase: cleanupPhaseValidator,
  },
  handler: async (ctx, args): Promise<null> => {
    let deleted = 0;
    if (args.phase === "projectLaunches") {
      const documents = await ctx.db
        .query("projectLaunches")
        .withIndex("by_project_day", (q) => q.eq("projectId", args.projectId))
        .take(CLEANUP_BATCH_SIZE);
      for (const document of documents) await ctx.db.delete(document._id);
      deleted = documents.length;
    } else if (args.phase === "deliveryAttempts") {
      const documents = await ctx.db
        .query("deliveryAttempts")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .take(CLEANUP_BATCH_SIZE);
      for (const document of documents) await ctx.db.delete(document._id);
      deleted = documents.length;
    } else if (args.phase === "drafts") {
      const documents = await ctx.db
        .query("drafts")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .take(CLEANUP_BATCH_SIZE);
      for (const document of documents) await ctx.db.delete(document._id);
      deleted = documents.length;
    } else if (args.phase === "syncRuns") {
      const documents = await ctx.db
        .query("syncRuns")
        .withIndex("by_project_started", (q) =>
          q.eq("projectId", args.projectId),
        )
        .take(CLEANUP_BATCH_SIZE);
      for (const document of documents) await ctx.db.delete(document._id);
      deleted = documents.length;
    } else if (args.phase === "projectContextVersions") {
      const documents = await ctx.db
        .query("projectContextVersions")
        .withIndex("by_project_created", (q) =>
          q.eq("projectId", args.projectId),
        )
        .take(CLEANUP_BATCH_SIZE);
      for (const document of documents) await ctx.db.delete(document._id);
      deleted = documents.length;
    } else {
      const documents = await ctx.db
        .query("monitorEvents")
        .withIndex("by_project_received", (q) =>
          q.eq("projectId", args.projectId),
        )
        .take(CLEANUP_BATCH_SIZE);
      for (const document of documents) await ctx.db.delete(document._id);
      deleted = documents.length;
    }

    if (deleted > 0) {
      await ctx.scheduler.runAfter(0, internal.projects.cleanupProject, args);
      return null;
    }
    const nextPhase = cleanupPhases[cleanupPhases.indexOf(args.phase) + 1];
    if (nextPhase) {
      await ctx.scheduler.runAfter(0, internal.projects.cleanupProject, {
        projectId: args.projectId,
        phase: nextPhase,
      });
    }
    return null;
  },
});

export const getInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: (ctx, args) => ctx.db.get(args.projectId),
});

export const findByMonitorId = internalQuery({
  args: { monitorId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("projects")
      .withIndex("by_monitor_id", (q) => q.eq("monitorId", args.monitorId))
      .unique(),
});

export const listInternal = internalQuery({
  args: { lateOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const projects = await ctx.db.query("projects").collect();
    return projects.filter(
      (project) =>
        project.contextStatus === "ready" &&
        (!args.lateOnly || project.lateSyncEnabled),
    );
  },
});

export const saveGeneratedContext = internalMutation({
  args: {
    projectId: v.id("projects"),
    expectedGeneration: v.number(),
    brandContext: brandContextValidator,
    source: v.union(v.literal("initial_crawl"), v.literal("monitor_update")),
    changeNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.contextGeneration !== args.expectedGeneration)
      return false;
    const now = Date.now();
    await ctx.db.patch(project._id, {
      brandContext: args.brandContext,
      contextGeneration: project.contextGeneration + 1,
      contextStatus: "ready",
      contextError: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("projectContextVersions", {
      projectId: project._id,
      brandContext: args.brandContext,
      source: args.source,
      changeNote: args.changeNote,
      createdAt: now,
    });
    return true;
  },
});

export const setContextFailure = internalMutation({
  args: {
    projectId: v.id("projects"),
    expectedGeneration: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.contextGeneration !== args.expectedGeneration)
      return;
    await ctx.db.patch(project._id, {
      contextStatus: "failed",
      contextError: args.error.slice(0, 1_000),
      updatedAt: Date.now(),
    });
  },
});

export const startContextGeneration = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    const generation = project.contextGeneration + 1;
    await ctx.db.patch(project._id, {
      contextGeneration: generation,
      contextStatus: "building",
      contextError: undefined,
      updatedAt: Date.now(),
    });
    return generation;
  },
});

export const setMonitorResult = internalMutation({
  args: {
    projectId: v.id("projects"),
    expectedGeneration: v.number(),
    monitorId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.monitorGeneration !== args.expectedGeneration)
      return false;
    await ctx.db.patch(project._id, {
      monitorId: args.monitorId,
      monitorError: args.error?.slice(0, 1_000),
      updatedAt: Date.now(),
    });
    return true;
  },
});

export type ProjectDocument = Doc<"projects">;
export type ProjectId = Id<"projects">;
