# Server-archive rebuild review, 27 October 2026

LABEL: SAME-HARNESS INTERNAL AUDIT (engineering review, NOT independent external certification).
Reviewer model: ZCode GLM 5.3 Flash (same harness as builder). Audited commit: 551c3cfc8abcb90c130029babf6210161aa879e2 against adopted tip d6191bcd5655b770f2e84d61238022e46aa6c858.

## Skills loaded

production-audit, production-guardrails, ai-native-agent, invrt-concise-code, verification-before-completion, code-review (all six read in full before the first command).

## Verdict

**PASS** (zero blocking findings; three non-blocking observations and one parent-integration item recorded below).

## Findings

### F1 PASS, worktree identity

`git rev-parse HEAD` printed 551c3cfc8abcb90c130029babf6210161aa879e2, branch codex/claude-server-archive-20261027, `git status --porcelain` empty before and after all checks. `git log --oneline -2` prints exactly 551c3cfc8a then d6191bcd56.

### F2 PASS, artifact authenticity

Durable artifact `/Users/mac/Repos/invrt-code-local-pilot/.pilot/oneday-release-2026-10-27/server-archive-candidate/INVRT-CODE-SERVER.tar.gz`:

- `shasum -a 256 -c SHA256SUMS.txt` printed `INVRT-CODE-SERVER.tar.gz: OK`, exit 0.
- Independent `shasum -a 256` printed 562e8052cd4d53046c5241e1a70d8f79be1d523c0c7ddcf3e03f4e7b67dbaae8.
- `stat -f %z` printed 94870610 bytes.

Runbook section 9 and INVRT-CODE-RELEASE-MANIFEST.json `current_server_archive_candidate` both bind the same bytes, sha, tip d6191bcd..., branch and serverVersion 0.1.3. Bindings match the actual file.

### F3 PASS, no pre-existing files overwritten

The new artifact was written into its own `server-archive-candidate/` subdirectory. The pre-existing files were untouched (mtimes 09:21-09:23, new dir 18:31):

- Old interim server tarball at `oneday-release-2026-10-27/INVRT-CODE-SERVER.tar.gz` still present: 66,477,760 bytes, sha256 2d143c815c07f17933c99f96d83df75d6e077be14da6c0768a800c01e2dbbe7d (recomputed in this audit).
- `oneday-release-2026-10-27/release/` holds only the 0.1.2 desktop artifacts (dmg, zip, two blockmaps, builder-debug.yml), none modified.

OBSERVATION O1 (non-blocking, corrects the audit brief, not the builder): the brief located the old server tarball inside `oneday-release-2026-10-27/release/`; it is actually in the `oneday-release-2026-10-27/` parent directory. `release/` never contained a server tarball, so nothing there could be overwritten. Either way the builder overwrote nothing.

### F4 PASS, pipeline faithfulness

Source read: `INVRT-CODE-SERVER-RUNBOOK.md` section 9, `scripts/build-cli-archive.ts` (stageRuntimeExternals at lines 125-219), `scripts/lib/cli-external-packages.ts` (selectCliRuntimeExternalDependencies at lines 50-56), `apps/server/package.json`, `scripts/build-desktop-artifact.ts` (createStageWorkspaceConfig, createStagePatchedDependencies, resolveFffNativeDependencies, STAGE_INSTALL_ARGS), `pnpm-workspace.yaml` catalog.

Source-derived expectation. `selectCliRuntimeExternalDependencies` filters ONLY the declared dependencies of apps/server/package.json through CLI_RUNTIME_EXTERNAL_PREFIXES and CURSOR_RUNTIME_DEPENDENCIES. Declared dependencies that match: `@cursor/sdk` 1.0.38, `@ff-labs/fff-node` 0.11.0, `@napi-rs/keyring` ^1.3.0, `node-pty` ^1.2.0-beta.15, `playwright-core` 1.60.0, `zod` ^4.6.5, `undici` catalog: (resolved 8.11.2). `resolveFffNativeDependencies("mac","x64","0.11.0")` adds `@ff-labs/fff-bin-darwin-x64` 0.11.0. Total: 8 direct roots, exactly the builder's list. `STAGE_INSTALL_ARGS` is `["install","--prod"]`; the stage workspace config carries supportedArchitectures darwin/x64, allowBuilds, patchedDependencies filtered to staged deps (both `@ff-labs/fff-node@0.11.0` and `node-pty@1.2.0-beta.15` match), catalog-resolved overrides, packageExtensions, plus `nodeLinker: hoisted` applied by build-cli-archive.ts.

