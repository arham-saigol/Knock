import { describe, expect, it } from "vitest";

import { withDeepSeekThinking } from "./deepseek";
import { parseCompletedMonitorEvent } from "./firecrawlWebhook";
import { isPastDraftStart, pktDay, productHuntDay } from "./time";

describe("provider contracts", () => {
  it("adds DeepSeek V4 high-reasoning thinking fields", () => {
    expect(withDeepSeekThinking({ model: "deepseek-v4-pro" })).toMatchObject({
      model: "deepseek-v4-pro",
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
  });

  it("reads Firecrawl monitor IDs from the completed-check data array", () => {
    expect(
      parseCompletedMonitorEvent({
        type: "monitor.check.completed",
        id: "top-level-check",
        data: [{ monitorId: "monitor-1", checkId: "check-1" }],
      }),
    ).toEqual({ monitorId: "monitor-1", checkId: "check-1" });
  });
});

describe("pipeline time zones", () => {
  it("uses Product Hunt's Los Angeles day and PKT draft cutoff", () => {
    const timestamp = Date.parse("2026-07-23T10:05:00.000Z");
    expect(productHuntDay(timestamp)).toBe("2026-07-23");
    expect(pktDay(timestamp)).toBe("2026-07-23");
    expect(isPastDraftStart(timestamp)).toBe(true);
  });

  it("keeps pre-cutoff research queued", () => {
    expect(isPastDraftStart(Date.parse("2026-07-23T10:04:00.000Z"))).toBe(
      false,
    );
  });
});
