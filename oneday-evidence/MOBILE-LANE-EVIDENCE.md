# Mobile lane evidence, ONE-DAY INVRT Code, 27 October 2026

Builder: Builder D (mobile lane), ZCode harness, model builtin:zai-coding-plan/GLM-5.3-Flash.
Skills loaded: production-guardrails, production-audit, ai-native-agent, invrt-concise-code, react-native-expert, invrt-ui-quality.
Worktree: /Users/mac/Repos/.worktrees/invrt-oneday-mobile-20261027, branch invrt/oneday-mobile-20261027, base 6ef29078c74d4cb82f0875d7f161ccdc24b4253c (clean at start, verified with git status and git log).
Outcome at a glance: native iOS dev-client BUILT, INSTALLED and LAUNCHED on the iPhone 17 Pro simulator; simulator reached the headless server and rendered its pairing page in Safari. In-app authenticated pairing, real device, push/deep-link journey completion, signed release and Android are NOT DONE with the exact reasons below.

## 1. Environment (verified by command, not assumed)

- Host: Intel x86_64, macOS 26.7 (darwin 25.6.0). Xcode 26.6 (17F113), iOS SDK iPhoneSimulator26.5. CocoaPods 1.17.0 at /usr/local/bin/pod.
- Simulator: iPhone 17 Pro, UDID 6E80DC3B-E855-4FC0-83CE-098FF073ACBD, iOS 26.5 (26.5 - 23F77). Booted with `xcrun simctl boot 6E80DC3B-E855-4FC0-83CE-098FF073ACBD` (exit 0), `xcrun simctl bootstatus -b` exit 0, device showed Booted. Shut down at close.
- Toolchain PATH per brief: worktree node_modules/.bin plus /Users/mac/Repos/invrt-code-local-pilot/.pilot/toolchain/node-v26.12.1-darwin-x64/bin. No global changes.
- `pnpm install --frozen-lockfile` exit 0 in 2m 12.7s (1733 packages, reused 1729). It modified pnpm-lock.yaml (+25 lines); restored with `git checkout -- pnpm-lock.yaml` per brief; final tree contains no lockfile churn.

## 2. Graph lookups (Graphify law)

- Read-only query against /Users/mac/Repos/invrt-code-local-pilot/graphify-out/graph.json (56,592 nodes): mobile symbols found include NativeComposerEditorProps, NativeComposerEditorRef, createWorkspaceStackNavigator iOS route types, V5StackHeader menu inputs under apps_mobile_src_native_* and apps_mobile_src_features_layout_*. The graph indexes TS source symbols; the build pipeline itself is config-driven, so the build path was confirmed from files: apps/mobile/app.config.ts, apps/mobile/package.json, scripts/mobile-native-client.ts (dev-client fingerprint/ensure helpers, Effect CLI style, not used directly because the explicit prebuild plus xcodebuild route was chosen for artefact control).

## 3. App identity (development variant)

- app.config.ts VARIANT_CONFIG.development: appName "T3 Code Dev", scheme t3code-dev, iOS bundle id com.t3tools.t3code.dev.
- Built .app Info.plist confirmed: CFBundleIdentifier com.t3tools.t3code.dev, CFBundleShortVersionString 2.1.0, CFBundleExecutable T3CodeDev.
- Xcode workspace: apps/mobile/ios/T3CodeDev.xcworkspace, scheme T3CodeDev (verified with xcodebuild -list).
- Product binary is a fat simulator binary: x86_64 and arm64 (lipo -info printed).

## 4. Build journey (four xcodebuild attempts, exact failures and fixes)

1. Attempt 1 (destination id=6E80DC3B..., 35 minutes): FAILED exit 65. Exact error: apps/mobile/modules/t3-terminal/ios/T3TerminalView.swift:3:8 error: unable to resolve module dependency: 'GhosttyKit'. Failing target T3TerminalNative from Pods.
   - Root cause (verified): Vendor/libghostty/GhosttyKit.xcframework exists (47 MB) but its ios-arm64-simulator/libghostty-fat.a is arm64 only (lipo -info printed "is architecture: arm64"). No x86_64 simulator slice exists anywhere in the repository. CocoaPods therefore stages no GhosttyKit module for the x86_64 simulator destination on this Intel host.
