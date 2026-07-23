import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { UserIdentity } from "convex/server";

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

type OwnedDocument = Pick<Doc<"projects">, "ownerId" | "ownerTokenIdentifier">;
type OwnerIdentity = Pick<
  UserIdentity,
  "issuer" | "subject" | "tokenIdentifier"
>;

export function isIdentityOwner(
  document: OwnedDocument,
  identity: OwnerIdentity,
) {
  if (document.ownerTokenIdentifier !== undefined) {
    return document.ownerTokenIdentifier === identity.tokenIdentifier;
  }

  return (
    document.ownerId === identity.subject &&
    identity.issuer === process.env.CLERK_JWT_ISSUER_DOMAIN
  );
}

export function ownerTokenIdentifierFor(document: OwnedDocument) {
  if (document.ownerTokenIdentifier !== undefined) {
    return document.ownerTokenIdentifier;
  }

  const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  if (!issuer) {
    throw new ConvexError("CLERK_JWT_ISSUER_DOMAIN is not configured");
  }
  return `${issuer}|${document.ownerId}`;
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
  if (!project || !isIdentityOwner(project, identity)) {
    throw new ConvexError("Project not found");
  }
  return project;
}

export function assertProjectOwner(
  project: Doc<"projects"> | null,
  identity: OwnerIdentity,
) {
  if (!project || !isIdentityOwner(project, identity)) {
    throw new ConvexError("Project not found");
  }
  return project;
}
