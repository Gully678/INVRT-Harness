import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { z } from "zod";
import * as Files from "./ForgeInputFiles.ts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";
import {
  firstUseTrust as trust,
  reviewedGuardedExecutionQualification,
} from "./ForgeFirstUseTrust.ts";
import { observationSchema } from "./ForgePythonRuntime.ts";
import * as Authority from "./ForgeLocalPlanningAuthority.ts";
import * as Input from "./ForgeLocalPlanningInput.ts";
import { fixture, request, run, blocked } from "./ForgeNativePlanning.test-support.ts";

const fsFault = vi.hoisted(() => ({ path: "", error: undefined as Error | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: (...args: Parameters<typeof actual.lstat>) =>
      args[0] === fsFault.path && fsFault.error
        ? Promise.reject(fsFault.error)
        : actual.lstat(...args),
  };
});

const manifestResources = z.object({
  resources: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      kind: z.enum(["body", "reference"]),
      bytes: z.number(),
      sha256: z.string(),
    }),
  ),
});
const runtimeCandidate = z
  .object({ modules: z.array(z.object({ module: z.string() }).passthrough()) })
  .passthrough();

it.layer(NodeServices.layer, { excludeTestServices: true })(
  "FORGE real local planning input",
  (it) => {
    it.effect.each(["ENOENT", "EACCES"] as const)(
      "actual file boundary keeps safe %s category",
      (code) =>
        run(
          Effect.gen(function* () {
            const { current, authority } = yield* fixture;
            const prepared = yield* authority.begin(request, current);
            const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
            const input = yield* Input.make.pipe(
              Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
            );
            const sensitive = "PRIVATE-PATH /credential/token owner-task-text";
            fsFault.path = `${trust.packageRoot}/MANIFEST.json`;
            fsFault.error = Object.assign(new Error(sensitive), { code });
            try {
              const result = yield* input.resolve(binding);
              expect(result).toEqual(
                code === "ENOENT"
                  ? { status: "unavailable", code: "snapshot_unavailable" }
                  : {
                      status: "unavailable",
                      code: "filesystem_io_unavailable",
                      diagnostic: { phase: "filesystem", cause: "io-error" },
                    },
              );
              expect(JSON.stringify(result)).not.toContain(sensitive);
              expect(JSON.stringify(result)).not.toContain(trust.packageRoot);
              expect(blocked).toEqual([]);
            } finally {
              fsFault.path = "";
              fsFault.error = undefined;
            }
          }),
        ),
    );
    it.effect("revoked native session cannot reach content admission", () =>
      run(
        Effect.gen(function* () {
          const { sql, current, authority } = yield* fixture;
          const prepared = yield* authority.begin(request, current);
          const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
          const input = yield* Input.make.pipe(
            Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
          );
          yield* sql`UPDATE auth_sessions SET revoked_at = '1970-01-01T00:00:00.000Z' WHERE session_id = ${current.sessionId}`;
          expect(yield* input.resolve(binding)).toEqual({ status: "unavailable", code: "revoked" });
          expect(blocked).toEqual([]);
          expect(
            yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`,
          ).toHaveLength(0);
        }),
      ),
    );
    // SOURCE PROPOSAL: this test must remain unexecuted until exact pre-execution approval.
    it.effect(
      "exact real package returns all18 resources after the real qualified router, with native turn held",
      () =>
        run(
          Effect.gen(function* () {
            const { sql, current, authority } = yield* fixture;
            const prepared = yield* authority.begin(request, current);
            const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
            const fs = yield* FileSystem.FileSystem;
            const directoryBefore = yield* fs.readDirectory(
              "/Users/mac/Repos/.worktrees/invrt-code-20261030-donor",
            );
            const native = yield* ChildProcessSpawner.ChildProcessSpawner;
            const children: ChildProcessSpawner.ChildProcessHandle[] = [];
            const args: string[][] = [];
            const tracked = ChildProcessSpawner.make((command) => {
              if (command._tag !== "StandardCommand") throw new Error("unexpected pipeline");
              args.push([...command.args]);
              return native.spawn(command).pipe(
                Effect.tap((child) =>
                  Effect.sync(() => {
                    children.push(child);
                  }),
                ),
              );
            });
            const input = yield* Input.make.pipe(
              Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, tracked),
            );
            const result = yield* input.resolve(binding);
            expect(Input.isAdmittedLocalPlanningInput(result)).toBe(true);
            if (!Input.isAdmittedLocalPlanningInput(result))
              throw new Error(`real input unavailable: ${result.code}`);
            expect(Input.isAdmittedLocalPlanningInput(JSON.parse(JSON.stringify(result)))).toBe(
              false,
            );
            expect(result.admission).toMatchObject({
              channel: "private-local-native-planning",
              profileId: trust.profileId,
              manifestSha256: trust.metadata["MANIFEST.json"],
              taskSha256: trust.metadata["TASK.json"],
              nativeRunId: binding.runId,
              nativeRunRevision: 1,
              humanVerified: false,
              buildAuthorised: false,
            });
            const manifest = manifestResources.parse(
              Files.parseJson(
                yield* fs.readFile(`${trust.packageRoot}/MANIFEST.json`),
                "manifest-invalid",
              ),
            );
            expect(result.resources.map((resource) => resource.id)).toEqual(
              manifest.resources.map((resource) => resource.id),
            );
            expect(result.resources).toHaveLength(18);
            expect(result.resources.filter((resource) => resource.kind === "body")).toHaveLength(8);
            expect(
              result.resources.filter((resource) => resource.kind === "reference"),
            ).toHaveLength(10);
            expect(result.resources.reduce((sum, resource) => sum + resource.utf8Bytes, 0)).toBe(
              502130,
            );
            for (const [index, resource] of result.resources.entries()) {
              const expected = manifest.resources[index]!;
              const original = yield* fs.readFile(`${trust.packageRoot}/${expected.path}`);
              expect(Buffer.from(resource.text)).toEqual(Buffer.from(original));
              expect(resource.utf8Bytes).toBe(expected.bytes);
              expect(resource.sha256).toBe(expected.sha256);
              expect(Files.hash(Buffer.from(resource.text))).toBe(expected.sha256);
              expect(Object.isFrozen(resource)).toBe(true);
            }
            const ids = result.resources.map((resource) => resource.id);
            expect(ids.filter((id) => id === "licence-notices/superpowers-MIT")).toHaveLength(1);
            for (const body of ["verification-before-completion", "writing-plans"])
              expect(ids.indexOf("licence-notices/superpowers-MIT")).toBeLessThan(
                ids.indexOf(body),
              );
            expect(ids.indexOf("licence-notices/ralph-MIT")).toBeLessThan(ids.indexOf("prd"));
            const gotchas = result.resources.find(
              (resource) => resource.id === "production-audit/references/gotchas-catalog.md",
            );
            expect(gotchas?.aliases).toContain(
              "production-guardrails/references/gotchas-catalog.md",
            );
            expect(children).toHaveLength(1);
            for (const child of children) expect(yield* child.isRunning).toBe(false);
            const qualification = reviewedGuardedExecutionQualification();
            if (!qualification) throw new Error("guard qualification required");
            expect(args[0]?.slice(0, 4)).toEqual(["-I", "-S", "-B", "-c"]);
            expect(Files.hash(args[0]![4]!)).toBe(qualification.launcherSha256);
            expect(args[0]![5]).toBe(qualification.policyPath);
            expect(args[0]![6]).toBe(qualification.policySha256);
            expect(args[0]?.slice(7)).toEqual([
              `--prompt=${trust.taskPrompt}`,
              "--cwd=/Users/mac/Repos/.worktrees/invrt-code-20261030-donor",
              "--task-type=planning",
              "--review",
              "--llm",
              "--done",
            ]);
            expect(
              yield* fs.readDirectory("/Users/mac/Repos/.worktrees/invrt-code-20261030-donor"),
            ).toEqual(directoryBefore);
            expect(
              yield* authority.start(
                { runId: binding.runId, revision: 1, operationId: "held-after-content" },
                current,
              ),
            ).toMatchObject({ nativeTurnHeld: true, state: "prepared" });
            expect(blocked).toEqual([]);
            expect(yield* sql`SELECT run_id FROM forge_local_planning_runs`).toHaveLength(1);
            expect(
              yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`,
            ).toHaveLength(0);
            expect(
              yield* sql`SELECT command_id FROM orchestration_v2_command_receipts`,
            ).toHaveLength(0);
          }),
        ),
    );
    it.effect("wire and projector-shaped objects cannot become a private native binding", () =>
      run(
        Effect.gen(function* () {
          const { current, authority } = yield* fixture;
          const prepared = yield* authority.begin(request, current);
          const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
          const input = yield* Input.make.pipe(
            Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
          );
          const wire: unknown = JSON.parse(JSON.stringify(binding));
          for (const value of [
            null,
            {},
            wire,
            { status: "ready", productionAdmitted: true, binding: wire },
          ])
            expect(yield* input.resolve(value)).toEqual({
              status: "unavailable",
              code: "wrong_binding",
            });
          expect(blocked).toEqual([]);
        }),
      ),
    );
    it.effect.each(["route_names_changed", "revoked_after_router"] as const)(
      "%s is denied after the actual qualified router with zero provider effects",
      (fault) =>
        run(
          Effect.gen(function* () {
            const { sql, current, authority } = yield* fixture;
            const prepared = yield* authority.begin(request, current);
            const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
            const native = yield* ChildProcessSpawner.ChildProcessSpawner;
            const children: ChildProcessSpawner.ChildProcessHandle[] = [];
            let routed = false;
            const negative = ChildProcessSpawner.make((command) =>
              native.spawn(command).pipe(
                Effect.map((child) => {
                  children.push(child);
                  if (command._tag !== "StandardCommand" || command.args[3] !== "-c") return child;
                  routed = true;
                  if (fault === "revoked_after_router")
                    return {
                      ...child,
                      exitCode: child.exitCode.pipe(
                        Effect.tap(() =>
                          sql`UPDATE auth_sessions SET revoked_at = '1970-01-01T00:00:00.000Z' WHERE session_id = ${current.sessionId}`.pipe(
                            Effect.orDie,
                          ),
                        ),
                      ),
                    };
                  return {
                    ...child,
                    stdout: Stream.concat(
                      Stream.drain(child.stdout),
                      Stream.make(
                        Buffer.from(
                          JSON.stringify({
                            task_types: ["planning"],
                            required: [...trust.routerRequired.slice(0, 5), "wrong-name"],
                            recommended: [],
                          }),
                        ),
                      ),
                    ),
                  };
                }),
              ),
            );
            const input = yield* Input.make.pipe(
              Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, negative),
            );
            expect(yield* input.resolve(binding)).toEqual({
              status: "unavailable",
              code: fault === "revoked_after_router" ? "revoked" : "routing_mismatch",
            });
            expect(routed).toBe(true);
            expect(children).toHaveLength(1);
            for (const child of children) expect(yield* child.isRunning).toBe(false);
            expect(blocked).toEqual([]);
            expect(
              yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`,
            ).toHaveLength(0);
            expect(
              yield* sql`SELECT command_id FROM orchestration_v2_command_receipts`,
            ).toHaveLength(0);
          }),
        ),
    );
    it.effect.each([
      "MANIFEST.json",
      "ROUTER-CATALOGUE-CUSTODY.json",
      "content/skills/writing-plans/SKILL.md",
    ])("native revocation during awaited %s read prevents admission", (path) =>
      run(
        Effect.gen(function* () {
          const { sql, current, authority } = yield* fixture;
          const prepared = yield* authority.begin(request, current);
          const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
          const input = yield* Input.make.pipe(
            Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
          );
          let revoked = false;
          let readReached!: () => void;
          let releaseRead!: () => void;
          const reached = new Promise<void>((resolve) => {
            readReached = resolve;
          });
          const released = new Promise<void>((resolve) => {
            releaseRead = resolve;
          });
          yield* Effect.promise(() => reached).pipe(
            Effect.andThen(
              sql`UPDATE auth_sessions SET revoked_at = '1970-01-01T00:00:00.000Z' WHERE session_id = ${current.sessionId}`,
            ),
            Effect.andThen(
              Effect.sync(() => {
                revoked = true;
                releaseRead();
              }),
            ),
            Effect.forkChild,
          );
          const original = Files.readVerified;
          using _read = vi
            .spyOn(Files, "readVerified")
            .mockImplementation(async (root, name, ...rest) => {
              const bytes = await original(root, name, ...rest);
              if (!revoked && name === path) {
                readReached();
                await released;
              }
              return bytes;
            });
          expect(yield* input.resolve(binding)).toEqual({ status: "unavailable", code: "revoked" });
          expect(revoked).toBe(true);
          expect(blocked).toEqual([]);
          expect(
            yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`,
          ).toHaveLength(0);
          expect(yield* sql`SELECT command_id FROM orchestration_v2_command_receipts`).toHaveLength(
            0,
          );
        }),
      ),
    );
    it.effect.each(["MANIFEST.json", "content/skills/prd/SKILL.md"])(
      "edited %s is denied by the production consumer",
      (path) =>
        run(
          Effect.gen(function* () {
            const { current, authority } = yield* fixture;
            const prepared = yield* authority.begin(request, current);
            const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
            const input = yield* Input.make.pipe(
              Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
            );
            const original = Files.readVerified;
            using _read = vi
              .spyOn(Files, "readVerified")
              .mockImplementation(async (root, name, ...rest) => {
                const bytes = await original(root, name, ...rest);
                return name === path ? Buffer.concat([bytes, Buffer.from("changed")]) : bytes;
              });
            expect(yield* input.resolve(binding)).toMatchObject({
              status: "unavailable",
              code: "resource_changed",
            });
            expect(blocked).toEqual([]);
          }),
        ),
    );
    it.effect("a missing real reference has no installed-reference fallback", () =>
      run(
        Effect.gen(function* () {
          const { current, authority } = yield* fixture;
          const prepared = yield* authority.begin(request, current);
          const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
          const input = yield* Input.make.pipe(
            Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
          );
          const original = Files.readVerified;
          const roots: string[] = [];
          const id = "ai-native-agent/references/ai-gotchas.md";
          using _read = vi
            .spyOn(Files, "readVerified")
            .mockImplementation((root, path, ...rest) => {
              roots.push(root);
              if (path === `content/skills/${id}`)
                return Promise.reject(
                  new Files.ForgeTaskInputUnavailableError("reference-missing", id),
                );
              return original(root, path, ...rest);
            });
          expect(yield* input.resolve(binding)).toEqual({
            status: "unavailable",
            code: "reference_incomplete",
            resourceId: id,
          });
          expect(roots.some((root) => root.startsWith("/Users/mac/.agents/skills"))).toBe(false);
          expect(blocked).toEqual([]);
        }),
      ),
    );
    it.effect.each(["compiled_anchor", "runtime_future_entry", "catalogue_drift"] as const)(
      "%s is denied before any router execution",
      (fault) =>
        run(
          Effect.gen(function* () {
            const { sql, current, authority } = yield* fixture;
            const prepared = yield* authority.begin(request, current);
            const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
            const native = yield* ChildProcessSpawner.ChildProcessSpawner;
            using spawn = vi.spyOn(native, "spawn");
            const input = yield* Input.make.pipe(
              Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
            );
            if (fault === "compiled_anchor")
              yield* sql`UPDATE forge_local_planning_runs SET manifest_sha256 = ${"0".repeat(64)} WHERE run_id = ${binding.runId}`;
            const original = Files.readVerified;
            using _read = vi
              .spyOn(Files, "readVerified")
              .mockImplementation(async (root, path, ...rest) => {
                const bytes = await original(root, path, ...rest);
                if (fault === "runtime_future_entry" && path === "PYTHON-RUNTIME-CANDIDATE.json") {
                  const runtime = runtimeCandidate.parse(
                    Files.parseJson(bytes, "manifest-invalid"),
                  );
                  return Buffer.from(
                    JSON.stringify({
                      ...runtime,
                      modules: runtime.modules.filter((entry) => entry.module !== "__future__"),
                    }),
                  );
                }
                if (
                  fault === "catalogue_drift" &&
                  root === trust.routerRoot &&
                  path === "skills/ai-native-agent/SKILL.md"
                )
                  return Buffer.concat([bytes, Buffer.from("changed")]);
                return bytes;
              });
            expect(yield* input.resolve(binding)).toEqual({
              status: "unavailable",
              code: fault === "compiled_anchor" ? "trust_mismatch" : "resource_changed",
            });
            expect(spawn).not.toHaveBeenCalled();
            expect(blocked).toEqual([]);
          }),
        ),
    );
    it.effect.each(["missing", "unknown_import"] as const)(
      "static inventory alone cannot qualify %s reviewed runtime metadata",
      (fault) =>
        run(
          Effect.gen(function* () {
            const { current, authority } = yield* fixture;
            const prepared = yield* authority.begin(request, current);
            const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
            const native = yield* ChildProcessSpawner.ChildProcessSpawner;
            using spawn = vi.spyOn(native, "spawn");
            const input = yield* Input.make.pipe(
              Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
            );
            let staticInventoryRead = false;
            let reviewedMetadataRead = false;
            const original = Files.readVerified;
            using _read = vi
              .spyOn(Files, "readVerified")
              .mockImplementation(async (root, path, ...rest) => {
                if (path === "PYTHON-RUNTIME-CANDIDATE.json") staticInventoryRead = true;
                if (path === "PROBE03-stdout.txt") {
                  reviewedMetadataRead = true;
                  if (fault === "missing")
                    throw new Files.ForgeTaskInputUnavailableError("router-runtime-unavailable");
                  const actual = await original(root, path, ...rest);
                  const observed = observationSchema.parse(
                    Files.parseJson(actual, "manifest-invalid"),
                  );
                  return Buffer.from(
                    JSON.stringify({
                      ...observed,
                      modules: [
                        ...observed.modules,
                        { ...observed.modules[0]!, name: "unreviewed-import" },
                      ],
                    }),
                  );
                }
                return original(root, path, ...rest);
              });
            expect(yield* input.resolve(binding)).toEqual({
              status: "unavailable",
              code: fault === "missing" ? "router_runtime_unavailable" : "runtime_unqualified",
            });
            expect(staticInventoryRead).toBe(true);
            expect(reviewedMetadataRead).toBe(true);
            expect(spawn).not.toHaveBeenCalled();
            expect(blocked).toEqual([]);
          }),
        ),
    );
    it.effect.each([
      ["ralph", false],
      ["ralph", true],
      ["superpowers", false],
      ["superpowers", true],
    ] as const)(
      "missing/truncated %s MIT notice (%s) forbids copied bodies without the whole reference",
      ([name, truncate]) =>
        run(
          Effect.gen(function* () {
            const { current, authority } = yield* fixture;
            const prepared = yield* authority.begin(request, current);
            const binding = yield* authority.revalidate(prepared.binding.runId, 1, current);
            const input = yield* Input.make.pipe(
              Effect.provideService(Authority.ForgeLocalPlanningAuthority, authority),
            );
            const original = Files.readVerified;
            const id = `licence-notices/${name}-MIT`;
            using _read = vi
              .spyOn(Files, "readVerified")
              .mockImplementation(async (root, path, ...rest) => {
                if (path === `content/notices/${name}-MIT.txt`) {
                  if (truncate) return (await original(root, path, ...rest)).subarray(0, 20);
                  return Promise.reject(
                    new Files.ForgeTaskInputUnavailableError("reference-missing", id),
                  );
                }
                return original(root, path, ...rest);
              });
            expect(yield* input.resolve(binding)).toEqual({
              status: "unavailable",
              code: "reference_incomplete",
              resourceId: id,
            });
            expect(blocked).toEqual([]);
          }),
        ),
    );
  },
);
