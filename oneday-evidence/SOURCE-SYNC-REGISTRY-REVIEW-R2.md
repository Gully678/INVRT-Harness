# Source-sync registry story (slice 1) — re-audit round 2

LABEL: SAME-HARNESS INTERNAL AUDIT (engineering review, NOT independent external certification).
Auditor: ZCode GLM 5.3 Flash, fresh context, 2026-10-27. Re-audit only; no code fixed, no commits made.

Skills loaded (all six, paths verified present): production-audit, production-guardrails,
ai-native-agent, invrt-concise-code, verification-before-completion, code-review.

## Verdict: PASS

All five round-1 findings are closed in the committed bytes at 6fd3d6f2. The fix introduced no new
defect: diff scope is exactly the four permitted paths, the sha validation rejects no legitimate
value, the byte-exact recopy broke no test, and the VP_GIT_HOOKS=0 opt-out was used only for the
verbatim coverage artifact. Gates rerun at HEAD all green. Mutation probe proves the new defence is
real.

- Audited commit: 6fd3d6f2a5a21d45093c18545618c91f5bfda7eb (HEAD verified) on
  codex/claude-source-sync-registry-20261027
- Round-1 code / round-1 audit evidence: 89ff51c6 / 743e3005 (findings read from
  oneday-evidence/SOURCE-SYNC-REGISTRY-REVIEW.md at that commit)
- Diff 743e3005..HEAD touches EXACTLY: scripts/source-sync/README.md,
  coverage-2026-10-27-SEMANTIC-COVERAGE.json, check-source-registry.ts,
  check-source-registry.test.ts (git diff --name-only verified; registry.ts untouched)
- Working tree at audit start and end: clean (verified; pnpm-lock.yaml churn from audit pnpm runs
  restored via git restore pnpm-lock.yaml after every pnpm run)

## Round-1 closure, finding by finding (verified in committed bytes, machine-printed)

- F1 byte-identical claim — CLOSED.
  `git show HEAD:scripts/source-sync/coverage-2026-10-27-SEMANTIC-COVERAGE.json | shasum -a 256`
  = 4234dc930599bb7327137e9a727027cb34dc2d27914100332c71c354a12dc3e7; the original
  ALL-SYNCED-SOURCES-SEMANTIC-COVERAGE.json in research/2026-10-27/ONE-DAY-RELEASE/ hashes to the
  same value; `cmp` reports identical. Round 1 measured 0527a10d... on the old copy; the fix
  replaced it. README now cites exactly that sha, so the claim matches machine reality.