2. Attempt 2 (after fix A): FAILED exit 65 in CompileAssetCatalogVariant thinned for target T3CodeDev. Exact error: "Exception while running actool: *** -[__NSPlaceholderArray initWithObjects:count:]: attempt to insert nil object from objects[0]".
   - Diagnosis (verified by manual actool runs): Images.xcassets alone and app-icon.icon alone each compile fine with the same thinning flags; the crash occurs only when actool receives both inputs together. Xcode 26.6 actool bug on this host.
   - Fix A (source change, committed): the JS layer already degrades by design when the native surface is absent. src/features/terminal/nativeTerminalModule.ts resolveNativeTerminalSurfaceView() returns null when the view config is missing, and src/features/terminal/NativeTerminalSurface.tsx renders FallbackTerminalSurface. So @t3tools/mobile-terminal-native was excluded from iOS autolinking via the supported expo.autolinking.ios.exclude key in apps/mobile/package.json (verified against expo-modules-autolinking build/commands/autolinkingOptions.js, which reads packageJson.expo.autolinking[platform].exclude). pod install re-run exit 0; Pods.xcodeproj/project.pbxproj now contains zero T3Terminal references (grep -c printed 0).
   - Consequence recorded: on an Apple Silicon Mac, or once an x86_64 simulator slice of GhosttyKit is built, this exclusion should be removed so the native terminal links again. Smallest next action: run apps/mobile/modules/t3-terminal/scripts/build-libghostty-ios16.sh on an arm64 Mac, or add x86_64-simulator to the vendored xcframework, then delete the ios.exclude block.
3. Attempt 3 (destination generic/platform=iOS Simulator, to avoid device-specific thinning): FAILED exit 65, same actool thinned-variant crash. So the destination change alone did not help.
4. Attempt 4 (after fix B): ** BUILD SUCCEEDED **, xcodebuild4-exit:0.
   - Fix B (local, generated-and-gitignored files only, no commit): created apps/mobile/ios/T3CodeDev/Images.xcassets/app-icon.appiconset/ with a single-size 1024 PNG copied from repo asset assets/dev/blueprint-ios-1024.png (1024x1024 verified with sips), and removed the four app-icon.icon references from apps/mobile/ios/T3CodeDev.xcodeproj/project.pbxproj so actool receives one input. ASSETCATALOG_COMPILER_APPICON_NAME = "app-icon" still resolves (to the appiconset). apps/mobile/ios is gitignored ("generated native folders"), so this workaround is not committed and does not affect other builds. Smallest next action for a durable fix: an Expo config plugin that does the same substitution for x86_64 hosts, or an Xcode/actool update.

Exact build command for the successful attempt:
`xcodebuild -workspace T3CodeDev.xcworkspace -scheme T3CodeDev -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/oneday-mobile-dd build`

Artefact verified before install: /tmp/oneday-mobile-dd/Build/Products/Debug-iphonesimulator/T3CodeDev.app (542 MB), Info.plist fields printed above.

## 5. Install and launch on the simulator (machine-printed proof)

- `xcrun simctl install 6E80DC3B-E855-4FC0-83CE-098FF073ACBD /tmp/oneday-mobile-dd/Build/Products/Debug-iphonesimulator/T3CodeDev.app` printed install-ok (exit 0).
- `xcrun simctl launch 6E80DC3B-E855-4FC0-83CE-098FF073ACBD com.t3tools.t3code.dev` printed "com.t3tools.t3code.dev: 7316" (exit 0).
- `xcrun simctl spawn ... launchctl list` showed UIKitApplication:com.t3tools.t3code.dev running with PID 7316 twelve seconds after launch.
- Screenshot oneday-evidence/ios-sim-launch.png shows the expo dev launcher rendering correctly: "T3 Code Dev, Development Build", DEVELOPMENT SERVERS list searching, "Enter URL manually", Home/Updates/Settings tabs, and the T3 app icon. sha256 47abc95c7f19dcc5d4a40a9660d500f64ee547f6eba8ac37478e9adc98b95ba4.

## 6. Metro bundle load on device: BLOCKED by a one-tap OS confirmation

- Metro started: `APP_VARIANT=development npx expo start --dev-client --scheme t3code-dev --localhost --port 8081` reached "Waiting on http://localhost:8081" (node listening on 127.0.0.1:8081, verified with lsof).
- `xcrun simctl openurl ... "t3code-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"` exited 0 and iOS presented the system confirmation "Open in "T3 Code Dev"?" (screenshot oneday-evidence/ios-sim-devlink-dialog.png, sha256 b60ba43965fea620e6c658c99ebf97f7d38c467787e3441766e2e2ebfce36962). This proves the custom scheme is registered by the installed app and the deep link reaches the OS.
- The single tap on "Open" could not be performed: no cliclick on PATH, AppleScript System Events times out (no accessibility permission for this process), simctl has no tap/keyboard event API, and cold-start openurl still asks on this iOS version. Metro's log never showed a bundle GET, so the JS bundle was not loaded on-device. Recorded honestly as owed, with the tap as the only missing step.

