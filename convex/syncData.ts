import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { ownerTokenIdentifierFor } from "./lib/auth";
import { syncKindValidator } from "./validators";

const filterLeaseMs = 10 * 60_000;
const syncLeaseMs = 10 * 60_000;
const filterRecoveryDelayMs = 30_000;
const syncRecoveryDelayMs = 30_000;
const maxFilterRecoveries = 1;
const maxSyncRecoveries = 1;
const filterBatchSize = 8;

const launchInput = v.object({
  productHuntId: v.optional(v.string()),
  name: v.string(),
  tagline: v.string(),
  description: v.string(),
  topics: v.array(v.string()),
  websiteUrl: v.optional(v.string()),
  canonicalWebsiteUrl: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  makers: v.array(
    v.object({
      name: v.string(),
      username: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
    }),
  ),
  productHuntUrl: v.string(),
  launchedAt: v.number(),
  launchDay: v.string(),
  source: v.union(v.literal("api"), v.literal("rss")),
});

export const begin = internalMutation({
  args: {
    key: v.string(),
    projectId: v.id("projects"),
    launchDay: v.string(),
    kind: syncKindValidator,
    slot: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    const existing = await ctx.db
      .query("syncRuns")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const now = Date.now();
    if (existing) {
      if (existing.filterStartedAt) {
        return {
          runId: existing._id,
          shouldRun: false,
          resumeFiltering: false,
        };
      }
      if (
        existing.status === "running" &&
        now - existing.startedAt < syncLeaseMs
      ) {
        return {
          runId: existing._id,
          shouldRun: false,
          resumeFiltering: false,
        };
      }
      const resumeFiltering = existing.filterRecoveryCount !== undefined;
      await ctx.db.patch(existing._id, {
        status: "running",
        error: undefined,
        startedAt: now,
        completedAt: undefined,
      });
      await ctx.scheduler.runAfter(
        syncLeaseMs,
        internal.syncData.recoverUnclaimedRun,
        { runId: existing._id, startedAt: now },
      );
      return { runId: existing._id, shouldRun: true, resumeFiltering };
    }
    const runId = await ctx.db.insert("syncRuns", {
      key: args.key,
      slot: args.slot,
      ownerId: project.ownerId,
      ownerTokenIdentifier: ownerTokenIdentifierFor(project),
      projectId: project._id,
      launchDay: args.launchDay,
      kind: args.kind,
      status: "running",
      fetchedCount: 0,
      newCount: 0,
      keptCount: 0,
      failedCount: 0,
      startedAt: now,
    });
    await ctx.scheduler.runAfter(
      syncLeaseMs,
      internal.syncData.recoverUnclaimedRun,
      { runId, startedAt: now },
    );
    return { runId, shouldRun: true, resumeFiltering: false };
  },
});

export const recoverUnclaimedRun = internalMutation({
  args: { runId: v.id("syncRuns"), startedAt: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.startedAt !== args.startedAt ||
      run.filterStartedAt !== undefined
    )
      return;
    const recoveryCount = run.syncRecoveryCount ?? 0;
    const shouldRetry = recoveryCount < maxSyncRecoveries;
    const error = shouldRetry
      ? "Sync worker timed out before filtering; retrying"
      : "Sync worker timed out before filtering after retrying";
    await ctx.db.patch(run._id, {
      status: "failed",
      syncRecoveryCount: shouldRetry ? recoveryCount + 1 : undefined,
      error,
      completedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.syncData.fail, {
      runId: run._id,
      filterStartedAt: undefined,
      error,
      retry: shouldRetry
        ? {
            projectId: run.projectId,
            kind: run.kind,
            slot: run.slot,
            launchDay: run.launchDay,
          }
        : undefined,
    });
  },
});

