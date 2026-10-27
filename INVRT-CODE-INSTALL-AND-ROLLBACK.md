# INVRT Code: install and rollback, one-day build (27 October 2026)

Unsigned local development build on Intel x64 macOS 26.7. This is NOT signed distribution: no developer identity, no notarisation, no auto-update channel and no App Store release is claimed. All artifacts are rebuildable from the integrated branch.

## 1. Desktop app (macOS DMG)

- Artifact: the DMG produced by `pnpm run dist:desktop:dmg:x64` on the integrated tree (path and sha256 in INVRT-CODE-RELEASE-MANIFEST.json). Application identity: com.invrt.code, product name INVRT Code.
- Install: open the DMG, drag INVRT Code to Applications. First launch of an unsigned local build: control-click, Open (Gatekeeper prompt), or allow in System Settings, Privacy and Security.
- Isolation: the app uses its own app data directory. To run fully isolated from any existing profiles, launch with `T3CODE_DESKTOP_APP_DATA_DIR=<chosen dir> open -a "INVRT Code" --args ...` or use the saved pilot launcher pattern (see the server runbook). Do not point it at a directory holding state you cannot lose.
- Rollback: quit the app, drag INVRT Code from Applications to Trash, and delete the chosen app-data directory. The DMG file itself is the previous version's rollback: keep the prior DMG before replacing it. User project folders and repositories are never touched by uninstall.
- Update: no auto-update is configured in this build (upstream update channel deliberately not enabled for the unsigned local build).

## 2. Headless server + web client (single artifact)

- Artifact: dist-package/INVRT-CODE-SERVER.tar.gz (sha256 in the manifest). Contains the server bundle, the built web client (served single-origin at the server root) and the pinned runtime externals.
- Run: `node dist/bin.mjs --base-dir <state dir> --host 127.0.0.1 --port <port> --no-browser` with Node 26.12.1 (the version this was built and verified with; see INVRT-CODE-SERVER-RUNBOOK.md for the full runbook, backup/restore and shutdown procedure).
- First run bootstraps environment auth and prints a pairing URL; treat the token as a secret.
- Rollback: stop the server by its recorded PID, swap the dist directory (or restore the previous tarball extraction), keep the state directory unless deliberately migrating; the schema migrates forward only, so pair a dist rollback with a state backup restore when crossing schema versions.
- The web client has no separate hosting route in this build: it ships inside the server bundle. A separate hosted route remains a future owner decision.

## 3. iOS simulator client

- Build route: on the integrated tree, `pnpm --filter @t3tools/mobile exec expo prebuild --clean --platform ios` (APP_VARIANT=development), then xcodebuild against the generated workspace for an iphonesimulator destination; install with `xcrun simctl install` and launch with `xcrun simctl launch`. Full command history with evidence: oneday-evidence/MOBILE-LANE-EVIDENCE.md.
- Status: BUILT NOT ACCEPTED. Proven on the iPhone 17 Pro simulator: install, launch, deep-link scheme registration, server reachability. Not proven (needs a human tap, owner pairing token, Clerk publishable key, or hardware): Metro load on device, native pairing, authenticated sign-in, real device, push/deep-link journeys, signed release.
- Rollback: delete the app from the simulator; remove the generated gitignored ios/ directory to return to managed prebuild.
- Note: on Intel hosts the native terminal module is excluded (GhosttyKit ships an arm64-only simulator slice); the designed JavaScript fallback terminal covers it.

## 4. Android

- BLOCKED on this machine: no Android SDK, no JDK, no adb. Nothing was installed. The `android:dev` route (`expo prebuild --clean --platform android` + `expo run:android`) is the documented path once an owner-approved SDK/JDK toolchain exists.

## 5. Windows

- Retained requirement. Cross-packaging from this Mac (`pnpm run dist:desktop:win`) is attempted for artifact purposes only and does NOT prove P02: a real Windows host journey (install, providers, paths, firewall, REA/Craft, update, rollback) remains required and is BLOCKED pending an owned Windows machine.

## 6. ZCode provider adapter

- Delivered as part of the integrated build (packages/provider-zcode, registered in the server driver registry and the web/mobile client registries). Requires the ZCode CLI present (auto-discovers /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs on macOS, override setting available). Live model turns additionally require a model provider configured for the ZCode CLI (owner action; see the release manifest open decisions).
