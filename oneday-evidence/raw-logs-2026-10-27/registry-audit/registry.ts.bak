// @effect-diagnostics nodeBuiltinImport:off - loads registry data before dependency installation.
// Approved source registry: typed loader and validator.
// The registry is DATA. Nothing here fetches, clones or executes remote content.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

type Brand<T, B extends string> = T & { readonly __brand: B };
export type SourceId = Brand<string, "SourceId">;
export type CommitSha = Brand<string, "CommitSha">;

export const ADOPTION_STATUSES = ["adopted", "pending", "superseded"] as const;
export type AdoptionStatus = (typeof ADOPTION_STATUSES)[number];

export const PIN_KINDS = ["sha", "local"] as const;
export type PinKind = (typeof PIN_KINDS)[number];

export interface ShaPin {
  readonly kind: "sha";
  readonly sha: CommitSha;
  readonly source: string;
  readonly version?: string;
}

export interface LocalPin {
  readonly kind: "local";
  readonly note: string;
}

export type Pin = ShaPin | LocalPin;

export interface GitCrossCheck {
  readonly reachable?: ReadonlyArray<CommitSha>;
  readonly ancestors?: ReadonlyArray<{ readonly ancestor: CommitSha; readonly of: CommitSha }>;
  readonly commitSubjectsBind?: ReadonlyArray<{
    readonly sha: CommitSha;
    readonly contains: string;
  }>;
  readonly evidenceFiles?: ReadonlyArray<{
    readonly path: string;
    readonly contains: ReadonlyArray<string>;
  }>;
}

export interface SourceRegistryEntry {
  readonly id: SourceId;
  readonly owner: string;
  readonly repo: string;
  readonly forkOf?: string;
  readonly firstParty?: true;
  readonly role: string;
  readonly pin: Pin | null;
  readonly adoptionStatus: AdoptionStatus;
  readonly packsRecords?: number;
  readonly changedBodies?: number;
  readonly missingPaths?: number;
  readonly notes?: string;
  readonly lastReviewed: string;
  readonly reviewRef: string;
  readonly gitCrossCheck?: GitCrossCheck;
}

export interface RegistrySummary {
  readonly sourcesTotal: number;
  readonly admittedRecords: number;
  readonly unchangedBodies: number;
  readonly changedBodies: number;
  readonly missingPaths: number;
  readonly localPilotDifferences: number;
  readonly changedBodiesBySource: Readonly<Record<string, number>>;
  readonly semanticCoverage: {
    readonly currentBodiesReviewed: number;
    readonly currentLines: number;
    readonly fullLiteralUnifiedDiffs: number;
    readonly structuralOldDeletionDiff: ReadonlyArray<string>;
  };
}

export interface SourceRegistry {
  readonly schemaVersion: 1;
  readonly lastReviewed: string;
  readonly reviewRefs: Readonly<Record<string, string>>;
  readonly summary: RegistrySummary;
  readonly sources: ReadonlyArray<SourceRegistryEntry>;
}

export class RegistryValidationError extends Error {
  readonly code: string;
  readonly entryId?: string;
  readonly field?: string;

  constructor(code: string, message: string, entryId?: string, field?: string) {
    super(entryId ? `[${entryId}] ${field ? `${field}: ` : ""}${message}` : message);
    this.name = "RegistryValidationError";
    this.code = code;
    if (entryId !== undefined) this.entryId = entryId;
    if (field !== undefined) this.field = field;
  }
}

export function defaultRegistryPath(): string {
  return NodePath.join(import.meta.dirname, "registry.json");
}

