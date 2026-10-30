// @effect-diagnostics-next-line nodeBuiltinImport:off -- This quarantined loader verifies exact host file bytes.
import * as NodeFSP from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- No-follow handle support is needed at the read boundary.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Byte identities are not permission claims.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Host canonical-path validation.
import * as NodePath from "node:path";
import { z } from "zod";

export const forgeInputUnavailableCodes = [
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
export type ForgeInputUnavailableCode = (typeof forgeInputUnavailableCodes)[number];
export const diagnosticSchema = z.discriminatedUnion("phase", [
  z.strictObject({ phase: z.literal("filesystem"), cause: z.literal("io-error") }),
  z.strictObject({ phase: z.literal("router"), cause: z.literal("process-error") }),
  z.strictObject({ phase: z.literal("internal"), cause: z.literal("unexpected-error") }),
]);
type ForgeDiagnostic = z.infer<typeof diagnosticSchema>;
export class ForgeTaskInputUnavailableError extends Error {
  readonly code: ForgeInputUnavailableCode;
  readonly resourceId: string | undefined;
  readonly diagnostic: ForgeDiagnostic | undefined;
  constructor(code: ForgeInputUnavailableCode, resourceId?: string, diagnostic?: ForgeDiagnostic) {
    super(
      code,
      diagnostic ? { cause: new Error(`${diagnostic.phase}: ${diagnostic.cause}`) } : undefined,
    );
    this.name = "ForgeTaskInputUnavailableError";
    this.code = code;
    this.resourceId = resourceId;
    this.diagnostic = diagnostic;
  }
}
export function fail(
  code: ForgeInputUnavailableCode,
  resourceId?: string,
  diagnostic?: ForgeDiagnostic,
): never {
  throw new ForgeTaskInputUnavailableError(code, resourceId, diagnostic);
}
export const safePath = (path: string) =>
  /^[A-Za-z0-9_-][A-Za-z0-9._/-]*[A-Za-z0-9._-]$/.test(path) &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
export const hash = (bytes: string | Uint8Array) =>
  NodeCrypto.createHash("sha256").update(bytes).digest("hex");
/** Reject duplicate JSON object keys before JSON.parse can discard the earlier value. */
export function parseJson(bytes: Uint8Array, code: ForgeInputUnavailableCode): unknown {
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
export function decodeUtf8(
  bytes: Uint8Array,
  code: ForgeInputUnavailableCode = "invalid-utf8",
): string {
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(code);
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail(code);
  }
}

export async function checkPath(
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      fail(missing, resourceId);
    fail(missing, resourceId, { phase: "filesystem", cause: "io-error" });
  }
}
export async function readVerified(
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      fail(missing, resourceId);
    return fail(missing, resourceId, { phase: "filesystem", cause: "io-error" });
  }
}

export function orderResourceClosure<
  T extends {
    readonly id: string;
    readonly kind: "body" | "reference";
    readonly dependencies: readonly string[];
    readonly byteLength: number;
  },
>(resources: readonly T[], bodies: readonly T[]): T[] {
  const ids = new Map(resources.map((resource) => [resource.id, resource]));
  const visited = new Set<string>();
  const active = new Set<string>();
  const ordered: T[] = [];
  const visit = (resource: T, depth: number): void => {
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
  if (visited.size !== resources.length) fail("dependency-invalid");
  if (ordered.reduce((sum, r) => sum + r.byteLength, 0) > 1048576) fail("content-limit");
  return ordered;
}

export async function requireAbsent(path: string): Promise<void> {
  await checkPath(NodePath.dirname(path), true, "router-runtime-unavailable");
  try {
    await NodeFSP.lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw new ForgeTaskInputUnavailableError("router-runtime-unavailable");
  }
  throw new ForgeTaskInputUnavailableError("router-runtime-unavailable");
}
