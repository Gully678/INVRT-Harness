// @effect-diagnostics nodeBuiltinImport:off -- offline CLI fixtures use native paths
import * as NodePath from "node:path";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import { makeGrokAcpAdapterFlavor } from "../../../../packages/provider-grok/src/server/adapter.ts";
import { GrokDriver } from "../../../../packages/provider-grok/src/server/driver.ts";
import { discoverGrokSkills } from "../../../../packages/provider-grok/src/server/skills.ts";
import { GrokSettings } from "../../../../packages/provider-grok/src/settings.ts";
import {
  checkGrokProviderStatus,
  grokSpawnEnvironment,
  selectGrokProviderRoute,
} from "../../../../packages/provider-grok/src/server/status.ts";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const LOGGED_IN = "You are logged in with grok.com.\n  * grok-4.6 (default)\n";
const LOGGED_OUT = "You are not authenticated.\n  * grok-4.6 (default)\n";

const writeRouteCli = (input: {
  readonly directory: string;
  readonly logPath: string;
  readonly modelsOutput: string | ReadonlyArray<string>;
}) =>
  writeFakeCli({
    directory: input.directory,
    name: "grok",
    source: [
      'import { appendFileSync as appendRouteLog } from "node:fs";',
      `appendRouteLog(${JSON.stringify(input.logPath)}, (process.env.XAI_API_KEY ? "key-present" : "key-absent") + " " + process.argv.slice(2).join(" ") + "\\n");`,
      'if (process.argv[2] === "--version") { process.stdout.write("grok 1.0.13\\n"); process.exit(0); }',
      'if (process.argv[2] === "models") {',
      '  const fs = await import("node:fs");',
      `  const callsPath = ${JSON.stringify(NodePath.join(input.directory, "models-calls"))};`,
      '  const calls = fs.existsSync(callsPath) ? fs.readFileSync(callsPath, "utf8").length : 0;',
      '  fs.appendFileSync(callsPath, ".");',
      `  const outputs = ${JSON.stringify([input.modelsOutput].flat())};`,
      "  process.stdout.write(outputs[Math.min(calls, outputs.length - 1)]);",
      "  process.exit(0);",
      "}",
      'if (process.argv[2] === "inspect") { process.stdout.write("{\\"skills\\":[]}\\n"); process.exit(0); }',
      "process.exit(3);",
      "",
    ].join("\n"),
  });

const checkRoute = (modelsOutput: string | ReadonlyArray<string>, apiKeySelected = false) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "grok-route-" });
    const logPath = NodePath.join(directory, "route.log");
    const binaryPath = writeRouteCli({ directory, logPath, modelsOutput });
    const previousKey = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "xai-parent-key";
    const snapshot = yield* checkGrokProviderStatus(
      decodeGrokSettings({ enabled: true, binaryPath }),
      {
        ...process.env,
        XAI_API_KEY: "xai-test-key",
      },
      undefined,
      apiKeySelected,
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (previousKey === undefined) delete process.env.XAI_API_KEY;
          else process.env.XAI_API_KEY = previousKey;
        }),
      ),
    );
    const log = yield* fs.readFileString(logPath);
    return { snapshot, log };
  });

