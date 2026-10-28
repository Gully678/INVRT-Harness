// @effect-diagnostics nodeBuiltinImport:off - spawns the check script and real git in subprocesses.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it, onTestFinished } from "vite-plus/test";

import {
  checkRegistryOffline,
  type CheckFinding,
  type GitRunner,
} from "./check-source-registry.ts";
import { defaultCoveragePath, loadRegistry, type SourceRegistry } from "./registry.ts";

const SCRIPT = NodePath.join(import.meta.dirname, "check-source-registry.ts");

async function tempCopy(name: string, data: string): Promise<string> {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "source-sync-check-"));
  onTestFinished(() => NodeFSP.rm(dir, { recursive: true, force: true }));
  const file = NodePath.join(dir, name);
  await NodeFSP.writeFile(file, data);
  return file;
}

function findingsWithCode(findings: ReadonlyArray<CheckFinding>, code: string): boolean {
  return findings.some((finding) => finding.code === code);
}

describe("checkRegistryOffline on the real registry", () => {
  it("returns zero findings", () => {
    const report = checkRegistryOffline();
    expect(report.entriesChecked).toBe(41);
    expect(report.gitCrossChecksRun).toBeGreaterThan(0);
    expect(report.findings).toEqual([]);
  });
});

describe("checkRegistryOffline on a deliberately corrupted copy", () => {
  it("names the mismatch when the registry is corrupted", async () => {
    const registry = loadRegistry();
    const corrupted: SourceRegistry = JSON.parse(JSON.stringify(registry));
    const harness = corrupted.sources.find((entry) => entry.id === "Gully678/INVRT-Harness");
    const rea = corrupted.sources.find((entry) => entry.id === "Gully678/rea");
    if (!harness || !rea) throw new Error("expected registry fixtures");
    const mutated = JSON.parse(JSON.stringify(corrupted)) as {
      summary: { changedBodies: number };
      sources: Array<{
        id: string;
        gitCrossCheck?: { ancestors?: Array<{ ancestor: string; of: string }> };
      }>;
    };
    mutated.summary.changedBodies = 79;
    const entry = mutated.sources.find((e) => e.id === "Gully678/INVRT-Harness");
    if (!entry?.gitCrossCheck?.ancestors?.[0]) throw new Error("expected harness ancestor binding");
    // Reachable commit that is NOT an ancestor of the adopted upstream sync point.
    const reaPin = rea.pin;
    if (!reaPin || reaPin.kind !== "sha") throw new Error("expected rea sha pin");
    entry.gitCrossCheck.ancestors[0].ancestor = reaPin.sha;
    const file = await tempCopy("registry.json", JSON.stringify(mutated, null, 2));
    const report = checkRegistryOffline({ registryPath: file });
    expect(report.findings.length).toBeGreaterThan(0);
    expect(findingsWithCode(report.findings, "summary-changed-bodies-mismatch")).toBe(true);
    expect(findingsWithCode(report.findings, "git-ancestor-mismatch")).toBe(true);
    const named = report.findings.some((finding) => finding.entryId === "Gully678/INVRT-Harness");
    expect(named).toBe(true);
  });
});

describe("checkRegistryOffline against a corrupted coverage copy", () => {
  it("names the coverage mismatch", async () => {
    const coveragePath = NodePath.join(
      import.meta.dirname,
      "coverage-2026-10-27-SEMANTIC-COVERAGE.json",
    );
    const coverage = JSON.parse(await NodeFSP.readFile(coveragePath, "utf8")) as {
      current_bodies_reviewed: number;
    };
    coverage.current_bodies_reviewed = 77;
    const file = await tempCopy("coverage.json", JSON.stringify(coverage, null, 2));
    const report = checkRegistryOffline({ coveragePath: file });
    expect(findingsWithCode(report.findings, "coverage-mismatch")).toBe(true);
  });
});

describe("git cross-checks", () => {
  const failRunner: GitRunner = () => ({ ok: false, stdout: "" });

  it("reports unreachable pins as named findings", () => {
    const report = checkRegistryOffline({ runGit: failRunner });
    // The bad runner applies to every entry, so the committed registry cannot stay green here.
    expect(report.findings.length).toBeGreaterThan(0);
    expect(findingsWithCode(report.findings, "git-unreachable")).toBe(true);
  });

  it("rejects a non-40-hex cross-check sha without invoking git", async () => {
    const registry = loadRegistry();
    const mutated = JSON.parse(JSON.stringify(registry)) as {
      sources: Array<{ id: string; gitCrossCheck?: { reachable?: string[] } }>;
    };
    const rea = mutated.sources.find((e) => e.id === "Gully678/rea");
    if (!rea?.gitCrossCheck?.reachable) throw new Error("expected rea cross-check");
    // A leading "-" would be parsed as a git option once passed into argv.
    rea.gitCrossCheck.reachable[0] = "-output=/tmp/evil";
    const file = await tempCopy("registry.json", JSON.stringify(mutated, null, 2));
    const calls: Array<ReadonlyArray<string>> = [];
    const spy: GitRunner = (args) => {
      calls.push(args);
      return { ok: false, stdout: "" };
    };
    const report = checkRegistryOffline({ registryPath: file, runGit: spy });
    expect(findingsWithCode(report.findings, "malformed-cross-check-sha")).toBe(true);
    const namedRea = report.findings.some(
      (finding) =>
        finding.entryId === "Gully678/rea" && finding.code === "malformed-cross-check-sha",
    );
    expect(namedRea).toBe(true);
    expect(
      calls.some((args) => args.some((argument) => argument.includes("-output=/tmp/evil"))),
    ).toBe(false);
  });

  it("reports a missing evidence file binding", async () => {
    const registry = loadRegistry();
    const mutated = JSON.parse(JSON.stringify(registry)) as SourceRegistry;
    const entry = mutated.sources.find((e) => e.id === "Gully678/INVRT-Harness");
    if (!entry?.gitCrossCheck?.evidenceFiles) throw new Error("expected evidence files");
    (entry.gitCrossCheck.evidenceFiles[0] as { path: string }).path =
      "oneday-evidence/DOES-NOT-EXIST.json";
    const file = await tempCopy("registry.json", JSON.stringify(mutated, null, 2));
    const report = checkRegistryOffline({ registryPath: file });
    expect(findingsWithCode(report.findings, "evidence-file-missing")).toBe(true);
  });
});

