// @effect-diagnostics-next-line nodeBuiltinImport:off -- This quarantined loader verifies exact host file bytes.
import * as NodeFSP from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- No-follow handle support is needed at the read boundary.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Byte identities are not permission claims.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Host canonical-path validation.
import * as NodePath from "node:path";
import { z } from "zod";
import * as Schema from "effect/Schema";
import {
  OrgId,
  PrincipalId,
  ProjectId,
  RunId,
  ThreadId,
  WorkItemId,
  PolicyRevisionRef,
} from "@t3tools/contracts";

const codes = [
  "invalid-input",
  "authority-unavailable",
  "authority-denied",
  "authority-stale",
  "task-changed",
  "snapshot-unavailable",
  "trust-anchor-missing",
  "manifest-mismatch",
  "manifest-invalid",
  "routing-catalogue-incomplete",
  "router-runtime-unavailable",
  "router-mismatch",
  "router-exit",
  "router-timeout",
  "router-output-limit",
  "router-output-invalid",
  "routing-unmatched",
  "required-skill-unknown",
  "body-missing",
  "reference-missing",
  "reference-unreviewed",
  "resource-changed",
  "unsafe-path",
  "resource-alias",
  "invalid-utf8",
  "dependency-invalid",
  "content-limit",
  "context-key-conflict",
  "fixture-input-forbidden",
  "production-admission-unavailable",
  "admission-channel-mismatch",
] as const;
export type ForgeInputUnavailableCode = (typeof codes)[number];
export class ForgeTaskInputUnavailableError extends Error {
  readonly code: ForgeInputUnavailableCode;
  readonly resourceId: string | undefined;
  constructor(code: ForgeInputUnavailableCode, resourceId?: string) {
    super(code);
    this.name = "ForgeTaskInputUnavailableError";
    this.code = code;
    this.resourceId = resourceId;
  }
}
function fail(code: ForgeInputUnavailableCode, resourceId?: string): never {
  throw new ForgeTaskInputUnavailableError(code, resourceId);
}
const scalar = (text: string) => text.isWellFormed();
const text = (max: number) => z.string().min(1).max(max).refine(scalar);
const identifier = text(256).regex(/^[^\u0000-\u001f\u007f]+$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const name = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/);
const row = z.string().regex(/^[a-z0-9][a-z0-9_]{0,127}$/);
const sorted = (values: readonly string[]) =>
  values.every((value, i) => i === 0 || values[i - 1]! < value);
const names = (item: z.ZodString, max = 128) => z.array(item).max(max).refine(sorted);
const safePath = (path: string) =>
  /^[A-Za-z0-9_-][A-Za-z0-9._/-]*[A-Za-z0-9._-]$/.test(path) &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const relativePath = text(1024).refine(safePath);
const absolutePath = text(4096).refine(
  (p) => NodePath.isAbsolute(p) && !/[\u0000-\u001f\u007f]/.test(p) && NodePath.normalize(p) === p,
);
const boundedId = <T>(decode: (value: string) => T) =>
  identifier.transform((value, context) => {
    try {
      return decode(value);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid identity" });
      return z.NEVER;
    }
  });
const decodePolicyRevision = Schema.decodeSync(PolicyRevisionRef, { onExcessProperty: "error" });
const policySchema = z
  .strictObject({ policyId: identifier, revision: z.number().int().safe().min(1), digest })
  .transform((value, context) => {
    try {
      return decodePolicyRevision(value);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid policy identity" });
      return z.NEVER;
    }
  });
