import { createModelCapabilities } from "@t3tools/shared/model";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";
import * as Stream from "effect/Stream";
import * as Sink from "effect/Sink";
import {
  ClaudeSettings,
  CodexSettings,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { checkClaudeProviderStatus, type ClaudeCapabilitiesProbe } from "./ClaudeProvider.ts";
import { checkCodexProviderStatus, type CodexAppServerProviderSnapshot } from "./CodexProvider.ts";
import * as ProviderCredentialStore from "./ProviderCredentialStore.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);
const decodeCodexSettings = Schema.decodeSync(CodexSettings);
const encoder = new TextEncoder();

function mockHandle(result: { stdout: string; stderr: string; code: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout)),
    stderr: Stream.make(encoder.encode(result.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

const layerVersionSpawner = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() =>
    Effect.succeed(mockHandle({ stdout: "1.0.0\n", stderr: "", code: 0 })),
  ),
);

function claudeProbe(
  overrides: Partial<ClaudeCapabilitiesProbe>,
): () => Effect.Effect<ClaudeCapabilitiesProbe> {
  return () =>
    Effect.succeed({
      email: undefined,
      subscriptionType: undefined,
      tokenSource: undefined,
      apiKeySource: undefined,
      apiProvider: "firstParty",
      slashCommands: [],
      ...overrides,
    });
}

function codexSnapshot(
  input: Partial<CodexAppServerProviderSnapshot> = {},
): CodexAppServerProviderSnapshot {
  return {
    version: "1.0.0",
    account: {
      account: { type: "chatgpt", email: "a@example.com", planType: "pro" },
      requiresOpenaiAuth: false,
    },
    models: [
      {
        slug: "gpt-live",
        name: "GPT Live",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
    skills: [],
    ...input,
  };
}

const meteredCodexEnv = { OPENAI_API_KEY: "metered-test-key" };

it.effect(
  "keeps an exhausted ChatGPT subscription off the API-key route when a metered key is present",
  () =>
    Effect.gen(function* () {
      const status = yield* checkCodexProviderStatus(
        decodeCodexSettings({}),
        () =>
          Effect.succeed(
            codexSnapshot({
              rateLimits: {
                snapshot: {
                  planType: "pro",
                  primary: { usedPercent: 100, resetsAt: 1_800_000_000, windowDurationMins: 300 },
                },
                resetCredits: null,
              },
            }),
          ),
        meteredCodexEnv,
      );
      assert.strictEqual(status.auth.status, "authenticated");
      assert.strictEqual(status.auth.type, "chatgpt");
      assert.notStrictEqual(status.auth.type, "apiKey");
      assert.strictEqual(status.usageLimits?.windows[0]?.usedPercent, 100);
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "does not promote a missing Codex login to an API key when a metered key is present",
  () =>
    Effect.gen(function* () {
      const status = yield* checkCodexProviderStatus(
        decodeCodexSettings({}),
        () =>
          Effect.succeed(
            codexSnapshot({
              account: { account: null, requiresOpenaiAuth: true },
              models: [],
            }),
          ),
        meteredCodexEnv,
      );
      assert.strictEqual(status.status, "error");
      assert.strictEqual(status.auth.status, "unauthenticated");
      assert.strictEqual(status.auth.type, undefined);
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("leaves a missing Codex model catalog and usage response unknown", () =>
  Effect.gen(function* () {
    const status = yield* checkCodexProviderStatus(decodeCodexSettings({}), () =>
      Effect.succeed(codexSnapshot({ models: undefined })),
    );
    assert.strictEqual(status.status, "warning");
    assert.deepStrictEqual(status.models, []);
    assert.strictEqual(status.auth.type, "chatgpt");
    assert.deepStrictEqual(status.usageLimits?.windows, []);
    assert.strictEqual(status.usageLimits?.unavailable?.reason, "probeFailed");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses to label a Claude subscription as an API key when the quota is exhausted", () =>
  Effect.gen(function* () {
    const status = yield* checkClaudeProviderStatus(
      decodeClaudeSettings({}),
      claudeProbe({
        subscriptionType: "pro",
        tokenSource: "apiKey",
        apiKeySource: "ANTHROPIC_API_KEY",
        usage: {
          rate_limits_available: true,
          rate_limits: {
            five_hour: { utilization: 100, resets_at: "2026-11-12T00:00:00Z" },
          },
        },
      }),
      { ANTHROPIC_API_KEY: "" },
    );
    assert.strictEqual(status.auth.status, "unknown");
    assert.strictEqual(status.status, "error");
    assert.strictEqual(status.auth.type, "pro");
    assert.notStrictEqual(status.auth.type, "apiKey");
    assert.ok(status.message?.includes("Refused automatic paid fallback"));
    assert.strictEqual(status.usageLimits?.windows[0]?.usedPercent, 100);
  }).pipe(Effect.provide(layerVersionSpawner), Effect.provide(NodeServices.layer)),
);

it.effect("records a refusal when a Claude subscription is present beside an API key", () =>
  Effect.gen(function* () {
    const status = yield* checkClaudeProviderStatus(
      decodeClaudeSettings({}),
      claudeProbe({
        subscriptionType: "pro",
        tokenSource: "none",
        apiKeySource: "ANTHROPIC_API_KEY",
      }),
      { ANTHROPIC_API_KEY: "" },
    );
    assert.strictEqual(status.auth.type, "pro");
    assert.notStrictEqual(status.auth.type, "apiKey");
    assert.ok(status.message?.includes("Refused automatic paid fallback"));
  }).pipe(Effect.provide(layerVersionSpawner), Effect.provide(NodeServices.layer)),
);

it.effect(
  "keeps a Claude API-key install on the API-key route when no subscription is reported",
  () =>
    Effect.gen(function* () {
      const status = yield* checkClaudeProviderStatus(
        decodeClaudeSettings({}),
        claudeProbe({
          tokenSource: "apiKey",
          apiKeySource: "ANTHROPIC_API_KEY",
        }),
        { ANTHROPIC_API_KEY: "explicit-instance-key" },
      );
      assert.strictEqual(status.auth.status, "authenticated");
      assert.strictEqual(status.auth.type, "apiKey");
      assert.strictEqual(
        status.message?.includes("Refused automatic paid fallback") ?? false,
        false,
      );
    }).pipe(Effect.provide(layerVersionSpawner), Effect.provide(NodeServices.layer)),
);

it.effect("leaves a missing Claude account response unknown", () =>
  Effect.gen(function* () {
    const status = yield* checkClaudeProviderStatus(decodeClaudeSettings({}), () =>
      Effect.succeed(Option.getOrUndefined(Option.none<ClaudeCapabilitiesProbe>())),
    );
    assert.strictEqual(status.auth.status, "unknown");
    assert.strictEqual(status.auth.type, undefined);
    assert.strictEqual(status.usageLimits, undefined);
  }).pipe(Effect.provide(layerVersionSpawner), Effect.provide(NodeServices.layer)),
);

it.effect("leaves a successful empty Claude account response unknown", () =>
  Effect.gen(function* () {
    const status = yield* checkClaudeProviderStatus(decodeClaudeSettings({}), claudeProbe({}));
    assert.strictEqual(status.auth.status, "unknown");
    assert.strictEqual(status.status, "warning");
    assert.strictEqual(status.auth.type, undefined);
    assert.strictEqual(status.usageLimits, undefined);
  }).pipe(Effect.provide(layerVersionSpawner), Effect.provide(NodeServices.layer)),
);

it.effect("leaves a missing Claude usage response unknown", () =>
  Effect.gen(function* () {
    const status = yield* checkClaudeProviderStatus(
      decodeClaudeSettings({}),
      claudeProbe({ subscriptionType: "pro", tokenSource: "claude.ai" }),
    );
    assert.strictEqual(status.auth.type, "pro");
    assert.deepStrictEqual(status.usageLimits?.windows, []);
    assert.strictEqual(status.usageLimits?.unavailable?.reason, "probeFailed");
  }).pipe(Effect.provide(layerVersionSpawner), Effect.provide(NodeServices.layer)),
);

it.effect("revoking one provider instance leaves a different instance usable", () =>
  Effect.gen(function* () {
    const data = new Map<string, Uint8Array>();
    const secretStore = ServerSecretStore.ServerSecretStore.of({
      get: (name) => Effect.sync(() => Option.fromUndefinedOr(data.get(name))),
      set: (name, value) =>
        Effect.sync(() => {
          data.set(name, value);
        }),
      remove: (name) =>
        Effect.sync(() => {
          data.delete(name);
        }),
      create: () => Effect.die("unused"),
      getOrCreateRandom: () => Effect.die("unused"),
    });
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore));
    for (const driver of ["codex", "claudeAgent", "grok"] as const) {
      const revoked = yield* provide(ProviderCredentialStore.make(driver, `${driver}-a`));
      const kept = yield* provide(ProviderCredentialStore.make(driver, `${driver}-b`));
      const revokedBytes = Uint8Array.from([1, driver.length]);
      const keptBytes = Uint8Array.from([2, driver.length]);
      yield* provide(revoked.set(revokedBytes));
      yield* provide(kept.set(keptBytes));
      assert.notStrictEqual(revoked.binding.key, kept.binding.key);
      yield* provide(revoked.remove);
      assert.isTrue(Option.isNone(yield* provide(revoked.get)));
      assert.deepStrictEqual(Option.getOrThrow(yield* provide(kept.get)), keptBytes);
    }
  }).pipe(Effect.provide(NodeCrypto.layer)),
);

it.effect("two provider instances do not read each other's session output", () =>
  Effect.gen(function* () {
    const sessions = yield* McpProviderSessions.McpProviderSessions;
    const environmentId = EnvironmentId.make("env-route-qualification");
    const threadA = ThreadId.make("thread-codex-a");
    const threadB = ThreadId.make("thread-claude-b");
    yield* sessions.set({
      environmentId,
      threadId: threadA,
      providerSessionId: "session-a",
      providerInstanceId: ProviderInstanceId.make("codex-a"),
      endpoint: "http://127.0.0.1/a",
      authorizationHeader: "Bearer output-a",
      browserToolsAvailable: false,
    });
    yield* sessions.set({
      environmentId,
      threadId: threadB,
      providerSessionId: "session-b",
      providerInstanceId: ProviderInstanceId.make("claude-b"),
      endpoint: "http://127.0.0.1/b",
      authorizationHeader: "Bearer output-b",
      browserToolsAvailable: false,
    });
    const readA = yield* sessions.read(threadA);
    const readB = yield* sessions.read(threadB);
    assert.strictEqual(readA?.providerInstanceId, ProviderInstanceId.make("codex-a"));
    assert.strictEqual(readA?.authorizationHeader, "Bearer output-a");
    assert.notStrictEqual(readA?.authorizationHeader, readB?.authorizationHeader);
    assert.strictEqual(readB?.providerInstanceId, ProviderInstanceId.make("claude-b"));
    yield* sessions.clear(threadA);
    assert.strictEqual(yield* sessions.read(threadA), undefined);
    assert.strictEqual((yield* sessions.read(threadB))?.authorizationHeader, "Bearer output-b");
  }).pipe(Effect.provide(McpProviderSessions.layer)),
);