describe("check CLI", () => {
  it("exits 0 on the real registry and non-zero with a named reason on a corrupted copy", async () => {
    const pass = NodeChildProcess.spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(pass.status).toBe(0);
    expect(pass.stdout).toContain("41");

    const registry = loadRegistry();
    const mutated = JSON.parse(JSON.stringify(registry)) as SourceRegistry & {
      sources: Array<{ id: string; adoptionStatus?: string }>;
    };
    const rea = mutated.sources.find((e) => e.id === "Gully678/rea");
    if (!rea) throw new Error("expected rea entry");
    (rea as unknown as { adoptionStatus: string }).adoptionStatus = "unapproved";
    const file = await tempCopy("registry.json", JSON.stringify(mutated, null, 2));
    const fail = NodeChildProcess.spawnSync(process.execPath, [SCRIPT, "--registry", file], {
      encoding: "utf8",
    });
    expect(fail.status).not.toBe(0);
    expect(`${fail.stdout}${fail.stderr}`).toContain("rea");
    expect(`${fail.stdout}${fail.stderr}`).toContain("adoptionStatus");
  });
});

const invalidCrossChecks: unknown[] = [
  null,
  [],
  ...["reachable", "ancestors", "commitSubjectsBind", "evidenceFiles"].flatMap((field) =>
    [null, {}, "bad", [null], [42], [{}]].map((value) => ({ [field]: value })),
  ),
  { ancestors: [{ ancestor: "a".repeat(40) }] },
  { commitSubjectsBind: [{ sha: "a".repeat(40), contains: 42 }] },
  { evidenceFiles: [{ path: "x", contains: [42] }] },
];

describe("untrusted offline inputs", () => {
  it.each(invalidCrossChecks)(
    "rejects nested runtime corruption before any git call %#",
    async (gitCrossCheck) => {
      const registry = loadRegistry();
      const file = await tempCopy(
        "registry.json",
        JSON.stringify({
          ...registry,
          sources: registry.sources.map((entry, index) =>
            index === 0 ? { ...entry, gitCrossCheck } : entry,
          ),
        }),
      );
      const calls: ReadonlyArray<string>[] = [];
      const report = checkRegistryOffline({
        registryPath: file,
        runGit: (args) => {
          calls.push(args);
          return { ok: true, stdout: "" };
        },
      });
      expect(
        report.findings.some((finding) =>
          ["registry-invalid", "malformed-cross-check-sha"].includes(finding.code),
        ),
      ).toBe(true);
      expect(report.gitCrossChecksRun).toBe(0);
      expect(calls).toEqual([]);
    },
  );

  it.each([undefined, null, {}, [], [null], Array.from({ length: 78 }, () => ({}))])(
    "requires shaped coverage rows %#",
    async (rows) => {
      const coverage = JSON.parse(await NodeFSP.readFile(defaultCoveragePath(), "utf8"));
      coverage.rows = rows;
      const file = await tempCopy("coverage.json", JSON.stringify(coverage));
      const report = checkRegistryOffline({ coveragePath: file });
      expect(report.findings.some((finding) => finding.code.startsWith("coverage-rows-"))).toBe(
        true,
      );
      const result = NodeChildProcess.spawnSync(process.execPath, [SCRIPT, "--coverage", file], {
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("coverage-rows-");
    },
  );

  it("rejects short, long and malformed individual evidence rows", async () => {
    const coverage = JSON.parse(await NodeFSP.readFile(defaultCoveragePath(), "utf8"));
    const row = coverage.rows[0];
    for (const rows of [
      coverage.rows.slice(1),
      [...coverage.rows, row],
      [{ ...row, current_pin: "bad" }, ...coverage.rows.slice(1)],
      [{ ...row, full_current_body_read: false }, ...coverage.rows.slice(1)],
    ]) {
      const report = checkRegistryOffline({
        coveragePath: await tempCopy("coverage.json", JSON.stringify({ ...coverage, rows })),
      });
      expect(report.findings.some((finding) => finding.code.startsWith("coverage-rows-"))).toBe(
        true,
      );
    }
  });
});
