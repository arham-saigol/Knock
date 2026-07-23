import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { parseCompletedMonitorEvent } from "./lib/firecrawlWebhook";

function hexBytes(value: string) {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return undefined;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

async function verifySignature(body: string, signature: string | null) {
  const secret = process.env.FIRECRAWL_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const signatureBytes = hexBytes(signature.slice(7));
  if (!signatureBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(body),
  );
}

const firecrawlMonitor = httpAction(async (ctx, request) => {
  const rawBody = await request.text();
  if (
    !(await verifySignature(
      rawBody,
      request.headers.get("X-Firecrawl-Signature"),
    ))
  ) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (payload.type !== "monitor.check.completed") {
    return new Response("Ignored", { status: 202 });
  }
  const event = parseCompletedMonitorEvent(payload);
  if (!event)
    return new Response("Missing monitor identifiers", { status: 400 });
  const { monitorId, checkId } = event;
  const project = await ctx.runQuery(internal.projects.findByMonitorId, {
    monitorId,
  });
  if (!project || !project.monitorEnabled)
    return new Response("Ignored", { status: 202 });
  const receivedAt = await ctx.runMutation(internal.monitoringData.register, {
    monitorId,
    checkId,
    projectId: project._id,
  });
  if (receivedAt !== null) {
    await ctx.scheduler.runAfter(0, internal.monitoringActions.processCheck, {
      monitorId,
      checkId,
      projectId: project._id,
      receivedAt,
    });
  }
  return new Response("Accepted", { status: 202 });
});

const http = httpRouter();
http.route({
  path: "/firecrawl-monitor",
  method: "POST",
  handler: firecrawlMonitor,
});

export default http;