const bindingSchema = z.strictObject({
  orgId: boundedId(Schema.decodeSync(OrgId)),
  projectId: boundedId(Schema.decodeSync(ProjectId)),
  principalId: boundedId(Schema.decodeSync(PrincipalId)),
  threadId: boundedId(Schema.decodeSync(ThreadId)),
  runId: boundedId(Schema.decodeSync(RunId)),
  policy: policySchema,
  bindingRevision: digest,
  cwd: absolutePath,
});
const taskSchema = z.strictObject({
  taskId: boundedId(Schema.decodeSync(WorkItemId)),
  taskRevision: z.number().int().safe().min(0),
  prompt: z
    .string()
    .max(131072)
    .refine(scalar)
    .refine((p) => Buffer.byteLength(p) <= 32768),
  taskTypes: names(row),
  flags: z.strictObject({
    build: z.boolean(),
    review: z.boolean(),
    llm: z.boolean(),
    done: z.boolean(),
  }),
  explicitRequired: names(name),
  directRequired: z
    .array(z.strictObject({ name, reason: text(4096), selectionRevision: digest }))
    .max(128)
    .refine((v) => sorted(v.map((x) => x.name))),
});
const taskRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  binding: bindingSchema,
  task: taskSchema,
});
export type ForgeExecutionBinding = z.infer<typeof bindingSchema>;
export type ForgeTaskSelection = z.infer<typeof taskSchema>;

const provenance = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("git"),
    repository: identifier,
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    sourcePath: relativePath,
    blobSha1: z.string().regex(/^[0-9a-f]{40}$/),
    contentSha256: digest,
  }),
  z.strictObject({
    kind: z.literal("local-reviewed"),
    originId: identifier,
    contentSha256: digest,
    reviewRef: identifier,
  }),
]);
const transform = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("identity") }),
  z.strictObject({
    kind: z.literal("preserve-reviewed"),
    id: identifier,
    inputSha256: digest,
    outputSha256: digest,
    reviewRef: identifier,
  }),
]);
const reference = z.discriminatedUnion("disposition", [
  z.strictObject({ literal: text(1024), disposition: z.literal("included"), targetId: identifier }),
  z.strictObject({
    literal: text(1024),
    disposition: z.literal("excluded-for-this-exact-task"),
    reason: text(4096),
  }),
]);
const manifestResourceSchema = z.strictObject({
  id: identifier,
  rootId: identifier,
  kind: z.enum(["body", "reference"]),
  skill: name,
  path: relativePath,
  byteLength: z.number().int().safe().min(1).max(262144),
  sha256: digest,
  provenance,
  licence: z.strictObject({ id: identifier, attribution: text(4096) }),
  transform,
  dependencies: names(identifier),
  references: z.array(reference).max(128),
  reviewRef: identifier,
});
const pinnedFile = <P extends string>(path: P) =>
  z.strictObject({
    path: z.literal(path),
    sha256: digest,
    byteLength: z.number().int().safe().min(1).max(1048576),
  });
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  product: z.literal("INVRT-Code"),
  channel: z.enum(["synthetic-component-test", "local-candidate"]),
  snapshotId: identifier,
  roots: z.strictObject({ router: identifier, content: identifier }),
  router: z.strictObject({
    rootId: identifier,
    files: z.strictObject({
      script: pinnedFile("tools/route_skills.py"),
      routing: pinnedFile("skills/ROUTING.yaml"),
      catalogue: pinnedFile("skills/CATALOG.md"),
      feeders: pinnedFile("skills/FEEDERS.json"),
    }),
    catalogueNames: names(name, 2048),
    runtimeManifestSha256: digest,
  }),
  selection: z.strictObject({
    taskRecordSha256: digest,
    taskTypes: names(row),
    routerRequired: names(name),
    explicitRequired: names(name),
    directRequired: names(name),
    required: names(name),
  }),
  resources: z.array(manifestResourceSchema).min(1).max(128),
  reviewRef: identifier,
});
type Manifest = z.infer<typeof manifestSchema>;

