// @effect-diagnostics-next-line nodeBuiltinImport:off -- Bound code-owned candidate paths.
import * as NodePath from "node:path";
import { z } from "zod";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ForgePlanningError } from "@t3tools/contracts";
import * as Authority from "./ForgeLocalPlanningAuthority.ts";
import {
  firstUseTrust as trust,
  reviewedPythonQualification,
  reviewedGuardedExecutionQualification,
  guardedLauncherPath,
} from "./ForgeFirstUseTrust.ts";
import { guardedMetadataSchema, buildGuardPolicy } from "./ForgeGuardedExecution.ts";
import {
  checkPath,
  requireAbsent,
  readVerified,
  hash,
  parseJson,
  decodeUtf8,
  safePath,
  orderResourceClosure,
  ForgeTaskInputUnavailableError,
  diagnosticSchema,
} from "./ForgeInputFiles.ts";
import * as ZipArchive from "../zipArchive.ts";
import * as Python from "./ForgePythonRuntime.ts";

const fileSchema = z.object({
  path: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(1).max(1048576),
});
const resourceSchema = fileSchema.extend({
  id: z.string().min(1),
  kind: z.enum(["body", "reference"]),
  requiredNoticeIds: z.array(z.string()).optional(),
});
const manifestSchema = z.object({
  schemaVersion: z.literal(5),
  snapshotId: z.literal("first-use-planning-real-v5"),
  channel: z.literal("private-local-native-planning-candidate"),
  routerRoot: z.string(),
  routerFiles: z.array(fileSchema).length(4),
  resources: z.array(resourceSchema).length(18),
  dependencyEdges: z.array(z.tuple([z.string(), z.string()])).max(32),
});
const receiptSchema = z.object({ files: z.array(fileSchema).length(53) });
const catalogueSchema = z.object({
  root: z.string(),
  count: z.literal(795),
  files: z.array(fileSchema).length(795),
});
const runtimeSchema = z.object({
  executable: z.string(),
  sha256: z.string(),
  mode: z.tuple([z.literal("-I"), z.literal("-S"), z.literal("-B")]),
  modules: z
    .array(fileSchema.extend({ module: z.string(), bytes: z.number().int().min(0).max(1048576) }))
    .length(79),
});
const licenceSchema = z.object({
  notices: z
    .array(
      fileSchema.extend({
        id: z.string(),
        completeNotice: z.literal(true),
        requiredFor: z.array(z.string()).min(1),
      }),
    )
    .length(2),
});
const taskSchema = z.object({
  purpose: z.literal("local-native-planning"),
  prompt: z.string(),
  taskTypes: z.tuple([z.literal("planning")]),
  flags: z.object({
    build: z.literal(false),
    review: z.literal(true),
    llm: z.literal(true),
    done: z.literal(true),
  }),
  expectedRouterRequired: z.array(z.string()),
  required: z.array(z.string()),
});
const routeSchema = z.strictObject({
  task_types: z.array(z.string()).length(1),
  required: z.array(z.string()).length(6),
  recommended: z.array(z.string()).max(795),
});
const routeMetadataSchema = z.object({
  task_types: z.object({ planning: z.object({ recommended: z.array(z.string()).max(795) }) }),
});
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const admittedBrand: unique symbol = Symbol("AdmittedLocalPlanningInput");
const admitted = new WeakSet<object>();
export interface AdmittedLocalPlanningInput {
  readonly [admittedBrand]: true;
  readonly status: "ready";
  readonly admission: {
    readonly channel: "private-local-native-planning";
    readonly trustRevision: 1;
    readonly profileId: "first-use-planning-real-v5";
    readonly manifestSha256: string;
    readonly taskSha256: string;
    readonly nativeRunId: string;
    readonly nativeRunRevision: number;
    readonly humanVerified: false;
    readonly buildAuthorised: false;
  };
  readonly binding: Authority.LocalPlanningBinding;
  readonly resources: readonly {
    readonly id: string;
    readonly aliases: readonly string[];
    readonly kind: "body" | "reference";
    readonly sha256: string;
    readonly utf8Bytes: number;
    readonly text: string;
  }[];
}
export type LocalPlanningInputResult =
  | AdmittedLocalPlanningInput
  | {
      readonly status: "unavailable";
      readonly code: string;
      readonly resourceId?: string;
      readonly diagnostic?: z.infer<typeof diagnosticSchema>;
    };