Missing-entry check (the adversarial question). The prefixes `ffi-rs`, `@yuuang/`, `@clerk/electron-passkeys`, `node-gyp-build`, `node-addon-api`, `bufferutil`, `utf-8-validate` and the non-declared Cursor deps `@connectrpc/connect-node`, `@fastify/busboy` are no-ops at the direct-dependency level: they are bundler-external matchers. Runtime-required transitive packages land through `pnpm install --prod` under the hoisted linker, which is shared code, so the replication produces the same closure. Verified directly in the archive:

| Source-derived expectation                                                             | In archive (tar listing + package.json read)                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @cursor/sdk 1.0.38                                                                     | yes, version 1.0.38                                                                                                                                                                                                                                  |
| @ff-labs/fff-node 0.11.0                                                               | yes, version 0.11.0                                                                                                                                                                                                                                  |
| @ff-labs/fff-bin-darwin-x64 0.11.0                                                     | yes, with libfff_c.dylib                                                                                                                                                                                                                             |
| @napi-rs/keyring ^1.3.0                                                                | yes, plus @napi-rs/keyring-darwin-x64                                                                                                                                                                                                                |
| node-pty ^1.2.0-beta.15                                                                | yes, version 1.2.0-beta.15, prebuilds contain ONLY darwin-x64 (foreign pruned exactly as stageRuntimeExternals specifies)                                                                                                                            |
| playwright-core 1.60.0                                                                 | yes, version 1.60.0                                                                                                                                                                                                                                  |
| zod ^4.6.5                                                                             | yes, version 4.6.7 (lockfile-resolved, per the pin-to-lockfile rule)                                                                                                                                                                                 |
| undici 8.11.2                                                                          | yes, version 8.11.2                                                                                                                                                                                                                                  |
| @cursor/sdk transitive runtime deps                                                    | @bufbuild/protobuf, @connectrpc/connect, @connectrpc/connect-web, @statsig/js-client, @statsig/client-core all present; @cursor/sdk-darwin-x64 present (the platform package the workspace publicHoistPattern comment says the SDK walks up to find) |
| ffi-rs / @yuuang (transitive of @ff-labs/fff-node, whose package.json declares ffi-rs) | ffi-rs and @yuuang/ffi-rs-darwin-x64 present                                                                                                                                                                                                         |
| node-addon-api (bundler prefix)                                                        | present transitively                                                                                                                                                                                                                                 |

Prune safety. The prune list (package.json, workspace yaml, lockfile, patches, node_modules/.pnpm, .modules.yaml, .pnpm-workspace-state-v1.json, .bin, foreign node-pty prebuilds, nested .bin) strips no runtime-required binary; the only platform prune is node-pty foreign prebuilds and the archive confirms only darwin-x64 remains.

Safe absences. `@connectrpc/connect-node` and `@fastify/busboy` are NOT in the archive. Grep of `dist/bin.mjs` found 0 occurrences of `fastify/busboy` and 0 of `connectrpc/connect-node`; `@cursor/sdk`'s package.json does not depend on either. Their absence cannot fail a runtime import.

Archive layout matches the dist-package design: root `README.md`, `dist/` (2,091 entries including `dist/client/index.html`), `node_modules/`.

Judgement on the temp driver. The official `buildCliArchive` command packages the SEA single-executable layout (t3 binary, client/, resource-monitor/), not the dist-package layout (dist/, node_modules/, README.md). Reusing the same `stageRuntimeExternals` helpers through a temp driver was the correct way to reproduce the documented staging without building the SEA artifact the runbook does not ship.

OBSERVATION O2 (non-blocking doc nuance): runbook section 9 does not name `packageExtensions` (STAGE_PACKAGE_EXTENSIONS), which the shared `createStageWorkspaceConfig` includes in the stage workspace. The builder followed the shared code; only the prose list is slightly narrower than the code.

### F5 PASS, clean-room re-verification (this auditor's own run)