export const upsertLaunches = internalMutation({
  args: {
    projectId: v.id("projects"),
    runId: v.id("syncRuns"),
    batchIndex: v.number(),
    launches: v.array(launchInput),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    const run = await ctx.db.get(args.runId);
    if (
      !project ||
      !run ||
      run.status !== "running" ||
      run.projectId !== project._id
    )
      return [];
    const now = Date.now();
    const candidateIds: Id<"projectLaunches">[] = [];

    for (const input of args.launches) {
      let launch = input.productHuntId
        ? await ctx.db
            .query("launches")
            .withIndex("by_product_hunt_id", (q) =>
              q.eq("productHuntId", input.productHuntId),
            )
            .unique()
        : null;
      if (!launch && !input.productHuntId && input.canonicalWebsiteUrl) {
        launch = await ctx.db
          .query("launches")
          .withIndex("by_canonical_website", (q) =>
            q.eq("canonicalWebsiteUrl", input.canonicalWebsiteUrl),
          )
          .first();
      }
      if (!launch) {
        launch = await ctx.db
          .query("launches")
          .withIndex("by_product_hunt_url", (q) =>
            q.eq("productHuntUrl", input.productHuntUrl),
          )
          .unique();
      }

      let launchId: Id<"launches">;
      if (launch) {
        launchId = launch._id;
        await ctx.db.patch(
          launchId,
          launch.source === "api" && input.source === "rss"
            ? { updatedAt: now }
            : { ...input, updatedAt: now },
        );
      } else {
        launchId = await ctx.db.insert("launches", {
          ...input,
          createdAt: now,
          updatedAt: now,
        });
      }

      const existingProjectLaunch = await ctx.db
        .query("projectLaunches")
        .withIndex("by_project_launch", (q) =>
          q.eq("projectId", project._id).eq("launchId", launchId),
        )
        .unique();
      if (existingProjectLaunch) {
        if (
          existingProjectLaunch.status === "failed" &&
          !existingProjectLaunch.filterDecision
        ) {
          await ctx.db.patch(existingProjectLaunch._id, {
            syncRunId: run._id,
            launchDay: input.launchDay,
            status: "processing",
            stage: "filtering",
            failure: undefined,
            updatedAt: now,
          });
          candidateIds.push(existingProjectLaunch._id);
        }
        continue;
      }

      const projectLaunchId = await ctx.db.insert("projectLaunches", {
        ownerId: project.ownerId,
        ownerTokenIdentifier: ownerTokenIdentifierFor(project),
        projectId: project._id,
        launchId,
        syncRunId: run._id,
        launchDay: input.launchDay,
        status: "processing",
        stage: "filtering",
        discoveredAt: now,
        updatedAt: now,
      });
      candidateIds.push(projectLaunchId);
    }

    await ctx.db.patch(run._id, {
      source: args.launches[0]?.source,
      fetchedCount:
        args.batchIndex === 0
          ? args.launches.length
          : run.fetchedCount + args.launches.length,
      newCount:
        args.batchIndex === 0
          ? candidateIds.length
          : run.newCount + candidateIds.length,
      keptCount: args.batchIndex === 0 ? 0 : run.keptCount,
      failedCount: args.batchIndex === 0 ? 0 : run.failedCount,
      filterCompletedAt:
        args.batchIndex === 0 ? undefined : run.filterCompletedAt,
    });
    return candidateIds;
  },
});

export const filterCandidates = internalQuery({
  args: { runId: v.id("syncRuns") },
  handler: async (ctx, args) => {
    const projectLaunches = await ctx.db
      .query("projectLaunches")
      .withIndex("by_sync_stage", (q) =>
        q.eq("syncRunId", args.runId).eq("stage", "filtering"),
      )
      .take(filterBatchSize);
    return Promise.all(
      projectLaunches.map(async (projectLaunch) => ({
        projectLaunchId: projectLaunch._id,
        launch: await ctx.db.get(projectLaunch.launchId),
      })),
    );
  },
});

export const claimFilterCall = internalMutation({
  args: { runId: v.id("syncRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running" || run.filterStartedAt) return null;
    const filterStartedAt = Date.now();
    await ctx.db.patch(run._id, { filterStartedAt });
    await ctx.scheduler.runAfter(
      filterLeaseMs,
      internal.syncData.recoverFilterLease,
      { runId: run._id, filterStartedAt },
    );
    return filterStartedAt;
  },
});

export const renewFilterCall = internalMutation({
  args: { runId: v.id("syncRuns"), filterStartedAt: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.filterStartedAt !== args.filterStartedAt
    )
      return null;
    const filterStartedAt = Date.now();
    await ctx.db.patch(run._id, { filterStartedAt });
    await ctx.scheduler.runAfter(
      filterLeaseMs,
      internal.syncData.recoverFilterLease,
      { runId: run._id, filterStartedAt },
    );
    return filterStartedAt;
  },
});

export const recoverFilterLease = internalMutation({
  args: { runId: v.id("syncRuns"), filterStartedAt: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.filterStartedAt !== args.filterStartedAt
    )
      return;
    const now = Date.now();
    const recoveryCount = run.filterRecoveryCount ?? 0;
    if (recoveryCount >= maxFilterRecoveries) {
      await ctx.db.patch(run._id, {
        status: "failed",
        filterRecoveryCount: undefined,
        error: "Filter worker timed out after retrying",
        completedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.syncData.fail, {
        runId: run._id,
        filterStartedAt: args.filterStartedAt,
        error: "Filter worker timed out after retrying",
      });
      return;
    }
    await ctx.db.patch(run._id, {
      status: "failed",
      filterStartedAt: undefined,
      filterRecoveryCount: recoveryCount + 1,
      error: "Filter worker lease expired",
      completedAt: now,
    });
    await ctx.scheduler.runAfter(
      filterRecoveryDelayMs,
      internal.syncActions.runSync,
      {
        projectId: run.projectId,
        kind: run.kind,
        slot: run.slot,
        launchDay: run.launchDay,
      },
    );
  },
});