const admissionFields = {
  schemaVersion: z.literal(1),
  productionAdmitted: z.literal(false),
  snapshotId: identifier,
  routerRootId: identifier,
  contentRootId: identifier,
  manifestSha256: digest,
  taskRecordSha256: digest,
  routerSha256: digest,
  bindingRevision: digest,
};
const admissionSchema = z.union([
  z.strictObject({
    ...admissionFields,
    channel: z.literal("synthetic-component-test"),
    authoritySource: z.literal("LABELLED-TEST-FIXTURE"),
    manifestChannel: z.literal("synthetic-component-test"),
  }),
  z.strictObject({
    ...admissionFields,
    channel: z.literal("local-candidate-unadmitted"),
    authoritySource: z.literal("trusted-code-caller"),
    manifestChannel: z.literal("local-candidate"),
  }),
]);
export type ForgeAdmissionIdentity = z.infer<typeof admissionSchema>;
const resourceSchema = z.strictObject({
  id: identifier,
  path: relativePath,
  kind: z.enum(["body", "reference"]),
  sha256: digest,
  byteLength: z.number().int().safe().min(1).max(262144),
  text: text(262144),
  dependsOn: names(identifier),
});
const readySchema = z.strictObject({
  status: z.literal("ready"),
  schemaVersion: z.literal(1),
  admission: admissionSchema,
  taskDigest: digest,
  binding: bindingSchema,
  manifestSha256: digest,
  routerSha256: digest,
  taskTypes: names(row),
  required: names(name),
  resources: z.array(resourceSchema).min(1).max(128),
});
const unavailableSchema = z.strictObject({
  status: z.literal("unavailable"),
  code: z.enum(codes),
  resourceId: identifier.optional(),
});
export type VerifiedForgeTaskInput = z.infer<typeof readySchema>;
export type ForgeTaskInputResult = VerifiedForgeTaskInput | z.infer<typeof unavailableSchema>;
// Provenance for this in-memory component only. No entry grants native or persistent authority.
const fixtureResolutions = new WeakMap<object, string>();

const hash = (bytes: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const equal = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
export function canonicalForgeTaskDigest(input: unknown): string {
  const parsed = taskRecordSchema.safeParse(input);
  if (!parsed.success) fail("invalid-input");
  const { binding: b, task: t } = parsed.data;
  return hash(
    "INVRT-FORGE-TASK-V1\n" +
      JSON.stringify([
        1,
        [
          b.orgId,
          b.projectId,
          b.principalId,
          b.threadId,
          b.runId,
          [b.policy.policyId, b.policy.revision, b.policy.digest],
          b.bindingRevision,
          b.cwd,
        ],
        [
          t.taskId,
          t.taskRevision,
          t.prompt,
          t.taskTypes,
          [t.flags.build, t.flags.review, t.flags.llm, t.flags.done],
          t.explicitRequired,
          t.directRequired.map((d) => [d.name, d.reason, d.selectionRevision]),
        ],
      ]),
  );
}

/** Reject duplicate JSON object keys before JSON.parse can discard the earlier value. */
function parseJson(bytes: Uint8Array, code: ForgeInputUnavailableCode): unknown {
  const value = decodeUtf8(bytes, code);
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(value[offset] ?? "") && offset < value.length) offset++;
  };
  const stringToken = (): string => {
    const start = offset++;
    while (offset < value.length) {
      const char = value[offset++];
      if (char === "\\") {
        offset++;
        continue;
      }
      if (char === '"') return JSON.parse(value.slice(start, offset));
    }
    return fail(code);
  };
  const visit = (depth: number): void => {
    if (depth > 64) fail(code);
    whitespace();
    const char = value[offset];
    if (char === "{") {
      offset++;
      whitespace();
      const keys = new Set<string>();
      if (value[offset] === "}") {
        offset++;
        return;
      }
      while (offset < value.length) {
        whitespace();
        if (value[offset] !== '"') fail(code);
        const key = stringToken();
        if (keys.has(key)) fail(code);
        keys.add(key);
        whitespace();
        if (value[offset++] !== ":") fail(code);
        visit(depth + 1);
        whitespace();
        const delimiter = value[offset++];
        if (delimiter === "}") return;
        if (delimiter !== ",") fail(code);
      }
      fail(code);
    }
    if (char === "[") {
      offset++;
      whitespace();
      if (value[offset] === "]") {
        offset++;
        return;
      }
      while (offset < value.length) {
        visit(depth + 1);
        whitespace();
        const delimiter = value[offset++];
        if (delimiter === "]") return;
        if (delimiter !== ",") fail(code);
      }
      fail(code);
    }
    if (char === '"') {
      stringToken();
      return;
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      value.slice(offset),
    );
    if (!token) fail(code);
    offset += token[0].length;
  };
  try {
    visit(0);
    whitespace();
    if (offset !== value.length) fail(code);
    return JSON.parse(value);
  } catch {
    return fail(code);
  }
}
function decodeUtf8(bytes: Uint8Array, code: ForgeInputUnavailableCode = "invalid-utf8"): string {
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(code);
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail(code);
  }
}

