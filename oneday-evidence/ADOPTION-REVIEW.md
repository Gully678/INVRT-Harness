# ADOPTION-REVIEW: fork-sync adoption audit

Verdict: **PASS**

Label: SAME-HARNESS INTERNAL AUDIT (reviewer runs on the same harness/model as the builder; engineering review only, NOT independent external certification).

Reviewer: ZCode audit agent (builtin:zai-coding-plan/GLM-5.3-Flash). Audited: worktree
`/Users/mac/Repos/.worktrees/invrt-claude-adoption-sync-20261027`, branch
`codex/claude-adoption-sync-20261027`, merge commit `5b0f7fb84e`, fix commit `84b49e6151`.

Skills loaded and applied: production-audit, production-guardrails, ai-native-agent,
invrt-concise-code, verification-before-completion, code-review.

## Gate reruns (executed by this reviewer)

All from the worktree root with PATH prefixed
`/Users/mac/Repos/invrt-code-local-pilot/.pilot/toolchain/node-v26.12.1-darwin-x64/bin`
(node v26.12.1, pnpm 12.14.0):

| Gate             | Command                                                               | Exit | Evidence                                                                            |
| ---------------- | --------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| mobile typecheck | `pnpm --filter @t3tools/mobile typecheck`                             | 0    | `/tmp/audit-mobile-typecheck.log`, ends `$ tsc --noEmit`, no errors                 |
| contracts test   | `pnpm exec vp test run packages/contracts/src/modelSelection.test.ts` | 0    | `Test Files  1 passed (1)` / `Tests  4 passed (4)` (`/tmp/audit-contract-test.log`) |
| web tsc          | `pnpm --filter @t3tools/web exec tsc --noEmit`                        | 0    | zero output (`/tmp/audit-web-tsc.log`)                                              |

The pnpm invocations re-added the known `@pnpm/exe` churn to `pnpm-lock.yaml`; restored with
`git restore pnpm-lock.yaml`. Nothing committed. Post-restore `git status --porcelain` is empty.

## Findings

### 1. Merge completeness: PASS (14 of 31 upstream commits verified)

Method: for each sampled commit, its touched files were diffed between upstream tip `790ba13d0c`
and merge `5b0f7fb84e` (empty diff = byte-identical adoption), and/or the commit's semantic anchor
was grep-verified in the merged tree. `git log 70eccd48..790ba13d0c` lists the 31 commits.

Verified commits and how:

- `56695ae3ec` model labels / registry move: `packages/client-runtime/src/providerClients.ts`
  exists with the full registry (see finding 2); `apps/web/src/components/settings/providerDriverMeta.ts`
  is now `export { providerClients } from "@t3tools/client-runtime/provider-clients"`.
- `a24b109bc3` showcase pure model: `apps/mobile/src/features/showcase/showcaseCaptureModel.ts` and
  `showcaseCaptureModel.test.ts` present (fix commit covered below).
- `c175e5737e` linux-arm64 SEA workaround: `scripts/lib/linux-arm64-sea.ts` byte-identical to
  upstream; TEMPORARY sentence present in `docs/operations/release.md` (verified in merge diff).
- `1ebbc205f6` CodeRabbit testing docs: `.coderabbit.config.ts` byte-identical to upstream.
- `d033768ec7` server child deliveries: `updateDelegatedCompletionOnlyRunId` mechanism present in
  `apps/server/src/orchestration-v2/Orchestrator.ts` (lines 11794, 11812, 11948, 12124-12142);
  `DelegatedCompletionDelivery.test.ts` byte-identical to upstream.
- `63bc022f64` web focus ring: `apps/web/src/components/device/DeviceStreamView.tsx` byte-identical.
- `7c3b3b3605` zod for @cursor/sdk: `"zod"` in `scripts/lib/cli-external-packages.ts` line 28;
  `scripts/lib/cli-external-packages.test.ts` byte-identical.
- `a86c05f977` Cmd/Ctrl+W: merged `apps/desktop/src/window/DesktopApplicationMenu.ts` has
  `Close Window` click handler (line 205) and `windowMenu` with custom submenu (line 297); file's
  13-line diff vs upstream is a single branding line (`T3 Code` to `INVRT Code` in an update dialog).
- `e5f2e5dbbc` iOS resume sockets: `packages/client-runtime/src/connection/driver.ts`,
  `registry.test.ts`, `supervisor.test.ts`, `apps/mobile/src/connection/app-state-wakeups.ts`
  all byte-identical to upstream.
- `bc8d02ffd5` interrupted Claude context: anchors in
  `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` lines 7260-7262
  (`(input.status === "completed" || input.context.nativeMessageCursor !== null)`).
- `b333c175ba` compact toggle token count: `apps/web/src/components/chat/ComposerPrimaryActions.tsx`
  byte-identical.
- `6bbb2d8508` avdmanager warnings: `apps/server/src/device/DeviceHubOperations.ts` byte-identical.
- `2202787df0` onboarding import hang: `waitForProject` imported and used in
  `apps/web/src/components/onboarding/WelcomeWizard.tsx` (lines 61, 1241-1243); the 63-line diff vs
  upstream is branding only (InvrtMark component, INVRT Code strings).
