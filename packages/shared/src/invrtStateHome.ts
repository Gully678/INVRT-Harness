// @effect-diagnostics nodeBuiltinImport:off - service launcher and desktop startup cannot take an Effect dependency.

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { DatabaseSync } from "node:sqlite";

/** INVRT application state directory. Upstream T3 keeps using `.t3`. */
export const INVRT_STATE_DIRECTORY_NAME = ".invrt-code";
export const INVRT_CODE_HOME_ENV = "INVRT_CODE_HOME";

const PROJECT_TABLE = "projection_projects";
const THREAD_TABLE = "projection_threads";

type JoinPath = (first: string, ...segments: string[]) => string;

const trimmed = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  return next.length > 0 ? next : undefined;
};

/**
 * Ordinary INVRT startup state directory.
 * Explicit path, then INVRT_CODE_HOME, then a worktree-local directory, then <home>/.invrt-code.
 * T3CODE_HOME is upstream T3 configuration and is never read.
 */
export function resolveInvrtStateDirectory(input: {
  readonly homeDirectory: string;
  readonly explicitDirectory?: string | null;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly worktreeDirectory?: string | null;
  readonly joinPath?: JoinPath;
  readonly resolvePath?: (value: string) => string;
}): string {
  const joinPath = input.joinPath ?? NodePath.join;
  const resolvePath = input.resolvePath ?? NodePath.resolve;
  const explicit = trimmed(input.explicitDirectory);
  if (explicit !== undefined) return resolvePath(explicit);
  const fromEnv = trimmed(input.environment?.[INVRT_CODE_HOME_ENV]);
  if (fromEnv !== undefined) return resolvePath(fromEnv);
  const worktree = trimmed(input.worktreeDirectory);
  if (worktree !== undefined) return joinPath(worktree, INVRT_STATE_DIRECTORY_NAME);
  return joinPath(input.homeDirectory, INVRT_STATE_DIRECTORY_NAME);
}

interface StateEntry {
  readonly relativePath: string;
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number;
  readonly sha256: string;
  readonly linkTarget?: string;
}

export interface LegacyStatePreview {
  readonly sourcePath: string;
  readonly projectCount: number | null;
  readonly threadCount: number | null;
  readonly fileNames: readonly string[];
  readonly message: string;
}

export interface LegacyStateImportResult {
  readonly verified: boolean;
  readonly idempotent: boolean;
  readonly copiedFileCount: number;
  readonly message: string;
}

export class LegacyStateImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyStateImportError";
  }
}

const hashBuffer = (contents: Buffer | string) =>
  NodeCrypto.createHash("sha256").update(contents).digest("hex");

