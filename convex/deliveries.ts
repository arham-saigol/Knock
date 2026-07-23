import { ConvexError, v } from "convex/values";

import { mutation } from "./_generated/server";
import { requireIdentity } from "./lib/auth";

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
    const [project, projectLaunch] = await Promise.all([
      ctx.db.get(draft.projectId),
      ctx.db.get(draft.projectLaunchId),
    ]);
    if (!project || !projectLaunch || !projectLaunch.contactEmail) {
      throw new ConvexError("Draft contact details are incomplete");
    }
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
    const attemptId = await ctx.db.insert("deliveryAttempts", {
      ownerId: identity.subject,
      projectId: project._id,
      draftId: draft._id,
      attemptNumber: attempts.length + 1,
      status: "sending",
      startedAt: Date.now(),
    });
    return {
      attemptId,
      senderName: project.senderName,
      senderEmail: project.senderEmail,
      recipientEmail: projectLaunch.contactEmail,
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
    if (!draft || draft.status !== "ready")
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
    await ctx.db.patch(attempt._id, {
      status: "failed",
      failure: args.error.slice(0, 1_000),
      finishedAt: Date.now(),
    });
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
    const draft = await ctx.db.get(attempt.draftId);
    const now = Date.now();
    await ctx.db.patch(attempt._id, {
      status: "unknown",
      failure: args.error.slice(0, 1_000),
      finishedAt: now,
    });
    if (draft) {
      await ctx.db.patch(draft._id, {
        status: "delivery_unknown",
        updatedAt: now,
      });
      await ctx.db.patch(draft.projectLaunchId, {
        status: "failed",
        stage: "complete",
        failure:
          "SMTP delivery outcome is unknown. Check the Sent folder before retrying outside Knock.",
        updatedAt: now,
      });
    }
  },
});
