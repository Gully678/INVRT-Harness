# Source-sync registry story (slice 1) — audit review

LABEL: SAME-HARNESS INTERNAL AUDIT (engineering review, NOT independent external certification).
Auditor: ZCode GLM 5.3 Flash, fresh context, 2026-10-27. Audit only; no code fixed, no commits made.

Skills loaded (all six): production-audit, production-guardrails, ai-native-agent, invrt-concise-code,
verification-before-completion, code-review.

## Verdict: CHANGES REQUIRED

The registry DATA, grounding, validator behaviour and all rerun gates are sound (100% of substantive
builder claims verified). The required changes are small and specific: the slice README contains one
demonstrably false factual claim (F1) and one wrong command path (F2); the validator has one
defence-in-depth gap (F3). Fix those and this story is PASS.

- Audited commit: 89ff51c64615c17bcaf4c2d03e85154c275ded54 on codex/claude-source-sync-registry-20261027
- Parent: d6191bcd5655b770f2e84d61238022e46aa6c858
- Working tree at audit start: clean (verified). No commits, no push made by the auditor.
- Diff vs parent: exactly 7 files, all under scripts/source-sync/, +2418 insertions (git show --stat
  and git diff --name-only verified). pnpm-lock.yaml is NOT in the commit (boundary held).
- Post-audit tree: clean; pnpm-lock.yaml churned by test runs and restored via `git restore pnpm-lock.yaml`.

## Grounding audit (core fabrication risk)

16 of 41 rows sampled in depth (target was 12). All 41 ids were additionally checked to exist in the
inventory. Every sampled row is GROUNDED.

| Row (id)                             | Identity in inventory | forkOf vs inventory | Pin vs documents                                                                                                                        | Counts vs documents                                                              | Verdict  |
| ------------------------------------ | --------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| Gully678/INVRT-Harness               | yes                   | OK                  | 70eccd48e47398cc66d422d47de9c2af8e1c30e5 exact in ADOPTION-QUEUE line 8                                                                 | n/a                                                                              | GROUNDED |
| Gully678/rea                         | yes                   | OK                  | 98422997c035bf314084b7d786628616e70bc95f v6.8.0 exact in ADOPTION-QUEUE line 8                                                          | n/a                                                                              | GROUNDED |
| INVRT-AI/monti-forge                 | yes                   | n/a (firstParty)    | local pin justified: inventory recorded_pins has exactly 6 revisions, no single consumed sha; checklist says "do not pull/reset/switch" | packsRecords 102 = checklist table; missingPaths 11 verified in preservation doc | GROUNDED |
| Gully678/kammandor-skills            | yes                   | n/a                 | 79549e60816050b276206742377f8dcfbdc81795 exact in PACKET line 21                                                                        | 304 = checklist + packet                                                         | GROUNDED |
| Gully678/INVRT_Production_Guardrails | yes                   | n/a                 | 93dc0db741a42604ade4261e7299e36f2681452d exact in PACKET line 19                                                                        | 3 = checklist                                                                    | GROUNDED |
| Gully678/grill-with-ui               | yes                   | OK                  | full sha fc0de407ff3ca5c981304afba0ecf059ed5ce6cd in inventory; PACKET names the prefix ("exactfc0de407")                               | n/a                                                                              | GROUNDED |
| Gully678/fusion-harness              | yes                   | OK                  | full sha in inventory; checklist states "Fusion01a34820" matches recorded head                                                          | n/a                                                                              | GROUNDED |
| Gully678/claude-seo                  | yes                   | OK                  | 6be93f45064ffbadced572b5d5c95f55fd263af0 = coverage current_pin for all 25 rows                                                         | 25 packs / 25 changed = coverage rows                                            | GROUNDED |
| Gully678/knowledge-work-plugins      | yes                   | OK                  | c75fda00ff0e41c8ee331ae312c8a07f1967653b = coverage current_pin                                                                         | 104 packs / 9 changed = checklist + coverage                                     | GROUNDED |
| Gully678/marketingskills             | yes                   | OK                  | 17772c7a80b7b8c7a47af30f648374cd8bd8adc5 = coverage current_pin                                                                         | 31 packs / 27 changed = checklist + coverage                                     | GROUNDED |
| Gully678/taste-skill                 | yes                   | OK                  | 12af471f627f866411b4bd785b19646d3672784c = coverage current_pin                                                                         | 13 packs / 1 changed / 12 missingPaths (preservation doc)                        | GROUNDED |
| Gully678/gsd-core                    | yes                   | OK                  | pin-pending: no consumed sha documented (inventory head only)                                                                           | 4 packs = checklist                                                              | GROUNDED |
| Gully678/aaron-marketing-skills      | yes                   | OK                  | pin-pending: honest                                                                                                                     | 120 packs = checklist                                                            | GROUNDED |
| Gully678/wordcraft                   | yes                   | OK                  | pin-pending: honest                                                                                                                     | n/a                                                                              | GROUNDED |
| Gully678/gstack                      | yes                   | OK                  | pin-pending: honest; notes "1383 changed paths (856 modified + 527 added)... 174 commits" verified verbatim in PACKET + ADOPTION-QUEUE  | n/a                                                                              | GROUNDED |
| Gully678/SkillSpector                | yes                   | OK                  | pin-pending: honest                                                                                                                     | n/a                                                                              | GROUNDED |

