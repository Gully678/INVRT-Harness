import { z } from "zod";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  firstUseTrust as trust,
  reviewedPythonQualification,
  reviewedGuardedExecutionQualification,
} from "./ForgeFirstUseTrust.ts";
import { logicalRouterArgs } from "./ForgeGuardedExecution.ts";
import { hash } from "./ForgeInputFiles.ts";

export class ForgePythonError extends Schema.TaggedError<ForgePythonError>()("ForgePythonError", {
  code: Schema.Literals([
    "runtime_unqualified",
    "runtime_timeout",
    "runtime_output_limit",
    "runtime_process_unavailable",
    "runtime_spawn_unavailable",
    "runtime_guard_unqualified",
    "runtime_guard_denied",
  ]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return `FORGE Python unavailable: ${this.code}.`;
  }
  get diagnostic(): { readonly phase: "router"; readonly cause: "process-error" } | undefined {
    return this.code === "runtime_process_unavailable" || this.code === "runtime_spawn_unavailable"
      ? { phase: "router", cause: "process-error" }
      : undefined;
  }
}
const isPythonError = Schema.is(ForgePythonError);
export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const run = Effect.fn("ForgePythonRuntime.run")(
    function* (cwd: string, launcherSource: string, policy: string) {
      const qualification = reviewedPythonQualification();
      const guarded = reviewedGuardedExecutionQualification();
      if (
        !qualification ||
        cwd !== qualification.cwd ||
        !guarded ||
        hash(launcherSource) !== guarded.launcherSha256 ||
        hash(policy) !== guarded.policySha256
      )
        return yield* new ForgePythonError({ code: "runtime_guard_unqualified" });
      const args = [
        "-I",
        "-S",
        "-B",
        "-c",
        launcherSource,
        guarded.policyPath,
        guarded.policySha256,
        ...logicalRouterArgs(cwd),
      ];
      const child = yield* spawner
        .spawn(
          ChildProcess.make(trust.executable, args, {
            cwd,
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
          Effect.mapError(
            (cause) => new ForgePythonError({ code: "runtime_spawn_unavailable", cause }),
          ),
        );
      yield* Effect.annotateCurrentSpan({
        "forge.python.pid": child.pid,
        "forge.python.mode": "same-process-guarded-route",
      });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      let total = 0;
      const drain = Stream.merge(
        child.stdout.pipe(Stream.map((bytes) => ({ bytes, target: stdout }))),
        child.stderr.pipe(Stream.map((bytes) => ({ bytes, target: stderr }))),
      ).pipe(
        Stream.runForEach(({ bytes, target }) =>
          Effect.suspend(() => {
            total += bytes.byteLength;
            if (total > 262144)
              return Effect.fail(new ForgePythonError({ code: "runtime_output_limit" }));
            target.push(Uint8Array.from(bytes));
            return Effect.void;
          }),
        ),
      );
      const [, exitCode] = yield* Effect.all([drain, child.exitCode], { concurrency: 2 });
      if (Number(exitCode) === 78)
        return yield* new ForgePythonError({ code: "runtime_guard_denied" });
      return {
        pid: child.pid,
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
    },
    // Closing the native process scope kills only this owned group and awaits its exit signal.
    Effect.scoped,
    Effect.timeout("5 seconds"),
    Effect.catchTags({
      TimeoutError: (cause) =>
        Effect.fail(new ForgePythonError({ code: "runtime_timeout", cause })),
    }),
    Effect.mapError((error) =>
      isPythonError(error)
        ? error
        : new ForgePythonError({ code: "runtime_process_unavailable", cause: error }),
    ),
  );
  return { run };
});

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const pinnedRuntimeFile = z.strictObject({
  path: z.string(),
  exists: z.literal(true),
  bytes: z.number().int().min(0).max(16777216),
  sha256,
});
const observedModule = z.strictObject({
  name: z.string(),
  origin: z.string().nullable(),
  spec_name: z.string().nullable(),
  loader: z.string(),
  file: z.string().nullable(),
  cached: z.string().nullable(),
  origin_file: pinnedRuntimeFile.optional(),
  frozen_registry_code_sha256: sha256.optional(),
  frozen_registry_code_bytes: z.number().int().min(1).max(16777216).optional(),
  frozen_code_filename: z.string().optional(),
});
const execCode = z.strictObject({
  filename: z.string(),
  name: z.string(),
  marshal_bytes: z.number().int().min(1).max(16777216),
  sha256,
  caller: z.string(),
});
export const observationSchema = z.strictObject({
  status: z.literal("OBSERVED_ONLY_REQUIRES_INDEPENDENT_RUNTIME_REVIEW"),
  executable: z.string(),
  version: z.string(),
  flags: z.strictObject({
    isolated: z.literal(1),
    no_site: z.literal(1),
    dont_write_bytecode: z.literal(1),
  }),
  sys_path: z.array(z.string()).length(3),
  cwd: z.string(),
  site_loaded: z.literal(false),
  executable_file: pinnedRuntimeFile,
  runtime_binary: pinnedRuntimeFile,
  modules: z.array(observedModule).max(128),
  import_events: z.array(z.string()).max(256),
  actual_exec_code: z.array(execCode).max(128),
  actual_opened_stdlib_files: z.array(pinnedRuntimeFile).max(128),
});
export type PythonObservation = z.infer<typeof observationSchema>;
export function matchesObservation(
  actual: PythonObservation,
  expected: PythonObservation,
  baseline: PythonObservation,
): boolean {
  if (
    JSON.stringify({ ...actual, actual_exec_code: [] }) !==
      JSON.stringify({ ...expected, actual_exec_code: [] }) ||
    actual.actual_exec_code.length !== expected.actual_exec_code.length
  )
    return false;
  return actual.actual_exec_code.every((code, index) => {
    const target = expected.actual_exec_code[index]!;
    if (JSON.stringify(code) === JSON.stringify(target)) return true;
    if (
      code.filename !==
        "/Library/Frameworks/Python.framework/Versions/3.11/lib/python3.11/argparse.py" ||
      target.filename !== code.filename
    )
      return false;
    const prior = baseline.actual_exec_code.find((entry) => entry.filename === code.filename);
    // The separate verdict allows only these two complete observed records, not semantic equivalence.
    return (
      prior !== undefined &&
      prior.sha256 === "eecfc6a6e407174b033817a9ed34b0818d70c554c94b59d2332492331250e6b6" &&
      target.sha256 === "539fcfe1f57392b0bf902aa8ff1f58e5fb90fa852e3dc135d18e6f2cec2a5ebf" &&
      prior.marshal_bytes === 114010 &&
      target.marshal_bytes === 114010 &&
      prior.caller === target.caller &&
      prior.name === target.name &&
      JSON.stringify(code) === JSON.stringify(prior)
    );
  });
}
