# Platform and evidence-record fix evidence, cross-harness fix act, Builder 2

Strictly Private and Confidential, INVRT internal. Last verified: 27 October 2026, ZCode, `builtin:zai-coding-plan/GLM-5.3-Flash` (recorded honestly; ZCode cannot route models or effort levels). Branch `invrt/oneday-fix-platform-20261027`, worktree `/Users/mac/Repos/.worktrees/invrt-oneday-fix-platform-20261027`, base `8a61a81827961c0c6e118e7237dd2e88ddaaf407` (audited integration tip). A different-harness re-audit follows this fix; this builder does not certify its own work.

Skills loaded (required union, binding): production-guardrails, production-audit, ai-native-agent, invrt-concise-code, invrt-ui-quality, design-system, invrt-technical-prose. Scope note: production-audit informed the evidence-contract handling (EG-01) and invrt-technical-prose the docs corrections; no strategy or deployment recommendation was made. The sibling fix-adapter worktree was not touched; nothing under `/Users/mac/My Drive` was modified.

## Environment and resource ledger

- Toolchain: node v26.12.1 from the pilot toolchain; `vp` from the worktree's own `node_modules/.bin`.
- `pnpm install --frozen-lockfile` was required (the worktree had no `node_modules` despite the brief saying it was present). Exit 0 in 66.3 s; `pnpm-lock.yaml` shows zero churn (verified with `git diff --stat pnpm-lock.yaml`: empty).
- Created and removed during the session: `apps/mobile/android` and `apps/mobile/ios` prebuild outputs (JS-only verification, deleted after verification), `/tmp/eg01-captures`, `/tmp/eg01-*-basedir`, `/tmp/eg01-harness.sh`, `/tmp/eg01-build.log`, prebuild logs, `apps/server/dist` (built once for the EG-01 reproduction; removed after the record), `gen-android-ds-icons.mjs` (temporary PNG generator, removed before commit).
- Retained build state: the worktree's `node_modules` (gitignored) so the next auditor can rerun tests without a reinstall.

## ZA-07 (P1) disabled-provider brand wording

Files: `packages/provider-zcode/src/server/status.ts` lines 197 and 238; `apps/web/src/components/settings/providerStatus.test.ts`.

Change: both probe messages now read `"ZCode is disabled in INVRT Code settings."`. Presentation chain verified: probe message -> `buildServerProvider` copies `probe.message` into `ServerProvider.message` (`packages/provider-core/src/server/snapshotProbe.ts:269`) -> `getProviderSummary` returns it as the settings-UI detail for disabled status (`apps/web/src/components/settings/providerStatus.ts:54-60`).

Presentation-level test added (not a constant assertion): builds the real disabled snapshot through `buildInitialZcodeProviderSnapshot` from `@t3tools/provider-zcode/server`, assembles the `ServerProvider` the snapshot layer produces, and runs the actual UI presentation function `getProviderSummary`, asserting `detail` contains "INVRT Code" and does not contain "T3 Code" with `getProviderStatusKey` = "disabled".

Machine outputs:

- `apps/web`: `vp test run src/components/settings/providerStatus.test.ts --project unit` -> `Test Files 1 passed (1), Tests 8 passed (8)`.
- Mutation probe (old string temporarily restored): the new test failed with `AssertionError: expected 'ZCode is disabled in T3 Code settings.' to contain 'INVRT Code'` while the 7 pre-existing tests stayed green; fix restored (2 occurrences verified). The test genuinely guards the wording.

## Platform P2 (P2) Android artwork

Files: six PNGs under `apps/mobile/assets/` (only these; the two adaptive background PNGs and all config paths were already wired and are not in the audit scope).

