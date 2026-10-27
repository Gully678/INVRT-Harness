# ZCode adapter cross-harness fix evidence, Builder 1, 27 October 2026

TL;DR: all six ADAPTER corrections ZA-01 to ZA-06 fixed regression-first on branch
`invrt/oneday-fix-adapter-20261027` (base 8a61a818). Full provider-zcode suite 73/73
(baseline 46), builtInDrivers 2/2, all four typechecks clean. UNAUDITED labels retained.

Strictly Private and Confidential, INVRT internal.

## Identity, harness and skills

Builder: ZCode, model `builtin:zai-coding-plan/GLM-5.3-Flash` (recorded honestly; this
fix batch still requires its own different-harness re-audit, which follows this build).
Worktree: `/Users/mac/Repos/.worktrees/invrt-oneday-fix-adapter-20261027`, branch
`invrt/oneday-fix-adapter-20261027`, base 8a61a81827961c0c6e118e7237dd2e88ddaaf407.

Skills loaded and applied: production-guardrails, production-audit, ai-native-agent,
invrt-concise-code, typescript-pro, test-driven-development. TDD was followed per entry:
each regression was written first and observed failing on the unmodified tip (or on the
missing-seam state) before the fix, then observed passing after. The required ZA-05
mixed-payload fixture was additionally proven failing on the fully unmodified tip before
any file in the package was edited.

## Per-entry record

### ZA-01 (P1) plan interaction policy enforced at the adapter, before any effect

Files: `packages/provider-zcode/src/server/adapter.ts` (startTurn), adapter.test.ts.

Fix: startTurn now computes the send mode before any effect. `interactionMode === "plan"`
maps to the protocol's native plan mode for every runtime mode (including full-access),
so a retained plan thread stays plan end-to-end and can never acquire build/edit/yolo.
The default interaction keeps the existing `zcodeRuntimeModeToCliMode` mapping unchanged
(full-access still sends yolo). Hiding the UI toggle was never the enforcement.

Proof: adapter-level tests drive the real adapter against the fake app-server with a
session/send frame log and assert the exact frames. RED on the unmodified tip
(`zac-fix-raw/ZA01-red-before-fix.txt`): the plan-policy tests failed because the tip
sent `yolo`. GREEN after the fix: mode is `plan` for full-access, approval-required and
auto-accept-edits under plan interaction; default full-access still sends `yolo`.

### ZA-02 (P1) one shared command resolver across status, turns and usage

Files: `status.ts` (zcodeCommandPlan, resolveZcodeExecutable, ZcodeCommandNotFoundError,
resolveZcodeCommandCandidates), `adapter.ts` openSession, `usage.ts` scan, tests.

Fix: one shared plan composes decoded defaults and cleared values (both decode to the
bare `zcode` name) into the same chain as an empty setting: PATH first, then the
/Applications/ZCode.app bundle script. An explicit override stands alone and never falls
back. `resolveZcodeExecutable` discovers the actual executable through the existing
SpawnExecutableResolution PATH scan plus file checks, expands tilde before execution
against the instance HOME, and fails with an honest ZcodeCommandNotFoundError (tried
list included) when nothing resolves, with no silent substitution. The adapter
openSession and the usage scan both consume the shared resolver; the usage scan keeps
per-instance failure isolation, and openSession maps the failure into
ProviderAdapterOpenSessionError per the adapter error union.

Proof: RED `zac-fix-raw/ZA02-red-before-fix.txt` (10 failures: missing seams plus the
adapter tilde end-to-end defect, where the tip spawned the literal `~/...` path). GREEN:
PATH absent + bundle present resolves the bundle; PATH absent + no bundle errors;
explicit override that cannot resolve errors even with the bundle present; tilde expands
via HOME; the adapter opens a session through a tilde override end-to-end. Existing
resolveZcodeCommandCandidates tests stayed green unchanged.

### ZA-03 (P1) post-start context usage publishes through the real projection caller

Files: `adapter.ts` (onNotification, ensureThread, resumeThread), adapter.test.ts.

Fix: a session/event usage change now publishes `provider_thread.updated` on the
session's event stream, which is the actual input the projection caller consumes, not
only the private ref. Publication is deduplicated by a comparison key of the context
usage snapshot and only fires after the thread is live; ensureThread and resumeThread
seed the baseline so only changes publish.

Proof: RED `zac-fix-raw/ZA03-red-before-fix.txt` (exactly one provider_thread.updated,
the ensureThread one; post-start usage published nothing). GREEN: a usage-only
notification after thread start produces a second provider_thread.updated whose
contextUsage carries usedTokens 400, maxTokens 1000, asserted on the runtime events
stream, not the mapper.

### ZA-04 (P2) unsupported usage-limit metadata attached to real snapshots

