import * as NodeAssert from "node:assert/strict";
import * as NodeUtil from "node:util";
import { it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";

import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import * as OpenCodeServerLedger from "./OpenCodeServerLedger.ts";

it.live.each(["explicit", "environment", "overlap", "spawn"] as const)(
  "redacts full managed failed-start diagnostics and finalises %s credentials",
  (source) =>
    Effect.gen(function* () {
      const password =
        source === "overlap" ? "OpenCodeRuntimeError" : `fixture-${source}-private-value`;
      const kills: string[] = [];
      let tracked = 0;
      let forgotten = 0;
      let streamsClosed = 0;
      const output = (text: string) =>
        Stream.make(new TextEncoder().encode(text)).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              streamsClosed++;
            }),
          ),
        );
      const spawner = ChildProcessSpawner.make(() =>
        source === "spawn"
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "TimedOut",
                module: "ChildProcessSpawner",
                method: "spawn",
                description: password,
                cause: { env: { _tag: password, operation: password, reason: password } },
              }),
            )
          : Effect.succeed(
              ChildProcessSpawner.makeHandle({
                // This identifier never enters an OS signalling port: platform and kill are mocked.
                pid: ChildProcessSpawner.ProcessId(123),
                stdout: output(`startup diagnostic ${password}`),
                stderr: output(`configuration rejected ${password}`),
                all: Stream.empty,
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(9)),
                isRunning: Effect.succeed(false),
                kill: (options?: Parameters<ChildProcessSpawner.ChildProcessHandle["kill"]>[0]) =>
                  Effect.sync(() => {
                    kills.push(options?.killSignal ?? "SIGTERM");
                  }),
                stdin: Sink.drain,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                unref: Effect.succeed(Effect.void),
              }),
            ),
      );
      const layer = OpenCodeRuntime.layer.pipe(
        Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
        Layer.provide(Layer.succeed(HostProcess.Platform, "win32")),
        Layer.provide(Layer.succeed(HostProcess.Environment, {})),
        Layer.provide(Layer.succeed(SpawnExecutableResolution, () => undefined)),
        Layer.provide(
          Layer.succeed(OpenCodeServerLedger.OpenCodeServerLedger, {
            track: () =>
              Effect.sync(() => {
                tracked++;
                return Effect.sync(() => {
                  forgotten++;
                });
              }),
          }),
        ),
      );
      const exit = yield* Effect.gen(function* () {
        const runtime = yield* OpenCodeRuntime.OpenCodeRuntime;
        return yield* Effect.exit(
          runtime.connectToOpenCodeServer({
            binaryPath: "/fixture/never-launch-opencode",
            directory: "/fixture/project",
            port: 12345,
            ...(source === "environment"
              ? { environment: { OPENCODE_SERVER_PASSWORD: password } }
              : { serverPassword: password, environment: {} }),
          }),
        );
      }).pipe(Effect.scoped, Effect.provide(layer));
      NodeAssert.ok(Exit.isFailure(exit));
      const error = Cause.squash(exit.cause);
      NodeAssert.ok(OpenCodeRuntime.isOpenCodeRuntimeError(error));
      NodeAssert.equal(error.operation, "startOpenCodeServerProcess");
      const diagnostics = NodeUtil.inspect(exit, { depth: null, showHidden: true });
      // Boolean assertions avoid printing the synthetic password on an OLD RED failure.
      if (source !== "overlap") NodeAssert.equal(diagnostics.includes(password), false);
      // Static native tags can coincide with a password; they are not credential payloads.
      NodeAssert.equal(error.detail.includes(password), false);
      NodeAssert.equal(NodeUtil.inspect(error.cause, { depth: null }).includes(password), false);
      if (source === "spawn") {
        NodeAssert.ok(PlatformError.isPlatformError(error.cause));
        NodeAssert.equal(error.cause.reason._tag, "TimedOut");
        NodeAssert.deepEqual(kills, []);
        NodeAssert.equal(tracked, 0);
        NodeAssert.equal(forgotten, 0);
        NodeAssert.equal(streamsClosed, 0);
        return;
      }
      NodeAssert.ok(error.detail.includes("configuration rejected [REDACTED]"));
      NodeAssert.deepEqual(error.cause, {
        exitCode: 9,
        stdout: "startup diagnostic [REDACTED]",
        stderr: "configuration rejected [REDACTED]",
      });
      NodeAssert.deepEqual(kills, ["SIGTERM", "SIGKILL"]);
      NodeAssert.equal(tracked, 1);
      NodeAssert.equal(forgotten, 1);
      NodeAssert.equal(streamsClosed, 2);
    }),
);
