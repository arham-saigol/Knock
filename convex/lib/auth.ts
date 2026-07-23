import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

type AuthReader = Pick<ActionCtx | MutationCtx | QueryCtx, "auth">;

type DatabaseReader =
  Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

export async function requireIdentity(ctx: AuthReader) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Authentication required");
  }
  assertAllowedUser(identity.subject);
  return identity;
}

export function assertAllowedUser(subject: string) {
  const allowed = (process.env.KNOCK_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowed.length === 0) {
    throw new ConvexError("KNOCK_ALLOWED_USER_IDS is not configured");
  }
  if (!allowed.includes(subject)) {
    throw new ConvexError("This account is not allowed to use Knock");
  }
}

export async function requireProject(
  ctx: DatabaseReader,
  projectId: Id<"projects">,
) {
  const identity = await requireIdentity(ctx);
  const project = await ctx.db.get(projectId);
  if (!project || project.ownerId !== identity.subject) {
    throw new ConvexError("Project not found");
  }
  return project;
}

export function assertProjectOwner(
  project: Doc<"projects"> | null,
  ownerId: string,
) {
  if (!project || project.ownerId !== ownerId) {
    throw new ConvexError("Project not found");
  }
  return project;
}