Cross-cutting grounding facts (machine-printed):

- Inventory contains exactly 41 entries; all 41 registry ids resolve to inventory entries; zero owner
  or forkOf mismatches across ALL 41 rows (not just the sample).
- All 14 sha pins appear in the named documents. 12 appear as full 40-char values in at least one
  named document; grill (fc0de407...) and fusion (01a34820...) appear as prefixes in the
  packet/checklist and as full values in ALL-SYNCED-SOURCES-CURRENT-INVENTORY.json. ZERO invented
  hashes found.
- 26 pin-pending rows have pin: null and no documented consumed sha (verified by absence, and by
  inventory recorded_pins being empty for the sampled pending rows).
- All 17 rows carrying packsRecords match the checklist "Current PACKS entries" table exactly
  (17/17 OK).
- Sums recomputed from registry.json: packsRecords=795, changedBodies=78, missingPaths=23;
  changedBodiesBySource (25/13/1/9/1/27/1/1) equals SEMANTIC-COVERAGE.json per-source row counts
  exactly (78 rows total).
- SEMANTIC-COVERAGE.json: current_bodies_reviewed=78, current_lines=21570,
  full_literal_unified_diffs=77, structural_old_deletion_diff=["last30days"] — all match the
  registry summary.
- Packet states 795 admitted records, "694 source bodies are unchanged,78 changed,23 recorded paths
  are absent", "176 local pilot bodies differ" — all match the registry summary (694/78/23/176).
- Missing-path preservation doc: exactly 12 taste-skill + 11 monti-forge = 23 rows, matching the
  registry.
- gitCrossCheck facts verified in the checkout: 70eccd48... reachable (git cat-file -e, OK);
  ancestor of 790ba13d0c... (git merge-base --is-ancestor, OK); 98422997... reachable (OK);
  merge 5b0f7fb84 subject is "merge: adopt synced upstream t3code main 790ba13d0c (31 commits)
  preserving INVRT contracts"; oneday-evidence/ADOPTION-REVIEW.json contains all three bound shas
  (grep counts 1/4/1).
- TDD corroboration: /tmp/b01-claude/source-sync/red.log shows "Tests 14 failed (14)" with
  "NOT IMPLEMENTED" stub errors; green*.log and final-tip-tests.log show "Tests 14 passed (14)";
  mutation.log shows the builder's own probe failing exactly the adopted-without-pin test.

## Summary-count and copy integrity

- All sums verified against SEMANTIC-COVERAGE.json (above): PASS.
- Byte-identity of the committed coverage copy: FAIL (finding F1).
  - sha256 original ALL-SYNCED-SOURCES-SEMANTIC-COVERAGE.json: 4234dc930599bb7327137e9a727027cb34dc2d27914100332c71c354a12dc3e7
  - sha256 committed copy coverage-2026-10-27-SEMANTIC-COVERAGE.json: 0527a10d676a644eee7d91a8321d5c1534643b0d0400cbc412ac0b5dee92e2e4
  - cmp differs at char 133, line 5; 794 vs 792 lines; 30224 vs 30216 bytes.
  - Parsed JSON is identical (python json equality True, canonical-string equal True): the copy is a
    re-serialisation (compact arrays), semantically identical, NOT byte-identical.
  - The README claims "a byte-identical copy" (line 31) and "copied byte-identical into this
    directory" (line 66). That claim is false as printed by the machine.

## Validator / check behaviour

- registry.ts validation covers: schemaVersion, duplicate ids, adoption status whitelist,
  adopted-without-pin, sha format (40 lowercase hex), local-pin-requires-firstParty, ISO lastReviewed,
  required non-empty strings, forkOf owner/repo shape, summary field types. Fail-closed via
  RegistryValidationError with named codes.
- check-source-registry.ts: summary consistency (sourcesTotal, changedBodiesBySource sum,
  per-entry changedBodies/missingPaths/packsRecords sums), coverage count comparison, rows.length vs
  current_bodies_reviewed, git cross-checks with named findings, unreadable coverage -> finding,
  invalid registry -> finding. Exit 1 with named reasons; exit 0 only with zero findings.
  gitCrossChecksRun counts entries carrying cross-check data (2 at HEAD).
- Capability sweep: grep across the slice found NO fetch/exec/spawn/clone/http. The only subprocess is
  `spawnSync("git", ...)` with fixed read-only argv (cat-file -e, merge-base --is-ancestor,
  log --format). Tests additionally spawn process.execPath on the check script. NO network or
  execution capability in the slice. Contract claim in README is accurate.

## Mutation probes (auditor-run, /tmp/b01-claude/registry-audit/)