Files: `status.ts` (buildInitialZcodeProviderSnapshot, checkZcodeProviderStatus),
status.test.ts.

Fix: `usageLimitsFromAvailability` is now attached to every buildServerProvider probe in
both snapshot paths, so UI and routing receive the honest unsupported 5-hour/weekly
metadata with no fabricated numbers. The ZA-07 message strings in the same file were
left untouched for the sibling fix-platform builder.

Proof: RED `zac-fix-raw/ZA04-red-before-fix.txt` (usageLimits undefined on all three
snapshot paths). GREEN: checked snapshot (disabled), probe-not-found snapshot and initial
snapshot all carry `unavailable.reason: "unsupported"` with the 5-hour and weekly
message and empty windows.

### ZA-05 (P1) explicit aborted/error outranks step-finish, never failure-as-completed

Files: `eventMapping.ts`, eventMapping.test.ts.

Fix: an explicit message `info.finish` now outranks the step-finish reason. A
non-completed finish always produces a FAILED turn.terminal carrying the reason. A
step-finish proves completion only through a recognised success reason (stop, length)
and only when no explicit finish disagrees; an `error` step reason is itself a failure;
unknown reasons and tool-calls prove nothing.

Proof: written and run FIRST on the fully unmodified tip before any other edit:
`zac-fix-raw/ZA05-red-before-fix.txt` shows 5 failures including the mixed-payload
fixture surfacing `completed` with `expected 'completed' to be 'failed'`. GREEN after
the fix: mixed aborted+stop fails with code aborted; error+stop fails with code error;
aborted+tool-calls still fails; completed+stop completes; unknown finish fails; step
error fails; unknown step reason without a finish terminates nothing. Existing cases
stayed green unchanged.

### ZA-06 (P2) usage range selector receives a duration, not an epoch

Files: `usage.ts` (zcodeUsageScan), usage.test.ts, fakeServer.ts (usage/stats frame log).

Fix: the scan measures the age of the retained window floor (the same
`max(windowStartMs, retentionCutoffMs)` the usage service retains on) from the Effect
Clock now and clamps a future floor to zero before `rangeForWindowMs`, so the protocol
receives the intended 7d/30d/all bucket instead of an epoch-divided `all`.

Proof: RED `zac-fix-raw/ZA06-red-before-fix.txt` (`expected 'all' to be '7d'`,
`expected 'all' to be '30d'`; the recorded usage/stats params prove what the scan asked
for). GREEN: 2-day window asks 7d, 28-day window asks 30d, 400-day window asks all.
The existing per-instance isolation test and dedupe-key tests stayed green unchanged.

## UNAUDITED scope statement

The live model-turn area keeps its UNAUDITED declaration. ZA-01 touches the startTurn
send path by necessity (the entry is the adapter-level enforcement) but changes only the
mode selection before the send; the stream mapping of live turn events is unchanged and
stays marked UNAUDITED in the source headers and ZCODE-ADAPTER-EVIDENCE.md. ZA-03 is
post-start usage notification publication, not a live model turn. No live ZCode model
provider configuration exists on this machine, so no live-turn claim is made here.

## Overlap note for the sibling fix-platform builder

This branch edits `packages/provider-zcode/src/server/status.ts` only for ZA-02
(resolver functions) and ZA-04 (usageLimits wiring). The ZA-07 user-visible strings at
status.ts (the disabled-provider "T3 Code" messages) were deliberately left unchanged
for the fix-platform worktree; the hunks are disjoint and should merge cleanly.

## Verification results (all machine-printed)

- Full provider-zcode suite after all fixes: 73 passed (73), 7 files
  (`zac-fix-raw/FINAL-suite.txt`). Baseline before fixes: 46 passed.
- builtInDrivers registration: 2 passed (2) (`zac-fix-raw/FINAL-builtinDrivers.txt`).
- Typechecks, all exit 0 with zero errors
  (`zac-fix-raw/FINAL-typecheck-*.txt`): provider-zcode, t3 (apps/server),
  @t3tools/web, @t3tools/mobile. Baseline provider-zcode typecheck verified clean
  before fixes (stash-verified) so nothing pre-existing was papered over.
- pnpm-lock.yaml: no churn at any point (install used --frozen-lockfile; git status
  clean for the lockfile before commit).

## Resource ledger

Temporary: `oneday-evidence/zac-fix-raw/` (committed as durable proof, not removed).
Durable: this evidence file and ZAC-FIX-EVIDENCE.json on the fix branch; the worktree
and branch are retained unpushed for the re-audit (no push performed, per the push law).
No processes, ports, databases or scratch dirs remain: the fake app-server children are
disposed inside each test, and every RED/GREEN run completed.