export const applyFilters = internalMutation({
  args: {
    runId: v.id("syncRuns"),
    filterStartedAt: v.number(),
    candidateIds: v.array(v.id("projectLaunches")),
    decisions: v.array(
      v.object({
        projectLaunchId: v.id("projectLaunches"),
        decision: v.union(v.literal("keep"), v.literal("remove")),
        reason: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.filterStartedAt !== args.filterStartedAt
    )
      return;
    const byId = new Map(
      args.decisions.map((decision) => [decision.projectLaunchId, decision]),
    );
    let keptCount = 0;
    let failedCount = 0;
    const now = Date.now();
    for (const candidateId of args.candidateIds) {
      const candidate = await ctx.db.get(candidateId);
      if (
        !candidate ||
        candidate.syncRunId !== run._id ||
        candidate.stage !== "filtering"
      )
        continue;
      const decision = byId.get(candidate._id);
      if (!decision) {
        failedCount += 1;
        await ctx.db.patch(candidate._id, {
          status: "failed",
          stage: "complete",
          failure: "The filter response omitted this launch",
          updatedAt: now,
        });
        continue;
      }
      if (decision.decision === "remove") {
        await ctx.db.patch(candidate._id, {
          status: "filtered",
          stage: "complete",
          filterDecision: "remove",
          filterReason: decision.reason.slice(0, 1_000),
          updatedAt: now,
        });
        continue;
      }
      keptCount += 1;
      await ctx.db.patch(candidate._id, {
        filterDecision: "keep",
        filterReason: decision.reason.slice(0, 1_000),
        stage: "scraping",
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.researchActions.processLaunch, {
        projectLaunchId: candidate._id,
      });
    }
    await ctx.db.patch(run._id, {
      keptCount: run.keptCount + keptCount,
      failedCount: run.failedCount + failedCount,
    });
  },
});

export const completeFilters = internalMutation({
  args: { runId: v.id("syncRuns"), filterStartedAt: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.filterStartedAt !== args.filterStartedAt
    )
      return false;
    const remaining = await ctx.db
      .query("projectLaunches")
      .withIndex("by_sync_stage", (q) =>
        q.eq("syncRunId", run._id).eq("stage", "filtering"),
      )
      .take(1);
    if (remaining.length > 0) return false;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: run.failedCount > 0 ? "partial" : "completed",
      filterStartedAt: undefined,
      filterCompletedAt: now,
      filterRecoveryCount: undefined,
      syncRecoveryCount: undefined,
      completedAt: now,
    });
    return true;
  },
});

export const fail = internalMutation({
  args: {
    runId: v.id("syncRuns"),
    filterStartedAt: v.optional(v.number()),
    error: v.string(),
    retry: v.optional(
      v.object({
        projectId: v.id("projects"),
        kind: syncKindValidator,
        slot: v.string(),
        launchDay: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.filterStartedAt !== args.filterStartedAt) return null;
    const candidates = await ctx.db
      .query("projectLaunches")
      .withIndex("by_sync_stage", (q) =>
        q.eq("syncRunId", run._id).eq("stage", "filtering"),
      )
      .take(50);
    const now = Date.now();
    for (const candidate of candidates) {
      await ctx.db.patch(candidate._id, {
        status: "failed",
        stage: "complete",
        failure: args.error.slice(0, 1_000),
        updatedAt: now,
      });
    }
    await ctx.db.patch(run._id, {
      status: "failed",
      failedCount: run.failedCount + candidates.length,
      filterStartedAt:
        candidates.length === 50 ? args.filterStartedAt : undefined,
      error: args.error.slice(0, 1_000),
      completedAt: now,
    });
    if (candidates.length === 50) {
      await ctx.scheduler.runAfter(0, internal.syncData.fail, args);
    } else if (args.retry) {
      await ctx.scheduler.runAfter(
        syncRecoveryDelayMs,
        internal.syncActions.runSync,
        args.retry,
      );
    }
    return null;
  },
});

export const completeWithoutCandidates = internalMutation({
  args: { runId: v.id("syncRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return;
    await ctx.db.patch(run._id, {
      status: "completed",
      filterStartedAt: undefined,
      filterRecoveryCount: undefined,
      syncRecoveryCount: undefined,
      completedAt: Date.now(),
    });
  },
});
