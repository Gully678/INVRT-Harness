/**
 * ZCode usage reader: scan kind over the app-server usage/stats payload.
 *
 * The scan starts one short-lived app-server process, calls usage/stats for each window
 * the request needs, maps dailyModelUsage entries into UsageRecords, and disposes the
 * process. Records are aggregate per day; the protocol provides no per-request records.
 */
import type { ZCodeSettings } from "../settings.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { UsageReadError } from "@t3tools/contracts";

import type {
  ProviderUsageInstance,
  ProviderUsageScan,
  ProviderUsageScanInput,
} from "@t3tools/provider-core/server/usage";
import { usageStatsToRecords } from "./mapping.ts";
import type { ZcodeUsageStatsResult } from "./protocolTypes.ts";
import { appServerCommand, startZcodeProtocolClient } from "./protocol.ts";
import { ZCODE_APP_BUNDLE_CLI } from "./status.ts";

const USAGE_STATS_TIMEOUT_MS = 45_000;

const rangeForWindowMs = (windowMs: number): "7d" | "30d" | "all" => {
  const days = windowMs / 86_400_000;
  if (days <= 7.5) return "7d";
  if (days <= 31) return "30d";
  return "all";
};

export const fetchZcodeUsageStats = (input: {
  readonly commandPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly range: "7d" | "30d" | "all";
}): Effect.Effect<ZcodeUsageStatsResult, UsageReadError> =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      startZcodeProtocolClient({
        command: appServerCommand(input.commandPath),
        env: input.env,
        requestTimeoutMs: USAGE_STATS_TIMEOUT_MS,
        handlers: {
          requestRuntimePreferences: () => ({
            nativeSearchEnhancementsEnabled: false,
            memoryEnabled: false,
            askUserQuestionAutoResolutionEnabled: true,
            modelContextBudgetStrategy: "preflight-v1",
          }),
        },
      }),
    ),
    (client) =>
      Effect.tryPromise({
        try: () =>
          client.request("usage/stats", { range: input.range }) as Promise<ZcodeUsageStatsResult>,
        catch: (cause) =>
          new UsageReadError({
            reason: "scanFailed",
            detail: `ZCode usage/stats failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      }),
    (client) => Effect.promise(() => client.dispose()),
  );

export const zcodeUsageScan = Effect.fn("ZcodeUsage.scan")(function* (
  input: ProviderUsageScanInput<ZCodeSettings>,
) {
  const scans: ProviderUsageScan[] = [];
  for (const instance of input.instances) {
    if (!instance.configured) continue;
    const commandPath = resolveCommandPath(instance);
    const range = rangeForWindowMs(Math.max(input.windowStartMs, input.retentionCutoffMs));
    const stats = yield* fetchZcodeUsageStats({
      commandPath,
      env: instance.environment,
      range,
    });
    const generatedAtIso = DateTime.formatIso(DateTime.makeUnsafe(stats.generatedAt));
    scans.push({
      dir: "zcode://usage-stats",
      status: "ok",
      message: `ZCode usage/stats (${range}) generated at ${generatedAtIso}.`,
      files: [
        {
          path: "zcode://usage-stats",
          records: usageStatsToRecords(stats),
        },
      ],
    });
  }
  return scans;
});

function resolveCommandPath(instance: ProviderUsageInstance<ZCodeSettings>): string {
  const configured = instance.config?.binaryPath?.trim() ?? "";
  return configured.length > 0 ? configured : ZCODE_APP_BUNDLE_CLI;
}

export const zcodeUsageReader = {
  kind: "scan",
  provider: "zcode",
  scan: zcodeUsageScan,
} as const;
