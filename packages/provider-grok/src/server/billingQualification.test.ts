import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";

import { GrokSettings } from "../settings.ts";
import { makeGrokAcpAdapterFlavor } from "./adapter.ts";
import { makeGrokAcpRuntime } from "./acpSupport.ts";
import { GrokDriver } from "./driver.ts";
import { makeGrokTextGeneration } from "./textGeneration.ts";

const decodeGrokSettings = Schema.decodeEffect(GrokSettings);
const encodeString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

const fixture = Effect.fn("billingQualification.fixture")(function* (
  login: "logged-out" | "unknown" | "confirmed",
  key: "unset" | "blank" | "explicit",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "grok-billing-qualification-" });
  const launchLog = path.join(directory, "launch.log");
  const requestLog = path.join(directory, "requests.ndjson");
  const output =
    login === "confirmed"
      ? "You are logged in with grok.com.\n"
      : login === "logged-out"
        ? "You are not authenticated.\n"
        : "No account metadata.\n";
  const binaryPath = writeFakeCli({
    directory,
    name: "grok",
    source: [
      'import * as fs from "node:fs";',
      `fs.appendFileSync(${encodeString(launchLog)}, JSON.stringify({ args: process.argv.slice(2), key: Boolean(process.env.XAI_API_KEY) }) + "\\n");`,
      'if (process.argv[2] === "models") {',
      `  process.stdout.write(${encodeString(output)}); process.exit(0);`,
      "}",
      `await import(${encodeString(new URL("../../../../apps/server/src/provider/testFixtures/grok-text-mock-agent.mjs", import.meta.url).href)});`,
    ].join("\n"),
  });
  const environment: NodeJS.ProcessEnv = {
    ...(yield* HostProcess.Environment),
    GROK_HOME: directory,
    T3_ACP_REQUEST_LOG_PATH: requestLog,
    T3_ACP_PROMPT_RESPONSE_TEXT: '{"title":"Qualified offline route"}',
  };
  delete environment.XAI_API_KEY;
  if (key !== "unset") environment.XAI_API_KEY = key === "explicit" ? "explicit-instance-key" : "";
  const settings = yield* decodeGrokSettings({ enabled: true, binaryPath });
  const read = (file: string) =>
    fs
      .exists(file)
      .pipe(Effect.flatMap((exists) => (exists ? fs.readFileString(file) : Effect.succeed(""))));
  return {
    directory,
    settings,
    environment,
    readLaunches: read(launchLog),
    readRequests: read(requestLog),
  };
});

type Fixture = Effect.Success<ReturnType<typeof fixture>>;
const runPrompt = Effect.fn("billingQualification.runPrompt")(function* (
  input: Fixture,
  route: "main" | "secondary",
  apiKeySelected = false,
) {
  const instanceId = ProviderInstanceId.make("grok-billing-qualification");
  if (route === "secondary") {
    const generation = yield* makeGrokTextGeneration(
      input.settings,
      input.environment,
      apiKeySelected,
    );
    return yield* generation.generateThreadTitle({
      cwd: input.directory,
      message: "Offline route qualification",
      modelSelection: createModelSelection(instanceId, "grok-mock-default"),
    });
  }
  const flavor = makeGrokAcpAdapterFlavor(
    {
      instanceId,
      settings: input.settings,
      environment: input.environment,
      apiKeySelected,
      hostPlatform: yield* HostProcess.Platform,
      selfInvocation: { command: yield* HostProcess.ExecutablePath, entrypoint: undefined },
    },
    input.directory,
  );
  const runtime = yield* flavor.makeRuntime({
    cwd: input.directory,
    runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
      cwd: input.directory,
      runtimeMode: "approval-required",
      interactionMode: "default",
    }),
    mcpServers: [],
    clientCapabilities: {},
    clientInfo: { name: "offline-billing-qualification", version: "0.0.0" },
    protocolLogging: {},
    onTermination: () => Effect.void,
  });
  yield* runtime.start();
  return yield* runtime.prompt({ prompt: [{ type: "text", text: "Offline route qualification" }] });
});