async function checkPath(
  path: string,
  directory: boolean,
  missing: ForgeInputUnavailableCode,
  resourceId?: string,
): Promise<void> {
  const parts = NodePath.resolve(path).split(NodePath.sep).filter(Boolean);
  let current = NodePath.parse(path).root;
  try {
    for (const [index, part] of parts.entries()) {
      current = NodePath.join(current, part);
      const stat = await NodeFSP.lstat(current);
      if (
        stat.isSymbolicLink() ||
        (index < parts.length - 1
          ? !stat.isDirectory()
          : directory
            ? !stat.isDirectory()
            : !stat.isFile())
      )
        fail("unsafe-path", resourceId);
    }
    if ((await NodeFSP.realpath(path)) !== path) fail("unsafe-path", resourceId);
  } catch (error) {
    if (error instanceof ForgeTaskInputUnavailableError) throw error;
    fail(missing, resourceId);
  }
}
async function readVerified(
  root: string,
  path: string,
  limit: number,
  missing: ForgeInputUnavailableCode,
  resourceId?: string,
): Promise<Uint8Array> {
  if (!safePath(path)) fail("unsafe-path", resourceId);
  const full = NodePath.join(root, path);
  if (!full.startsWith(root + NodePath.sep)) fail("unsafe-path", resourceId);
  await checkPath(full, false, missing, resourceId);
  try {
    const handle = await NodeFSP.open(
      full,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile()) fail("unsafe-path", resourceId);
      if (before.size > limit) fail("content-limit", resourceId);
      // Read at most the bound plus one byte, even if the file grows after stat.
      const buffer = Buffer.alloc(limit + 1);
      let length = 0;
      while (length < buffer.length) {
        const next = await handle.read(buffer, length, buffer.length - length, null);
        if (next.bytesRead === 0) break;
        length += next.bytesRead;
      }
      if (length > limit) fail("content-limit", resourceId);
      const after = await handle.stat();
      const linked = await NodeFSP.lstat(full);
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        linked.isSymbolicLink() ||
        linked.dev !== before.dev ||
        linked.ino !== before.ino
      )
        fail("resource-changed", resourceId);
      await checkPath(full, false, missing, resourceId);
      return buffer.subarray(0, length);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof ForgeTaskInputUnavailableError) throw error;
    return fail(missing, resourceId);
  }
}

