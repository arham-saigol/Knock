export function parseCompletedMonitorEvent(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const event = payload as Record<string, unknown>;
  if (event.type !== "monitor.check.completed") return undefined;
  const data = Array.isArray(event.data)
    ? (event.data[0] as Record<string, unknown> | undefined)
    : (event.data as Record<string, unknown> | undefined);
  const monitorId = String(event.monitorId ?? data?.monitorId ?? "");
  const checkId = String(
    event.checkId ?? data?.checkId ?? data?.id ?? event.id ?? "",
  );
  return monitorId && checkId ? { monitorId, checkId } : undefined;
}