Source: INVRT Design System `assets/invrt-mark.svg` (DS flat master geometry, the same glyph as `derived/app-icon-1024.png`), fill white, composed with sharp 0.35.4 (the repo's existing image dependency). The repo's own `scripts/export-android-icons.ts` pipeline could not be reused because its sources (`assets/*/app-icon.icon/Assets/text.svg`) are still the unregenerated upstream wordmark; that .icon regeneration gap stays owned by the acknowledged iOS `.icon`/ictool item and is not silently worked around.

Per-role sizes verified from the replaced files and the app.config pipeline: adaptive foreground and monochrome 432x432 (full-bleed canvas, glyph height 48 percent, inside Android's 66 percent safe zone for every mask), notification 96x96 (white silhouette on transparent, 70 percent height), splash 1152x1152 per variant (full-bleed background, white mark at the upstream 48 percent height).

| File                            | Baseline sha256 (audit)                                          | New sha256                                                       |
| ------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| android-icon-foreground.png     | 6587c7848ca58514b4d4dc16bc974051ea820c203b7d644becfb03d2ecad7263 | 86c1c5dbcbe6b12056d4af881efb77dc8578a07bc9bd69e339ac1e2d2e38bf21 |
| android-icon-mark.png           | ba626d1d8b4ee7f17a251c1fbe293ba0ce17f3b0e843d69c227cc48ce3ea9be0 | 86c1c5dbcbe6b12056d4af881efb77dc8578a07bc9bd69e339ac1e2d2e38bf21 |
| android-notification-icon.png   | e0f6e170f4e03e4bfbb50feecdc296326e7a93c682f34a2644b4da7bfd4359d6 | 322819bf75e4c2449614ac7e771ec3b2d3bffa69a2019ec41a0da4fea5e734ef |
| android-splash-icon-dev.png     | a04af8a0493f5dd4e7cf4c4004cb4dcc99aa0b826861f8dbcf0de4839c9e6d94 | a4c99ff189684a05506053292ccfef5fe2ff65a5cd92b230c8b89ae17aa7308f |
| android-splash-icon-nightly.png | f085b6d81bead9b5b0a6b071f8db60d376d73f5389f778c267c8c872323bca32 | 66ca84f3fc21b5b120802f6461233650207259d6210c1d9ebf9392e8c429b289 |
| android-splash-icon-prod.png    | 8292258e91c5404da82219dc9c154cf5cb28a99ee88ee6d79e478dc4dc5208ab | 7cab6cb0dbfe4dda98df496e03907f1adda6e3ccec3be2758e9bc1c7d05058e4 |

Background choices (documented, contrast = white text ratio, WCAG relative luminance): dev splash uses DS Momentum Blue 600 `#405BD8` (5.67), nightly uses DS Deep Slate `#0F172A` (17.85), prod keeps `#000000` (21.0) matching the production adaptive background in `app.config.ts`. Foreground and monochrome layers are white on transparent so the launcher's own layer colour governs light and dark; the configured adaptive backgrounds (#347FF8 dev at 3.79, #111533 nightly at 17.81, #000000 prod at 21.0) all keep the white silhouette legible; masks are covered by the safe-zone margin. `hasAlpha` verified true for all six.

Consumer verification without a native build (SDK/JDK/adb remain absent): `expo prebuild --platform android --no-install` (JS-only, exit 0) generated and was verified, then deleted:

- `mipmap-*/ic_launcher_foreground.webp` and `ic_launcher_monochrome.webp` (432x432 at xxxhdpi, visually the INVRT mark) from `adaptiveIcon.foregroundImage` / `monochromeImage` (`app.config.ts:290-291`).
- `drawable-*/notification_icon.png` (96x96) from the `expo-notifications` icon (`app.config.ts:336`).
- `drawable-*` and `drawable-night-*` `splashscreen_logo.png` (1152x1152, visually the INVRT mark on the variant background) from the `expo-splash-screen` android image (`app.config.ts:391`).
- `mipmap-*/shortcut_icon_foreground.png` from `expo-quick-actions` (`app.config.ts:349`).
- `values/colors.xml`: `iconBackground #000000`, `notification_icon_color #FFFFFF` as configured.

iOS gap unchanged: `.icon`/Icon Composer sources remain unregenerated (acknowledged item, untouched here).

## Platform P3 (P2) iOS terminal-native exclusion scope

Files: `apps/mobile/package.json` (unconditional `expo.autolinking.ios.exclude` removed), `apps/mobile/app.config.ts` (plugin registered), new `apps/mobile/plugins/terminalNativeExclusion.cjs`, `apps/mobile/plugins/withIosTerminalNativeExclusion.cjs`, `apps/mobile/plugins/withIosTerminalNativeExclusion.test.ts`.

Mechanism research (empirical on this SDK, expo-modules-autolinking 58.0.13):

- `expo.autolinking` in `app.config.ts` is IGNORED by resolution: with the package.json exclusion neutralised, `expo-modules-autolinking resolve -p ios` still listed the module with the exclusion present in app config (test run recorded; exit evidence in session). Only package.json `expo.autolinking` is honoured, and it is a static boolean list with no platform+condition support (`build/autolinking/findModules.js:55` `excludeNames = new Set(autolinkingOptions.exclude)`).
- The CocoaPods path accepts options: `use_expo_modules!(options)` (`expo/scripts/autolinking.rb:8-16`) forwards `exclude` to the resolve CLI (`expo-modules-autolinking/scripts/ios/autolinking_manager.rb:213-226` appends `['--exclude', ...exclude]`).

Narrowest correct mechanism: a Podfile dangerous mod replaces only the main target's bare `use_expo_modules!` with a conditional that reads `T3CODE_IOS_EXCLUDE_TERMINAL_NATIVE` at pod-install time; the widgets target's `use_expo_modules_widgets!` is untouched. One prebuild serves both destinations: default (arm64 simulators, physical devices, archive builds) keeps the native terminal; the Intel x86_64 simulator workflow sets the variable before `pod install`/`expo run:ios` because GhosttyKit ships an arm64-only simulator slice.

Verification chain (all machine-printed this session, no signing, no native build):

1. Default keeps the module: with the package.json exclusion removed, `expo-modules-autolinking resolve -p ios --json` lists `@t3tools/mobile-terminal-native` (True).
2. The exclusion passthrough drops it: the same CLI with `--exclude @t3tools/mobile-terminal-native` (exactly what `use_expo_modules!(exclude: [pkg])` passes) omits the module (False).
3. The Ruby conditional is correct: evaluating the generated Podfile line prints `with env=1 excludes: ["@t3tools/mobile-terminal-native"]` and `without env excludes: []`.
4. `expo prebuild --platform ios --no-install` (exit 0, deleted after) produced a Podfile whose main target reads `terminal_native_excludes = ENV["T3CODE_IOS_EXCLUDE_TERMINAL_NATIVE"] == '1' ? ["@t3tools/mobile-terminal-native"] : []` followed by `use_expo_modules!(exclude: terminal_native_excludes)`, with `use_expo_modules_widgets!` untouched.

Tests (assert the predicate directly): `apps/mobile`: `vp test run plugins/withIosTerminalNativeExclusion.test.ts --project unit` -> `Test Files 1 passed (1), Tests 6 passed (6)` covering: no flag keeps the terminal; flag=1 excludes exactly the one package; empty/`0` values exclude nothing; the patch reads the env at pod-install time; only the bare main-target invocation is replaced; idempotency; loud failure when the bare invocation is missing.

Honest limits (not claimed): no `pod install`, no xcodebuild, no physical-device or Intel-simulator run exists; the pod-install-time env behaviour is proven at the Ruby-conditional and CLI-passthrough level, and the generated autolinking output for an actual arm64 build must be checked when a signing-capable host is available. Removing the package.json exclusion changes the Expo fingerprint; existing saved native-client records become stale by design and will rebuild on next ensure.

## Platform P4 (P3) runbook and package docs

Files: `INVRT-CODE-SERVER-RUNBOOK.md`, `dist-package/README.md`.

- Runbook lines 54 and 57 now quote the actual emitted text: "Authentication required. Open INVRT Code using the pairing URL." (`apps/server/src/serverRuntimeStartup.ts:350`) and "A INVRT Code server is already running for <base-dir>" (`apps/server/src/cli/config.ts:344`). `grep -c "T3 Code"` on the runbook returns 0.
- Archive-root ambiguity removed: section 9 now states the tarball extracts `dist/`, `node_modules/` and `README.md` at the archive root, that the repo-tree paths in sections 2-4 (`apps/server/dist/`) do not exist inside the archive, and binds the shipped archive exactly: 66,477,760 bytes, sha256 `2d143c815c07f17933c99f96d83df75d6e077be14da6c0768a800c01e2dbbe7d` (verified against `/Users/mac/Repos/invrt-code-local-pilot/.pilot/oneday-release-2026-10-27/INVRT-CODE-SERVER.tar.gz`; archive listing confirms `dist/bin.mjs`, `dist/client/index.html`, `node_modules/`, `README.md` at root). Repackage requirement noted: packaging is a separate controlled step and the shipped tarball still contains the pre-fix docs wording; the original deliverable was not rebuilt or moved.
- `dist-package/README.md` line 3 now says INVRT Code server and describes the archive-root layout. The `t3` CLI binary name stays (declared migration identifier).

## EG-01 (P2) egress evidence retraction

New file: `oneday-evidence/EG01-EGRESS-RETRACTION.md` (additive; historical lane evidence not rewritten). Registry corrections on this branch, one-line surgical replacements (both files still valid JSON):

- `INVRT-CODE-PLATFORM-EVIDENCE.json` `server_headless.integrated_run`: "zero egress" replaced with the corrected statement plus pointer to the retraction record.
- `INVRT-CODE-RELEASE-MANIFEST.json` `tests_and_audits.server`: same.

Caller attribution (full citations in the retraction record):

1. `185.199.108-111.133:443` = `raw.githubusercontent.com`; caller `apps/server/src/provider/ModelManifest.ts:226` (`MODEL_MANIFEST_URL` lines 24-25), forked at startup via `refreshInBackground` (line 255); toggle `enableProviderUpdateChecks` (`packages/contracts/src/settings.ts:1122`, default true; guard `ModelManifest.ts:223`); gap: the guard is skipped while no settings file exists, so fresh state fetches before opt-in. Litellm rates fetch (`apps/server/src/usage/UsageService.ts:259`, URL lines 61-62) runs on the usage-read path (`:715`), not startup, with no toggle (gap recorded).
2. `ingest.t3.codes` (Cloudflare edges 104.16.7.34, 104.16.10.34, 104.21.3.218, 172.67.153.155; DNS verified this session); caller telemetry `apps/server/src/telemetry/AnalyticsService.ts:68` (PostHog host default) and key default lines 62-64; toggle `T3CODE_TELEMETRY_ENABLED` (line 73, default true).

Reproduction (source bundle built once from this branch, harness `lsof -a -p <pid> -i -n -P` plus per-child sampling to 60 s):

| Run | State                   | Config                                       | Non-loopback egress seen                                   |
| --- | ----------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| A   | fresh                   | defaults                                     | `185.199.108.133:443` (~3 s), `172.67.153.155:443` (~13 s) |
| B   | same-state restart of A | defaults                                     | `185.199.109.133:443` (~4 s), `104.21.3.218:443` (~14 s)   |
| C   | fresh                   | `T3CODE_TELEMETRY_ENABLED=0`                 | `185.199.110.133:443` only                                 |
| E   | fresh                   | settings `enableProviderUpdateChecks: false` | `172.67.153.155:443` only                                  |

Differential attribution: GitHub-raw egress disappears exactly with the update-checks setting (E vs A); ingest.t3.codes egress disappears exactly with the telemetry env (C vs A). No child process opened any socket in any capture. The shipped tarball was not re-run here (packaging is a separate controlled step); Codex's package-mode raw lsof (PID 22830) shows the same two destinations.

## Test outputs (all machine-printed this session)

| Suite                                                                                          | Result                                                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Branding trio (`branding.test.ts`, `DesktopEnvironment.test.ts`, `DesktopAppIdentity.test.ts`) | 3 files, 29/29 passed                                                   |
| Packaging (`scripts/build-desktop-artifact.test.ts`)                                           | 1 file, 43/43 passed                                                    |
| `apps/mobile` typecheck (`tsc --noEmit`)                                                       | exit 0                                                                  |
| `apps/web` typecheck (`vp run --filter @t3tools/web typecheck`)                                | exit 0 (pre-existing TS suggestions only, unrelated files)              |
| `packages/provider-zcode` suite (touched `status.ts`)                                          | 6 files, 46/46 passed                                                   |
| `apps/web` `providerStatus.test.ts` (ZA-07 presentation)                                       | 1 file, 8/8 passed; mutation probe on the old string fails the new test |
| `apps/mobile` plugin predicate tests (P3)                                                      | 1 file, 6/6 passed                                                      |

## Residuals and honest limits

- Android and Windows remain BLOCKED (SDK/JDK/adb absent; no owned Windows host); P2 was source-level artwork and JS-only consumer verification, not a native Android build.
- P3 is proven at source, CLI-resolution, Ruby-conditional and generated-Podfile level; pod-install and xcodebuild verification needs a signing-capable host.
- The shipped tarball predates these fixes: repackage (controlled step) is required before any distribution, and the tarball binding in the runbook describes the existing archive.
- The two EG-01 gaps (fresh-state fetch before opt-in; no rates-fetch toggle) and the telemetry default are recorded for the owner in `oneday-evidence/EG01-EGRESS-RETRACTION.md`; no product change was made for them in this fix.