const authorityResponse = z.union([
  z.strictObject({
    status: z.literal("current"),
    taskRecordSha256: digest,
    approvedManifestSha256: digest,
    bindingRevision: digest,
  }),
  z.strictObject({ status: z.enum(["unavailable", "denied", "stale"]) }),
]);
export interface ForgeInputAuthority {
  readonly source: "trusted-code-caller" | "LABELLED-TEST-FIXTURE";
  readonly revalidate: (
    binding: ForgeExecutionBinding,
    task: ForgeTaskSelection,
  ) => Promise<unknown>;
}
export interface ForgeRouterRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell: false;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: 5000;
  readonly outputLimit: 262144;
}
export interface ForgeFixturePorts {
  readonly source: "LABELLED-TEST-FIXTURE";
  runRouter: (
    request: ForgeRouterRequest,
  ) => Promise<
    | { status: "timeout" | "output-limit" }
    | { status: "exited"; exitCode: number; stdout: Uint8Array; stderr: Uint8Array }
  >;
  afterResourceRead?: (id: string) => Promise<void>;
}
const snapshotSchema = z.strictObject({
  routerRoot: absolutePath,
  contentRoot: absolutePath,
  routerRootId: identifier,
  contentRootId: identifier,
  approvedManifestSha256: digest.optional(),
  pythonExecutable: absolutePath,
  pythonExecutableSha256: digest,
  pythonRuntimeManifestSha256: digest,
});
const inputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  binding: bindingSchema,
  task: taskSchema,
  authority: z.strictObject({
    source: z.enum(["trusted-code-caller", "LABELLED-TEST-FIXTURE"]),
    revalidate: z.custom<ForgeInputAuthority["revalidate"]>((v) => typeof v === "function"),
  }),
  snapshot: snapshotSchema,
  fixturePorts: z
    .strictObject({
      source: z.literal("LABELLED-TEST-FIXTURE"),
      runRouter: z.custom<ForgeFixturePorts["runRouter"]>((v) => typeof v === "function"),
      afterResourceRead: z
        .custom<NonNullable<ForgeFixturePorts["afterResourceRead"]>>((v) => typeof v === "function")
        .optional(),
    })
    .optional(),
});
async function revalidate(
  authority: ForgeInputAuthority,
  binding: ForgeExecutionBinding,
  task: ForgeTaskSelection,
  taskDigest: string,
  manifestDigest: string,
): Promise<void> {
  let response: z.infer<typeof authorityResponse>;
  try {
    response = authorityResponse.parse(await authority.revalidate(binding, task));
  } catch {
    return fail("authority-unavailable");
  }
  if (response.status !== "current")
    return fail(
      response.status === "denied"
        ? "authority-denied"
        : response.status === "stale"
          ? "authority-stale"
          : "authority-unavailable",
    );
  if (response.taskRecordSha256 !== taskDigest) fail("task-changed");
  if (
    response.approvedManifestSha256 !== manifestDigest ||
    response.bindingRevision !== binding.bindingRevision
  )
    fail("authority-stale");
}
function validateClosure(
  manifest: Manifest,
  task: ForgeTaskSelection,
  taskDigest: string,
): z.infer<typeof manifestResourceSchema>[] {
  if (
    manifest.roots.router === manifest.roots.content ||
    manifest.router.rootId !== manifest.roots.router
  )
    fail("manifest-invalid");
  const selection = manifest.selection;
  if (selection.taskRecordSha256 !== taskDigest) fail("task-changed");
  if (
    !equal(selection.explicitRequired, task.explicitRequired) ||
    !equal(
      selection.directRequired,
      task.directRequired.map((d) => d.name),
    )
  )
    fail("manifest-invalid");
  const required = [
    ...new Set([
      ...selection.routerRequired,
      ...task.explicitRequired,
      ...task.directRequired.map((d) => d.name),
    ]),
  ].sort();
  if (!equal(selection.required, required)) fail("manifest-invalid");
  if (required.some((n) => !manifest.router.catalogueNames.includes(n)))
    fail("required-skill-unknown");
  const ids = new Map<string, z.infer<typeof manifestResourceSchema>>();
  const paths = new Set<string>();
  for (const resource of manifest.resources) {
    const pathKey = resource.path.toLowerCase();
    if (ids.has(resource.id) || paths.has(pathKey)) fail("resource-alias");
    ids.set(resource.id, resource);
    paths.add(pathKey);
    if (
      resource.rootId !== manifest.roots.content ||
      !resource.path.startsWith(`skills/${resource.skill}/`) ||
      (resource.kind === "body" && resource.path !== `skills/${resource.skill}/SKILL.md`)
    )
      fail("manifest-invalid");
    if (
      resource.reviewRef.toLowerCase() === "unreviewed" ||
      (resource.provenance.kind === "local-reviewed" &&
        resource.provenance.reviewRef.toLowerCase() === "unreviewed")
    )
      fail("reference-unreviewed", resource.id);
    if (
      resource.transform.kind === "identity"
        ? resource.sha256 !== resource.provenance.contentSha256
        : resource.transform.inputSha256 !== resource.provenance.contentSha256 ||
          resource.transform.outputSha256 !== resource.sha256
    )
      fail("manifest-invalid");
    const included = resource.references
      .filter((r) => r.disposition === "included")
      .map((r) => r.targetId)
      .sort();
    if (
      !sorted(included) ||
      !equal(included, resource.dependencies) ||
      new Set(resource.references.map((r) => r.literal)).size !== resource.references.length
    )
      fail("manifest-invalid");
  }
  const bodies = manifest.resources
    .filter((r) => r.kind === "body")
    .sort((a, b) => (a.skill < b.skill ? -1 : 1));
  if (
    !equal(
      bodies.map((r) => r.skill),
      required,
    )
  )
    fail("body-missing");
  const visited = new Set<string>();
  const active = new Set<string>();
  const ordered: z.infer<typeof manifestResourceSchema>[] = [];
  const visit = (resource: z.infer<typeof manifestResourceSchema>, depth: number): void => {
    if (depth > 16 || active.has(resource.id)) fail("dependency-invalid");
    if (visited.has(resource.id)) return;
    active.add(resource.id);
    visited.add(resource.id);
    ordered.push(resource);
    for (const id of resource.dependencies) {
      const dependency = ids.get(id);
      if (!dependency || dependency.kind !== "reference") fail("dependency-invalid");
      visit(dependency, depth + 1);
    }
    active.delete(resource.id);
  };
  for (const body of bodies) visit(body, 0);
  if (visited.size !== manifest.resources.length) fail("dependency-invalid");
  if (ordered.reduce((sum, r) => sum + r.byteLength, 0) > 1048576) fail("content-limit");
  return ordered;
}