## 7. Server pairing story (loopback, own state dir)

- Server started from the server lane's build: `node /Users/mac/Repos/.worktrees/invrt-oneday-server-20261027/apps/server/dist/bin.mjs --base-dir .mobile-test-server-state --host 127.0.0.1 --port 14037 --no-browser` (execute only; nothing written into the server worktree). PID 20793 printed. State dir lived inside MY worktree and was deleted after evidence.
- The server printed an authentication-required pairing URL on loopback. The URL contains a one-time secret token; per the secrets law the token value is not copied into any file, log or screenshot in this lane.
- Host loopback check: `curl http://127.0.0.1:14037/` returned HTTP 200 with the app HTML shell; lsof confirmed node listening on 127.0.0.1:14037.
- On-device browser evidence: `xcrun simctl openurl 6E80DC3B-E855-4FC0-83CE-098FF073ACBD "http://127.0.0.1:14037/"` exit 0; Safari in the simulator rendered the server's auth-gated page: "T3 CODE (BETA) - Pair with this environment - Enter a pairing token to start a session with this environment" with a pairing-token field, Continue and Reload app controls. Screenshot oneday-evidence/ios-sim-safari-server.png, sha256 e86f68f9d79daf7a144f58528794250c9ae9829f3b565c23649da9f25ec80f6b. This proves simulator-to-server reachability over host loopback and that the server enforces its pairing gate before any session.
- What is owed for a full native pairing: the dev-client tap from section 6, then a valid one-time pairing token (Mark's; none may be invented or copied), and cloud sign-in additionally needs Clerk credentials that are absent in this worktree (only .env.example exists, so EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY was null in this build; no .env was read or created).

## 8. Cleanup proof (resource ledger)

- Server stopped by exact PID 20793: ps confirmed stopped; port 14037 now has zero listeners (lsof count 0).
- Metro stopped by exact listening PID 7608: port 8081 now has zero listeners.
- .mobile-test-server-state deleted from this worktree.
- /tmp scratch removed: actool test dirs, curl body, three interim screenshots. Remaining /tmp items owned by this lane: oneday-mobile-* logs and /tmp/oneday-mobile-dd (DerivedData) are temporary and safe to delete after this evidence is reviewed; the .app artefact path is recorded above.
- Simulator shut down: `xcrun simctl shutdown 6E80DC3B-E855-4FC0-83CE-098FF073ACBD` exit 0.
- Generated apps/mobile/ios tree remains in the worktree (gitignored, regenerated by prebuild) and node_modules is installed for future builders.

## 9. Proven versus not done (honest status)

PROVEN (machine-printed or screenshot evidence above):

- Native iOS dev-client build from this repository on this Intel host (BUILD SUCCEEDED exit 0, fat x86_64+arm64 simulator binary).
- Install and launch on iPhone 17 Pro (iOS 26.5) simulator; expo dev launcher UI renders with correct INVRT Code development identity.
- Simulator reaches the headless server over host loopback and renders its auth-gated pairing page in Safari.
- Custom scheme t3code-dev is registered and deep links reach the OS confirmation.

NOT DONE with exact missing dependencies:

- Metro JS bundle load on device: one tap on the iOS "Open in T3 Code Dev?" confirmation; no tap automation available in this harness. A human tap (or accessibility permission granted to a scripted UI tool) completes it while Metro runs on 127.0.0.1:8081.
- In-app native pairing with the local server: requires the tap above plus a genuine one-time pairing token owned by Mark.
- Authenticated sign-in: requires Clerk credentials (no .env in this worktree; nothing copied or invented).
- Real-device build and install: requires an Apple developer identity and a cable/registered device; explicitly out of scope here (no signing identities created).
- Push notifications and full deep-link journey: requires the Metro load plus credentials; not exercised.
- Signed release build (Archive): requires distribution certificate and provisioning profile; not attempted.
- Android: BLOCKED. No Android SDK, no JDK and no adb exist anywhere on this machine (verified by the orchestrator and consistent with this lane's PATH checks). Installing them needs owner authorisation; nothing was installed.

## 10. Commits

- Branch invrt/oneday-mobile-20261027, base 6ef29078c74d4cb82f0875d7f161ccdc24b4253c.
- This lane's commit contains exactly: apps/mobile/package.json (the supported expo.autolinking.ios.exclude for the x86_64 simulator gap, with the removal condition recorded in section 4) and the oneday-evidence/ files. Nothing else; no lockfile churn; nothing pushed.