- F2 wrong config path — CLOSED. README documents "from this directory, with `pnpm exec vp test
  run --config ../../vite.config.ts --dir .`". A slice-wide grep for `../vite.config` not preceded
  by `../` returns nothing; no stale reference remains. This audit ran the documented invocation:
  15 passed (15), exit 0.
- F3 sha validation before git argv — CLOSED. `CROSS_CHECK_SHA = /^[0-9a-f]{40}$/` (no g flag,
  anchored) guards every sha-to-argv position in check-source-registry.ts: reachable[i] (continue
  on malformed), ancestors[i].ancestor AND ancestors[i].of (both checked, continue when either
  malformed), commitSubjectsBind[i].sha (continue). grep lists exactly three sha-carrying runGit
  sites (lines 173, 191, 205/204) and all sit behind the guards; no unguarded position exists.
  The negative test is behavioural and constructs the evil case: it sets
  `gitCrossCheck.reachable[0] = "-output=/tmp/evil"` in a temp registry copy, injects a spy
  GitRunner, asserts the named "malformed-cross-check-sha" finding on entry Gully678/rea, and
  asserts the evil string never appears in any recorded git argv.
- F4 totals-only — UNCHANGED (no action required, none taken). The diff adds only sha validation;
  the check contract remains internal totals consistency, no per-row doc-grounding scope creep.
- F5 fmt-scope caveat — CLOSED. README adds: "The verbatim coverage-2026-10-27-SEMANTIC-COVERAGE.json
  copy must stay outside any future whole-repo `vp fmt` scope: reformatting it would break the
  byte-identity provenance claim above."

## New-defect hunt on the fix (all clean)

- No legitimate registry value rejected: the check at HEAD exits 0 with entries=41 gitCrossChecks=2
  findings=0, so every real cross-check sha passes the new 40-hex rule.
- Byte-exact recopy broke no test: all 15 tests pass (round 1 had 14; the +1 is the new negative
  test). The recopied coverage file is parseable and the check's coverage comparisons still pass.
- VP_GIT_HOOKS=0 opt-out scoped correctly: `git show 6fd3d6f2 --stat` lists only the four permitted
  paths; `vp fmt --check` across those four files flags ONLY the coverage json (the documented
  verbatim exception); registry.json, README.md and both TS files are fmt-clean. The commit message
  documents the opt-out and its reason (the staged pre-commit hook would re-serialise the JSON).
- Code-quality passes: the regex has no lastIndex statefulness; finding messages carry entryId,
  field path and the offending value; a comment explains the argv-option risk that motivates the
  guard.

## Substance re-check (lighter than round 1, which verified 16/16)

- 41 entries: machine-printed by the check at HEAD (entries=41).
- Summary counts verified: the check recomputed all internal totals with findings=0; this audit
  independently recounted the coverage evidence rows: 78 total, per-source 25/13/1/9/1/27/1/1,
  exactly matching summary.changedBodiesBySource.
- 4-row grounding sample, all GROUNDED:
  - Gully678/knowledge-work-plugins: pin c75fda00... appears 9 times in
    ALL-SYNCED-SOURCES-SEMANTIC-COVERAGE.json (9 rows, one current_pin each) and in
    CURRENT-INVENTORY; changedBodies=9 matches the 9 coverage rows.
  - Gully678/taste-skill: pin 12af471f... in coverage (1 row) and inventory; missingPaths=12
    matches 12 taste-skill rows in ALL-SYNCED-SOURCES-MISSING-PATH-PRESERVATION.md.
  - INVRT-AI/monti-forge: packsRecords=102 matches the checklist table (line 38); missingPaths=11
    matches 11 monti-forge rows in the preservation doc; local-pin rationale consistent with the
    recorded six-revision history.
  - Gully678/INVRT-Harness: pin 70eccd48... exact in ADOPTION-QUEUE-2026-10-27.md line 8; its
    gitCrossCheck facts (reachable, ancestor-of, commit subject bind, evidence binding) were
    machine-executed by the check run at HEAD (findings=0, gitCrossChecks=2 covers this entry and
    Gully678/rea).

## Gates rerun at HEAD (auditor-executed, this session)

- Tests: `pnpm exec vp test run --config ../../vite.config.ts --dir .` (from scripts/source-sync):
  15 passed (15), exit 0.
- Check entry: `node scripts/source-sync/check-source-registry.ts`:
  "source-registry OK: entries=41 gitCrossChecks=2 findings=0", exit 0.
- tsc: `pnpm exec tsc --noEmit -p tsconfig.json` (from scripts/): exit 0.
- vp lint on the two changed TS files: "Found 0 warnings and 0 errors", exit 0.
- vp fmt --check on the two changed TS files: "All matched files use the correct format.", exit 0;
  scope check across all four changed files flags only the coverage json (documented verbatim
  exception).
- Lockfile restored after each pnpm run; final `git status --porcelain` clean before this report's
  two evidence files were written.

## Mutation probe (auditor-run, /tmp/b01-claude/registry-reaudit/)

Neutralised the F3 defence by replacing `const CROSS_CHECK_SHA = /^[0-9a-f]{40}$/;` with
`const CROSS_CHECK_SHA = /.*/;` in a working-tree copy (uncommitted). Reran the documented test
invocation: EXACTLY "rejects a non-40-hex cross-check sha without invoking git" fails
(1 failed | 14 passed) - the negative test genuinely detects the removed validation. Original
sha256 4edb87a2fecf5b81892df70dfca49a0b4333b892aa187bcc68e16a11be376c97 recorded before; after
restore the file hashes to the same value and `cmp` against the saved original passes
(byte-exact restore proven). Probe artifacts saved under /tmp/b01-claude/registry-reaudit/.

## Boundaries

- Diff scope: exactly the four permitted paths vs 743e3005. VERIFIED.
- No commits, no push by this audit. VERIFIED (tree clean except the two evidence files this
  report adds, which remain uncommitted).
- registry.ts (round-1 code) untouched by the fix. VERIFIED.
- No installs beyond the workspace's own frozen pnpm prepare; lockfile restored. VERIFIED.