export const isAdmittedLocalPlanningInput = (value: unknown): value is AdmittedLocalPlanningInput =>
  typeof value === "object" && value !== null && admitted.has(value);
export class ForgeLocalPlanningInput extends Context.Service<
  ForgeLocalPlanningInput,
  {
    readonly resolve: (binding: unknown) => Effect.Effect<LocalPlanningInputResult>;
  }
>()("t3/provider/ForgeLocalPlanningInput") {}
class InputUnavailable extends Error {
  readonly code: string;
  readonly resourceId: string | undefined;
  readonly diagnostic: z.infer<typeof diagnosticSchema> | undefined;
  constructor(code: string, resourceId?: string, diagnostic?: z.infer<typeof diagnosticSchema>) {
    super(code);
    this.code = code;
    this.resourceId = resourceId;
    this.diagnostic = diagnostic;
  }
}
const isPlanningError = Schema.is(ForgePlanningError);
const isPythonError = Schema.is(Python.ForgePythonError);
const inputError = (error: unknown): InputUnavailable | ForgeTaskInputUnavailableError =>
  error instanceof InputUnavailable || error instanceof ForgeTaskInputUnavailableError
    ? error
    : new InputUnavailable("capability_unavailable", undefined, {
        phase: "internal",
        cause: "unexpected-error",
      });
const fail = (code: string, resourceId?: string): never => {
  throw new InputUnavailable(code, resourceId);
};
const parse = <T>(bytes: Uint8Array, schema: z.ZodType<T>, resourceId = "manifest") =>
  Effect.try({
    try: () => schema.parse(parseJson(bytes, "manifest-invalid")),
    catch: () => new InputUnavailable("manifest_invalid", resourceId),
  });

