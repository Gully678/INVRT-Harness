import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { firstUseTrust, reviewedGuardedExecutionQualification } from "./ForgeFirstUseTrust.ts";
import { hash } from "./ForgeInputFiles.ts";
import * as Authority from "./ForgeLocalPlanningAuthority.ts";
import * as Input from "./ForgeLocalPlanningInput.ts";
import { fixture, request, run, blocked } from "./ForgeNativePlanning.test-support.ts";

// SOURCE ONLY. All process cases require exact runtime/source approval and parent coordination.
// Real native services prepare the run; test-only child faults never manufacture admission.
const faults = [
  "runtime_timeout",
  "runtime_output_limit",
  "unknown_import",
  "unknown_exec",
  "third_argparse",
  "spawn_failure",
] as const;
it.layer(NodeServices.layer, { excludeTestServices: true })(
  "FORGE actual guarded process refusals",
  (it) => {
    it.effect.each(faults)(
      "%s refuses before affected code and reaps its actual owned PID",
      (fault) =>
        run(
          Effect.gen(function* () {
            const { current, authority } = yield* fixture;
            const prepared = yield* authority.begin(request, current);
            const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
            const qualification = reviewedGuardedExecutionQualification();
            if (!qualification) throw new Error("new guarded runtime is not qualified");
            const native = yield* ChildProcessSpawner.ChildProcessSpawner;
            let handle: ChildProcessSpawner.ChildProcessHandle | undefined;
            const stdout: string[] = [];
            const negative = ChildProcessSpawner.make((command) => {
              if (command._tag !== "StandardCommand") throw new Error("unexpected pipeline");
              expect(command.command).toBe(firstUseTrust.executable);
              expect(command.args.slice(0, 4)).toEqual(["-I", "-S", "-B", "-c"]);
              expect(hash(command.args[4]!)).toBe(qualification.launcherSha256);
              expect(hash(command.args[5]!)).toBe(qualification.policySha256);
              expect(command.options).toMatchObject({
                shell: false,
                extendEnv: false,
                stdin: "ignore",
                detached: true,
                killSignal: "SIGKILL",
                env: { LANG: "C", LC_ALL: "C" },
              });
              let source = command.args[4]!;
              let args: readonly string[];
              if (fault === "runtime_timeout")
                args = ["-I", "-S", "-B", "-c", "import time\ntime.sleep(30)\n"];
              else if (fault === "runtime_output_limit")
                args = [
                  "-I",
                  "-S",
                  "-B",
                  "-c",
                  "import sys,time\nsys.stdout.buffer.write(b'x'*262145)\nsys.stdout.flush()\ntime.sleep(30)\n",
                ];
              else if (fault === "spawn_failure") args = command.args;
              else {
                if (fault === "unknown_import")
                  source = source.replace(
                    "    source = read_verified(router)",
                    "    __import__('_forge_unreviewed_module')\n    source = read_verified(router)",
                  );
                else {
                  const filename =
                    fault === "third_argparse"
                      ? "/Library/Frameworks/Python.framework/Versions/3.11/lib/python3.11/argparse.py"
                      : "<unreviewed-test>";
                  let preparation = `    _unknown = compile(\"print('UNREVIEWED_EXEC_RAN')\", ${JSON.stringify(filename)}, 'exec')\n`;
                  if (fault === "third_argparse")
                    preparation +=
                      "    _base = _unknown.co_consts\n    _unknown = _unknown.replace(co_consts=(*_base, 'x'*110000))\n    _unknown = _unknown.replace(co_consts=(*_base, 'x'*(114010-len(marshal.dumps(_unknown))+110000)))\n    assert len(marshal.dumps(_unknown)) == 114010\n    assert sha256(marshal.dumps(_unknown)) not in ('eecfc6a6e407174b033817a9ed34b0818d70c554c94b59d2332492331250e6b6','539fcfe1f57392b0bf902aa8ff1f58e5fb90fa852e3dc135d18e6f2cec2a5ebf')\n";
                  source = source
                    .replace(
                      "    sys.addaudithook(audit)",
                      preparation + "    sys.addaudithook(audit)",
                    )
                    .replace(
                      "    source = read_verified(router)",
                      "    sys.modules['_frozen_importlib']._call_with_frames_removed(exec, _unknown, {})\n    source = read_verified(router)",
                    );
                }
                expect(source).not.toBe(command.args[4]);
                args = [...command.args.slice(0, 4), source, ...command.args.slice(5)];
              }
              return native
                .spawn(
                  ChildProcess.make(
                    fault === "spawn_failure"
                      ? "/invrt-forge-owned-missing-executable"
                      : firstUseTrust.executable,
                    args,
                    {
                      cwd: "/Users/mac/Repos/.worktrees/invrt-code-20261030-donor",
                      shell: false,
                      env: { LANG: "C", LC_ALL: "C" },
                      extendEnv: false,
                      stdin: "ignore",
                      stdout: "pipe",
                      stderr: "pipe",
                      detached: true,
                      killSignal: "SIGKILL",
                    },
                  ),
                )
                .pipe(
                  Effect.map((child) => {
                    handle = child;
                    return {
                      ...child,
                      stdout: child.stdout.pipe(
                        Stream.tap((bytes) =>
                          Effect.sync(() => {
                            if (stdout.length < 4)
                              stdout.push(new TextDecoder().decode(bytes.subarray(0, 256)));
                          }),
                        ),
                      ),
                    };
                  }),
                );
            });
            const input = yield* Input.make.pipe(
              Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, negative),
            );
            const outcome = yield* input.resolve(binding);
            expect(outcome).toEqual(
              fault === "spawn_failure"
                ? {
                    status: "unavailable",
                    code: "runtime_spawn_unavailable",
                    diagnostic: { phase: "router", cause: "process-error" },
                  }
                : {
                    status: "unavailable",
                    code: fault.startsWith("runtime_") ? fault : "runtime_guard_denied",
                  },
            );
            expect(JSON.stringify(outcome)).not.toContain("/invrt-forge-owned-missing-executable");
            if (fault === "spawn_failure") {
              expect(handle).toBeUndefined();
              return;
            }
            if (!handle) throw new Error("no actual child spawned");
            expect(yield* handle.isRunning).toBe(false);
            expect(stdout.join("")).not.toContain("UNREVIEWED_EXEC_RAN");
            expect(blocked).toEqual([]);
            yield* Effect.logInfo("FORGE owned child refusal/reap", {
              fault,
              pid: handle.pid,
              running: false,
            });
          }),
        ),
    );
  },
);