it.effect("keeps a logged-in Grok subscription off the API key and strips it from the spawn", () =>
  Effect.gen(function* () {
    const { snapshot, log } = yield* checkRoute(LOGGED_IN);
    expect(snapshot.auth).toEqual({
      status: "authenticated",
      type: "cached_token",
      label: "Grok account",
    });
    expect(snapshot.message).toContain("Refused automatic paid fallback");
    expect(log).toContain("key-absent --version");
    expect(log).toContain("key-absent models");
    expect(log).toContain("key-absent inspect");
    expect(log).toContain("key-absent agent");
    expect(log).not.toContain("key-present");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refreshes an expired Grok subscription instead of falling through to the API key", () =>
  Effect.gen(function* () {
    const { snapshot, log } = yield* checkRoute([LOGGED_OUT, LOGGED_IN]);
    expect(snapshot.auth.type).toBe("cached_token");
    expect(snapshot.message).toContain("Refused automatic paid fallback");
    expect(log).toContain("key-absent --version");
    expect(log.match(/key-absent models/g)?.length).toBe(2);
    expect(log).toContain("key-absent inspect");
    expect(log).toContain("key-absent agent");
    expect(log).not.toContain("key-present");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps a missing Grok login response unknown instead of inventing API-key billing", () =>
  Effect.gen(function* () {
    const { snapshot, log } = yield* checkRoute("no login verdict\n");
    expect(snapshot.auth.status).toBe("unknown");
    expect(snapshot.auth.type).toBeUndefined();
    expect(snapshot.message).toContain("Refused automatic paid fallback");
    expect(log).toContain("key-absent --version");
    expect(log).toContain("key-absent models");
    expect(log).toContain("key-absent inspect");
    expect(log).toContain("key-absent agent");
    expect(log).not.toContain("key-present");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("keeps a logged-in subscription and a missing login off the API key", () => {
  expect(selectGrokProviderRoute({ cliAuthenticated: true, apiKeyPresent: true })).toMatchObject({
    auth: { status: "authenticated", type: "cached_token" },
    useApiKey: false,
    refusal: "Refused automatic paid fallback.",
  });
  const missing = selectGrokProviderRoute({ cliAuthenticated: null, apiKeyPresent: true });
  expect(missing.auth).toEqual({ status: "unknown" });
  expect(missing.useApiKey).toBe(false);
  const env = grokSpawnEnvironment(
    { XAI_API_KEY: "xai-test-key", GROK_HOME: "/tmp/grok-a" },
    false,
  );
  expect(env.XAI_API_KEY).toBe("");
  expect(env.GROK_HOME).toBe("/tmp/grok-a");
  expect(env.GROK_OAUTH2_REFERRER).toBe("invrt-code");
});

it("refuses an ambient key after a Grok subscription login is revoked", () => {
  const route = selectGrokProviderRoute({ cliAuthenticated: false, apiKeyPresent: true });
  expect(route.useApiKey).toBe(false);
  expect(route.auth.status).toBe("unauthenticated");
  expect(route.refusal).toContain("Refused automatic paid fallback");
});

it.effect("refuses an ambient Grok key at the CLI boundary after logout", () =>
  Effect.gen(function* () {
    const { snapshot, log } = yield* checkRoute(LOGGED_OUT);
    expect(snapshot.auth.status).toBe("unauthenticated");
    expect(snapshot.status).toBe("error");
    expect(snapshot.message).toContain("Refused automatic paid fallback");
    expect(log).not.toContain("key-present");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps a logged-out Grok CLI on an explicit API key", () =>
  Effect.gen(function* () {
    const { snapshot, log } = yield* checkRoute(LOGGED_OUT, true);
    expect(snapshot.auth).toEqual({
      status: "authenticated",
      type: "api_key",
      label: "xAI API key",
    });
    expect(snapshot.message ?? "").not.toContain("Refused automatic paid fallback");
    expect(log).toContain("key-absent --version");
    expect(log).toContain("key-absent models");
    expect(log).toContain("key-present inspect");
    expect(log).toContain("key-present agent");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const skillRoutes = (modelsOutput: string, apiKeySelected = false) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "grok-skill-route-" });
    const logPath = NodePath.join(directory, "route.log");
    const binaryPath = writeRouteCli({ directory, logPath, modelsOutput });
    const previousKey = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "xai-parent-key";
    const restoreKey = Effect.sync(() => {
      if (previousKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = previousKey;
    });
    const flavor = makeGrokAcpAdapterFlavor(
      {
        instanceId: ProviderInstanceId.make("grok-skill-route"),
        settings: decodeGrokSettings({ enabled: true, binaryPath }),
        environment: { ...process.env, XAI_API_KEY: "xai-test-key", GROK_HOME: directory },
        apiKeySelected,
        hostPlatform: yield* HostProcess.Platform,
        selfInvocation: { command: process.execPath, entrypoint: undefined },
      },
      directory,
    );
    const rewriteLog = yield* flavor.rewriteUserText!("$deploy ship", {
      runtimePolicy: { cwd: directory },
    } as Parameters<NonNullable<typeof flavor.rewriteUserText>>[1]).pipe(
      Effect.andThen(fs.readFileString(logPath)),
      Effect.ensuring(restoreKey),
    );
    yield* fs.remove(logPath).pipe(Effect.ignore);
    const scanLog = yield* discoverGrokSkills(
      decodeGrokSettings({ enabled: true, binaryPath }),
      { ...process.env, XAI_API_KEY: "xai-parent-key", GROK_HOME: directory },
      directory,
      false,
    ).pipe(
      Effect.andThen(fs.readFileString(logPath)),
      Effect.orElseSucceed(() => ""),
      Effect.ensuring(restoreKey),
    );
    return { rewriteLog, scanLog };
  });

it.effect("keeps a parent key off a subscription skill rewrite and workspace scan", () =>
  Effect.gen(function* () {
    const { rewriteLog, scanLog } = yield* skillRoutes(LOGGED_IN);
    expect(rewriteLog).toContain("key-absent models");
    expect(rewriteLog).toContain("key-absent inspect");
    expect(rewriteLog).not.toContain("key-present");
    expect(scanLog).toContain("key-absent inspect");
    expect(scanLog).not.toContain("key-present");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps a parent key off an unknown skill rewrite and a refused inspect", () =>
  Effect.gen(function* () {
    const { rewriteLog, scanLog } = yield* skillRoutes("no login verdict\n");
    expect(rewriteLog).not.toContain("key-present");
    expect(scanLog).toContain("key-absent inspect");
    expect(scanLog).not.toContain("key-present");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("lets a logged-out API-key route inspect skills with the key", () =>
  Effect.gen(function* () {
    const { rewriteLog } = yield* skillRoutes(LOGGED_OUT, true);
    expect(rewriteLog).toContain("key-present inspect");
    expect(rewriteLog).toContain("key-absent models");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("omits a parent API key from the workspace skill scan", () => {
  const seen: Array<string | undefined> = [];
  const previousKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "xai-parent-key";
  return Effect.gen(function* () {
    const instance = yield* GrokDriver.create({
      instanceId: ProviderInstanceId.make("grok-skill-scan"),
      displayName: "Grok",
      enabled: true,
      environment: [],
      config: GrokDriver.defaultConfig(),
    });
    yield* instance.snapshotForCwd!("/workspace").pipe(Effect.exit);
    expect(seen.some((value) => value === "xai-parent-key")).toBe(false);
    expect(seen).toContain("");
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (previousKey === undefined) delete process.env.XAI_API_KEY;
        else process.env.XAI_API_KEY = previousKey;
      }),
    ),
    Effect.provideService(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) => {
        const spawn = command as {
          readonly args?: ReadonlyArray<string>;
          readonly options?: { readonly env?: NodeJS.ProcessEnv };
        };
        if (spawn.args?.includes("inspect")) seen.push(spawn.options?.env?.XAI_API_KEY);
        return Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            unref: Effect.succeed(Effect.void),
            stdin: Sink.drain,
            stdout: Stream.encodeText(Stream.make('{"skills":[]}\n')),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
          }),
        );
      }),
    ),
    Effect.scoped,
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
            HttpClient.make(() => Effect.die("Grok skill scan must not make an HTTP request")),
          ),
        ),
      ),
    ),
  );
});
