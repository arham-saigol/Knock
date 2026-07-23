import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { requireIdentity } from "./lib/auth";

const DELIVERY_LEASE_MS = 5 * 60_000;

async function quarantineDelivery(
  ctx: MutationCtx,
  attempt: Doc<"deliveryAttempts">,
  error: string,
) {
  const draft = await ctx.db.get(attempt.draftId);
  const now = Date.now();
  await ctx.db.patch(attempt._id, {
    status: "unknown",
    failure: error.slice(0, 1_000),
    finishedAt: now,
  });
  if (draft?.status !== "sending") return;
  await ctx.db.patch(draft._id, {
    status: "delivery_unknown",
    updatedAt: now,
  });
  const projectLaunch = await ctx.db.get(draft.projectLaunchId);
  if (projectLaunch) {
    await ctx.db.patch(projectLaunch._id, {
      status: "failed",
      stage: "complete",
      failure:
        "SMTP delivery outcome is unknown. Check the Sent folder before retrying outside Knock.",
      updatedAt: now,
    });
  }
}

export const reserve = mutation({
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
    const [project, projectLaunch, launch] = await Promise.all([
      ctx.db.get(draft.projectId),
      ctx.db.get(draft.projectLaunchId),
      ctx.db.get(draft.launchId),
    ]);
    if (!project || !projectLaunch || !launch || !projectLaunch.contactEmail) {
      throw new ConvexError("Draft contact details are incomplete");
    }
    const recipientEmail = projectLaunch.contactEmail.trim().toLowerCase();
    const canonicalWebsiteUrl = launch.canonicalWebsiteUrl;
    const attempts = await ctx.db
      .query("deliveryAttempts")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .order("desc")
      .collect();
    if (attempts.some((attempt) => attempt.status === "sent")) {
      throw new ConvexError("This draft was already sent");
    }
    if (attempts.some((attempt) => attempt.status === "unknown")) {
      throw new ConvexError(
        "Delivery outcome is unknown. Check the mailbox Sent folder before taking any action.",
      );
    }
    const active = attempts.find((attempt) => attempt.status === "sending");
    if (active) {
      throw new ConvexError(
        Date.now() - active.startedAt < 5 * 60_000
          ? "This draft is already being sent"
          : "The prior delivery outcome is unknown. Check the Sent folder before taking any action.",
      );
    }
    const blockingStatuses = ["sending", "sent", "unknown"] as const;
    const priorDeliveries = await Promise.all([
      ...blockingStatuses.map((status) =>
        ctx.db
          .query("deliveryAttempts")
          .withIndex("by_project_and_recipient_email_and_status", (q) =>
            q
              .eq("projectId", project._id)
              .eq("recipientEmail", recipientEmail)
              .eq("status", status),
          )
          .first(),
      ),
      ...(canonicalWebsiteUrl
        ? blockingStatuses.map((status) =>
            ctx.db
              .query("deliveryAttempts")
              .withIndex("by_project_and_canonical_website_and_status", (q) =>
                q
                  .eq("projectId", project._id)
                  .eq("canonicalWebsiteUrl", canonicalWebsiteUrl)
                  .eq("status", status),
              )
              .first(),
          )
        : []),
    ]);
    if (priorDeliveries.some(Boolean)) {
      throw new ConvexError(
        "This company already has a sent or unresolved delivery",
      );
    }
    const now = Date.now();
    const attemptId = await ctx.db.insert("deliveryAttempts", {
      ownerId: identity.subject,
      projectId: project._id,
      draftId: draft._id,
      recipientEmail,
      canonicalWebsiteUrl,
      attemptNumber: attempts.length + 1,
      status: "sending",
      startedAt: now,
    });
    await ctx.db.patch(draft._id, { status: "sending", updatedAt: now });
    await ctx.scheduler.runAfter(
      DELIVERY_LEASE_MS + 5_000,
      internal.deliveries.expireLease,
      { attemptId },
    );
    return {
      attemptId,
      senderName: project.senderName,
      senderEmail: project.senderEmail,
      recipientEmail,
      subject: draft.subject,
      body: draft.body,
    };
  },
});

export const complete = mutation({
  args: {
    attemptId: v.id("deliveryAttempts"),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const attempt = await ctx.db.get(args.attemptId);
    if (
      !attempt ||
      attempt.ownerId !== identity.subject ||
      attempt.status !== "sending"
    ) {
      throw new ConvexError("Delivery attempt is no longer active");
    }
    const draft = await ctx.db.get(attempt.draftId);
    if (!draft || draft.status !== "sending")
      throw new ConvexError("Draft is no longer available");
    const now = Date.now();
    await ctx.db.patch(attempt._id, {
      status: "sent",
      providerMessageId: args.providerMessageId,
      finishedAt: now,
    });
    await ctx.db.patch(draft._id, {
      status: "sent",
      sentAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(draft.projectLaunchId, {
      status: "sent",
      stage: "complete",
      failure: undefined,
      updatedAt: now,
    });
  },
});

export const fail = mutation({
  args: { attemptId: v.id("deliveryAttempts"), error: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const attempt = await ctx.db.get(args.attemptId);
    if (
      !attempt ||
      attempt.ownerId !== identity.subject ||
      attempt.status !== "sending"
    )
      return;
    const now = Date.now();
    await ctx.db.patch(attempt._id, {
      status: "failed",
      failure: args.error.slice(0, 1_000),
      finishedAt: now,
    });
    const draft = await ctx.db.get(attempt.draftId);
    if (draft?.status === "sending") {
      await ctx.db.patch(draft._id, { status: "ready", updatedAt: now });
    }
  },
});

export const markUnknown = mutation({
  args: { attemptId: v.id("deliveryAttempts"), error: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const attempt = await ctx.db.get(args.attemptId);
    if (
      !attempt ||
      attempt.ownerId !== identity.subject ||
      attempt.status !== "sending"
    )
      return;
    await quarantineDelivery(ctx, attempt, args.error);
  },
});

export const expireLease = internalMutation({
  args: { attemptId: v.id("deliveryAttempts") },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (
      !attempt ||
      attempt.status !== "sending" ||
      Date.now() - attempt.startedAt < DELIVERY_LEASE_MS
    )
      return;
    await quarantineDelivery(
      ctx,
      attempt,
      "Delivery did not finish before the sending lease expired.",
    );
  },
});
