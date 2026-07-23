import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  brandContextValidator,
  contactSourceValidator,
  launchStatusValidator,
  processingStageValidator,
  projectStatusValidator,
  scrapedPageValidator,
  skipRetentionValidator,
  sourceValidator,
  syncKindValidator,
  syncStatusValidator,
} from "./validators";

export default defineSchema({
  projects: defineTable({
    ownerId: v.string(),
    name: v.string(),
    domain: v.string(),
    canonicalDomain: v.string(),
    senderName: v.string(),
    senderEmail: v.string(),
    brandContext: brandContextValidator,
    contextGeneration: v.number(),
    contextStatus: projectStatusValidator,
    contextError: v.optional(v.string()),
    filterInstructions: v.string(),
    draftInstructions: v.string(),
    monitorEnabled: v.boolean(),
    monitorGeneration: v.number(),
    monitorId: v.optional(v.string()),
    monitorError: v.optional(v.string()),
    lateSyncEnabled: v.boolean(),
    skipRetention: skipRetentionValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_domain", ["ownerId", "canonicalDomain"])
    .index("by_monitor_id", ["monitorId"]),

  projectContextVersions: defineTable({
    projectId: v.id("projects"),
    brandContext: brandContextValidator,
    source: v.union(
      v.literal("initial_crawl"),
      v.literal("manual_edit"),
      v.literal("monitor_update"),
      v.literal("restore"),
    ),
    changeNote: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_project_created", ["projectId", "createdAt"]),

  launches: defineTable({
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
    source: sourceValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product_hunt_id", ["productHuntId"])
    .index("by_canonical_website", ["canonicalWebsiteUrl"])
    .index("by_product_hunt_url", ["productHuntUrl"])
    .index("by_launch_day", ["launchDay", "launchedAt"]),

  projectLaunches: defineTable({
    ownerId: v.string(),
    projectId: v.id("projects"),
    launchId: v.id("launches"),
    syncRunId: v.id("syncRuns"),
    launchDay: v.string(),
    status: launchStatusValidator,
    stage: processingStageValidator,
    filterDecision: v.optional(v.union(v.literal("keep"), v.literal("remove"))),
    filterReason: v.optional(v.string()),
    scrapeMarkdown: v.optional(v.string()),
    scrapedPages: v.optional(v.array(scrapedPageValidator)),
    contactEmail: v.optional(v.string()),
    contactSourceUrl: v.optional(v.string()),
    contactSource: v.optional(contactSourceValidator),
    contactEvidence: v.optional(v.string()),
    failure: v.optional(v.string()),
    researchStartedAt: v.optional(v.number()),
    researchCompletedAt: v.optional(v.number()),
    draftStartedAt: v.optional(v.number()),
    discoveredAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_launch", ["projectId", "launchId"])
    .index("by_sync_stage", ["syncRunId", "stage"])
    .index("by_project_day", ["projectId", "launchDay"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_owner_day", ["ownerId", "launchDay"]),

  drafts: defineTable({
    ownerId: v.string(),
    projectId: v.id("projects"),
    projectLaunchId: v.id("projectLaunches"),
    launchId: v.id("launches"),
    subject: v.string(),
    body: v.string(),
    status: v.union(
      v.literal("ready"),
      v.literal("sending"),
      v.literal("skipped"),
      v.literal("sent"),
      v.literal("delivery_unknown"),
    ),
    version: v.number(),
    skippedAt: v.optional(v.number()),
    deleteAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_launch", ["projectId", "projectLaunchId"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_status_and_delete_at", ["status", "deleteAt"]),

  deliveryAttempts: defineTable({
    ownerId: v.string(),
    projectId: v.id("projects"),
    draftId: v.id("drafts"),
    attemptNumber: v.number(),
    status: v.union(
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    providerMessageId: v.optional(v.string()),
    failure: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_draft", ["draftId", "attemptNumber"])
    .index("by_project", ["projectId", "startedAt"]),

  syncRuns: defineTable({
    key: v.string(),
    ownerId: v.string(),
    projectId: v.id("projects"),
    launchDay: v.string(),
    kind: syncKindValidator,
    status: syncStatusValidator,
    source: v.optional(sourceValidator),
    fetchedCount: v.number(),
    newCount: v.number(),
    keptCount: v.number(),
    failedCount: v.number(),
    filterStartedAt: v.optional(v.number()),
    filterCompletedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_project_started", ["projectId", "startedAt"])
    .index("by_project_day_kind", ["projectId", "launchDay", "kind"]),

  agentUsage: defineTable({
    day: v.string(),
    kind: v.literal("firecrawl_contact"),
    count: v.number(),
    updatedAt: v.number(),
  }).index("by_day_kind", ["day", "kind"]),

  monitorEvents: defineTable({
    monitorId: v.string(),
    checkId: v.string(),
    projectId: v.id("projects"),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attemptCount: v.number(),
    changeCount: v.number(),
    error: v.optional(v.string()),
    receivedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_check", ["checkId"])
    .index("by_project_received", ["projectId", "receivedAt"]),
});