- Probe A (count corruption): temp registry copy with summary.admittedRecords 795->796 fed via
  `node check-source-registry.ts --registry <temp>`: exit 1 with
  "FAIL summary-admitted-records-mismatch per-entry packsRecords sum to 795 but
  summary.admittedRecords=796". Named reason, non-zero exit. PASS.
- Probe B (rule removal): adopted-without-pin rule removed from a working-tree copy of registry.ts
  (uncommitted); `pnpm exec vp test run --config ../../vite.config.ts --dir .` -> exactly
  "rejects adopted without a pin" failed (1 failed | 13 passed). Restored from backup;
  sha256 before and after both 79fc0feea56611f87bffc08ebec089432b744faa8655a3bb94dec8e5ece6eba1
  (byte-exact restore proven). PASS.

## Gates rerun at HEAD (auditor-executed)

- Tests: `pnpm exec vp test run --config ../../vite.config.ts --dir .` (from scripts/source-sync):
  14 passed (14), exit 0. (Rerun again after probe restore: 14/14, exit 0.)
- Check entry: `node check-source-registry.ts`:
  "source-registry OK: entries=41 gitCrossChecks=2 findings=0", exit 0.
- tsc scoped: `pnpm exec tsc --noEmit -p tsconfig.json` (from scripts/): exit 0.
  (Per-file `tsc --noEmit <files>` is not this repo's convention: TS5112 because scripts/tsconfig.json
  exists; the scoped project run is the working invocation.)
- vp lint on the 4 slice TS files: "Found 0 warnings and 0 errors", exit 0.
- vp fmt --check on the 6 slice files: "All matched files use the correct format.", exit 0.
- Lockfile: churned by pnpm during runs; restored with `git restore pnpm-lock.yaml`;
  final `git status --porcelain` empty (clean).

## Findings

Severity ranked money -> data -> lawsuits per production-audit.

- F1 (Medium, honest-status/doc accuracy): README lines 31 and 66 claim the committed coverage copy
  is "byte-identical" to the review-wave original. Machine evidence disproves this (sha256 differ;
  parsed-equal only). Required fix: either replace the committed copy with a byte-exact copy of the
  original (sha256 4234dc93...) or reword both lines to "semantically identical copy (re-serialised)".
  No data-integrity impact: all counts match and the parsed content is identical.
- F2 (Low, doc accuracy/breakage): README line 49 documents the test invocation as
  `vp test run --config ../vite.config.ts --dir .` from the scripts workspace. No ../vite.config.ts
  exists relative to scripts/source-sync (ls exit 1, verified). The working invocation is
  `pnpm exec vp test run --config ../../vite.config.ts --dir .` (14/14, exit 0). Required fix: correct
  the path so the next agent does not hit a dead command.
- F3 (Low, hardening): registry.ts validates gitCrossCheck only as isRecord; sha-shaped strings
  inside gitCrossCheck (reachable[], ancestors[].ancestor/of, commitSubjectsBind[].sha) are never
  checked against the 40-hex COMMIT_SHA rule before being interpolated into git argv. No shell is
  used (spawnSync argv array), so shell injection is out; but a crafted value beginning with "-" could
  inject a git option (e.g. `git log -1 --format=%B --output=<path>` is a file-write primitive).
  Registry is committed, reviewed data, so exploitability is low; a 40-hex check would close the gap
  and turn malformed cross-check data into a named validator error instead of a git invocation.
- F4 (Info, by-design scope): the check enforces internal TOTALS, not per-row distribution or
  doc-grounding: shifting packsRecords between entries (+X/-X), or deleting an entry's gitCrossCheck
  data entirely, keeps findings=0. Within the stated "internal consistency" contract for slice 1;
  document-grounding cross-checks belong to a later slice. Noted so no one mistakes the check for
  doc verification.
- F5 (Info): the README carries no fmt-scope caveat (the only "format" match is the sha-format line).
  fmt was verified clean by this audit on the six slice files; stating the fmt check scope would
  complete the contract wording.

## Honest-status spot-check (duty 6)

- No fetch automation claimed: TRUE (README defers fetch/candidate/rollback to a later slice;
  capability grep confirms no fetch code).
- REA cross-check described as reachability-only: TRUE (README lines 38-39: "deliberately NOT claimed
  as an ancestor"; verified 98422997... is reachable and no ancestor claim is made).
- fmt-scope caveat present: FALSE (F5).
- byte-identical claim: FALSE (F1).

## Boundaries (duty 5)

- Only the 7 slice files vs base: VERIFIED (git diff --name-only).
- No product source touched: VERIFIED.
- Lockfile zero-change in the commit: VERIFIED (git show --stat has no pnpm-lock.yaml; working-tree
  lockfile churn from audit-time pnpm runs restored; tree clean).
- No push, no commits, no installs beyond the workspace's own frozen pnpm prepare: VERIFIED.

## Recommended sequence for the builder

1. F1 README byte-identity wording (or byte-exact re-copy) — data/provenance claim.
2. F2 test invocation path — operational accuracy.
3. F3 40-hex validation of gitCrossCheck fields + a validator negative test — hardening.
4. (Optional) F5 fmt-scope sentence.