export function defaultCoveragePath(): string {
  return NodePath.join(import.meta.dirname, "coverage-2026-10-27-SEMANTIC-COVERAGE.json");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const OWNER_REPO = /^[^\s/]+\/[^\s/]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(entryId: string, object: Record<string, unknown>, field: string): string {
  const value = object[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new RegistryValidationError(
      "missing-field",
      `${field} must be a non-empty string`,
      entryId,
      field,
    );
  }
  return value;
}

function toShaPin(entryId: string, value: Record<string, unknown>): ShaPin {
  const sha = value.sha;
  if (typeof sha !== "string" || !COMMIT_SHA.test(sha)) {
    throw new RegistryValidationError(
      "malformed-sha",
      `pin.sha must be 40 lowercase hex characters, got ${String(sha)}`,
      entryId,
      "pin.sha",
    );
  }
  const source = requireString(entryId, value, "source");
  const version = value.version;
  if (version !== undefined && typeof version !== "string") {
    throw new RegistryValidationError(
      "bad-version",
      "pin.version must be a string",
      entryId,
      "pin.version",
    );
  }
  return version === undefined
    ? { kind: "sha", sha: sha as CommitSha, source }
    : { kind: "sha", sha: sha as CommitSha, source, version };
}

function toPin(entryId: string, value: unknown, firstParty: boolean): Pin {
  if (!isRecord(value)) {
    throw new RegistryValidationError("bad-pin", "pin must be an object or null", entryId, "pin");
  }
  if (value.kind === "sha") return toShaPin(entryId, value);
  if (value.kind === "local") {
    if (!firstParty) {
      throw new RegistryValidationError(
        "local-pin-not-first-party",
        "a local pin requires firstParty: true (only first-party working copies may omit a sha)",
        entryId,
        "pin.kind",
      );
    }
    return { kind: "local", note: requireString(entryId, value, "note") };
  }
  throw new RegistryValidationError(
    "unknown-pin-kind",
    `unknown pin.kind ${String(value.kind)}`,
    entryId,
    "pin.kind",
  );
}

function toEntry(value: unknown): SourceRegistryEntry {
  if (!isRecord(value)) {
    throw new RegistryValidationError(
      "bad-entry",
      "source entry must be an object",
      undefined,
      "sources[]",
    );
  }
  const idRaw = requireString("", value, "id");
  const id = idRaw as SourceId;
  const firstParty = value.firstParty === true;
  const adoptionStatus = value.adoptionStatus;
  if (
    typeof adoptionStatus !== "string" ||
    !ADOPTION_STATUSES.includes(adoptionStatus as AdoptionStatus)
  ) {
    throw new RegistryValidationError(
      "unknown-adoption-status",
      `adoptionStatus must be one of ${ADOPTION_STATUSES.join("|")}, got ${String(adoptionStatus)}`,
      idRaw,
      "adoptionStatus",
    );
  }
  const pin = value.pin === null ? null : toPin(idRaw, value.pin, firstParty);
  if (adoptionStatus === "adopted" && pin === null) {
    throw new RegistryValidationError(
      "adopted-without-pin",
      "adopted entries must record a pin (sha or local); pin-pending is only valid pre-adoption",
      idRaw,
      "pin",
    );
  }
  const lastReviewed = value.lastReviewed;
  if (typeof lastReviewed !== "string" || !ISO_DATE.test(lastReviewed)) {
    throw new RegistryValidationError(
      "bad-last-reviewed",
      "lastReviewed must be an ISO date (YYYY-MM-DD)",
      idRaw,
      "lastReviewed",
    );
  }
  const owner = requireString(idRaw, value, "owner");
  const repo = requireString(idRaw, value, "repo");
  const role = requireString(idRaw, value, "role");
  const reviewRef = requireString(idRaw, value, "reviewRef");
  const forkOf = value.forkOf;
  if (forkOf !== undefined && (typeof forkOf !== "string" || !OWNER_REPO.test(forkOf))) {
    throw new RegistryValidationError("bad-fork-of", "forkOf must be owner/repo", idRaw, "forkOf");
  }
  const gitCrossCheck = value.gitCrossCheck;
  if (gitCrossCheck !== undefined && !isRecord(gitCrossCheck)) {
    throw new RegistryValidationError(
      "bad-git-cross-check",
      "gitCrossCheck must be an object",
      idRaw,
      "gitCrossCheck",
    );
  }
  return {
    id,
    owner,
    repo,
    ...(forkOf !== undefined ? { forkOf } : {}),
    ...(firstParty ? { firstParty: true as const } : {}),
    role,
    pin,
    adoptionStatus: adoptionStatus as AdoptionStatus,
    ...(typeof value.packsRecords === "number" ? { packsRecords: value.packsRecords } : {}),
    ...(typeof value.changedBodies === "number" ? { changedBodies: value.changedBodies } : {}),
    ...(typeof value.missingPaths === "number" ? { missingPaths: value.missingPaths } : {}),
    ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
    lastReviewed,
    reviewRef,
    ...(gitCrossCheck !== undefined ? { gitCrossCheck: gitCrossCheck as GitCrossCheck } : {}),
  };
}

function toPositiveNumber(entryId: string, object: Record<string, unknown>, field: string): number {
  const value = object[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RegistryValidationError(
      "bad-summary-field",
      `${field} must be a non-negative integer, got ${String(value)}`,
      entryId,
      field,
    );
  }
  return value;
}

function toSummary(value: Record<string, unknown>): RegistrySummary {
  const bySource = value.changedBodiesBySource;
  if (!isRecord(bySource)) {
    throw new RegistryValidationError(
      "bad-summary-field",
      "changedBodiesBySource must be an object",
      undefined,
      "summary.changedBodiesBySource",
    );
  }
  for (const [key, count] of Object.entries(bySource)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new RegistryValidationError(
        "bad-summary-field",
        `changedBodiesBySource.${key} must be a non-negative integer`,
        undefined,
        "summary.changedBodiesBySource",
      );
    }
  }
  const coverage = value.semanticCoverage;
  if (!isRecord(coverage)) {
    throw new RegistryValidationError(
      "bad-summary-field",
      "semanticCoverage must be an object",
      undefined,
      "summary.semanticCoverage",
    );
  }
  const deletionDiff = coverage.structuralOldDeletionDiff;
  if (!Array.isArray(deletionDiff) || deletionDiff.some((item) => typeof item !== "string")) {
    throw new RegistryValidationError(
      "bad-summary-field",
      "semanticCoverage.structuralOldDeletionDiff must be an array of strings",
      undefined,
      "summary.semanticCoverage.structuralOldDeletionDiff",
    );
  }
  return {
    sourcesTotal: toPositiveNumber("", value, "sourcesTotal"),
    admittedRecords: toPositiveNumber("", value, "admittedRecords"),
    unchangedBodies: toPositiveNumber("", value, "unchangedBodies"),
    changedBodies: toPositiveNumber("", value, "changedBodies"),
    missingPaths: toPositiveNumber("", value, "missingPaths"),
    localPilotDifferences: toPositiveNumber("", value, "localPilotDifferences"),
    changedBodiesBySource: bySource as Readonly<Record<string, number>>,
    semanticCoverage: {
      currentBodiesReviewed: toPositiveNumber("", coverage, "currentBodiesReviewed"),
      currentLines: toPositiveNumber("", coverage, "currentLines"),
      fullLiteralUnifiedDiffs: toPositiveNumber("", coverage, "fullLiteralUnifiedDiffs"),
      structuralOldDeletionDiff: deletionDiff as ReadonlyArray<string>,
    },
  };
}

