/**
 * Pure mappings from ZCode Protocol payloads to T3 contract types.
 * Grounded in the live transcripts captured under oneday-evidence/transcripts/.
 * The protocol exposes no 5-hour or weekly rate-limit windows and no provider reset
 * times: those stay unavailable and no numbers are invented for them.
 */
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";

import type { UsageTokenTotals } from "@t3tools/contracts";
import type { UsageRecord } from "@t3tools/provider-core/server/usage";
import { EMPTY_TOTALS, tokenCount } from "@t3tools/provider-core/server/usage";

import type {
  ZcodeSessionStateUsage,
  ZcodeSessionUsageResult,
  ZcodeUsageStatsResult,
} from "./protocolTypes.ts";

const DAY_MS = 86_400_000;

/** "zcode:usage-stats:<yyyy-mm-dd>" keeps daily aggregate records stable for dedupe. */
const dailyRecordDedupeKey = (day: string): string => `zcode:usage-stats:${day}`;

export const USAGE_STATS_SCAN_PATH = "zcode://usage-stats";
export const SESSION_USAGE_SCAN_PATH = "zcode://session-usage";

function dateFromDay(day: string): number | null {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Maps usage/stats dailyModelUsage entries into per-day UsageRecords. Records are
 * aggregate per day (sessionId "usage-stats"), which the usage page accepts.
 */
export function usageStatsToRecords(stats: ZcodeUsageStatsResult): UsageRecord[] {
  const daily = stats.dailyModelUsage ?? [];
  const records: UsageRecord[] = [];
  for (const day of daily) {
    if (typeof day.date !== "string") continue;
    const timestampMs = dateFromDay(day.date);
    if (timestampMs === null) continue;
    const uncachedInput = Math.max(
      0,
      tokenCount(day.inputTokens) -
        tokenCount(day.cacheReadTokens) -
        tokenCount(day.cacheCreationTokens),
    );
    records.push({
      provider: "zcode",
      timestampMs,
      model: day.models?.[0]?.modelId ?? "aggregate",
      sessionId: "usage-stats",
      totals: {
        uncachedInputTokens: uncachedInput,
        cachedInputTokens: tokenCount(day.cacheReadTokens),
        cacheCreationTokens: tokenCount(day.cacheCreationTokens),
        outputTokens: tokenCount(day.outputTokens),
        reasoningTokens: tokenCount(day.reasoningTokens),
      },
      reportedCostUsd: null,
      speed: "standard",
      dedupeKey: dailyRecordDedupeKey(day.date),
    });
  }
  return records;
}

/** Maps session/usage cumulative totals into the T3 token totals shape. */
export function sessionUsageToTotals(usage: ZcodeSessionUsageResult): UsageTokenTotals {
  const input = tokenCount(usage.inputTokens);
  const cacheRead = tokenCount(usage.cacheReadTokens);
  const cacheCreation = tokenCount(usage.cacheCreationTokens);
  return {
    uncachedInputTokens: Math.max(0, input - cacheRead - cacheCreation),
    cachedInputTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    outputTokens: tokenCount(usage.outputTokens),
    reasoningTokens: tokenCount(usage.reasoningTokens),
  };
}

/** Context used vs the model context window, 0..100, or null when either side is unknown. */
export function contextWindowUsedPercent(usedTokens: unknown, maxTokens: unknown): number | null {
  if (typeof usedTokens !== "number" || !Number.isFinite(usedTokens) || usedTokens < 0) return null;
  if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0) return null;
  return Math.min(100, Math.round((usedTokens / maxTokens) * 1000) / 10);
}

export const SESSION_CONTEXT_WINDOW_ID = "zcode-context-window";

/**
 * Session context usage as a "session" usage window. Only produced when the live session
 * state reports both used and max tokens; the 5-hour and weekly rate-limit windows are
 * NOT available from the ZCode Protocol and are reported as unsupported instead.
 */
export function sessionContextUsageWindow(
  usage: ZcodeSessionStateUsage | undefined,
  checkedAt: string,
): ServerProviderUsageWindow | undefined {
  const used = usage?.contextWindow?.usedTokens;
  const max = usage?.contextWindow?.maxTokens;
  const percent = contextWindowUsedPercent(used, max);
  if (percent === null) return undefined;
  const window: ServerProviderUsageWindow = {
    id: SESSION_CONTEXT_WINDOW_ID,
    kind: "session",
    label: "Context window",
    usedPercent: percent,
  };
  return window;
}

/** Honest usage limits: available context data, explicit unsupported reason for the rest. */
export function usageLimitsFromAvailability(input: {
  readonly checkedAt: string;
  readonly contextUsage?: ZcodeSessionStateUsage | undefined;
}): ServerProviderUsageLimits {
  const contextWindow = sessionContextUsageWindow(input.contextUsage, input.checkedAt);
  return {
    checkedAt: input.checkedAt,
    windows: contextWindow === undefined ? [] : [contextWindow],
    unavailable: {
      reason: "unsupported",
      message:
        "The ZCode Protocol does not expose 5-hour or weekly rate-limit windows or provider reset times. Only live session context usage is measurable.",
    },
  };
}

/** Maps a live session state usage block into the thread token usage snapshot. */
export function sessionStateUsageToSnapshot(
  usage: ZcodeSessionStateUsage | undefined,
): { usedTokens: number; maxTokens?: number; autoCompactThreshold?: number } | null {
  const used = usage?.contextWindow?.usedTokens;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return null;
  const max = usage?.contextWindow?.maxTokens;
  const threshold = usage?.contextWindow?.autoCompactThresholdTokens;
  return {
    usedTokens: Math.trunc(used),
    ...(typeof max === "number" && Number.isFinite(max) && max > 0
      ? { maxTokens: Math.trunc(max) }
      : {}),
    ...(typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0
      ? { autoCompactThreshold: Math.trunc(threshold) }
      : {}),
  };
}

/** Empty totals for readers that cannot reach a source. */
export const emptyTotals = (): UsageTokenTotals => ({ ...EMPTY_TOTALS });
