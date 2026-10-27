import { describe, expect, it } from "@effect/vitest";

import {
  contextWindowUsedPercent,
  sessionContextUsageWindow,
  sessionStateUsageToSnapshot,
  sessionUsageToTotals,
  usageLimitsFromAvailability,
  usageStatsToRecords,
} from "./mapping.ts";
import type { ZcodeUsageStatsResult, ZcodeSessionUsageResult } from "./protocolTypes.ts";

// Shape captured live in oneday-evidence/transcripts/t3-usage-long.json (values reduced).
const USAGE_STATS: ZcodeUsageStatsResult = {
  range: "all",
  generatedAt: 1793065588724,
  timeZone: "UTC",
  source: "agent-db",
  summary: {
    totalTokens: 37794271227,
    inputTokens: 37708756099,
    outputTokens: 85515128,
    favoriteModel: { modelId: "GLM-5.3-Flash", totalTokens: 37767981071 },
  },
  dailyModelUsage: [
    {
      date: "2026-10-26",
      totalTokens: 1000,
      inputTokens: 800,
      outputTokens: 200,
      reasoningTokens: 20,
      cacheReadTokens: 700,
      cacheCreationTokens: 0,
      turnCount: 3,
      models: [{ modelId: "GLM-5.3-Flash", totalTokens: 1000 }],
    },
    { date: "not-a-date", totalTokens: 5 },
  ],
};

// Shape captured live in oneday-evidence/transcripts/t5-workspace.json.
const SESSION_USAGE: ZcodeSessionUsageResult = {
  sessionId: "sess_4b52709b-72ce-4246-ba8e-c64ccfd321ee",
  totalTokens: 933556,
  inputTokens: 895758,
  outputTokens: 37798,
  reasoningTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  modelRequestCount: 54,
  modelErrorCount: 0,
  inputBaselineBySource: { main_turn: 320944 },
};

describe("usageStatsToRecords", () => {
  it("maps daily usage entries into per-day records with stable dedupe keys", () => {
    const records = usageStatsToRecords(USAGE_STATS);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.provider).toBe("zcode");
    expect(record.sessionId).toBe("usage-stats");
    expect(record.dedupeKey).toBe("zcode:usage-stats:2026-10-26");
    expect(record.model).toBe("GLM-5.3-Flash");
    // input 800 minus 700 cache reads equals 100 uncached input tokens.
    expect(record.totals.uncachedInputTokens).toBe(100);
    expect(record.totals.cachedInputTokens).toBe(700);
    expect(record.totals.outputTokens).toBe(200);
    expect(record.timestampMs).toBe(Date.parse("2026-10-26T00:00:00Z"));
  });

  it("skips entries without a valid date", () => {
    const records = usageStatsToRecords({ ...USAGE_STATS, dailyModelUsage: [{ totalTokens: 5 }] });
    expect(records).toHaveLength(0);
  });

  it("returns no records when dailyModelUsage is missing", () => {
    expect(usageStatsToRecords({ range: "all", generatedAt: 0 })).toHaveLength(0);
  });
});

describe("sessionUsageToTotals", () => {
  it("maps the live session/usage payload into T3 token totals", () => {
    const totals = sessionUsageToTotals(SESSION_USAGE);
    expect(totals).toEqual({
      uncachedInputTokens: 895758,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 37798,
      reasoningTokens: 0,
    });
  });

  it("splits cache reads out of input tokens", () => {
    const totals = sessionUsageToTotals({
      ...SESSION_USAGE,
      inputTokens: 1000,
      cacheReadTokens: 400,
      cacheCreationTokens: 100,
    });
    expect(totals.uncachedInputTokens).toBe(500);
    expect(totals.cachedInputTokens).toBe(400);
    expect(totals.cacheCreationTokens).toBe(100);
  });
});

describe("context window usage", () => {
  it("computes percent from live session state usage", () => {
    expect(contextWindowUsedPercent(500, 1000)).toBe(50);
    expect(contextWindowUsedPercent(1, 3)).toBe(33.3);
    expect(contextWindowUsedPercent(0, 100)).toBe(0);
  });

  it("returns null when either side is unknown (never invents a number)", () => {
    expect(contextWindowUsedPercent(undefined, 1000)).toBeNull();
    expect(contextWindowUsedPercent(500, undefined)).toBeNull();
    expect(contextWindowUsedPercent(500, 0)).toBeNull();
    expect(contextWindowUsedPercent(-5, 100)).toBeNull();
  });

  it("caps at 100", () => {
    expect(contextWindowUsedPercent(1500, 1000)).toBe(100);
  });
});

describe("usageLimitsFromAvailability", () => {
  it("reports the 5-hour and weekly windows as unsupported and includes context when live", () => {
    const limits = usageLimitsFromAvailability({
      checkedAt: "2026-10-27T00:00:00.000Z",
      contextUsage: {
        contextWindow: { usedTokens: 400, maxTokens: 1000, autoCompactThresholdTokens: 900 },
      },
    });
    expect(limits.checkedAt).toBe("2026-10-27T00:00:00.000Z");
    expect(limits.windows).toEqual([
      {
        id: "zcode-context-window",
        kind: "session",
        label: "Context window",
        usedPercent: 40,
      },
    ]);
    expect(limits.unavailable?.reason).toBe("unsupported");
    expect(limits.unavailable?.message).toContain("5-hour");
    expect(limits.unavailable?.message).toContain("weekly");
  });

  it("keeps windows empty when no live context usage exists", () => {
    const limits = usageLimitsFromAvailability({ checkedAt: "2026-10-27T00:00:00.000Z" });
    expect(limits.windows).toEqual([]);
    expect(limits.unavailable?.reason).toBe("unsupported");
  });
});

describe("sessionStateUsageToSnapshot", () => {
  it("maps the bundle session-state usage block into a thread token snapshot", () => {
    const snapshot = sessionStateUsageToSnapshot({
      contextWindow: { usedTokens: 1234, maxTokens: 200000, autoCompactThresholdTokens: 180000 },
    });
    expect(snapshot).toEqual({ usedTokens: 1234, maxTokens: 200000, autoCompactThreshold: 180000 });
  });

  it("returns null without a usable usedTokens value", () => {
    expect(sessionStateUsageToSnapshot(undefined)).toBeNull();
    expect(sessionStateUsageToSnapshot({ contextWindow: null })).toBeNull();
    expect(sessionStateUsageToSnapshot({ contextWindow: { maxTokens: 100 } })).toBeNull();
  });
});

describe("sessionContextUsageWindow", () => {
  it("builds a session-kind window only when the data supports it", () => {
    const window = sessionContextUsageWindow(
      { contextWindow: { usedTokens: 250, maxTokens: 1000 } },
      "2026-10-27T00:00:00.000Z",
    );
    expect(window).toEqual({
      id: "zcode-context-window",
      kind: "session",
      label: "Context window",
      usedPercent: 25,
    });
    expect(
      sessionContextUsageWindow({ contextWindow: { usedTokens: 250 } }, "2026-10-27T00:00:00.000Z"),
    ).toBeUndefined();
  });
});
