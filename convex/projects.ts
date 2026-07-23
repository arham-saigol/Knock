import { paginationOptsValidator } from "convex/server";
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
const contextBuildLeaseMs = 10 * 60_000;
const contextRecoveryDelayMs = 30_000;
const maxContextRecoveries = 1;

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    return ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const selected = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const project = await ctx.db.get(args.projectId);
    return project?.ownerId === identity.subject ? project : null;
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
    const contextStartedAt = now;
    const projectId = await ctx.db.insert("projects", {
      ownerId: identity.subject,
      name,
      domain: `https://${canonicalDomain}`,
      canonicalDomain,
      senderName,
      senderEmail,
      brandContext: emptyBrandContext,
      contextGeneration: 1,
      contextStartedAt,
      settingsRevision: 1,
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
        contextStartedAt,
      },
    );
    await ctx.scheduler.runAfter(
      contextBuildLeaseMs,
      internal.projects.recoverContextBuild,
      { projectId, expectedGeneration: 1, contextStartedAt },
    );
    return projectId;
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    expectedContextGeneration: v.number(),
    expectedSettingsRevision: v.number(),
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
    if (project.settingsRevision !== args.expectedSettingsRevision) {
      throw new ConvexError(
        "Project settings changed in another session. Load the latest version before saving.",
      );
    }
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
    if (
      contextChanged &&
      project.contextGeneration !== args.expectedContextGeneration
    ) {
      throw new ConvexError(
        "Brand context changed in another session. Load the latest version before saving.",
      );
    }
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
    const contextStartedAt = domainChanged ? now : undefined;
    const settingsRevision = project.settingsRevision + 1;
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
      contextStartedAt:
        domainChanged || contextChanged
          ? contextStartedAt
          : project.contextStartedAt,
      contextRecoveryCount:
        domainChanged || contextChanged
          ? undefined
          : project.contextRecoveryCount,
      settingsRevision,
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
          contextStartedAt: now,
        },
      );
      await ctx.scheduler.runAfter(
        contextBuildLeaseMs,
        internal.projects.recoverContextBuild,
        {
          projectId: project._id,
          expectedGeneration: contextGeneration,
          contextStartedAt: now,
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
    return { contextGeneration, settingsRevision };
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
      contextStartedAt: undefined,
      contextRecoveryCount: undefined,
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
  args: {
    lateOnly: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .paginate(args.paginationOpts);
    return {
      ...projects,
      page: projects.page
        .filter(
          (project) =>
            project.contextStatus === "ready" &&
            (!args.lateOnly || project.lateSyncEnabled),
        )
        .map((project) => project._id),
    };
  },
});

export const saveGeneratedContext = internalMutation({
  args: {
    projectId: v.id("projects"),
    expectedGeneration: v.number(),
    contextStartedAt: v.optional(v.number()),
    brandContext: brandContextValidator,
    source: v.union(v.literal("initial_crawl"), v.literal("monitor_update")),
    changeNote: v.optional(v.string()),
    monitorEvent: v.optional(
      v.object({
        checkId: v.string(),
        receivedAt: v.number(),
        changeCount: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (
      !project ||
      project.contextGeneration !== args.expectedGeneration ||
      (args.contextStartedAt !== undefined &&
        project.contextStartedAt !== args.contextStartedAt)
    )
      return false;
    const monitorEventArgs = args.monitorEvent;
    const monitorEvent = monitorEventArgs
      ? await ctx.db
          .query("monitorEvents")
          .withIndex("by_check", (q) =>
            q.eq("checkId", monitorEventArgs.checkId),
          )
          .unique()
      : null;
    if (
      monitorEventArgs &&
      (!monitorEvent ||
        monitorEvent.projectId !== project._id ||
        monitorEvent.status !== "processing" ||
        monitorEvent.receivedAt !== monitorEventArgs.receivedAt)
    )
      return false;
    const now = Date.now();
    await ctx.db.patch(project._id, {
      brandContext: args.brandContext,
      contextGeneration: project.contextGeneration + 1,
      contextStartedAt: undefined,
      contextRecoveryCount: undefined,
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
    if (monitorEvent && monitorEventArgs) {
      await ctx.db.patch(monitorEvent._id, {
        status: "completed",
        changeCount: monitorEventArgs.changeCount,
        error: undefined,
        completedAt: now,
      });
    }
    return true;
  },
});

export const setContextFailure = internalMutation({
  args: {
    projectId: v.id("projects"),
    expectedGeneration: v.number(),
    contextStartedAt: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (
      !project ||
      project.contextGeneration !== args.expectedGeneration ||
      project.contextStartedAt !== args.contextStartedAt
    )
      return;
    await ctx.db.patch(project._id, {
      contextStatus: "failed",
      contextStartedAt: undefined,
      contextRecoveryCount: undefined,
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
    const contextStartedAt = Date.now();
    await ctx.db.patch(project._id, {
      contextGeneration: generation,
      contextStartedAt,
      contextRecoveryCount: undefined,
      contextStatus: "building",
      contextError: undefined,
      updatedAt: contextStartedAt,
    });
    await ctx.scheduler.runAfter(
      contextBuildLeaseMs,
      internal.projects.recoverContextBuild,
      {
        projectId: project._id,
        expectedGeneration: generation,
        contextStartedAt,
      },
    );
    return { expectedGeneration: generation, contextStartedAt };
  },
});

export const recoverContextBuild = internalMutation({
  args: {
    projectId: v.id("projects"),
    expectedGeneration: v.number(),
    contextStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (
      !project ||
      project.contextStatus !== "building" ||
      project.contextGeneration !== args.expectedGeneration ||
      project.contextStartedAt !== args.contextStartedAt
    )
      return;
    const recoveryCount = project.contextRecoveryCount ?? 0;
    const now = Date.now();
    if (recoveryCount >= maxContextRecoveries) {
      await ctx.db.patch(project._id, {
        contextStatus: "failed",
        contextStartedAt: undefined,
        contextRecoveryCount: undefined,
        contextError: "Brand context worker timed out after retrying",
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(project._id, {
      contextStartedAt: now,
      contextRecoveryCount: recoveryCount + 1,
      contextError: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      contextRecoveryDelayMs,
      internal.projectActions.buildInitialContext,
      {
        projectId: project._id,
        expectedGeneration: args.expectedGeneration,
        contextStartedAt: now,
      },
    );
    await ctx.scheduler.runAfter(
      contextRecoveryDelayMs + contextBuildLeaseMs,
      internal.projects.recoverContextBuild,
      {
        projectId: project._id,
        expectedGeneration: args.expectedGeneration,
        contextStartedAt: now,
      },
    );
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
