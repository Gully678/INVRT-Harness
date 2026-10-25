import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopUserData from "./DesktopUserData.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
  pathLayer = NodePath.layerPosix,
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(Layer.mergeAll(NodeServices.layer, pathLayer, DesktopConfig.layerTest(env))),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
  pathLayer = NodePath.layerPosix,
) =>
  DesktopEnvironment.DesktopEnvironment.pipe(
    Effect.provide(layerEnvironment(overrides, env, pathLayer)),
  );

describe("DesktopEnvironment", () => {
  it.effect("uses the packaged Windows server sidecar as the backend root", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(environment.appRoot, "/install/resources/app.asar");
      assert.equal(environment.serverRoot, "/install/resources/server.asar");
      assert.equal(
        environment.backendEntryPath,
        "/install/resources/server.asar/apps/server/dist/bin.mjs",
      );
      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.t3/dev");
      assert.equal(production.stateDir, "/Users/alice/.t3/userdata");
    }),
  );

  it.effect.each(["darwin", "linux"] as const)(
    "uses an explicit desktop app data directory on %s",
    (platform) =>
      Effect.gen(function* () {
        const environment = yield* makeEnvironment(
          { platform },
          { T3CODE_DESKTOP_APP_DATA_DIR: " /isolated/pilot " },
        );
        assert.equal(environment.appDataDirectory, "/isolated/pilot");
        const userData = yield* DesktopUserData.resolveUserDataPath(environment).pipe(
          Effect.provide(Layer.mergeAll(NodeServices.layer, NodePath.layerPosix)),
        );
        assert.equal(userData, "/isolated/pilot/t3code-v2");
      }),
  );

  it.effect.each([
    { platform: "darwin", expected: "/Users/alice/Library/Application Support" },
    { platform: "linux", expected: "/Users/alice/.config" },
    { platform: "win32", expected: "/Users/alice/AppData/Roaming" },
  ] as const)("retains the default app data directory on $platform", ({ platform, expected }) =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({ platform });
      assert.equal(environment.appDataDirectory, expected);
    }),
  );

  it.effect.each(["relative/pilot", "   ", "/pilot\nother"])(
    "rejects an invalid explicit desktop app data directory %j",
    (directory) =>
      Effect.gen(function* () {
        const result = yield* makeEnvironment({}, { T3CODE_DESKTOP_APP_DATA_DIR: directory }).pipe(
          Effect.flip,
        );
        assert.equal(result._tag, "ConfigError");
        assert.include(result.message, "absolute path");
      }),
  );

  it.effect("treats an empty override as unset", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({}, { T3CODE_DESKTOP_APP_DATA_DIR: "" });
      assert.equal(environment.appDataDirectory, "/Users/alice/Library/Application Support");
    }),
  );

  it.effect.each(["C:\\pilot\\app-data", "\\\\server\\pilot"])(
    "accepts an absolute Windows override %j",
    (directory) =>
      Effect.gen(function* () {
        const environment = yield* makeEnvironment(
          { platform: "win32" },
          { T3CODE_DESKTOP_APP_DATA_DIR: directory },
          NodePath.layerWin32,
        );
        assert.equal(environment.appDataDirectory, directory);
        const userData = yield* DesktopUserData.resolveUserDataPath(environment).pipe(
          Effect.provide(Layer.mergeAll(NodeServices.layer, NodePath.layerWin32)),
        );
        assert.equal(userData, `${directory}\\t3code-v2`);
      }),
  );

  it.effect.each([
    { platform: "darwin", directory: "C:\\pilot" },
    { platform: "linux", directory: "C:\\pilot" },
    { platform: "darwin", directory: "\\\\server\\pilot" },
    { platform: "linux", directory: "\\\\server\\pilot" },
    { platform: "win32", directory: "/isolated/pilot" },
    { platform: "win32", directory: "C:pilot" },
  ] as const)("rejects $directory on $platform", ({ platform, directory }) =>
    Effect.gen(function* () {
      const result = yield* makeEnvironment(
        { platform },
        { T3CODE_DESKTOP_APP_DATA_DIR: directory },
        platform === "win32" ? NodePath.layerWin32 : NodePath.layerPosix,
      ).pipe(Effect.flip);
      assert.equal(result._tag, "ConfigError");
      assert.include(result.message, "absolute path");
    }),
  );
});