export const make = Effect.gen(function* () {
  const authority = yield* Authority.ForgeLocalPlanningAuthority;
  const python = yield* Python.make;
  const resolve = Effect.fn("ForgeLocalPlanningInput.resolve")(
    function* (
      input: unknown,
    ): Effect.fn.Return<
      LocalPlanningInputResult,
      | InputUnavailable
      | ForgeTaskInputUnavailableError
      | ForgePlanningError
      | Python.ForgePythonError
    > {
      if (!Authority.isLocalPlanningBinding(input))
        return { status: "unavailable", code: "wrong_binding" };
      const binding = input;
      const initial = yield* authority.revalidateBinding(binding);
      const cwd = initial.cwd;
      const checkpoint = authority.revalidateBinding(binding).pipe(
        Effect.flatMap((current) => {
          if (JSON.stringify(current.binding) !== JSON.stringify(binding) || current.cwd !== cwd)
            return Effect.fail(new InputUnavailable("wrong_binding"));
          return Effect.void;
        }),
      );
      yield* checkpoint;
      if (
        binding.manifestSha256 !== trust.metadata["MANIFEST.json"] ||
        binding.taskSha256 !== trust.metadata["TASK.json"] ||
        binding.trustRevision !== trust.trustRevision
      )
        return yield* Effect.fail(new InputUnavailable("trust_mismatch"));
      const read = (
        root: string,
        path: string,
        expectedHash: string,
        size?: number,
        resourceId?: string,
        resourceKind?: "body" | "reference",
      ) =>
        Effect.tryPromise({
          try: async () => {
            const bytes = await readVerified(
              root,
              path,
              1048576,
              resourceKind === "reference"
                ? "reference-missing"
                : resourceKind === "body"
                  ? "body-missing"
                  : "snapshot-unavailable",
              resourceId,
            );
            if (hash(bytes) !== expectedHash || (size !== undefined && bytes.length !== size))
              fail(
                resourceId?.startsWith("licence-notices/")
                  ? "reference_incomplete"
                  : "resource_changed",
                resourceId,
              );
            return bytes;
          },
          catch: inputError,
        }).pipe(Effect.tap(() => checkpoint));
      yield* Effect.tryPromise({
        try: () => checkPath(cwd, true, "snapshot-unavailable"),
        catch: inputError,
      });
      yield* checkpoint;
      const metadata = new Map<string, Uint8Array>();
      for (const [name, expected] of Object.entries(trust.metadata))
        metadata.set(name, yield* read(trust.packageRoot, name, expected));
      const manifest = yield* parse(metadata.get("MANIFEST.json")!, manifestSchema);
      const task = yield* parse(metadata.get("TASK.json")!, taskSchema, "task");
      if (
        task.prompt !== trust.taskPrompt ||
        manifest.routerRoot !== trust.routerRoot ||
        !same(task.expectedRouterRequired, trust.routerRequired) ||
        !same(task.required, trust.required)
      )
        return yield* Effect.fail(new InputUnavailable("routing_mismatch"));
      const receiptBytes = yield* read(
        trust.evidenceRoot,
        "V5-REVIEW-INPUTS.json",
        trust.receiptSha256,
      );
      const receipt = yield* parse(receiptBytes, receiptSchema, "receipt");
      const verified = new Map<string, Uint8Array>();
      for (const file of receipt.files) {
        if (!file.path.startsWith(trust.evidenceRoot + NodePath.sep))
          return yield* Effect.fail(new InputUnavailable("unsafe_path"));
        const relative = NodePath.relative(trust.evidenceRoot, file.path);
        const resource = manifest.resources.find(
          (entry) => NodePath.join(trust.packageRoot, entry.path) === file.path,
        );
        verified.set(
          file.path,
          yield* read(
            trust.evidenceRoot,
            relative,
            file.sha256,
            file.bytes,
            resource?.id,
            resource?.kind,
          ),
        );
      }
      const archivePath = NodePath.join(trust.evidenceRoot, "FIRST-USE-REAL-INPUTS-V5.zip");
      const archiveBytes = verified.get(archivePath);
      if (!archiveBytes || hash(archiveBytes) !== trust.archiveSha256)
        return yield* Effect.fail(new InputUnavailable("trust_mismatch"));
      const members = new Map(
        [...verified]
          .filter(([path]) => path.startsWith(trust.packageRoot + NodePath.sep))
          .map(([path, bytes]) => [NodePath.relative(trust.packageRoot, path), bytes]),
      );
      if (members.size !== 32)
        return yield* Effect.fail(new InputUnavailable("reference_incomplete"));
      yield* Effect.gen(function* () {
        const archive = yield* ZipArchive.openZipArchive(
          archivePath,
          () => new InputUnavailable("reference_incomplete"),
        );
        yield* checkpoint;
        if (archive.entryCount !== 32)
          return yield* Effect.fail(new InputUnavailable("reference_incomplete"));
        const seen = new Set<string>();
        for (;;) {
          const entry = yield* archive.next;
          yield* checkpoint;
          if (!entry) break;
          const expected = members.get(entry.fileName);
          if (
            !safePath(entry.fileName) ||
            seen.has(entry.fileName) ||
            !expected ||
            entry.uncompressedSize !== expected.length
          )
            return yield* Effect.fail(new InputUnavailable("reference_incomplete"));
          seen.add(entry.fileName);
          const readable = yield* archive.streamEntry(entry);
          yield* checkpoint;
          const bytes = yield* Effect.tryPromise({
            try: async () => {
              const chunks: Uint8Array[] = [];
              let size = 0;
              for await (const chunk of readable) {
                if (!(chunk instanceof Uint8Array)) fail("reference_incomplete");
                size += chunk.byteLength;
                if (size > expected.length || size > 1048576) fail("reference_incomplete");
                chunks.push(chunk);
              }
              return Buffer.concat(chunks);
            },
            catch: inputError,
          });
          yield* checkpoint;
          if (!bytes.equals(expected))
            return yield* Effect.fail(new InputUnavailable("reference_incomplete"));
        }
        if (seen.size !== 32)
          return yield* Effect.fail(new InputUnavailable("reference_incomplete"));
      }).pipe(Effect.scoped);
      yield* checkpoint;
      yield* read(trust.evidenceRoot, "FIRST-USE-REAL-INPUTS-V5.zip", trust.archiveSha256);
      const catalogue = yield* parse(
        metadata.get("ROUTER-CATALOGUE-CUSTODY.json")!,
        catalogueSchema,
        "catalogue",
      );
      if (
        catalogue.root !== trust.routerRoot ||
        new Set(catalogue.files.map((file) => file.path)).size !== 795
      )
        return yield* Effect.fail(new InputUnavailable("routing_mismatch"));
      for (const file of [...manifest.routerFiles, ...catalogue.files])
        yield* read(trust.routerRoot, file.path, file.sha256, file.bytes);
      const runtime = yield* parse(
        metadata.get("PYTHON-RUNTIME-CANDIDATE.json")!,
        runtimeSchema,
        "runtime",
      );
      if (
        runtime.executable !== trust.executable ||
        runtime.sha256 !== trust.executableSha256 ||
        !runtime.modules.some((module) => module.module === "__future__")
      )
        return yield* Effect.fail(new InputUnavailable("runtime_unqualified"));
      for (const file of runtime.modules) {
        if (
          !file.path.startsWith(
            "/Library/Frameworks/Python.framework/Versions/3.11/lib/python3.11/",
          )
        )
          return yield* Effect.fail(new InputUnavailable("unsafe_path"));
        yield* read(
          NodePath.dirname(file.path),
          NodePath.basename(file.path),
          file.sha256,
          file.bytes,
        );
      }
      yield* read(
        NodePath.dirname(trust.executable),
        NodePath.basename(trust.executable),
        trust.executableSha256,
      );
      const resources = manifest.resources.map((resource) => ({
        ...resource,
        byteLength: resource.bytes,
        dependencies: manifest.dependencyEdges
          .filter(([from]) => from === resource.id)
          .map(([, to]) => to),
      }));
      const bodies = resources.filter((resource) => resource.kind === "body");
      if (
        new Set(resources.map((resource) => resource.id)).size !== 18 ||
        new Set(resources.map((resource) => resource.path.toLowerCase())).size !== 18 ||
        bodies.length !== 8 ||
        !same(bodies.map((resource) => resource.id).sort(), trust.required) ||
        resources.reduce((sum, resource) => sum + resource.bytes, 0) !== 502130
      )
        return yield* Effect.fail(new InputUnavailable("reference_incomplete"));
      yield* Effect.try({ try: () => orderResourceClosure(resources, bodies), catch: inputError });
      const licences = yield* parse(
        metadata.get("LICENCE-CUSTODY.json")!,
        licenceSchema,
        "licences",
      );
      for (const notice of licences.notices) {
        const index = resources.findIndex((resource) => resource.id === notice.id);
        const resource = resources[index];
        if (
          !resource ||
          resource.kind !== "reference" ||
          resource.path !== notice.path ||
          resource.bytes !== notice.bytes ||
          resource.sha256 !== notice.sha256
        )
          return yield* Effect.fail(new InputUnavailable("reference_incomplete", notice.id));
        for (const bodyId of notice.requiredFor) {
          const bodyIndex = resources.findIndex((entry) => entry.id === bodyId);
          const body = resources[bodyIndex];
          if (
            !body ||
            body.kind !== "body" ||
            index >= bodyIndex ||
            !body.requiredNoticeIds?.includes(notice.id) ||
            !body.dependencies.includes(notice.id)
          )
            return yield* Effect.fail(new InputUnavailable("reference_incomplete", notice.id));
        }
      }
      const content: {
        id: string;
        kind: "body" | "reference";
        sha256: string;
        utf8Bytes: number;
        text: string;
      }[] = [];
      for (const resource of resources) {
        const bytes = yield* read(
          trust.packageRoot,
          resource.path,
          resource.sha256,
          resource.bytes,
          resource.id,
          resource.kind,
        );
        const text = yield* Effect.try({ try: () => decodeUtf8(bytes), catch: inputError });
        content.push({
          id: resource.id,
          kind: resource.kind,
          sha256: resource.sha256,
          utf8Bytes: bytes.length,
          text,
        });
        for (const noticeId of resource.requiredNoticeIds ?? []) {
          if (
            !licences.notices.some(
              (notice) => notice.id === noticeId && notice.requiredFor.includes(resource.id),
            )
          )
            return yield* Effect.fail(new InputUnavailable("reference_incomplete", resource.id));
        }
      }
      yield* checkpoint;
      const qualification = reviewedPythonQualification();
      if (!qualification) return { status: "unavailable", code: "runtime_unqualified" };
      if (cwd !== qualification.cwd)
        return { status: "unavailable", code: "runtime_cwd_unqualified" };
      const guarded = reviewedGuardedExecutionQualification();
      if (!guarded) return { status: "unavailable", code: "runtime_guard_unqualified" };
      const readAbsolute = (path: string, expected: string, limit = 1048576) =>
        Effect.tryPromise({
          try: async () => {
            const bytes = await readVerified(
              NodePath.dirname(path),
              NodePath.basename(path),
              limit,
              "router-runtime-unavailable",
            );
            if (hash(bytes) !== expected) fail("runtime_unqualified");
            return bytes;
          },
          catch: inputError,
        }).pipe(Effect.tap(() => checkpoint));
      yield* readAbsolute(trust.contentVerdict.path, trust.contentVerdict.sha256);
      yield* readAbsolute(trust.packetVerdict.path, trust.packetVerdict.sha256);
      yield* readAbsolute(qualification.verdictPath, qualification.verdictSha256);
      const expected = yield* parse(
        yield* readAbsolute(qualification.metadataPath, qualification.metadataSha256),
        Python.observationSchema,
      );
      const baseline = yield* parse(
        yield* readAbsolute(qualification.baselinePath, qualification.baselineSha256),
        Python.observationSchema,
      );
      yield* readAbsolute(guarded.verdictPath, guarded.verdictSha256);
      const guardedMetadata = yield* parse(
        yield* readAbsolute(guarded.metadataPath, guarded.metadataSha256),
        guardedMetadataSchema,
        "guarded-runtime",
      );
      const launcher = decodeUtf8(yield* readAbsolute(guardedLauncherPath, guarded.launcherSha256));
      if (guardedMetadata.launcherSha256 !== guarded.launcherSha256)
        return yield* Effect.fail(new InputUnavailable("runtime_guard_unqualified"));
      if (
        expected.cwd !== cwd ||
        expected.modules.length !== 81 ||
        expected.actual_opened_stdlib_files.length !== 35 ||
        baseline.modules.length !== 72 ||
        baseline.actual_opened_stdlib_files.length !== 30 ||
        expected.executable !== trust.executable ||
        expected.executable_file.sha256 !== trust.executableSha256
      )
        return yield* Effect.fail(new InputUnavailable("runtime_unqualified"));
      const runtimeFiles = [
        expected.executable_file,
        expected.runtime_binary,
        ...expected.actual_opened_stdlib_files,
        ...expected.modules.flatMap((module) => (module.origin_file ? [module.origin_file] : [])),
      ];
      const verifyRuntime = Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            requireAbsent("/Library/Frameworks/Python.framework/Versions/3.11/lib/python311.zip"),
          catch: inputError,
        });
        yield* checkpoint;
        for (const file of runtimeFiles) {
          if (
            !file.path.startsWith("/Library/Frameworks/Python.framework/Versions/3.11/") ||
            file.path.includes("/site-packages/")
          )
            return yield* Effect.fail(new InputUnavailable("runtime_unqualified"));
          const bytes = yield* readAbsolute(file.path, file.sha256, Math.max(1, file.bytes));
          if (bytes.length !== file.bytes)
            return yield* Effect.fail(new InputUnavailable("runtime_unqualified"));
        }
      });
      yield* verifyRuntime;
      yield* checkpoint;
      const guardFiles = [
        ...runtimeFiles,
        ...runtime.modules,
        ...[...manifest.routerFiles, ...catalogue.files].map((file) => ({
          ...file,
          path: NodePath.join(trust.routerRoot, file.path),
        })),
      ];
      const policy = yield* Effect.try({
        try: () =>
          buildGuardPolicy(
            expected,
            baseline,
            guardedMetadata,
            guardFiles,
            manifest.routerFiles.find((file) => file.path === "tools/route_skills.py")!.sha256,
          ),
        catch: () => new InputUnavailable("runtime_guard_unqualified"),
      });
      if (hash(policy) !== guarded.policySha256)
        return yield* Effect.fail(new InputUnavailable("runtime_guard_unqualified"));
      yield* checkpoint;
      const routed = yield* python.run(cwd, launcher, policy);
      yield* checkpoint;
      if (routed.exitCode !== 0 || routed.stderr.length !== 0)
        return yield* Effect.fail(new InputUnavailable("routing_mismatch"));
      const route = yield* parse(routed.stdout, routeSchema);
      const routedMetadata = yield* parse(
        verified.get(NodePath.join(trust.packageRoot, "router/skills/ROUTING.yaml"))!,
        routeMetadataSchema,
      );
      const recommended = [...new Set(routedMetadata.task_types.planning.recommended)]
        .filter((name) => !trust.routerRequired.includes(name))
        .sort();
      if (
        !same(route.task_types, ["planning"]) ||
        !same(route.required, trust.routerRequired) ||
        !same(route.recommended, recommended) ||
        !same(
          [...new Set([...route.required, "production-guardrails", "invrt-concise-code"])].sort(),
          trust.required,
        )
      )
        return yield* Effect.fail(new InputUnavailable("routing_mismatch"));
      yield* verifyRuntime;
      for (const file of receipt.files)
        yield* read(
          trust.evidenceRoot,
          NodePath.relative(trust.evidenceRoot, file.path),
          file.sha256,
          file.bytes,
        );
      for (const file of [...manifest.routerFiles, ...catalogue.files])
        yield* read(trust.routerRoot, file.path, file.sha256, file.bytes);
      for (const file of runtime.modules)
        yield* read(
          NodePath.dirname(file.path),
          NodePath.basename(file.path),
          file.sha256,
          file.bytes,
        );
      yield* Effect.tryPromise({
        try: () => checkPath(cwd, true, "snapshot-unavailable"),
        catch: inputError,
      });
      yield* checkpoint;
      const result: AdmittedLocalPlanningInput = Object.freeze({
        [admittedBrand]: true as const,
        status: "ready",
        admission: Object.freeze({
          channel: "private-local-native-planning",
          trustRevision: 1,
          profileId: "first-use-planning-real-v5",
          manifestSha256: trust.metadata["MANIFEST.json"],
          taskSha256: trust.metadata["TASK.json"],
          nativeRunId: binding.runId,
          nativeRunRevision: binding.revision,
          humanVerified: false,
          buildAuthorised: false,
        }),
        binding,
        resources: Object.freeze(
          content.map((resource) =>
            Object.freeze({
              ...resource,
              aliases: Object.freeze(
                content
                  .filter(
                    (other) =>
                      other.id !== resource.id &&
                      other.sha256 === resource.sha256 &&
                      other.text === resource.text,
                  )
                  .map((other) => other.id),
              ),
            }),
          ),
        ),
      });
      admitted.add(result);
      return result;
    },
    (effect) =>
      effect.pipe(
        Effect.catch((error) => {
          if (isPlanningError(error) || error instanceof InputUnavailable || isPythonError(error))
            return Effect.succeed({
              status: "unavailable" as const,
              code: error.code,
              ...(error instanceof InputUnavailable && error.resourceId
                ? { resourceId: error.resourceId }
                : {}),
              ...((error instanceof InputUnavailable || isPythonError(error)) && error.diagnostic
                ? { diagnostic: diagnosticSchema.parse(error.diagnostic) }
                : {}),
            });
          if (error instanceof ForgeTaskInputUnavailableError)
            return Effect.succeed({
              status: "unavailable" as const,
              code:
                error.diagnostic?.phase === "filesystem"
                  ? "filesystem_io_unavailable"
                  : error.code === "reference-missing"
                    ? "reference_incomplete"
                    : error.code.replaceAll("-", "_"),
              ...(error.resourceId ? { resourceId: error.resourceId } : {}),
              ...(error.diagnostic ? { diagnostic: diagnosticSchema.parse(error.diagnostic) } : {}),
            });
          return Effect.logWarning(
            "FORGE local planning input storage or metadata unavailable",
          ).pipe(Effect.as({ status: "unavailable" as const, code: "capability_unavailable" }));
        }),
      ),
  );
  return ForgeLocalPlanningInput.of({ resolve });
});
export const layer = Layer.effect(ForgeLocalPlanningInput, make);
