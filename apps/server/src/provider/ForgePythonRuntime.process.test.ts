import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { firstUseTrust, reviewedPythonQualification } from "./ForgeFirstUseTrust.ts";
import { hash } from "./ForgeInputFiles.ts";
import * as Python from "./ForgePythonRuntime.ts";

// SOURCE PROPOSAL: do not execute before the exact pre-execution review.
// These two test-only stdlib children exercise failure cleanup, never qualification or admission.
const failures = [
  ["runtime_timeout", "import time\ntime.sleep(30)\n"],
  [
    "runtime_output_limit",
    "import sys,time\nsys.stdout.buffer.write(b'x'*262145)\nsys.stdout.flush()\ntime.sleep(30)\n",
  ],
] as const;
it.layer(NodeServices.layer, { excludeTestServices: true })(
  "FORGE native Python process limits",
  (it) => {
    it.effect.each(failures)("%s kills and reaps its actual owned PID", ([code, source]) =>
      Effect.gen(function* () {
        const qualification = reviewedPythonQualification();
        if (!qualification) throw new Error("reviewed runtime descriptor required");
        const fs = yield* FileSystem.FileSystem;
        const probe = yield* fs.readFileString(qualification.probePath);
        expect(hash(probe)).toBe(qualification.probeSha256);
        const native = yield* ChildProcessSpawner.ChildProcessSpawner;
        let handle: ChildProcessSpawner.ChildProcessHandle | undefined;
        const negativeChild = ChildProcessSpawner.make((command) => {
          if (command._tag !== "StandardCommand") throw new Error("unexpected pipeline");
          expect(command.command).toBe(firstUseTrust.executable);
          expect(command.args).toEqual(["-I", "-S", "-B", "-c", probe]);
          expect(command.options).toMatchObject({
            cwd: qualification.cwd,
            shell: false,
            env: { LANG: "C", LC_ALL: "C" },
            extendEnv: false,
            stdin: "ignore",
            detached: true,
            killSignal: "SIGKILL",
          });
          return native
            .spawn(
              ChildProcess.make(firstUseTrust.executable, ["-I", "-S", "-B", "-c", source], {
                cwd: qualification.cwd,
                shell: false,
                env: { LANG: "C", LC_ALL: "C" },
                extendEnv: false,
                stdin: "ignore",
                stdout: "pipe",
                stderr: "pipe",
                detached: true,
                killSignal: "SIGKILL",
              }),
            )
            .pipe(
              Effect.tap((child) =>
                Effect.sync(() => {
                  handle = child;
                }),
              ),
            );
        });
        const runtime = yield* Python.make.pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, negativeChild),
        );
        const outcome = yield* runtime.run("observe", qualification.cwd, probe).pipe(Effect.result);
        expect(Result.isFailure(outcome)).toBe(true);
        if (!Result.isFailure(outcome)) throw new Error("negative child unexpectedly succeeded");
        expect(outcome.failure.code).toBe(code);
        if (!handle) throw new Error("no actual child was spawned");
        expect(yield* handle.isRunning).toBe(false);
        yield* Effect.logInfo("FORGE owned process limit verified", {
          code,
          pid: handle.pid,
          running: false,
        });
      }),
    );
  },
);