/** No executable runner is installed by HD1. Only explicitly labelled synthetic process fixtures can resolve content. */
export async function resolveForgeTaskInput(input: unknown): Promise<ForgeTaskInputResult> {
  try {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return { status: "unavailable", code: "invalid-input" };
    // Copy task/snapshot values before yielding so caller mutation cannot change an in-flight selection.
    const { binding, task, snapshot, authority, fixturePorts } = parsed.data;
    const taskDigest = canonicalForgeTaskDigest({ schemaVersion: 1, binding, task });
    const manifestDigest = snapshot.approvedManifestSha256;
    if (manifestDigest === undefined) fail("trust-anchor-missing");
    await revalidate(authority, binding, task, taskDigest, manifestDigest);
    if (!fixturePorts || authority.source !== "LABELLED-TEST-FIXTURE")
      return { status: "unavailable", code: "router-runtime-unavailable" };
    await checkPath(snapshot.routerRoot, true, "snapshot-unavailable");
    await checkPath(snapshot.contentRoot, true, "snapshot-unavailable");
    if (snapshot.routerRoot === snapshot.contentRoot) fail("snapshot-unavailable");
    const manifestBytes = await readVerified(
      snapshot.contentRoot,
      "manifest.json",
      262144,
      "snapshot-unavailable",
    );
    if (hash(manifestBytes) !== manifestDigest) fail("manifest-mismatch");
    const manifestParsed = manifestSchema.safeParse(parseJson(manifestBytes, "manifest-invalid"));
    if (!manifestParsed.success) fail("manifest-invalid");
    const manifest = manifestParsed.data;
    if (manifest.channel !== "synthetic-component-test") fail("admission-channel-mismatch");
    if (
      manifest.roots.router !== snapshot.routerRootId ||
      manifest.roots.content !== snapshot.contentRootId
    )
      fail("manifest-invalid");
    if (manifest.router.runtimeManifestSha256 !== snapshot.pythonRuntimeManifestSha256)
      fail("router-runtime-unavailable");
    const ordered = validateClosure(manifest, task, taskDigest);
    const files = new Map<string, string>();
    for (const pinned of Object.values(manifest.router.files)) {
      const bytes = await readVerified(
        snapshot.routerRoot,
        pinned.path,
        1048576,
        "router-mismatch",
      );
      if (bytes.length !== pinned.byteLength || hash(bytes) !== pinned.sha256)
        fail("router-mismatch");
      files.set(pinned.path, decodeUtf8(bytes));
    }
    const catalogue = files
      .get("skills/CATALOG.md")!
      .split("\n")
      .map((line) => line.split("|").map((cell) => cell.trim()))
      .filter((cells) => cells.length === 6 && /^[a-z0-9][a-z0-9-]{0,127}$/.test(cells[1]!))
      .map((cells) => cells[1]!)
      .sort();
    if (!equal(catalogue, manifest.router.catalogueNames)) fail("routing-catalogue-incomplete");
    for (const skill of catalogue)
      await checkPath(
        NodePath.join(snapshot.routerRoot, "skills", skill, "SKILL.md"),
        false,
        "routing-catalogue-incomplete",
      );
    const routing = parseJson(Buffer.from(files.get("skills/ROUTING.yaml")!), "router-mismatch");
    if (
      !routing ||
      typeof routing !== "object" ||
      !("task_types" in routing) ||
      !routing.task_types ||
      typeof routing.task_types !== "object"
    )
      fail("router-mismatch");
    const knownRows = new Set(Object.keys(routing.task_types));
    if (task.taskTypes.some((t) => !knownRows.has(t))) fail("routing-unmatched");
    const args = [
      "-I",
      "-S",
      "-B",
      NodePath.join(snapshot.routerRoot, "tools/route_skills.py"),
      `--prompt=${task.prompt}`,
      `--cwd=${binding.cwd}`,
      ...task.taskTypes.map((t) => `--task-type=${t}`),
      ...Object.entries(task.flags)
        .filter(([, enabled]) => enabled)
        .map(([flag]) => `--${flag}`),
    ];
    const response = await fixturePorts.runRouter({
      executable: snapshot.pythonExecutable,
      args,
      cwd: binding.cwd,
      shell: false,
      env: { LANG: "C.UTF-8" },
      timeoutMs: 5000,
      outputLimit: 262144,
    });
    if (response.status !== "exited")
      fail(response.status === "timeout" ? "router-timeout" : "router-output-limit");
    if (response.stdout.length + response.stderr.length > 262144) fail("router-output-limit");
    if (response.exitCode !== 0) fail("router-exit");
    decodeUtf8(response.stderr, "router-output-invalid");
    const route = z
      .strictObject({ task_types: names(row), required: names(name), recommended: names(name) })
      .safeParse(parseJson(response.stdout, "router-output-invalid"));
    if (!route.success) fail("router-output-invalid");
    if (
      route.data.task_types.some((t) => !knownRows.has(t)) ||
      [...route.data.required, ...route.data.recommended].some((n) => !catalogue.includes(n))
    )
      fail("router-output-invalid");
    if (route.data.task_types.length === 0) fail("routing-unmatched");
    // The pinned router unions explicit and triggered types; triggered rows may extend this set.
    if (task.taskTypes.some((type) => !route.data.task_types.includes(type)))
      fail("router-output-invalid");
    if (
      !equal(route.data.task_types, manifest.selection.taskTypes) ||
      !equal(route.data.required, manifest.selection.routerRequired)
    )
      fail("manifest-invalid");
    const resources: VerifiedForgeTaskInput["resources"] = [];
    for (const resource of ordered) {
      const bytes = await readVerified(
        snapshot.contentRoot,
        resource.path,
        262144,
        resource.kind === "body" ? "body-missing" : "reference-missing",
        resource.id,
      );
      if (bytes.length !== resource.byteLength || hash(bytes) !== resource.sha256)
        fail("resource-changed", resource.id);
      const text = decodeUtf8(bytes);
      resources.push({
        id: resource.id,
        path: resource.path,
        kind: resource.kind,
        sha256: resource.sha256,
        byteLength: resource.byteLength,
        text,
        dependsOn: resource.dependencies,
      });
      await fixturePorts.afterResourceRead?.(resource.id);
    }
    await revalidate(authority, binding, task, taskDigest, manifestDigest);
    const result: VerifiedForgeTaskInput = {
      status: "ready",
      schemaVersion: 1,
      admission: {
        schemaVersion: 1,
        channel: "synthetic-component-test",
        authoritySource: authority.source,
        manifestChannel: manifest.channel,
        productionAdmitted: false,
        snapshotId: manifest.snapshotId,
        routerRootId: manifest.roots.router,
        contentRootId: manifest.roots.content,
        manifestSha256: manifestDigest,
        taskRecordSha256: taskDigest,
        routerSha256: manifest.router.files.script.sha256,
        bindingRevision: binding.bindingRevision,
      },
      taskDigest,
      binding,
      manifestSha256: manifestDigest,
      routerSha256: manifest.router.files.script.sha256,
      taskTypes: route.data.task_types,
      required: manifest.selection.required,
      resources,
    };
    fixtureResolutions.set(result, hash(JSON.stringify(result)));
    return result;
  } catch (error) {
    if (error instanceof ForgeTaskInputUnavailableError)
      return {
        status: "unavailable",
        code: error.code,
        ...(error.resourceId ? { resourceId: error.resourceId } : {}),
      };
    return { status: "unavailable", code: "snapshot-unavailable" };
  }
}

