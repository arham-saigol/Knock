import { Migrations } from "@convex-dev/migrations";

import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

const migrations = new Migrations<DataModel>(components.migrations);

function ownerTokenIdentifier(ownerId: string) {
  const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  if (!issuer) {
    throw new Error("CLERK_JWT_ISSUER_DOMAIN is not configured");
  }
  return `${issuer}|${ownerId}`;
}

export const addProjectOwnerTokenIdentifier = migrations.define({
  table: "projects",
  migrateOne: (_ctx, project) =>
    project.ownerTokenIdentifier === undefined
      ? { ownerTokenIdentifier: ownerTokenIdentifier(project.ownerId) }
      : undefined,
});

export const addProjectLaunchOwnerTokenIdentifier = migrations.define({
  table: "projectLaunches",
  migrateOne: (_ctx, projectLaunch) =>
    projectLaunch.ownerTokenIdentifier === undefined
      ? { ownerTokenIdentifier: ownerTokenIdentifier(projectLaunch.ownerId) }
      : undefined,
});

export const addDraftOwnerTokenIdentifier = migrations.define({
  table: "drafts",
  migrateOne: (_ctx, draft) =>
    draft.ownerTokenIdentifier === undefined
      ? { ownerTokenIdentifier: ownerTokenIdentifier(draft.ownerId) }
      : undefined,
});

export const addDeliveryOwnerTokenIdentifier = migrations.define({
  table: "deliveryAttempts",
  migrateOne: (_ctx, attempt) =>
    attempt.ownerTokenIdentifier === undefined
      ? { ownerTokenIdentifier: ownerTokenIdentifier(attempt.ownerId) }
      : undefined,
});

export const addSyncRunOwnerTokenIdentifier = migrations.define({
  table: "syncRuns",
  migrateOne: (_ctx, run) =>
    run.ownerTokenIdentifier === undefined
      ? { ownerTokenIdentifier: ownerTokenIdentifier(run.ownerId) }
      : undefined,
});

export const migrateOwnerTokenIdentifiers = migrations.runner([
  internal.migrations.addProjectOwnerTokenIdentifier,
  internal.migrations.addProjectLaunchOwnerTokenIdentifier,
  internal.migrations.addDraftOwnerTokenIdentifier,
  internal.migrations.addDeliveryOwnerTokenIdentifier,
  internal.migrations.addSyncRunOwnerTokenIdentifier,
]);
