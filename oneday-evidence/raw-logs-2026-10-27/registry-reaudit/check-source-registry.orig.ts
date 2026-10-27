// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - offline registry check runs before dependency installation.
// Offline internal-consistency check for the approved source registry.
// Verifies: every entry validates, summary counts are internally consistent and match the
// committed semantic-coverage evidence copy, and documented pins that are cross-checkable in this
// checkout verify against git-reachable facts (`git` local reads only, zero network).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  defaultCoveragePath,
  defaultRegistryPath,
  loadRegistry,
  type GitCrossCheck,
  type SourceRegistry,
  type SourceRegistryEntry,
} from "./registry.ts";

export interface CheckFinding {
  readonly code: string;
  readonly message: string;
  readonly entryId?: string;
}

export interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
}

export type GitRunner = (args: ReadonlyArray<string>) => GitResult;

export interface CheckOptions {
  readonly registryPath?: string;
  readonly coveragePath?: string;
  readonly runGit?: GitRunner;
  readonly repoRoot?: string;
}

export interface CheckReport {
  readonly findings: ReadonlyArray<CheckFinding>;
  readonly entriesChecked: number;
  readonly gitCrossChecksRun: number;
}

export function runGitLocal(args: ReadonlyArray<string>, repoRoot?: string): GitResult {
  const result = NodeChildProcess.spawnSync("git", args, {
    cwd: repoRoot ?? NodePath.resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}

function sum(values: Iterable<number | undefined>): number {
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
}

export function checkSummaryConsistency(registry: SourceRegistry): ReadonlyArray<CheckFinding> {
  const findings: Array<CheckFinding> = [];
  const { summary } = registry;
  if (summary.sourcesTotal !== registry.sources.length) {
    findings.push({
      code: "summary-sources-total-mismatch",
      message: `summary.sourcesTotal=${summary.sourcesTotal} but sources.length=${registry.sources.length}`,
    });
  }
  const changedBySource = Object.values(summary.changedBodiesBySource ?? {}).reduce(
    (a, b) => a + b,
    0,
  );
  if (changedBySource !== summary.changedBodies) {
    findings.push({
      code: "summary-changed-bodies-mismatch",
      message: `changedBodiesBySource sums to ${changedBySource} but summary.changedBodies=${summary.changedBodies}`,
    });
  }
  const changedOnEntries = sum(registry.sources.map((entry) => entry.changedBodies));
  if (changedOnEntries !== summary.changedBodies) {
    findings.push({
      code: "summary-changed-bodies-total-mismatch",
      message: `per-entry changedBodies sum to ${changedOnEntries} but summary.changedBodies=${summary.changedBodies}`,
    });
  }
  const missingOnEntries = sum(registry.sources.map((entry) => entry.missingPaths));
  if (missingOnEntries !== summary.missingPaths) {
    findings.push({
      code: "summary-missing-paths-mismatch",
      message: `per-entry missingPaths sum to ${missingOnEntries} but summary.missingPaths=${summary.missingPaths}`,
    });
  }
  const packs = sum(registry.sources.map((entry) => entry.packsRecords));
  if (packs !== summary.admittedRecords) {
    findings.push({
      code: "summary-admitted-records-mismatch",
      message: `per-entry packsRecords sum to ${packs} but summary.admittedRecords=${summary.admittedRecords}`,
    });
  }
  return findings;
}

export function checkCoverage(
  registry: SourceRegistry,
  coverage: unknown,
): ReadonlyArray<CheckFinding> {
  if (!isRecord(coverage)) {
    return [{ code: "coverage-unavailable", message: "coverage evidence is not a JSON object" }];
  }
  const findings: Array<CheckFinding> = [];
  const expected = registry.summary.semanticCoverage;
  const pairs: Array<[string, unknown, unknown]> = [
    ["current_bodies_reviewed", coverage.current_bodies_reviewed, expected.currentBodiesReviewed],
    ["current_lines", coverage.current_lines, expected.currentLines],
    [
      "full_literal_unified_diffs",
      coverage.full_literal_unified_diffs,
      expected.fullLiteralUnifiedDiffs,
    ],
    [
      "structural_old_deletion_diff",
      coverage.structural_old_deletion_diff,
      expected.structuralOldDeletionDiff,
    ],
  ];
  for (const [field, actual, wanted] of pairs) {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      findings.push({
        code: "coverage-mismatch",
        message: `coverage.${field}=${JSON.stringify(actual)} but registry summary expects ${JSON.stringify(wanted)}`,
      });
    }
  }
  const rows = coverage.rows;
  if (Array.isArray(rows) && rows.length !== coverage.current_bodies_reviewed) {
    findings.push({
      code: "coverage-rows-mismatch",
      message: `coverage rows.length=${rows.length} but current_bodies_reviewed=${String(coverage.current_bodies_reviewed)}`,
    });
  }
  return findings;
}

function gitContains(runGit: GitRunner, args: ReadonlyArray<string>, needle: string): boolean {
  const result = runGit(args);
  return result.ok && result.stdout.includes(needle);
}

// Same 40-hex rule as registry.ts's COMMIT_SHA (kept local: that module is registry DATA code).
// Git argv receives these strings raw, so a value starting with "-" would be parsed as a git
// option (e.g. `--output=<path>` is a file-write primitive); each sha is validated before any
// git call and malformed values never reach argv.
const CROSS_CHECK_SHA = /^[0-9a-f]{40}$/;

function malformedShaFinding(entryId: string, field: string, sha: string): CheckFinding {
  return {
    code: "malformed-cross-check-sha",
    entryId,
    message: `gitCrossCheck.${field} must be 40 lowercase hex characters, got ${sha}`,
  };
}

export function checkGitCrossCheck(
  entry: SourceRegistryEntry,
  crossCheck: GitCrossCheck,
  runGit: GitRunner,
): ReadonlyArray<CheckFinding> {
  const findings: Array<CheckFinding> = [];
  for (const [index, sha] of (crossCheck.reachable ?? []).entries()) {
    if (!CROSS_CHECK_SHA.test(sha)) {
      findings.push(malformedShaFinding(entry.id, `reachable[${index}]`, sha));
      continue;
    }
    if (!runGit(["cat-file", "-e", `${sha}^{commit}`]).ok) {
      findings.push({
        code: "git-unreachable",
        entryId: entry.id,
        message: `recorded pin ${sha} is not git-reachable in this checkout`,
      });
    }
  }
  for (const [index, { ancestor, of }] of (crossCheck.ancestors ?? []).entries()) {
    const ancestorValid = CROSS_CHECK_SHA.test(ancestor);
    const ofValid = CROSS_CHECK_SHA.test(of);
    if (!ancestorValid) {
      findings.push(malformedShaFinding(entry.id, `ancestors[${index}].ancestor`, ancestor));
    }
    if (!ofValid) {
      findings.push(malformedShaFinding(entry.id, `ancestors[${index}].of`, of));
    }
    if (!ancestorValid || !ofValid) continue;
    if (!runGit(["merge-base", "--is-ancestor", ancestor, of]).ok) {
      findings.push({
        code: "git-ancestor-mismatch",
        entryId: entry.id,
        message: `recorded pin ${ancestor} is not an ancestor of ${of}`,
      });
    }
  }
  for (const [index, { sha, contains }] of (crossCheck.commitSubjectsBind ?? []).entries()) {
    if (!CROSS_CHECK_SHA.test(sha)) {
      findings.push(malformedShaFinding(entry.id, `commitSubjectsBind[${index}].sha`, sha));
      continue;
    }
    if (!gitContains(runGit, ["log", "-1", "--format=%B", sha], contains)) {
      const subject = runGit(["log", "-1", "--format=%s", sha]).stdout.trim();
      findings.push({
        code: "git-subject-mismatch",
        entryId: entry.id,
        message: `commit ${sha} subject does not bind ${contains} (subject: ${subject || "unavailable"})`,
      });
    }
  }
  for (const evidence of crossCheck.evidenceFiles ?? []) {
    const file = NodePath.resolve(import.meta.dirname, "../..", evidence.path);
    let contents: string | undefined;
    try {
      contents = NodeFS.readFileSync(file, "utf8");
    } catch {
      findings.push({
        code: "evidence-file-missing",
        entryId: entry.id,
        message: `adoption evidence file ${evidence.path} is not readable`,
      });
      continue;
    }
    for (const needle of evidence.contains) {
      if (!contents.includes(needle)) {
        findings.push({
          code: "evidence-binding-missing",
          entryId: entry.id,
          message: `adoption evidence ${evidence.path} does not bind ${needle}`,
        });
      }
    }
  }
  return findings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkRegistryOffline(options: CheckOptions = {}): CheckReport {
  const runGit = options.runGit ?? runGitLocal;
  let registry: SourceRegistry;
  try {
    registry = loadRegistry(options.registryPath ?? defaultRegistryPath());
  } catch (error) {
    return {
      findings: [
        {
          code: "registry-invalid",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      entriesChecked: 0,
      gitCrossChecksRun: 0,
    };
  }
  const findings: Array<CheckFinding> = [...checkSummaryConsistency(registry)];

  let coverageRaw: string | undefined;
  try {
    coverageRaw = NodeFS.readFileSync(options.coveragePath ?? defaultCoveragePath(), "utf8");
  } catch (error) {
    findings.push({
      code: "coverage-unavailable",
      message: `coverage evidence unreadable: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (coverageRaw !== undefined) {
    try {
      findings.push(...checkCoverage(registry, JSON.parse(coverageRaw) as unknown));
    } catch (error) {
      findings.push({
        code: "coverage-unavailable",
        message: `coverage evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  let gitCrossChecksRun = 0;
  for (const entry of registry.sources) {
    if (!entry.gitCrossCheck) continue;
    gitCrossChecksRun += 1;
    findings.push(...checkGitCrossCheck(entry, entry.gitCrossCheck, runGit));
  }
  return { findings, entriesChecked: registry.sources.length, gitCrossChecksRun };
}

export function main(argv: ReadonlyArray<string> = process.argv.slice(2)): number {
  let registryPath: string | undefined;
  let coveragePath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--registry") registryPath = argv[index + 1];
    if (argument === "--coverage") coveragePath = argv[index + 1];
  }
  const report = checkRegistryOffline({
    ...(registryPath ? { registryPath } : {}),
    ...(coveragePath ? { coveragePath } : {}),
  });
  if (report.findings.length > 0) {
    for (const finding of report.findings) {
      const scope = finding.entryId ? `[${finding.entryId}] ` : "";
      console.error(`FAIL ${finding.code} ${scope}${finding.message}`);
    }
    console.error(`source-registry check FAILED: ${report.findings.length} finding(s)`);
    return 1;
  }
  console.log(
    `source-registry OK: entries=${report.entriesChecked} gitCrossChecks=${report.gitCrossChecksRun} findings=0`,
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = main();
}
