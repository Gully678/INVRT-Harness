import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { acpRegistryPromptFailure } from "./adapter.ts";

it.effect(
  "redacts underscore credentials from runtime process exit through the public failure",
  () =>
    Effect.gen(function* () {
      const written = yield* Deferred.make<void>();
      const ended = yield* Deferred.make<void>();
      const exited = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      const secret = "sk-ant-api03-fixture_prefix_PRIVATE_UNDERSCORE_TAIL";
      const stderr = `Provider stopped: ${secret}\n`;
      const handle = ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(12345),
        exitCode: Deferred.await(exited),
        isRunning: Deferred.isDone(exited).pipe(Effect.map((done) => !done)),
        kill: () => Effect.void,
        stdin: Sink.forEach(() => Deferred.succeed(written, undefined).pipe(Effect.asVoid)),
        stdout: Stream.fromEffect(Deferred.await(ended)).pipe(Stream.drain),
        stderr: Stream.make(new TextEncoder().encode(stderr)),
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
      const runtime = yield* AcpSessionRuntime.make({
        spawn: { command: "fixture-only-no-exec", args: [], shell: false },
        cwd: "/fixture",
        clientInfo: { name: "fixture", version: "1" },
        ownDetachedProcessGroup: false,
        ownDescendantProcessGroups: false,
      }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.succeed(handle)),
        ),
      );
      const initialized = yield* runtime.initialize().pipe(Effect.result, Effect.forkChild);
      yield* Deferred.await(written);
      yield* Deferred.succeed(exited, ChildProcessSpawner.ExitCode(7));
      yield* Deferred.succeed(ended, undefined);
      const result = yield* Fiber.join(initialized);
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") return;
      expect(result.failure._tag).toBe("AcpProcessExitedError");
      if (result.failure._tag !== "AcpProcessExitedError") return;
      expect(result.failure.code).toBe(7);
      expect(result.failure.stderr).toBe("Provider stopped: [redacted]");
      const event = yield* runtime.getEvents().pipe(Stream.take(1), Stream.runCollect);
      expect(event[0]).toMatchObject({
        _tag: "ConnectionTerminated",
        error: { stderr: "Provider stopped: [redacted]" },
      });
      const failure = acpRegistryPromptFailure("fixture", result.failure);
      expect(failure.class).toBe("provider_error");
      expect(JSON.stringify({ result, event, failure })).not.toContain(secret);
      expect(JSON.stringify({ result, event, failure })).not.toContain("PRIVATE_UNDERSCORE_TAIL");
    }).pipe(
      Effect.provide(NodeCrypto.layer),
      Effect.provideService(HostProcess.HomeDirectory, "/fixture/home"),
      Effect.scoped,
    ),
);