export function validateRegistry(data: unknown): SourceRegistry {
  if (!isRecord(data)) {
    throw new RegistryValidationError("bad-registry", "registry must be a JSON object");
  }
  if (data.schemaVersion !== 1) {
    throw new RegistryValidationError(
      "unknown-schema-version",
      `schemaVersion must be 1, got ${String(data.schemaVersion)}`,
      undefined,
      "schemaVersion",
    );
  }
  if (!Array.isArray(data.sources)) {
    throw new RegistryValidationError(
      "bad-sources",
      "sources must be an array",
      undefined,
      "sources",
    );
  }
  const seen = new Set<string>();
  const sources = data.sources.map((entry) => {
    const validated = toEntry(entry);
    if (seen.has(validated.id)) {
      throw new RegistryValidationError(
        "duplicate-id",
        `duplicate source id ${validated.id}`,
        validated.id,
        "id",
      );
    }
    seen.add(validated.id);
    return validated;
  });
  const reviewRefs = data.reviewRefs;
  if (!isRecord(reviewRefs)) {
    throw new RegistryValidationError(
      "bad-review-refs",
      "reviewRefs must be an object",
      undefined,
      "reviewRefs",
    );
  }
  const summary = data.summary;
  if (!isRecord(summary)) {
    throw new RegistryValidationError(
      "bad-summary",
      "summary must be an object",
      undefined,
      "summary",
    );
  }
  return {
    schemaVersion: 1,
    lastReviewed: requireString("", data, "lastReviewed"),
    reviewRefs: reviewRefs as Readonly<Record<string, string>>,
    summary: toSummary(summary),
    sources,
  };
}

export function loadRegistry(registryPath: string = defaultRegistryPath()): SourceRegistry {
  let raw: string;
  try {
    raw = NodeFS.readFileSync(registryPath, "utf8");
  } catch (error) {
    throw new RegistryValidationError(
      "registry-unreadable",
      `cannot read registry at ${registryPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RegistryValidationError(
      "registry-not-json",
      `registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateRegistry(parsed);
}
