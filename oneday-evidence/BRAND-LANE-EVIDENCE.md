# BRAND-LANE-EVIDENCE.md

Lane: Builder B (brand/product), ONE-DAY INVRT Code, 27 October 2026.
Worktree: /Users/mac/Repos/.worktrees/invrt-oneday-brand-20261027, branch invrt/oneday-brand-20261027, base 6ef29078c74d4cb82f0875d7f161ccdc24b4253c.
Builder: ZCode harness, model builtin:zai-coding-plan/GLM-5.3-Flash (same-harness audits are never claimed as cross-harness acceptance; a different-model auditor is still owed).

## Skills loaded

production-guardrails, production-audit, ai-native-agent, invrt-concise-code, invrt-ui-quality, design-system. Loaded from /Users/mac/.zcode/skills/*/SKILL.md (the Skill tool rejects unqualified names for subagents; the same files were read directly).

## Graph lookups

`graphify explain "branding" --graph /Users/mac/Repos/invrt-code-local-pilot/graphify-out/graph.json` failed: the file does not exist. /Users/mac/Repos/invrt-code-local-pilot/graphify-out/ holds only cache/ and .rebuild.lock (a rebuild by another session was in progress). Recorded as a graph miss; the documented fallback (bounded direct greps at the exact revision) was used. No graph result was fabricated. Seams were verified at the exact revision before editing.

## Approved identity applied

Product name "INVRT Code". Tokens read (never guessed) from /Users/mac/My Drive/Claude/INVRT Design System/tokens/invrt-tokens.json: accent.default #405BD8, accent.gradient 135deg #405BD8 to #2A3A8E, surface.base #F8FAFC, ink.strong #0F172A. No colour was hardcoded into product code by this lane: this lane changes names and identity strings only. Suitable DS assets inspected: assets/invrt-wordmark.svg (currentColor, aria-label INVRT), assets/invrt-mark.svg, assets/derived/app-icon-1024.png and favicon PNGs.

## Per-surface before and after

| Surface                              | File                                                                             | Before                                                                    | After                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Web fallback base name               | apps/web/src/branding.ts:19                                                      | `?? "T3 Code"`                                                            | `?? "INVRT Code"`                                                                                |
| Web page title                       | apps/web/index.html:465                                                          | `<title>T3 Code (Beta)</title>`                                           | `<title>INVRT Code (Beta)</title>`                                                               |
| Web splash                           | apps/web/index.html:470-471                                                      | aria-label "T3 Code splash screen", alt "T3 Code"                         | "INVRT Code splash screen", "INVRT Code"                                                         |
| Web onboarding identity              | apps/web/src/components/onboarding/WelcomeWizard.tsx:233-240                     | title "Set up T3 Code", aria-label "T3 Code", T3Wordmark glyph + "Code"   | title "Set up INVRT Code", aria-label "INVRT Code", text span "INVRT" + "Code" (same type scale) |
| Web theme label                      | apps/web/src/components/settings/ThemePreviewCircles.tsx:61                      | label "T3 Code"                                                           | "INVRT Code"                                                                                     |
| Web browser link target              | apps/web/src/components/settings/IntegrationsSettings.tsx:634                    | app: "T3 Code"                                                            | "INVRT Code"                                                                                     |
| Web auth client label                | apps/web/src/connection/clientMetadata.ts:80,89                                  | "T3 Code Desktop" / "T3 Code Web"                                         | "INVRT Code Desktop" / "INVRT Code Web"                                                          |
| Desktop injected branding origin     | apps/desktop/src/app/DesktopEnvironment.ts:90                                    | APP_BASE_NAME "T3 Code"                                                   | "INVRT Code"                                                                                     |
| Desktop productName                  | apps/desktop/package.json:44                                                     | "T3 Code (Beta)"                                                          | "INVRT Code"                                                                                     |
| Desktop bundle id (electron-builder) | scripts/build-desktop-artifact.ts:65                                             | DESKTOP_APP_ID "com.t3tools.t3code"                                       | "com.invrt.code" (comment records the signed-build caveat)                                       |
| Mobile app names                     | apps/mobile/app.config.ts VARIANT_CONFIG                                         | "T3 Code Dev" / "T3 Code Preview" / "T3 Code"                             | "INVRT Code Dev" / "INVRT Code Preview" / "INVRT Code"                                           |
| Mobile permission strings            | apps/mobile/app.config.ts                                                        | "Allow T3 Code to ..." (local network, photo library, microphone, camera) | "Allow INVRT Code to ..." (same wording otherwise)                                               |
| Mobile widget descriptions           | apps/mobile/app.config.ts                                                        | "connected T3 Code environments", "active T3 Code agents"                 | "connected INVRT Code environments", "active INVRT Code agents"                                  |
| Mobile brand mark                    | apps/mobile/src/components/BrandMark.tsx:30                                      | "T3 Code"                                                                 | "INVRT Code" (mark component structure unchanged)                                                |
| Mobile header brand title            | apps/mobile/src/components/CompactBrandTitle.tsx                                 | T3Wordmark glyph + "Code", aria-label "T3 Code, Threads"                  | Text "INVRT" (font-t3-bold) + "Code", aria-label "INVRT Code, Threads"                           |
| Mobile theme label                   | apps/mobile/src/lib/mobileTheme.ts:29                                            | "T3 Code"                                                                 | "INVRT Code"                                                                                     |
| Mobile settings sections             | OutdatedServerUpdateSection.tsx:87, SettingsEnvironmentDetailRouteScreen.tsx:233 | SettingsSection title "T3 Code"                                           | "INVRT Code"                                                                                     |
| Mobile Android header                | apps/mobile/src/features/workspace/WorkspaceRootScreen.tsx:178                   | title "T3 Code"                                                           | "INVRT Code"                                                                                     |
| Mobile Live Activities               | remoteRegistration.ts:492, showcaseAgentActivity.ts:70, ThreadComposer.tsx:709   | title/projectTitle "T3 Code"                                              | "INVRT Code"                                                                                     |

## Audit fix pass (F1-F4), 27 October 2026

Fix agent: ZCode harness, model builtin:zai-coding-plan/GLM-5.3-Flash. Applied the four findings from oneday-evidence/BRAND-LANE-AUDIT.md (that audit file is left uncommitted; the auditor owns it). Surgical string diffs only; the launcher bundle-id rewrite is untouched.

| Finding  | File                                                                                                                          | Before                                                                                                                                                                                                                                              | After                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1       | apps/web/public/manifest.webmanifest:3-4                                                                                      | name and short_name "T3 Code"                                                                                                                                                                                                                       | name and short_name "INVRT Code"; web rebuilt; dist copy verified (0 "T3 Code" matches, title still INVRT Code (Beta))                                   |
| F2       | apps/desktop/scripts/electron-launcher.mjs:16                                                                                 | APP_DISPLAY_NAME "T3 Code (Dev)" / "T3 Code (Beta)"                                                                                                                                                                                                 | "INVRT Code (Dev)" / "INVRT Code (Beta)". Display-name string only; the com.t3tools.t3code bundle-id rewrite is untouched (owner decision, below)        |
| F3       | apps/mobile/modules/t3-composer-editor/android/src/main/java/expo/modules/t3composereditor/T3ComposerEditorModule.kt:21,39,44 | clipboard ClipData labels "T3 Code" (newPlainText x2, newHtmlText x1)                                                                                                                                                                               | "INVRT Code"                                                                                                                                             |
| F4       | scripts/build-desktop-artifact.ts:2755-2756,2831-2837,2851,2903,3830,4117                                                     | "T3 Code (Nightly)" productName and "T3 Code" fallback; four macOS permission descriptions; two protocol names "T3 Code"; store description "T3 Code is an open-source desktop app..."; command description "Build a desktop artifact for T3 Code." | all now "INVRT Code" wording. Schemes, maintainer, homepage and author untouched                                                                         |
| F4 tests | scripts/build-desktop-artifact.test.ts                                                                                        | no assertion covered the product-name seam                                                                                                                                                                                                          | new test pins resolveDesktopProductName to "INVRT Code (Nightly)" / "INVRT Code" per channel; no existing assertion weakened or deleted (42 -> 43 tests) |

Fix-pass machine-printed results (same toolchain PATH as the builder run):

- `pnpm exec vp test run apps/web/src/branding.test.ts apps/desktop/src/app/DesktopEnvironment.test.ts apps/desktop/src/app/DesktopAppIdentity.test.ts` -> Test Files 3 passed (3), Tests 29 passed (29).
- `pnpm exec vp test run scripts/build-desktop-artifact.test.ts` -> Test Files 1 passed (1), Tests 43 passed (43).
- `pnpm exec vp run --filter @t3tools/web typecheck` -> exit 0 (cache hit; pre-existing suggestions only).
- `pnpm exec vp run --filter @t3tools/desktop typecheck` -> exit 0 (cache hit).
- `pnpm exec vp run --filter @t3tools/web build` -> exit 0, built in 43.66s; `grep` of apps/web/dist/manifest.webmanifest prints `"name": "INVRT Code"` / `"short_name": "INVRT Code"` and 0 "T3 Code" matches; dist title still `<title>INVRT Code (Beta)</title>`.

## Deliberately unchanged

- DESKTOP_DOWNLOAD_URL stays `https://t3.codes/download` (apps/web/src/branding.ts:28). No INVRT download URL was invented; pending owner decision.
- Internal @t3tools package scopes, T3CODE_* env names, import paths, slug "t3-code", URL schemes (t3code, t3code-dev, t3code-preview), clerk-theme internals and licence/notice text: untouched.
- Mobile bundle ids com.t3tools.t3code(.dev/.preview) and android packages: NOT changed. They are not cleanly separable: they bind the Clerk relying party clerk.t3.codes app-site association (applinks/webcredentials), keychain access groups, app groups, widget bundle ids and the EAS project. Changing them breaks auth and deep links. Pending owner decision.
- Desktop appUserModelId (com.t3tools.t3code, DesktopEnvironment.ts:248) and linuxWmClass "t3code": untouched; window/notification identity, not listed as a lane seam. Noted for the owner.
- T3Wordmark glyph remains in web SidebarChrome, V2LifecycleRow, TimelineToolActivityIcon and mobile thread-work-log.tsx; replacing those glyphs is a visual identity decision for the owner with real DS assets.
- Prose sentences containing "T3 Code" (160 occurrences across the three src trees, for example "T3 Code will restart..."): deliberately left; a copy pass is a separate bounded lane to avoid a mass edit in shared settings files.

## Signing status

The desktop build is unsigned local development. com.invrt.code was applied only to the electron-builder DESKTOP_APP_ID; no signing identity, team id or provisioning profile was touched. For a signed/distributed build the appId drives the teamId.appId.webauthn keychain access group entitlement, so a signed release needs Mark's team identity decision first.

## Tests

Focused tests added because the seam contract changed (fallback baseName, injected branding, builder appId):

- apps/web/src/branding.test.ts (new): asserts fallback baseName "INVRT Code", display name contains "INVRT Code", DESKTOP_DOWNLOAD_URL unchanged.
- apps/desktop/src/app/DesktopEnvironment.test.ts: appended resolveDesktopAppBranding contract tests (Dev and Beta stage labels preserved, baseName "INVRT Code", displayName "INVRT Code (Dev)" / "INVRT Code (Beta)").
- Updated assertions only (coverage not deleted): apps/desktop/src/app/DesktopAppIdentity.test.ts (setName and About panel names), scripts/build-desktop-artifact.test.ts (passkey appId and rendered entitlements string).

Machine-printed results (toolchain PATH per the lane brief, no whole-repo suite):

- `pnpm exec vp test run apps/web/src/branding.test.ts apps/desktop/src/app/DesktopEnvironment.test.ts apps/desktop/src/app/DesktopAppIdentity.test.ts` -> Test Files 3 passed (3), Tests 29 passed (29).
- `pnpm exec vp test run scripts/build-desktop-artifact.test.ts` -> Test Files 1 passed (1), Tests 42 passed (42).
- `pnpm exec vp run --filter @t3tools/web typecheck` -> exit 0 (only pre-existing effectFnOpportunity suggestions in storage.ts, untouched).
- `pnpm exec vp run --filter @t3tools/desktop typecheck` -> exit 0 (pre-existing suggestions only).
- `pnpm exec vp run --filter @t3tools/web build` -> exit 0, built in 36.32s; apps/web/dist/index.html verified, machine-printed `<title>INVRT Code (Beta)</title>`.
- Desktop DMG/packaging build intentionally NOT run (orchestrator owns packaging).
- Mobile runtime/typecheck not run: no mobile typecheck script in the lane brief; changes there are string and JSX-label edits verified by the web/desktop typechecks of shared contracts and by inspection.

## Remaining sweeps and gaps

- grep `'"T3 Code"'` outside test files now returns zero matches in apps/web/src, apps/desktop/src, apps/mobile/src. Exact-string matches inside test files are fixtures (simulated OS window titles, project titles, document.title stubs) and stay, except the two branding-contract assertions updated above.
- Files fixed by the audit fix pass (no longer counted as remaining): apps/web/public/manifest.webmanifest, apps/desktop/scripts/electron-launcher.mjs (APP_DISPLAY_NAME line 16 only), apps/mobile/modules/t3-composer-editor/android/.../T3ComposerEditorModule.kt, scripts/build-desktop-artifact.ts.
- Residual inside the declared desktop surface, honestly recorded: apps/desktop/scripts/electron-launcher.mjs:271-272 still read "T3 Code captures the active window when you use the snapshot shortcut." (NSWindowCaptureUsageDescription) and "T3 Code reads project files you open in the desktop app." (NSDocumentsFolderUsageDescription). The audit's F2 enumerated the display-name string only, so the fix pass left them and queues them for the next bounded pass; they surface in macOS permission prompts.
- Out-of-scope backlog (audit F5, unchanged, outside the three surfaces): apps/server (McpHttpServer.ts:1034 server name, McpOAuth.ts:76 OAuth resource name, cliAuthHtml.ts:12 CLI auth page, provider and VCS strings), apps/marketing/src/layouts/Layout.astro title and og:site_name, .devcontainer/devcontainer.json name, infra/relay, native/browser-secret/main.c, packages/provider-muse and source-control-github. Several are identifiers rather than prose; they need their own bounded pass with owner awareness.
- Icon asset gap (recorded, not invented): a suitable INVRT icon exists in the DS (invrt-mark.svg, derived/app-icon-1024.png) but the mobile icon pipeline is variant-specific (scripts/lib/brand-assets.ts drives composer projects and platform icon sets). Swapping icons across dev/nightly/prod variants is an owner decision; BrandMark keeps its structure with the INVRT name.
- pnpm-lock.yaml was modified by the lane's `pnpm install` (@pnpm/exe entries from pnpm 12.14.0) and restored before commit; it is not part of this change.

## Pending decisions for the owner

(a) Download URL: no INVRT download URL was invented; DESKTOP_DOWNLOAD_URL stays https://t3.codes/download (apps/web/src/branding.ts:28, pinned by apps/web/src/branding.test.ts).
(b) Mobile bundle ids unchanged (com.t3tools.t3code(.dev/.preview) and Android packages): they bind the Clerk relying party clerk.t3.codes app-site association, keychain groups, app groups, widget bundle ids and the EAS project.
(c) Identity set still t3 in the launcher and OS integrations: electron-launcher APP_BUNDLE_ID com.t3tools.t3code(.dev.*), DesktopEnvironment appUserModelId, Linux metainfo id and the com.t3tools.t3code.service launchd label. One owner identity decision is required before any signed or distributed build; until then the unsigned local pilot position holds.
(d) com.invrt.code (electron-builder DESKTOP_APP_ID) is applied for unsigned local development only; a signed release derives teamId.appId.webauthn keychain entitlements, so it needs Mark's team identity decision first.
(e) Icon variant pipeline: which INVRT DS icon goes into which app variant (dev/nightly/prod, web favicon set, mobile platform icon sets) is an owner decision; nothing was invented or swapped in this lane.
(f) Prose backlog outside the three surfaces plus the in-surface launcher permission descriptions: the remaining user-visible "T3 Code" text listed under Remaining sweeps and gaps (server MCP/OAuth/CLI auth names, marketing app, devcontainer, infra/relay, native/browser-secret, provider packages, and electron-launcher.mjs:271-272).

## Commit

Recorded after commit (see the lane report for the exact sha). Only the files listed above are staged by explicit path; nothing is pushed.