const hashFile = (filePath: string) => {
  const hash = NodeCrypto.createHash("sha256");
  const handle = NodeFS.openSync(filePath, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  let size = 0;
  try {
    for (;;) {
      const read = NodeFS.readSync(handle, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      size += read;
    }
  } finally {
    NodeFS.closeSync(handle);
  }
  return { size, sha256: hash.digest("hex") };
};

const toRelative = (root: string, absolute: string) =>
  NodePath.relative(root, absolute).split(NodePath.sep).join("/");

const walkState = (root: string): StateEntry[] => {
  const entries: StateEntry[] = [];
  const visit = (directory: string) => {
    for (const dirent of NodeFS.readdirSync(directory, { withFileTypes: true })) {
      const absolute = NodePath.join(directory, dirent.name);
      const relativePath = toRelative(root, absolute);
      if (dirent.isSymbolicLink()) {
        const linkTarget = NodeFS.readlinkSync(absolute);
        entries.push({
          relativePath,
          kind: "symlink",
          size: Buffer.byteLength(linkTarget),
          sha256: hashBuffer(linkTarget),
          linkTarget,
        });
        continue;
      }
      if (dirent.isDirectory()) {
        entries.push({ relativePath, kind: "directory", size: 0, sha256: "" });
        visit(absolute);
        continue;
      }
      if (dirent.isFile()) {
        const hashed = hashFile(absolute);
        entries.push({ relativePath, kind: "file", size: hashed.size, sha256: hashed.sha256 });
      }
    }
  };
  visit(root);
  return entries;
};

const filesOf = (entries: readonly StateEntry[]) => entries.filter((entry) => entry.kind !== "directory");

const fingerprint = (entries: readonly StateEntry[]) =>
  filesOf(entries)
    .map((entry) => `${entry.relativePath}\0${entry.size}\0${entry.sha256}`)
    .sort()
    .join("\n");

const countTable = (database: DatabaseSync, table: typeof PROJECT_TABLE | typeof THREAD_TABLE) => {
  const found = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  if (found === undefined) return null;
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return Number(row.count);
};

const countDatabaseCopy = (databasePath: string) => {
  const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "invrt-import-preview-"));
  try {
    const copyPath = NodePath.join(temp, "state.sqlite");
    NodeFS.copyFileSync(databasePath, copyPath);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${databasePath}${suffix}`;
      if (NodeFS.existsSync(sidecar)) NodeFS.copyFileSync(sidecar, `${copyPath}${suffix}`);
    }
    const database = new DatabaseSync(copyPath, { readOnly: true });
    try {
      return {
        projectCount: countTable(database, PROJECT_TABLE),
        threadCount: countTable(database, THREAD_TABLE),
      };
    } finally {
      database.close();
    }
  } catch {
    return { projectCount: null, threadCount: null };
  } finally {
    NodeFS.rmSync(temp, { recursive: true, force: true });
  }
};

const databaseFile = (fileNames: readonly string[]) =>
  fileNames.find((name) => name === "userdata/statev2.sqlite" || name.endsWith("/statev2.sqlite")) ??
  fileNames.find(
    (name) => name.endsWith("state.sqlite") && !name.endsWith("statev2.sqlite"),
  );

export function previewLegacyState(sourcePath: string): LegacyStatePreview {
  const source = NodePath.resolve(sourcePath);
  if (!NodeFS.existsSync(source) || !NodeFS.statSync(source).isDirectory()) {
    throw new LegacyStateImportError("Legacy import source must be a directory.");
  }
  const fileNames = filesOf(walkState(source))
    .map((entry) => entry.relativePath)
    .sort();
  const database = databaseFile(fileNames);
  const counts =
    database === undefined
      ? { projectCount: null, threadCount: null }
      : countDatabaseCopy(NodePath.join(source, ...database.split("/")));
  const message =
    counts.projectCount === null || counts.threadCount === null
      ? `Files: ${fileNames.join(", ")}.`
      : `${counts.projectCount} projects, ${counts.threadCount} threads. Files: ${fileNames.join(", ")}.`;
  return {
    sourcePath: source,
    projectCount: counts.projectCount,
    threadCount: counts.threadCount,
    fileNames,
    message,
  };
}

const isInside = (parent: string, child: string) => {
  const relative = NodePath.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) && relative !== ".." && !NodePath.isAbsolute(relative))
  );
};

const restoreBackup = (destination: string, backup: string | null) => {
  NodeFS.rmSync(destination, { recursive: true, force: true });
  if (backup !== null && NodeFS.existsSync(backup)) {
    NodeFS.renameSync(backup, destination);
  }
};

const verifyCopy = (sourceRoot: string, destinationRoot: string, entries: readonly StateEntry[]) => {
  for (const entry of filesOf(entries)) {
    const destination = NodePath.join(destinationRoot, ...entry.relativePath.split("/"));
    if (entry.kind === "symlink") {
      const target = NodeFS.readlinkSync(destination);
      if (target !== entry.linkTarget || Buffer.byteLength(target) !== entry.size) {
        throw new LegacyStateImportError(`Verification failed for ${entry.relativePath}.`);
      }
      continue;
    }
    const hashed = hashFile(destination);
    if (hashed.size !== entry.size || hashed.sha256 !== entry.sha256) {
      throw new LegacyStateImportError(`Verification failed for ${entry.relativePath}.`);
    }
  }
  if (fingerprint(walkState(sourceRoot)) !== fingerprint(entries)) {
    throw new LegacyStateImportError("Source changed during import.");
  }
};

export function importLegacyState(input: {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly replace?: boolean;
  readonly afterCopiedFile?: (event: {
    readonly copiedCount: number;
    readonly relativePath: string;
  }) => void;
}): LegacyStateImportResult {
  const source = NodePath.resolve(input.sourcePath);
  const destination = NodePath.resolve(input.destinationPath);
  if (!NodeFS.existsSync(source) || !NodeFS.statSync(source).isDirectory()) {
    throw new LegacyStateImportError("Legacy import source must be a directory.");
  }
  if (isInside(source, destination) || isInside(destination, source)) {
    throw new LegacyStateImportError("Legacy import source and destination must be separate directories.");
  }
  const sourceEntries = walkState(source);
  const sourceFingerprint = fingerprint(sourceEntries);
  const destinationExists = NodeFS.existsSync(destination);
  if (destinationExists && !NodeFS.statSync(destination).isDirectory()) {
    throw new LegacyStateImportError("Legacy import destination must be a directory.");
  }
  if (destinationExists) {
    const destinationEntries = walkState(destination);
    const destinationFiles = filesOf(destinationEntries);
    if (destinationFiles.length > 0 && fingerprint(destinationEntries) === sourceFingerprint) {
      return {
        verified: true,
        idempotent: true,
        copiedFileCount: 0,
        message: "Destination already matches the source.",
      };
    }
    if (destinationFiles.length > 0 && input.replace !== true) {
      throw new LegacyStateImportError(
        "Destination already has different state. Pass replace to overwrite.",
      );
    }
  }

  const backup = destinationExists
    ? NodePath.join(
        NodePath.dirname(destination),
        `.invrt-import-backup-${NodeCrypto.randomBytes(8).toString("hex")}`,
      )
    : null;
  if (backup !== null) {
    NodeFS.cpSync(destination, backup, { recursive: true, dereference: false });
  }

  try {
    NodeFS.rmSync(destination, { recursive: true, force: true });
    NodeFS.mkdirSync(destination, { recursive: true });
    let copiedCount = 0;
    const ordered = [...sourceEntries].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );
    for (const entry of ordered) {
      const target = NodePath.join(destination, ...entry.relativePath.split("/"));
      if (entry.kind === "directory") {
        NodeFS.mkdirSync(target, { recursive: true });
        continue;
      }
      NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
      if (entry.kind === "symlink") {
        NodeFS.symlinkSync(entry.linkTarget ?? "", target);
      } else {
        NodeFS.copyFileSync(NodePath.join(source, ...entry.relativePath.split("/")), target);
      }
      copiedCount += 1;
      input.afterCopiedFile?.({ copiedCount, relativePath: entry.relativePath });
    }
    verifyCopy(source, destination, sourceEntries);
    if (backup !== null) NodeFS.rmSync(backup, { recursive: true, force: true });
    return {
      verified: true,
      idempotent: false,
      copiedFileCount: copiedCount,
      message: `Copied ${copiedCount} files.`,
    };
  } catch (cause) {
    restoreBackup(destination, backup);
    if (cause instanceof LegacyStateImportError) throw cause;
    throw cause;
  }
}
