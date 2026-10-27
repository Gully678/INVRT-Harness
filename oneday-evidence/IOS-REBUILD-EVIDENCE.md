# iOS dev-client REBUILD from the integrated tree, ONE-DAY INVRT Code, 27 October 2026

Builder: mobile REBUILD lane, ZCode harness, model builtin:zai-coding-plan/GLM-5.3-Flash (recorded honestly; ZCode does not route models).
Skills loaded (required union): production-guardrails, production-audit, ai-native-agent, invrt-concise-code, react-native-expert.
Worktree: /Users/mac/Repos/.worktrees/invrt-oneday-integration-20261027, branch invrt/oneday-integration-20261027, HEAD at start 8b1d75a5b1ae802fca69ed9d7e8fa2e7de11e168. Prior lane evidence read first: /Users/mac/Repos/.worktrees/invrt-oneday-mobile-20261027/oneday-evidence/MOBILE-LANE-EVIDENCE.md (read-only). The mobile lane worktree was not touched.

Outcome at a glance: the iOS dev-client was REBUILT from the INTEGRATED tree with `** BUILD SUCCEEDED **` exit 0 on the first xcodebuild attempt, installed and launched on the iPhone 17 Pro simulator, and the launch screenshot shows the artifact carrying the INVRT Code identity: header "INVRT Code Dev", "Development Build", INVRT mark as the app icon.

## 1. Identity at launch (the goal)

- Display name at launch: **INVRT Code Dev** (screenshot oneday-evidence/ios-sim-INVRT-launch.png shows the expo dev launcher header "INVRT Code Dev / Development Build" with the INVRT mark icon).
- Bundle id at launch: **com.t3tools.t3code.dev** (deliberate owner-decision exception preserved).
- Built .app Info.plist, printed by PlistBuddy: CFBundleDisplayName "INVRT Code Dev", CFBundleIdentifier com.t3tools.t3code.dev, CFBundleName INVRTCodeDev, CFBundleExecutable INVRTCodeDev, CFBundleShortVersionString 2.1.0.
- Screenshot sha256: a1ae6c25416fe5e7187031f799376f5d7531dfccba1742cf67b3e6b7c5e5fa55 (file oneday-evidence/ios-sim-INVRT-launch.png).

## 2. Graph lookups (Graphify law)

- The integration worktree has no local graphify-out (the graph is rebuilt, never synced); miss recorded per law 13. Read-only query against /Users/mac/Repos/invrt-code-local-pilot/graphify-out/graph.json (56,592 nodes) returned the node apps_mobile_app_config_app_variant; brand/icon symbol hits were server/web browserAppIcon resolvers, not the mobile build path. The build pipeline is config-driven, so the bounded lookup continued in files: apps/mobile/app.config.ts, scripts/lib/brand-assets.ts, apps/mobile/package.json.

## 3. Environment and prerequisites (machine-printed)

- Host Intel x86_64, macOS 26.7 (darwin 25.6.0), Xcode 26.6, CocoaPods via pod inside prebuild.
- Simulator iPhone 17 Pro UDID 6E80DC3B-E855-4FC0-83CE-098FF073ACBD booted (boot exit 0, bootstatus -b exit 0, device listed Booted), shut down at close (shutdown exit 0, device listed Shutdown).
- node_modules/.bin/vp present, so per brief pnpm install --frozen-lockfile was NOT run; result: zero pnpm-lock.yaml churn this lane (git diff on pnpm-lock.yaml empty; git status shows no lockfile modification).
- expo resolved at apps/mobile/node_modules/.bin/expo (pnpm workspace layout; expo not on the root .bin).
- Dev icon source verified before prebuild: repo-root assets/dev/blueprint-ios-1024.png, sips reports 1024x1024 (this is the INVRT-branded replacement of the pre-brand icon the prior lane used).
- The integrated GhosttyKit fix is present in the tree: apps/mobile/package.json expo.autolinking.ios.exclude ["@t3tools/mobile-terminal-native"] (verified by grep). The arm64-only GhosttyKit blocker did not recur.

## 4. Build journey