- `f81c4cd79f` markdown frontmatter: `packages/shared/src/markdownFrontmatter.ts` and its test,
  `apps/mobile/src/features/files/FileMarkdownPreview.tsx`, `packages/shared/package.json` all
  byte-identical to upstream.

### 2. Conflict-resolution correctness: PASS (all six paths)

- `apps/mobile/package.json`: nine `@t3tools/provider-*` workspace deps removed, matching upstream's
  registry move; ZCode dep re-homed (see next). Evidence: `git diff 6eb44b38 5b0f7fb84e -- apps/mobile/package.json`.
- `apps/web/package.json`: `provider-acp-registry`, `-cursor`, `-fx`, `-grok`, `-muse`, `-opencode`,
  `-pi` removed; `@t3tools/provider-core` and `@t3tools/provider-zcode: workspace:*` retained.
- ZCode client registration: `packages/client-runtime/src/providerClients.ts` imports
  `zcodeClient` from `@t3tools/provider-zcode/client` (line 17) and registers it in the
  `makeProviderClientRegistry` array before `acpRegistryClient` (order: museClient, piClient,
  zcodeClient, acpRegistryClient).
- `providerStatus.test.ts` imports resolve: it imports `@t3tools/provider-zcode/settings` and
  `@t3tools/provider-zcode/server`; `packages/provider-zcode/package.json` declares both exports
  (`./settings`, `./server`, `./client`, `./server/usage`, `./testing`); apps/web declares the dep.
  Web `tsc --noEmit` exit 0 is the executable proof.
- Deleted file: `apps/mobile/src/lib/providerClients.ts` deleted in the merge; a strict grep across
  `apps` and `packages` (`*.ts`, `*.tsx`) for import paths resolving to `lib/providerClients`
  returns zero hits.
- `docs/operations/release.md`: upstream's TEMPORARY linux-arm64 postject sentence taken; INVRT Code
  brand preserved; `t3.codes` / `t3` npm / T3 release-version phrasing retained (documented exceptions).
- `pnpm-lock.yaml`: see finding 4.

### 3. Brand integrity: PASS (zero new hits)

`git grep -nE "T3 Code|T3Code"` over `apps/**` and `packages/**` `*.ts|*.tsx|*.json` (node_modules
excluded) at merge `5b0f7fb84e` vs base `6eb44b38`: 9 hits at both; `comm` shows zero NEW hits and
zero removed. The 9 hits are all legacy-migration compatibility names (`T3 Code (Alpha)`,
`T3 Code (Dev)`, `t3code` profile/app-name constants in `apps/desktop/src/app/DesktopLegacyLocalStorage.ts`,
`DesktopUserData.ts` and their tests) plus one regression-test comment in
`apps/web/src/components/settings/providerStatus.test.ts` asserting the ABSENCE of `T3 Code`.
No new user-visible upstream product-name string was introduced by the merge.

### 4. Lockfile integrity: PASS with documented trade-off

`git diff 790ba13d0c 5b0f7fb84e -- pnpm-lock.yaml` shows exactly:

- zero `@pnpm/exe` hunks (grep count 0) vs upstream;
- 3 added `@t3tools/provider-zcode` importer entries, landing inside the `apps/server` (lockfile
  line ~856), `apps/web` (~1046) and `packages/client-runtime` (~1432) importer ranges;
  zero in the `apps/mobile` range (verified by range grep);
- a new `packages/provider-zcode` importer section (contracts, provider-core, shared, effect,
  dev deps) matching that package's actual dependencies;
- 3 local-derived patch hashes updated (`@ff-labs/fff-node@0.11.0`, `app-builder-lib@26.16.1`,
  `dbus-next@0.10.2`) in `patchedDependencies`, importer versions and snapshot keys, matching the
  INVRT-branded `patches/*.patch` files.

Coherent for CI-style frozen installs: all referenced workspace link targets exist and importer
entries mirror the committed package.json files. Known trade-off stands: any local pnpm install
(e.g. this review's gate reruns) re-adds `@pnpm/exe` self-managed churn; documented in
ONE-DAY-RUN-STATE-2026-10-27.md and restored here (`git restore pnpm-lock.yaml`).

### 5. Fix commit 84b49e6151: PASS

`packages/shared/src/themePalettes.ts` line 3: `MOBILE_DEFAULT_THEME_ID = "invrt-code"`.
`apps/mobile/src/features/showcase/showcaseCaptureModel.test.ts` contains zero `"t3-code"` literals
and five `"invrt-code"` literals after the 5-line (7 literal) swap. Mobile typecheck exit 0 and the
test's type errors are gone as claimed.

### 6. Worktree state: PASS

Post-restore `git status --porcelain` empty; `git log --oneline -3` reads `84b49e6151`,
`5b0f7fb84e`, `790ba13d0c` as expected. Nothing committed by this reviewer; no pushes.

## Adversarial notes (no blocking findings)

- The reviewer attempted to find a caller still importing the deleted mobile provider registry via
  path variants (`../lib/providerClients`, `@/lib/providerClients`, `~/lib/providerClients`,
  `mobile/src/lib/providerClients`) and found none; typechecks passing across mobile and web make a
  dangling import implausible.
- No `changes required` findings. Severity of every finding above: PASS; the only open operational
  item is the pre-documented lockfile churn trade-off, which is a process note, not a defect.