it.effect.each([
  ["main", "logged-out", "unset"],
  ["main", "logged-out", "blank"],
  ["main", "unknown", "unset"],
  ["main", "unknown", "blank"],
  ["secondary", "logged-out", "unset"],
  ["secondary", "logged-out", "blank"],
  ["secondary", "unknown", "unset"],
  ["secondary", "unknown", "blank"],
] as const)("refuses %s %s subscription with %s key before agent launch", ([route, login, key]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* fixture(login, key);
      const result = yield* runPrompt(input, route).pipe(Effect.exit);
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result))
        expect(String(result.cause)).toContain("Refused automatic paid fallback");
      expect(yield* input.readLaunches).not.toContain("agent");
      expect(yield* input.readRequests).not.toContain("session/prompt");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.each([
  ["main", "blank"],
  ["main", "explicit"],
  ["secondary", "blank"],
  ["secondary", "explicit"],
] as const)("permits %s deliberately selected %s route", ([route, key]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* fixture(key === "explicit" ? "logged-out" : "confirmed", key);
      yield* runPrompt(input, route, key === "explicit");
      expect(yield* input.readRequests).toContain("session/prompt");
      const launches = yield* input.readLaunches;
      expect(launches).toContain('"key":' + String(key === "explicit"));
      expect(launches).toContain("agent");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses an omitted subscription verdict by default at runtime creation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* fixture("unknown", "blank");
      const result = yield* makeGrokAcpRuntime({
        grokSettings: input.settings,
        environment: input.environment,
        cwd: input.directory,
        clientInfo: { name: "offline-unqualified-runtime", version: "0.0.0" },
      }).pipe(Effect.exit);
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result))
        expect(String(result.cause)).toContain("Refused automatic paid fallback");
      expect(yield* input.readLaunches).not.toContain("agent");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "allows an explicit metadata-only initialize without a subscription verdict or prompt",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const input = yield* fixture("unknown", "blank");
        const runtime = yield* makeGrokAcpRuntime({
          grokSettings: input.settings,
          environment: input.environment,
          cwd: input.directory,
          metadataOnly: true,
          clientInfo: { name: "offline-metadata-only", version: "0.0.0" },
        });
        yield* runtime.initialize();
        const requests = yield* input.readRequests;
        expect(requests).toContain("initialize");
        expect(requests).not.toContain("session/new");
        expect(requests).not.toContain("session/prompt");
        expect(yield* input.readLaunches).toContain('"key":false');
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses the normal no-override instance's secondary route after logout", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* fixture("logged-out", "blank");
      const instance = yield* GrokDriver.create({
        instanceId: ProviderInstanceId.make("grok-normal-no-overrides"),
        displayName: "Offline fixture",
        environment: [],
        enabled: true,
        config: input.settings,
      });
      const result = yield* instance.textGeneration
        .generateThreadTitle({
          cwd: input.directory,
          message: "No key configured",
          modelSelection: createModelSelection(instance.instanceId, "grok-mock-default"),
        })
        .pipe(Effect.exit);
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result))
        expect(String(result.cause)).toContain("Refused automatic paid fallback");
      expect(yield* input.readLaunches).not.toContain("agent");
    }),
  ).pipe(
    Effect.provide(
      TestProviderHost.layer({ runBackgroundWork: false }).pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(IdAllocator.layer),
        Layer.provideMerge(McpProviderSessions.layer),
        Layer.provideMerge(ProviderLatestVersions.layer),
        Layer.provideMerge(
          Layer.succeed(
            ProviderEventLoggers.ProviderEventLoggers,
            ProviderEventLoggers.NoOpProviderEventLoggers,
          ),
        ),
        Layer.provideMerge(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("Offline billing test must not make HTTP requests")),
          ),
        ),
      ),
    ),
  ),
);
