import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { GrokSettings } from "../../../../packages/provider-grok/src/settings.ts";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
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
      "process.exit(3);",
      "",
    ].join("\n"),
  });

const checkRoute = (modelsOutput: string | ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "grok-route-" });
    const logPath = NodePath.join(directory, "route.log");
    const binaryPath = writeRouteCli({ directory, logPath, modelsOutput });
    const snapshot = yield* checkGrokProviderStatus(decodeGrokSettings({ enabled: true, binaryPath }), {
      ...process.env,
      XAI_API_KEY: "xai-test-key",
    });
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
    expect(log).toContain("key-absent models");
    expect(log).toContain("key-absent agent");
    expect(log).not.toContain("key-present models");
    expect(log).not.toContain("key-present agent");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refreshes an expired Grok subscription instead of falling through to the API key", () =>
  Effect.gen(function* () {
    const { snapshot, log } = yield* checkRoute([LOGGED_OUT, LOGGED_IN]);
    expect(snapshot.auth.type).toBe("cached_token");
    expect(snapshot.message).toContain("Refused automatic paid fallback");
    expect(log.match(/key-absent models/g)?.length).toBe(2);
    expect(log).toContain("key-absent agent");
    expect(log).not.toContain("key-present agent");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps a missing Grok login response unknown instead of inventing API-key billing", () =>
  Effect.gen(function* () {
    const { snapshot, log } = yield* checkRoute("no login verdict\n");
    expect(snapshot.auth.status).toBe("unknown");
    expect(snapshot.auth.type).toBeUndefined();
    expect(snapshot.message).toContain("Refused automatic paid fallback");
    expect(log).toContain("key-absent models");
    expect(log).toContain("key-absent agent");
    expect(log).not.toContain("key-present agent");
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
  const env = grokSpawnEnvironment({ XAI_API_KEY: "xai-test-key", GROK_HOME: "/tmp/grok-a" }, false);
  expect(env.XAI_API_KEY).toBeUndefined();
  expect(env.GROK_HOME).toBe("/tmp/grok-a");
  expect(env.GROK_OAUTH2_REFERRER).toBe("invrt-code");
});

it.effect("keeps a logged-out Grok CLI on an explicit API key", () =>
  Effect.gen(function* () {
    const { snapshot, log } = yield* checkRoute(LOGGED_OUT);
    expect(snapshot.auth).toEqual({
      status: "authenticated",
      type: "api_key",
      label: "xAI API key",
    });
    expect(snapshot.message ?? "").not.toContain("Refused automatic paid fallback");
    expect(log).toContain("key-absent models");
    expect(log).toContain("key-present agent");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