/** Require the unchanged output of an actual current loader resolution for fixture projection. */
export function validateForgeFixtureProjectionInput(input: unknown): VerifiedForgeTaskInput {
  const result = validateForgeTaskInputResult(input);
  if (result.status === "unavailable") return fail(result.code, result.resourceId);
  if (result.admission.channel !== "synthetic-component-test") fail("fixture-input-forbidden");
  if (
    typeof input !== "object" ||
    input === null ||
    fixtureResolutions.get(input) !== hash(JSON.stringify(input))
  )
    fail("invalid-input");
  return result;
}

/** Runtime validation at the actual consumer, before content rendering. No HD1 variant grants native delivery. */
export function validateForgeTaskInputResult(input: unknown): ForgeTaskInputResult {
  const unavailable = unavailableSchema.safeParse(input);
  if (unavailable.success) return unavailable.data;
  const parsed = readySchema.safeParse(input);
  if (!parsed.success) return fail("invalid-input");
  const result = parsed.data;
  const a = result.admission;
  if (
    a.manifestSha256 !== result.manifestSha256 ||
    a.taskRecordSha256 !== result.taskDigest ||
    a.routerSha256 !== result.routerSha256 ||
    a.bindingRevision !== result.binding.bindingRevision ||
    a.routerRootId === a.contentRootId
  )
    fail("admission-channel-mismatch");
  const ids = new Set<string>();
  const paths = new Set<string>();
  let total = 0;
  for (const resource of result.resources) {
    if (ids.has(resource.id) || paths.has(resource.path.toLowerCase())) fail("resource-alias");
    ids.add(resource.id);
    paths.add(resource.path.toLowerCase());
    const bytes = Buffer.from(resource.text);
    total += bytes.length;
    if (bytes.length !== resource.byteLength || hash(bytes) !== resource.sha256)
      fail("resource-changed", resource.id);
  }
  if (total > 1048576) fail("content-limit");
  if (
    !equal(
      result.resources.filter((r) => r.kind === "body").map((r) => r.path.split("/")[1]!),
      result.required,
    )
  )
    fail("invalid-input");
  for (const resource of result.resources)
    if (resource.dependsOn.some((id) => !ids.has(id))) fail("dependency-invalid");
  return result;
}
