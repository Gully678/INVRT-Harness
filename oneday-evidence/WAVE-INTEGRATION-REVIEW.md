# WAVE-INTEGRATION-REVIEW

Label: SAME-HARNESS INTERNAL AUDIT (engineering review, NOT independent external certification).
Reviewer: fresh-context reviewer, ZCode (GLM 5.3 Flash). Reviewer model differs from the integration builder only in context; this is a same-harness internal audit and certifies nothing external.
Date: 2026-10-27.
Target: worktree /Users/mac/Repos/.worktrees/invrt-claude-wave-integration-20261027, branch codex/claude-wave-integration-20261027, HEAD 6feeffab9de8d471b54b0d0c5cdbf2fc9cdaec62, tree clean at start of review and clean at end (reviewer's own two evidence files excluded; no commits made by reviewer).

## Verdict

PASS (within the SAME-HARNESS INTERNAL AUDIT label; cross-harness release acceptance remains owed and is not claimed).

All five duties verified by printed evidence: union completeness holds for every branch, topology matches the claim, the platform-evidence binding matches the artifact on disk right now, all byte-exact spot checks pass, and all three sampled gates rerun clean.

## Per-branch union table

Method: for each branch, enumerate changed paths via `git diff <own-base>..<branch-tip> --name-only`, then compare each path's content at the branch tip against HEAD (`git diff <branch-tip> HEAD -- <path>`; empty means byte-identical). Own base = merge-base of the branch tip with the prior chain element.

| Branch                                        | Tip      | Changed paths vs own base                                  | Product files verified byte-identical at HEAD                                                                                                                        | Evidence files present at HEAD                                                                                          | Result |
| --------------------------------------------- | -------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| codex/claude-adoption-sync-20261027           | d6191bcd | 2 (both evidence)                                          | n/a (0 product)                                                                                                                                                      | 2 of 2 (ADOPTION-REVIEW.json/.md), identical                                                                            | OK     |
| codex/claude-server-archive-20261027          | c7c9de11 | 5 (3 product + 2 evidence)                                 | 3 of 3: RELEASE-MANIFEST.json, SERVER-RUNBOOK.md, dist-package/README.md                                                                                             | 2 of 2 (SERVER-ARCHIVE-REVIEW.json/.md), identical                                                                      | OK     |
| codex/claude-domain-core-b01-20261027 (B01.1) | ea153d9d | 7 (3 product + 4 evidence)                                 | 3 of 3: programmeDomain.ts, programmeDomain.test.ts identical; index.ts holds union (see note)                                                                       | 4 of 4 (B01-REVIEW.json/.md, B01-REVIEW-R2.json/.md), identical                                                         | OK     |
| codex/claude-b01-2-identity-20261027 (B01.2)  | 656aefd4 | 5 (3 product + 2 evidence)                                 | 3 of 3: programmeIdentity.ts, programmeIdentity.test.ts identical; index.ts identical to B01.2's union version                                                       | 2 of 2 (B01-2-REVIEW-R1.json/.md), identical                                                                            | OK     |
| codex/claude-source-sync-registry-20261027    | fe868c6a | 13 (7 product + 6 evidence, 2 shared with adoption branch) | 7 of 7: registry.ts, registry.test.ts, check-source-registry.ts, check-source-registry.test.ts, README.md, coverage-2026-10-27-SEMANTIC-COVERAGE.json, registry.json | 4 of 4 own (SOURCE-SYNC-REGISTRY-REVIEW.json/.md + R2 pair) plus 2 shared ADOPTION-REVIEW files, all present, identical | OK     |

Union totals: 16 product-path checks (index.ts checked from both parents), 16/16 identical or correct union; 14 distinct wave evidence files, 14/14 present and identical; oneday-evidence/ at the tip carries 73 tracked files in total.

Overlap note (the one genuine conflict surface): packages/contracts/src/index.ts was changed by both B01.1 and B01.2. HEAD vs ea153d9d shows exactly one added line (`export * from "./programmeIdentity.ts";`) and HEAD vs 656aefd4 is empty; HEAD lines 71-72 carry both programme exports. The union of both branches is intact, so the builder's "zero conflicts" claim holds where a conflict was possible.

Diffstat reconciliation: merge chain (8ade1577) vs base c7c9de11 = 22 files, +6547, -0, matching the builder claim exactly. HEAD adds the evidence bind commit (1 file, +18/-1 in INVRT-CODE-PLATFORM-EVIDENCE.json), giving 6565+/1- vs base overall. The single deletion is inside the deliberate evidence rebind, not product code.

## Topology

- `git log --oneline --graph` shows the three merges stacked on c7c9de11 in order b736c472, 729999cb, 8ade1577, then evidence bind 6feeffab.
- Merge parents printed by `git log -1 --format='%P'`:
  - b736c472: c7c9de118a + ea153d9d17 (matches claim)
  - 729999cb: b736c472bd + 656aefd4f4 (matches claim)
  - 8ade1577: 729999cbd4 + fe868c6a26 (matches claim)
- `git merge-base --is-ancestor` OK for c7c9de11, ea153d9d, 656aefd4, fe868c6a, plus 551c3cfc and d6191bcd, all against HEAD.

## Platform-evidence binding

- INVRT-CODE-PLATFORM-EVIDENCE.json parses (python3 json.load, exit 0).
- current_server_archive_candidate: bytes 94870610; sha256 562e8052cd4d53046c5241e1a70d8f79be1d523c0c7ddcf3e03f4e7b67dbaae8; sourceTip d6191bcd5655b770f2e84d61238022e46aa6c858. All three match the claim.
- Artifact verified on disk right now: `shasum -a 256` of /Users/mac/Repos/invrt-code-local-pilot/.pilot/oneday-release-2026-10-27/server-archive-candidate/INVRT-CODE-SERVER.tar.gz prints 562e8052cd4d...dbaae8 and stat prints 94870610 bytes. Exact match.
- current_takeover_candidate retained intact with supersededBy "current_server_archive_candidate", supersededAt 2026-10-27, and an explicit retention note; the new entry carries a matching "supersedes" pointer. Nothing deleted.
- Field-name observation: the artifact path is stored under the key `file` (absolute path present), not `path`. Recorded as informational; the duty's "path" is satisfied by the `file` key.

## Byte-exact spot checks

- scripts/source-sync/coverage-2026-10-27-SEMANTIC-COVERAGE.json sha256 = 4234dc930599bb7327137e9a727027cb34dc2d27914100332c71c354a12dc3e7 (matches 4234dc93... claim).
- packages/contracts/src/programmeDomain.ts vs ea153d9d: diff empty.
- packages/contracts/src/programmeIdentity.ts vs 656aefd4: diff empty.
- scripts/source-sync/registry.json vs fe868c6a: diff empty.
- INVRT-CODE-SERVER-RUNBOOK.md present at the integration tip (11,805 bytes); INVRT-CODE-RELEASE-MANIFEST.json also present (8,348 bytes).

## Gates rerun (sample), PATH prefixed with /Users/mac/Repos/invrt-code-local-pilot/.pilot/toolchain/node-v26.12.1-darwin-x64/bin

- contracts typecheck (`pnpm exec tsc --noEmit` in packages/contracts): exit 0.
- B01.2 suite (`pnpm exec vp test run packages/contracts/src/programmeIdentity.test.ts`): Test Files 1 passed, Tests 26 passed (26), exit 0. Matches the claimed 26.
- registry check entry (`node scripts/source-sync/check-source-registry.ts`): "source-registry OK: entries=41 gitCrossChecks=2 findings=0", exit 0. Matches the claimed entries=41 findings=0.
- Lockfile discipline: `git restore pnpm-lock.yaml` after the pnpm runs; tree returned to 0 modified entries at HEAD 6feeffab. Zero commits on the integration branch touch pnpm-lock.yaml (git log c7c9de11..HEAD -- pnpm-lock.yaml prints nothing), confirming the builder's lockfile claim.
- Not rerun (out of sample scope, builder-reported only): tier-1 285, B01.1 60, registry slice 15, two builds, five further typechecks.

## Honesty scan

- All four integration commits (b736c472, 729999cb, 8ade1577, 6feeffab) were read in full; grep for certif/independent/external-audit finds no certification claim in any message.
- audit_labels in PLATFORM-EVIDENCE states "All evidence same-harness (ZCode GLM 5.3 Flash); cross-harness release acceptance owed on every row". The two "independent" mentions in the JSON both record a future owner audit as still owed; neither claims completed independent certification.
- Candidate status strings read "PRIVATE CANDIDATE, SELF-TESTED ...; NOT ENTERPRISE ACCEPTED". Honest.

## Findings

1. INFORMATIONAL (no action required for this act): the union-diff claim "+6547/0" describes the merge chain (8ade1577 vs c7c9de11), not HEAD; HEAD vs base is 6565+/1- because the evidence bind deliberately rewrites INVRT-CODE-PLATFORM-EVIDENCE.json. The builder's own message states the 22-file +6547 -0 scope, so no misstatement exists; recorded so a future reader does not mistake the 1 deletion for product loss.
2. INFORMATIONAL: current_server_archive_candidate stores the artifact path under key `file` rather than `path`. Absolute path is present and the artifact hashes correctly today; any consumer looking for a `path` key must read `file`.
3. NOTE (freshness): the bound 94.8 MB archive lives outside the repository in the pilot toolchain directory. The hash was verified now (562e8052..., 94,870,610 bytes); it must be re-hashed at release acceptance per the freshness law. No defect.
4. NOTE (unchanged scope): the gates rerun here is a sample per the duty; the 285/60/15 suites, builds and additional typechecks rest on the builder's printed evidence and the per-branch audit records bound in oneday-evidence/. This is within the stated review scope, and cross-harness acceptance remains owed.

No blocking findings. Nothing dropped, nothing altered, no dishonest claim found.

## Reviewer trail

Commands whose printed output this review relies on: git status/rev-parse/log -1 --format=%P, git merge-base --is-ancestor, git diff --name-only and --shortstat and --numstat and --quiet per path, python3 json inspection, shasum -a 256, stat, pnpm exec tsc --noEmit, pnpm exec vp test run, node scripts/source-sync/check-source-registry.ts, git restore pnpm-lock.yaml, git status --porcelain. No commits were made by the reviewer.
