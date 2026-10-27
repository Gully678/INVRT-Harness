// @effect-diagnostics nodeBuiltinImport:off -- Adapter tests drive real temp scripts and spawn the fake CLI by path, so node fs/path are required.
import { describe, expect, it } from "@effect/vitest";

import { chmod } from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProviderSessionId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  makeZcodeAdapterV2,
  snapshotAppThreadId,
  ZCODE_DEFAULT_INSTANCE_ID,
  ZCODE_PROVIDER,
} from "./adapter.ts";
import { startFakeZcodeAppServer } from "./fakeServer.ts";
import { ZCodeSettings } from "../settings.ts";

describe("readThreadSnapshot app thread id fallback", () => {
  it("keeps the orchestrator-assigned app thread id when present", () => {
    const assigned = ThreadId.make("thread:app:assigned");
    expect(snapshotAppThreadId(assigned, "sess_native_1")).toBe(assigned);
  });

  it("derives a per-provider-thread id instead of one constant when appThreadId is null", () => {
    // Different provider threads (native session ids) must never share a snapshot
    // thread id; the constant "thread:provider:zcode:snapshot" fallback grouped them.
    const first = snapshotAppThreadId(null, "sess_native_1");
    const second = snapshotAppThreadId(null, "sess_native_2");
    expect(first).not.toEqual(second);
    expect(first).toBe(snapshotAppThreadId(null, "sess_native_1"));
    expect(first).toContain(String(ZCODE_PROVIDER));
    expect(first).toContain("sess_native_1");
  });
});

const decodeSettings = Schema.decodeSync(ZCodeSettings);

const policy = (runtimeMode: string, interactionMode: string) =>
  ({ runtimeMode, interactionMode, cwd: null }) as never;

const modelSelection = { provider: "zcode", model: "zcode-default" } as never;

/**
 * Runs the adapter against the fake app-server and returns the exact session/send
 * request frames it received. The adapter spawns the fake by path, so the script needs
 * its executable bit like the real CLI.
 */
const sendFramesFor = async (
  turnPolicy: unknown,
): Promise<ReadonlyArray<Record<string, unknown>>> => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-adapter-"));
  const sendLog = join(dir, "send-log.ndjson");
  const fake = await startFakeZcodeAppServer({
    sessionCreateSessionId: "sess_plan",
    sessionSendLog: sendLog,
  });
  try {
    await chmod(fake.command[1]!, 0o755);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = yield* makeZcodeAdapterV2({
            instanceId: ZCODE_DEFAULT_INSTANCE_ID,
            settings: decodeSettings({ enabled: true, binaryPath: fake.command[1] }),
            environment: { ...process.env },
          });
          const threadId = ThreadId.make("thread:za01");
          const runtime = yield* adapter.openSession({
            threadId,
            providerSessionId: ProviderSessionId.make("session:za01"),
            modelSelection,
            runtimePolicy: policy("approval-required", "default"),
          });
          const thread = yield* runtime.ensureThread({
            threadId,
            modelSelection,
            runtimePolicy: policy("approval-required", "default"),
          });
          yield* runtime.startTurn({
            threadId: ThreadId.make("thread:za01"),
            runId: "run:za01" as never,
            runOrdinal: 1,
            providerTurnOrdinal: 1,
            attemptId: "run-attempt:za01" as never,
            rootNodeId: "node:za01" as never,
            providerThread: thread,
            message: { messageId: "msg:za01" as never, text: "plan only" },
            modelSelection,
            runtimePolicy: turnPolicy as never,
            appThread: {} as never,
          } as never);
        }),
      ),
    );
    const raw = await readFile(sendLog, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } finally {
    await fake.dispose();
    await rm(dir, { recursive: true, force: true });
  }
};

describe("startTurn interaction policy (ZA-01)", () => {
  it("a plan interaction sends the native plan mode, never a build/edit/yolo mode", async () => {
    const frames = await sendFramesFor(policy("full-access", "plan"));
    expect(frames).toHaveLength(1);
    const frame = frames[0]!;
    expect(frame.method).toBe("session/send");
    const params = frame.params as { sessionId: string; content: string; mode: string };
    expect(params.sessionId).toBe("sess_plan");
    expect(params.content).toBe("plan only");
    expect(params.mode).toBe("plan");
    expect(["build", "edit", "yolo"]).not.toContain(params.mode);
  }, 30_000);

  it("keeps the default interaction mapping unchanged: full-access still sends yolo", async () => {
    const frames = await sendFramesFor(policy("full-access", "default"));
    expect(frames).toHaveLength(1);
    const params = frames[0]!.params as { mode: string };
    expect(params.mode).toBe("yolo");
  }, 30_000);

  it("a plan interaction holds for approval-required and auto-accept-edits runtime modes too", async () => {
    for (const runtimeMode of ["approval-required", "auto-accept-edits"]) {
      const frames = await sendFramesFor(policy(runtimeMode, "plan"));
      expect(frames).toHaveLength(1);
      const params = frames[0]!.params as { mode: string };
      expect(params.mode).toBe("plan");
    }
  }, 30_000);
});

