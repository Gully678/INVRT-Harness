// @effect-diagnostics nodeBuiltinImport:off - Executes generated CocoaPods Ruby without a native build.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";

import { main } from "./mobile-native-client.ts";

const flag = "T3CODE_IOS_EXCLUDE_TERMINAL_NATIVE";
const device = "test-simulator";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "mobile-ios-target-" });
  const app = path.join(home, "client.app");
  yield* fs.makeDirectory(app);
  yield* fs.writeFileString(path.join(app, "binary"), "native client");
  const calls: ChildProcess.StandardCommand[] = [];
  let installed = false;
  let architecture = "x86_64";
  let state = "Booted";
  let architectureExitCode = 0;
  const spawner = ChildProcessSpawner.make((child) => {
    assert(ChildProcess.isStandardCommand(child));
    calls.push(child);
    let stdout = "";
    if (child.args.includes("--eval")) stdout = `T3_NATIVE_FINGERPRINT=${"a".repeat(40)}`;
    else if (child.args.includes("list") && child.args.includes("devices")) {
      stdout = JSON.stringify({
        devices: { runtime: [{ udid: device, name: "Test simulator", state }] },
      });
    } else if (child.args.includes("uname")) stdout = architecture;
    else if (child.args.includes("listapps")) stdout = installed ? '"com.t3tools.t3code.dev"' : "";
    else if (child.args.includes("get_app_container")) stdout = app;
    else if (child.args.includes("simctl") && child.args.includes("install")) installed = true;
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(
          ChildProcessSpawner.ExitCode(child.args.includes("uname") ? architectureExitCode : 0),
        ),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.make(new TextEncoder().encode(stdout)),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });
  const run = (inheritedFlag?: string, selected = device, host: NodeJS.Architecture = "x64") =>
    Command.runWith(main, { version: "0.0.0" })(["ensure", "ios", selected]).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(HostProcess.Environment, { HOME: home, [flag]: inheritedFlag }),
      Effect.provideService(HostProcess.Platform, "darwin"),
      Effect.provideService(HostProcess.Architecture, host),
      Effect.provide(FetchHttpClient.layer),
    );
  return {
    calls,
    run,
    fs,
    home,
    setState: (value: string) => {
      state = value;
    },
    failArchitecture: () => {
      architectureExitCode = 1;
    },
    setArchitecture: (value: string) => {
      architecture = value;
    },
  };
});

it.layer(NodeServices.layer)("iOS native-client destination", (it) => {
  it.effect.each([
    ["x86_64", undefined, "arm64"],
    ["arm64", undefined, "x64"],
    ["arm64", "1", "x64"],
  ] as const)(
    "uses %s simulator, inherited flag %s, host %s",
    ([architecture, inheritedFlag, host]) =>
      Effect.gen(function* () {
        const test = yield* fixture;
        test.setArchitecture(architecture);
        yield* test.run(inheritedFlag, device, host);
        const native = test.calls.filter(
          (call) =>
            call.args.includes("--eval") ||
            call.args.includes("prebuild") ||
            call.command === "pod" ||
            call.args.includes("xcodebuild"),
        );
        assert(native.some((call) => call.args.includes("prebuild")));
        assert(native.some((call) => call.command === "pod"));
        for (const call of native) {
          assert.strictEqual(call.options.env?.[flag], architecture === "x86_64" ? "1" : "0");
        }
        const build = native.find((call) => call.args[0] === "xcodebuild")!;
        assert(build.args.includes(`ARCHS=${architecture}`));
        assert(build.args.some((arg) => arg.endsWith("ios/InvrtCodeDev.xcworkspace")));
        assert(
          test.calls.some(
            (call) =>
              call.args.includes("install") &&
              call.args.some((arg) => arg.endsWith("InvrtCodeDev.app")),
          ),
        );
        const pod = native.find((call) => call.command === "pod")!;
        const plugin: unknown = NodeModule.createRequire(import.meta.url)(
          "../apps/mobile/plugins/terminalNativeExclusion.cjs",
        );
        assert(
          typeof plugin === "object" &&
            plugin !== null &&
            "applyTerminalNativeExclusionPatch" in plugin,
        );
        assert(typeof plugin.applyTerminalNativeExclusionPatch === "function");
        const ruby: unknown = plugin.applyTerminalNativeExclusionPatch(
          "target 'App' do\n  use_expo_modules!\nend\n",
        );
        assert(typeof ruby === "string");
        const resolved = NodeChildProcess.execFileSync(
          "ruby",
          [
            "-e",
            'require "json"\ndef target(name); yield; end\ndef use_expo_modules!(options); puts options.to_json; end\n' +
              ruby,
          ],
          { encoding: "utf8", env: { PATH: process.env.PATH, ...pod.options.env } },
        );
        assert.deepStrictEqual(JSON.parse(resolved), {
          exclude: architecture === "x86_64" ? ["@t3tools/mobile-terminal-native"] : [],
        });
      }),
  );

  it.effect("invalidates the installed-client record when destination architecture changes", () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* test.run();
      const buildCount = () => test.calls.filter((call) => call.args[0] === "xcodebuild").length;
      assert.strictEqual(buildCount(), 1);
      yield* test.run();
      assert.strictEqual(buildCount(), 1);
      test.setArchitecture("arm64");
      yield* test.run("1");
      assert.strictEqual(buildCount(), 2);
    }),
  );

  it.effect("rejects a physical-device ID before prebuild or pod install", () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      const error = yield* test.run("1", "physical-device").pipe(Effect.flip);
      assert.match(String(error), /No available iOS simulator/);
      assert(!test.calls.some((call) => call.command === "pod" || call.args.includes("prebuild")));
    }),
  );

  it.effect("requires the existing boot step before architecture lookup or native setup", () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      test.setState("Shutdown");
      const error = yield* test.run().pipe(Effect.flip);
      assert.match(
        String(error),
        /Boot the selected simulator first: xcrun simctl boot test-simulator/,
      );
      assert(
        !test.calls.some(
          (call) =>
            call.args.includes("uname") ||
            call.args.includes("--eval") ||
            call.command === "pod" ||
            call.args.includes("prebuild"),
        ),
      );
      assert(!(yield* test.fs.exists(`${test.home}/.cache`)));
    }),
  );

  it.effect("preserves the saved record and reports a failed architecture command", () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      yield* test.run();
      const directory = `${test.home}/.cache/t3code/native-clients/ios`;
      const [record] = yield* test.fs.readDirectory(directory);
      const before = yield* test.fs.readFileString(`${directory}/${record}`);
      const count = test.calls.length;
      test.failArchitecture();
      const error = yield* test.run().pipe(Effect.flip);
      assert.match(String(error), /xcrun simctl failed/);
      assert.strictEqual(yield* test.fs.readFileString(`${directory}/${record}`), before);
      assert(
        !test.calls
          .slice(count)
          .some(
            (call) =>
              call.command === "pod" ||
              call.args.includes("--eval") ||
              call.args.includes("prebuild"),
          ),
      );
    }),
  );

  it.effect("fails before native setup when the simulator architecture is unknown", () =>
    Effect.gen(function* () {
      const test = yield* fixture;
      test.setArchitecture("unknown");
      const error = yield* test.run().pipe(Effect.flip);
      assert.match(String(error), /architecture/);
      assert(!test.calls.some((call) => call.command === "pod" || call.args.includes("prebuild")));
    }),
  );
});