- Precheck: port 14197 had no listener (lsof exit 1).
- Fresh extract of the durable archive to a new temp dir: tar exit 0, root files README.md, dist, node_modules.
- Server started with PATH prefix `/Users/mac/Repos/invrt-code-local-pilot/.pilot/toolchain/node-v26.12.1-darwin-x64/bin`, `node dist/bin.mjs --base-dir <fresh-temp> --port 14197 --host 127.0.0.1`, isolated state dir. Migrations ran; `lsof` showed LISTEN on 127.0.0.1:14197 (pid 95720).
- Root `GET /`: HTTP 200, HTML references `/assets/index-DJpS8QtT.js` (same asset hash the builder recorded).
- Descriptor `GET /.well-known/t3/environment`: HTTP 200, fresh environmentId 3307debb-bad9-4d9f-9a93-c87a312dddf9.
- Unauthenticated `GET /api/orchestration/shell`: HTTP 401, body `_tag EnvironmentAuthInvalidError`, `reason:"missing_credential"`.
- Forged Bearer `Authorization: Bearer forged-token-audit-123`: HTTP 401, `reason:"invalid_credential"`.
- SIGTERM: after 5 s `ps -p` exit 1 (process gone); `lsof` exit 1 (port freed).

Scope honestly stated: the restart-persistence leg was NOT rerun here (the builder proved same-environmentId persistence across restart); this run proves the four server checks plus graceful stop on my own extract. Loopback LISTEN observed is not a zero-egress claim; EG01-EGRESS-RETRACTION.md stands and no egress certification is made.

### F6 PASS, docs binding accuracy

- Runbook section 9 binds server version 0.1.3, 94,870,610 bytes, sha 562e8052..., tip d6191bcd5655..., branch codex/claude-server-archive-20261027; describes the two superseded archives (65,009,201 and 66,477,760 bytes) as retained and untouched. `git show` diff confirms ff6a3ef5 and 2d143c81 were REMOVED from the binding text.
- INVRT-CODE-RELEASE-MANIFEST.json parses (`python3 json.load` OK). `current_server_archive_candidate` carries the new path, bytes 94870610, sha 562e8052..., serverVersion 0.1.3, sourceCommit d6191bcd..., sourceTree worktree at d6191bcd.
- Stale-reference rule: the binding sections are clean. One historical mention remains in the manifest `takeover_note` (line 103): it names the prior candidate (source 1a1ab102, 65,009,201 bytes, ff6a3ef5..., preimage 2d143c81...) explicitly AS superseded. That is supersession narrative, not a binding, so it satisfies "no stale references in the BINDING sections".

OBSERVATION O3 (non-blocking): if the parent later wants zero occurrences anywhere in the manifest, the takeover_note sentence could be shortened to bytes-only; current text is accurate.

PARENT-INTEGRATION ITEM (flagged, verified, NOT a finding against the builder): INVRT-CODE-PLATFORM-EVIDENCE.json `current_takeover_candidate` (lines ~90-96) still cites the OLD candidate path `/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-27/ONE-DAY-RELEASE/CODEX-TAKEOVER-CANDIDATE/INVRT-CODE-SERVER.tar.gz` with 65,009,201 bytes, sha ff6a3ef5..., preimage 2d143c81.... That file is outside the builder's stated runbook/manifest/README scope; the parent should fold the new binding into the platform evidence at integration.

### F7 PASS, scope

`git show --stat 551c3cfc` touches exactly three documentation files: INVRT-CODE-RELEASE-MANIFEST.json (39 lines), INVRT-CODE-SERVER-RUNBOOK.md (66 lines), dist-package/README.md (2 lines). `git diff d6191bcd..HEAD --stat` is byte-identical to that, so no product source changed anywhere in the branch's commits since the adopted tip. Worktree clean after all checks; this auditor ran no pnpm, so pnpm-lock.yaml is untouched.

### F8 PASS, ledger and ports

`git log --oneline -2` reads 551c3cfc8a then d6191bcd56. After cleanup: `lsof -nP -iTCP:14195 -iTCP:14196 -iTCP:14197 -sTCP:LISTEN` exit 1 (no listeners on any of the three ports); no builder leftovers found.

## Recommended sequence

Nothing blocking. Parent integration only: fold the new archive binding into INVRT-CODE-PLATFORM-EVIDENCE.json (item F6), and optionally note O1/O2 in the next runbook or handover touch.