describe("adapter command resolution (ZA-02)", () => {
  it("openSession resolves a tilde override through the shared resolver", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-tilde-"));
    const fake = await startFakeZcodeAppServer({ sessionCreateSessionId: "sess_tilde" });
    try {
      const fakeBin = join(dir, "fakebin", "zcode");
      const { mkdir, writeFile, chmod } = await import("node:fs/promises");
      await mkdir(join(dir, "fakebin"), { recursive: true });
      const { fakeServerScriptSource } = await import("./fakeServer.ts");
      await writeFile(
        fakeBin,
        fakeServerScriptSource({ sessionCreateSessionId: "sess_tilde" }),
        "utf8",
      );
      await chmod(fakeBin, 0o755);
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const adapter = yield* makeZcodeAdapterV2({
              instanceId: ZCODE_DEFAULT_INSTANCE_ID,
              settings: decodeSettings({ enabled: true, binaryPath: "~/fakebin/zcode" }),
              environment: { ...process.env, HOME: dir },
            });
            const threadId = ThreadId.make("thread:za02");
            const runtime = yield* adapter.openSession({
              threadId,
              providerSessionId: ProviderSessionId.make("session:za02"),
              modelSelection,
              runtimePolicy: policy("approval-required", "default"),
            });
            // ensureThread round-trips session/create against the resolved command.
            yield* runtime.ensureThread({
              threadId,
              modelSelection,
              runtimePolicy: policy("approval-required", "default"),
            });
          }),
        ),
      );
    } finally {
      await fake.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("post-start context usage publication (ZA-03)", () => {
  // A usage-only session/event payload arriving after the thread started must reach the
  // real projection caller: the adapter's own events stream, not only the private ref.
  it("publishes provider_thread.updated with the new context usage after thread start", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-usage-"));
    const fake = await startFakeZcodeAppServer({
      sessionCreateSessionId: "sess_usage",
      turnEvents: [
        {
          eventId: "u1",
          sessionId: "sess_usage",
          deliveryKind: "main",
          payload: {
            usage: { contextWindow: { usedTokens: 400, maxTokens: 1000 } },
          },
        },
      ],
    });
    try {
      await chmod(fake.command[1]!, 0o755);
      const events = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const adapter = yield* makeZcodeAdapterV2({
              instanceId: ZCODE_DEFAULT_INSTANCE_ID,
              settings: decodeSettings({ enabled: true, binaryPath: fake.command[1] }),
              environment: { ...process.env },
            });
            const threadId = ThreadId.make("thread:za03");
            const runtime = yield* adapter.openSession({
              threadId,
              providerSessionId: ProviderSessionId.make("session:za03"),
              modelSelection,
              runtimePolicy: policy("approval-required", "default"),
            });
            const thread = yield* runtime.ensureThread({
              threadId,
              modelSelection,
              runtimePolicy: policy("approval-required", "default"),
            });
            // Initial snapshot has no usage yet.
            expect(thread.contextUsage).toBeNull();
            const collected: unknown[] = [];
            const collectFiber = yield* Stream.runForEach(runtime.events, (event) =>
              Effect.sync(() => {
                collected.push(event);
              }),
            ).pipe(Effect.forkScoped);
            yield* runtime.startTurn({
              threadId,
              runId: "run:za03" as never,
              runOrdinal: 1,
              providerTurnOrdinal: 1,
              attemptId: "run-attempt:za03" as never,
              rootNodeId: "node:za03" as never,
              providerThread: thread,
              message: { messageId: "msg:za03" as never, text: "hi" },
              modelSelection,
              runtimePolicy: policy("approval-required", "default"),
              appThread: {} as never,
            } as never);
            // The fake emits the usage notification right after the send reply.
            yield* Effect.sleep("400 millis");
            yield* Fiber.interrupt(collectFiber);
            return collected;
          }),
        ),
      );
      const threadUpdates = (events as ReadonlyArray<Record<string, unknown>>).filter(
        (event) => event.type === "provider_thread.updated",
      );
      // ensureThread published one; the post-start usage notification must add another.
      expect(threadUpdates.length).toBeGreaterThanOrEqual(2);
      const latest = threadUpdates[threadUpdates.length - 1]!.providerThread as {
        contextUsage: { usedTokens: number; maxTokens: number } | null;
      };
      expect(latest.contextUsage).not.toBeNull();
      expect(latest.contextUsage?.usedTokens).toBe(400);
      expect(latest.contextUsage?.maxTokens).toBe(1000);
    } finally {
      await fake.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