1. `APP_VARIANT=development EXPO_NO_GIT_STATUS=1 npx expo prebuild --clean --platform ios` from apps/mobile: exit 0 (log PREBUILD-EXIT:0), pod install completed inside. Generated project renamed by the brand sweep: apps/mobile/ios/INVRTCodeDev.xcworkspace / INVRTCodeDev.xcodeproj (was T3CodeDev in the pre-brand tree).
2. `xcodebuild -list -workspace INVRTCodeDev.xcworkspace`: scheme **INVRTCodeDev** (shared scheme INVRTCodeDev.xcscheme); ASSETCATALOG_COMPILER_APPICON_NAME = "app-icon".
3. Actool workaround applied BEFORE the first build (deviation from "hit the crash once", deliberate and recorded): the prior lane machine-verified on this same host that Xcode 26.6 actool crashes when Images.xcassets and app-icon.icon are both inputs, and the generated pbxproj contained both (7 Images.xcassets refs, 4 app-icon.icon lines). Applied the same class of fix with the CURRENT INVRT icon: created INVRTCodeDev/Images.xcassets/app-icon.appiconset/ with Contents.json (single universal 1024 entry) plus icon-1024.png copied from repo-root assets/dev/blueprint-ios-1024.png, and deleted the 4 app-icon.icon lines from INVRTCodeDev.xcodeproj/project.pbxproj (grep count after: 0; plutil -lint: OK). Both changed locations are inside gitignored generated output; nothing committed from them.
4. `xcodebuild -workspace INVRTCodeDev.xcworkspace -scheme INVRTCodeDev -configuration Debug -sdk iphonesimulator -destination 'id=6E80DC3B-E855-4FC0-83CE-098FF073ACBD' -derivedDataPath /tmp/ios-rebuild/dd build`: ** BUILD SUCCEEDED **, XCODEBUILD-EXIT:0 (about 35 minutes on Intel; log contained 62 "error:" strings, all of them Objective-C `error:(NSError **)` parameter text inside warnings, zero BUILD FAILED/fatal lines).

## 5. Install and launch (machine-printed)

- `xcrun simctl install 6E80DC3B-E855-4FC0-83CE-098FF073ACBD .../INVRTCodeDev.app`: install-ok, exit 0. Artifact was 271 MB (device-specific thinning to iPhone18,1 with an id= destination, so the binary is x86_64 only; lipo printed "is architecture: x86_64").
- `xcrun simctl launch 6E80DC3B-E855-4FC0-83CE-098FF073ACBD com.t3tools.t3code.dev` printed "com.t3tools.t3code.dev: 65934", exit 0.
- Fourteen seconds after launch, `xcrun simctl spawn ... launchctl list` showed "65934 0 UIKitApplication:com.t3tools.t3code.dev[341f][rb-legacy]" (still running).
- Screenshot written by `xcrun simctl io 6E80DC3B-E855-4FC0-83CE-098FF073ACBD screenshot` to oneday-evidence/ios-sim-INVRT-launch.png, sha256 above; it renders the launcher with the INVRT identity.

## 6. Resource ledger and cleanup (all items lane-owned, removed or retained with proof)

- Simulator boot: shut down, listed Shutdown after `xcrun simctl shutdown` exit 0; app terminated first (terminate exit 0).
- /tmp/ios-rebuild (prebuild log, xcodebuild log, DerivedData 6.2 GB incl. the .app): deleted; path no longer exists (ls: No such file or directory). The .app is reproducible from the recorded commands; its identity evidence is section 1 and the screenshot.
- pnpm-lock.yaml: untouched (no churn to restore; no install ran).
- Worktree delta from this lane: ONLY the two new oneday-evidence files (this document, IOS-REBUILD-EVIDENCE.json) and ios-sim-INVRT-launch.png, committed by explicit path. Foreign pre-existing items (modified oneday-evidence/INTEGRATION-EVIDENCE.md, untracked .integrated-server-state/, dist-package/) were present at start and left untouched.
- Generated gitignored apps/mobile/ios tree remains (regenerated by prebuild --clean; the appiconset substitution inside it is regenerated away by any future prebuild --clean and must be re-applied per section 4 until an upstream actool fix).

## 7. Proven versus not done (honest status)

PROVEN: build from the INTEGRATED tree succeeds with INVRT identity baked into the artifact (display name, icon); install, launch and sustained process on iPhone 17 Pro (iOS 26.5); launch screenshot digest recorded; bundle id com.t3tools.t3code.dev preserved.

NOT DONE (unchanged from the prior lane, with the same missing dependencies): Metro JS bundle load in-app (needs the one OS confirmation tap no harness here can perform); in-app pairing with the local server (needs that tap plus a genuine one-time pairing token owned by Mark); Clerk sign-in (no credentials in this tree); real-device build/install (needs signing identity); push and full deep-link journey; signed release Archive; Android (no SDK/JDK/adb on this machine, installation needs owner authorisation).

## 8. Deviations and follow-ups

- Actool workaround applied proactively instead of after a first crash: prior lane's diagnosis was machine-verified on this same host and Xcode version, and the brief is time-boxed; consequence is that this lane did not independently re-trigger the crash. Smallest durable next action remains an Expo config plugin performing the same substitution on x86_64 hosts, or an Xcode/actool update.
- Commit sha for this evidence: see IOS-REBUILD-EVIDENCE.json "commit" field and the git log of branch invrt/oneday-integration-20261027. Nothing pushed.
