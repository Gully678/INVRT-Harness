// @effect-diagnostics nodeBuiltinImport:off -- The fake server script needs a real executable bit so the usage reader can spawn it by path, like the real CLI.
import { describe, expect, it } from "@effect/vitest";

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProviderInstanceId, ServerSettings } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ZCodeSettings } from "../settings.ts";
import { startFakeZcodeAppServer } from "./fakeServer.ts";
import { zcodeUsageScan } from "./usage.ts";

const decodeSettings = Schema.decodeSync(ZCodeSettings);
const decodeServerSettings = Schema.decodeSync(ServerSettings);

// Shape captured live in oneday-evidence/transcripts/t3-usage-long.json (values reduced).
const USAGE_STATS_FIXTURE = {
  range: "all",
  generatedAt: 1793065588724,
  timeZone: "UTC",
  source: "agent-db",
  summary: {
    totalTokens: 1000,
    inputTokens: 800,
    outputTokens: 200,
    favoriteModel: { modelId: "GLM-5.3-Flash", totalTokens: 1000 },
  },
  dailyModelUsage: [
    {
      date: "2026-10-26",
      totalTokens: 1000,
      inputTokens: 800,
      outputTokens: 200,
      cacheReadTokens: 700,
      models: [{ modelId: "GLM-5.3-Flash", totalTokens: 1000 }],
    },
  ],
};

const scanInput = (instances: Parameters<typeof zcodeUsageScan>[0]["instances"]) => ({
  instances,
  settings: decodeServerSettings({}),
  // Fixed bounds keep the scan inside the "7d" range bucket and stay deterministic.
  windowStartMs: 1_793_000_000_000 - 2 * 86_400_000,
  retentionCutoffMs: 1_793_000_000_000 - 30 * 86_400_000,
  awaitRefresh: false,
});

describe("zcodeUsageScan per-instance isolation", () => {
  it("records a failed scan for a broken instance and still scans the others", async () => {
    const fake = await startFakeZcodeAppServer({ usageStats: USAGE_STATS_FIXTURE });
    try {
      // The usage reader spawns `[binaryPath, "app-server"]`; the fake carries a node
      // shebang, so making it executable lets the scan launch it by path like the real CLI.
      await chmod(fake.command[1]!, 0o755);
      // Real callers pass the merged instance environment; the fake's node shebang needs
      // PATH, so an empty env here would fail the healthy instance for the wrong reason.
      const environment = { ...process.env };
      const scans = await Effect.runPromise(
        zcodeUsageScan(
          scanInput([
            {
              instanceId: ProviderInstanceId.make("zcode-broken"),
              config: decodeSettings({
                enabled: true,
                binaryPath: "/nonexistent/zcode-binary",
              }),
              environment,
              configured: true,
            },
            {
              instanceId: ProviderInstanceId.make("zcode-working"),
              config: decodeSettings({ enabled: true, binaryPath: fake.command[1]! }),
              environment,
              configured: true,
            },
          ]),
        ),
      );
      expect(scans).toHaveLength(2);
      expect(scans[0]).toMatchObject({
        dir: "zcode://usage-stats",
        status: "failed",
        files: null,
      });
      expect(scans[0]?.message).toContain("zcode-broken");
      expect(scans[1]).toMatchObject({ dir: "zcode://usage-stats", status: "ok" });
      expect(scans[1]?.files?.[0]?.records.length).toBeGreaterThan(0);
    } finally {
      await fake.dispose();
    }
  }, 60_000);

  // ZA-06 regression: usage/stats receives a range DURATION selector (7d/30d/all), not an
  // epoch timestamp. The recorded request params prove which bucket the scan asks for.
  describe("requested range bucket", () => {
    const scanRange = async (windowStartMs: number, retentionCutoffMs: number) => {
      const dir = await mkdtemp(join(tmpdir(), "zcode-range-"));
      const statsLog = join(dir, "stats-log.ndjson");
      const fake = await startFakeZcodeAppServer({
        usageStats: USAGE_STATS_FIXTURE,
        usageStatsLog: statsLog,
      });
      try {
        await chmod(fake.command[1]!, 0o755);
        const environment = { ...process.env };
        const scans = await Effect.runPromise(
          zcodeUsageScan({
            instances: [
              {
                instanceId: ProviderInstanceId.make("zcode-range"),
                config: decodeSettings({ enabled: true, binaryPath: fake.command[1] }),
                environment,
                configured: true,
              },
            ],
            settings: decodeServerSettings({}),
            windowStartMs,
            retentionCutoffMs,
            awaitRefresh: false,
          }),
        );
        expect(scans[0]?.status).toBe("ok");
        const raw = await readFile(statsLog, "utf8");
        const frames = raw
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as { params?: { range?: string } });
        expect(frames).toHaveLength(1);
        return frames[0]!.params?.range;
      } finally {
        await fake.dispose();
        await rm(dir, { recursive: true, force: true });
      }
    };

    it("asks for 7d when the retained window is two days old", async () => {
      const now = await Effect.runPromise(Clock.currentTimeMillis);
      expect(await scanRange(now - 2 * 86_400_000, now - 40 * 86_400_000)).toBe("7d");
    }, 60_000);

    it("asks for 30d when the retained window is 28 days old", async () => {
      const now = await Effect.runPromise(Clock.currentTimeMillis);
      expect(await scanRange(now - 28 * 86_400_000, now - 40 * 86_400_000)).toBe("30d");
    }, 60_000);

    it("asks for all when the retained window is older than the 30d bucket", async () => {
      const now = await Effect.runPromise(Clock.currentTimeMillis);
      expect(await scanRange(now - 400 * 86_400_000, now - 500 * 86_400_000)).toBe("all");
    }, 60_000);
  });
});
