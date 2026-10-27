# Integration evidence, 2026-10-27 (one-day INVRT Code programme)

Coordinator: ZCode harness, model builtin:zai-coding-plan/GLM-5.3-Flash. Same-harness audits only; cross-harness release acceptance remains owed and is claimed nowhere.

## Integrated branch

- invrt/oneday-integration-20261027, base 6ef29078c74d4cb82f0875d7f161ccdc24b4253c.
- Merges (all clean, no conflicts): 1b5357dc server lane; 7a311560 ZCode adapter; e00fbe53 lockfile condition (6 required importer lines, @pnpm/exe churn excluded, frozen-lockfile validated); 60bbf0d8 mobile lane; 70572442 brand lane; gitignore guardrail commit (userdata/ key material, server-audit F2).
- Lane tips consumed: server 3b5873f18 + 1c0765dc; adapter d161e960 + 4d5968a8 (re-audit PASS); mobile b57cc4a7 + 86b47974 (audit PASS); brand 7327cdefe + d16b042ae + 6c1fed5a53 + 059b56d1 (sweep re-audit PASS).

## Integrated build and headless re-verification

- pnpm install --frozen-lockfile exit 0; churn restored before any commit.
- pnpm exec vp run --filter t3 build exit 0 (2/2); apps/server/dist/bin.mjs + dist/client built; served title: INVRT Code (Beta).
- Headless run on 127.0.0.1:14038 (PID 47700, fresh state dir .integrated-server-state, deleted after evidence): ROOT 200; GET /api/auth/clients 401; GET /api/orchestration/shell 401 (POST 404 = method mismatch, not a route regression; the audited lane used GET); /.well-known/t3/environment 200 with fresh environmentId 740fab9c-13ea-4daa-a86b-88583b9543ce, serverVersion 0.1.2, orchestrationProtocolVersion 2; lsof -a -p 47700 -i showed loopback LISTEN only, zero egress; stopped by exact PID, port verified free.

## Deployable server package (supersedes base-built tarball)

- Built from: audited pruned node_modules staging (server-lane tarball) + integrated apps/server/dist. Externals unchanged by all lanes (additive bundled code only).
- dist-package/INVRT-CODE-SERVER.tar.gz, 63M, sha256 2d143c815c07f17933c99f96d83df75d6e077be14da6c0768a800c01e2dbbe7d (untracked, like the audited original).
- Clean-room verification of the identically-staged content: extracted to fresh temp dir, node 26.12.1, port 14039, fresh state: ROOT 200 with INVRT Code (Beta) title, /api/auth/clients 401, descriptor 200, SIGTERM stop, port free, temp deleted. (First tarball build 8aec7371... had identical staging; gzip timestamps make digests non-deterministic between builds.)

## Desktop packaging

- pnpm run dist:desktop:dmg:x64 launched on the integrated tree (log /tmp/oneday-dmg-build.log); result recorded in the release manifest when complete. Host: Intel x64, macOS 26.7; UNSIGNED local development build.

## Desktop install and launch journey (27 October)

- DMG mounted, identity verified from Info.plist: CFBundleIdentifier com.invrt.code, CFBundleName/DisplayName INVRT Code. Copied to /Applications/INVRT Code.app (retained as the usable local deliverable), quarantine xattr cleared for the unsigned local build, DMG detached.
- Launch with isolated app data: T3CODE_DESKTOP_APP_DATA_DIR=/tmp/oneday-desktop-appdata, auto-update disabled. Main PID 51068 plus gpu/network/renderer helpers running with --user-data-dir=/tmp/oneday-desktop-appdata/t3code-v2 (isolation verified in the live process arguments). Quit by exact PID; all INVRT Code processes verified gone.
- Honest visual capture: a screencapture was taken but the host screen was occupied by fullscreen video and a pending ZCode automation permission dialog; the app window was not visible in the frame. The image was deleted (private screen content, no product evidence value); window-level visual proof is NOT CLAIMED. Launch acceptance rests on the process-tree and isolation evidence above.
- Rollback documented in INVRT-CODE-INSTALL-AND-ROLLBACK.md (trash app + chosen app-data dir).

## Windows cross-package attempt (27 October)

- pnpm run dist:desktop:win FAILED exit 1 at the native resource-monitor cross-compile: rustc E0463, x86_64-pc-windows-msvc target not installed. Installing the Rust cross-target is a global toolchain change deferred to the owner; P02 additionally requires an owned Windows host. Recorded BLOCKED in INVRT-CODE-PLATFORM-EVIDENCE.json; no fake package produced.
