# Server Lane Evidence, one-day INVRT Code

Builder: ZCode harness, model `builtin:zai-coding-plan/GLM-5.3-Flash`. Skills loaded:
production-guardrails, production-audit, ai-native-agent, invrt-concise-code. An audit of
this work from the same harness must be labelled same-harness; it is not cross-harness
acceptance under the Different-Model Law.

Date: 27 October 2026. Worktree: `/Users/mac/Repos/.worktrees/invrt-oneday-server-20261027`
on branch `invrt/oneday-server-20261027`, base commit `6ef29078c74d4cb82f0875d7f161ccdc24b4253c`.
Runtime: node v26.12.1 (`/Users/mac/Repos/invrt-code-local-pilot/.pilot/toolchain/node-v26.12.1-darwin-x64/bin/node`,
read-only shared infrastructure), macOS 26.7 (darwin x64).

## Graph lookups (law 13)

- `/Library/Frameworks/Python.framework/Versions/3.11/bin/graphify explain "bin" --graph
  /Users/mac/Repos/invrt-code-local-pilot/graphify-out/graph.json`: FAILED, "graph file not
  found" (graphify-out contains only `cache`; no graph.json in the pilot checkout or the
  worktree). Miss recorded; fell back to the smallest bounded reads: `apps/server/src/bin.ts`,
  `binCli.ts`, `cli/config.ts`, `cli/server.ts`, `startupAccess.ts`, `config.ts`
  (resolveStaticDir, deriveServerPaths), `packages/contracts/src/environmentHttp.ts`,
  `scripts/lib/cli-external-packages.ts`, `scripts/build-cli-archive.ts`.

## Headless CLI surface (read before running)

- Entry `apps/server/src/bin.ts` dispatches fast paths, then `binCli.ts` (`t3` CLI, effect-cli).
- Default command = run server (`runDefaultServerCommand`, rejects a second server over the
  same `--base-dir`). `t3 serve` = headless presentation: forces no-browser, forces
  `autoBootstrapProjectFromCwd=false`, prints headless pairing block.
- Flags (cli/config.ts): `--mode`, `--port`, `--host`, `--base-dir`, `--dev-url`,
  `--no-browser`, `--bootstrap-fd`, `--auto-bootstrap-project-from-cwd`,
  `--log-websocket-events`/`--log-ws-events`, `--tailscale-serve`, `--tailscale-serve-port`,
  positional cwd. Env mirrors listed in INVRT-CODE-SERVER-RUNBOOK.md section 3.
- First-run auth: server issues a startup pairing credential and logs
  "Authentication required. Open T3 Code using the pairing URL." The token is a secret;
  all captured logs are redacted (see below). Auth cannot be disabled.

## 1. Install

Command: `pnpm install --frozen-lockfile` in the worktree. Exit 0
("Done in 1m 15.8s using pnpm v12.14.0"; pnpm 11.17.0 self-managed to the pinned 12.14.0).
Finding: each pnpm invocation appended a `@pnpm/exe` packageManagerDependencies block to
`pnpm-lock.yaml`. Restored with `git restore pnpm-lock.yaml` every time; never committed.

## 2. Build

Command: `pnpm exec vp run --filter t3 build`. Exit 0, "vp run: 2/2 successful"
(web build then `node scripts/cli.ts build` = tsdown bundle + web client copy).
Evidence printed by the machine:

- `apps/web/dist/`: index.html, assets/, favicon, manifest (listed).
- `apps/server/dist/`: bin.mjs, bundled modules; `apps/server/dist/client/` populated
  (index.html + assets; build log line "Bundled web app into dist/client"). 209M total.

## 3. Headless run (port 14036, state inside the worktree)

- Port check: `lsof -nP -iTCP:14036 -sTCP:LISTEN` empty (free).
- Command run 1 (PID 81019): `node apps/server/dist/bin.mjs --base-dir
  /Users/mac/Repos/.worktrees/invrt-oneday-server-20261027/.headless-server-state --host
  127.0.0.1 --port 14036 --no-browser .`
- Log: 69 migrations applied; "Listening on http://127.0.0.1:14036"; "Authentication
  required. Open T3 Code using the pairing URL." (pairingUrl redacted in evidence logs).
- Listener: `lsof` shows `TCP 127.0.0.1:14036 (LISTEN)` for PID 81019 only.
- `.headless-server-state/process.json` records exact PID, command and both runs.

## 4. HTTP verification (run 1)

| Request                                      | Status | Body evidence                                                                                                    |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| GET /                                        | 200    | HTML doctype, references `/assets/index-D9bF5v4J.js`                                                             |
| GET /assets/index-D9bF5v4J.js                | 200    | built web asset served from dist/client                                                                          |
| GET /.well-known/t3/environment              | 200    | descriptor JSON, environmentId cda61fbc-bb8d-40cb-802d-e41c8d14a9e2, serverVersion 0.1.2                         |
| GET /api/auth/session (no credential)        | 200    | `{"authenticated":false,"auth":{"policy":"loopback-browser",...}}` (auth-state probe by design, returns no data) |
| GET /api/orchestration/shell (no credential) | 401    | `{"_tag":"EnvironmentAuthInvalidError","code":"auth_invalid","reason":"missing_credential",...}`                 |
| GET /api/auth/clients (no credential)        | 401    | same EnvironmentAuthInvalidError shape                                                                           |

Negative tests prove auth is enforced and fail closed. No auth path was weakened.

## 5. Restart persistence

- Stop run 1: `kill 81019` (SIGTERM), waited, `ps -p 81019` gone (exit 1), port released.
  State before stop recorded: `userdata/statev2.sqlite` sha256
  `7752827a20be9384dda4d93c5a4eae3c49e773cdff43a679ab219d6309536a45`.
- Run 2 (PID 83075), same command and same `--base-dir`: healthy, root 200, descriptor 200
  with the SAME environmentId, and zero migrations re-run ("Migrations ran successfully"
  count in run 2 log: 0), proving durable state survived the restart. Unauthenticated
  negative test still 401. Stop run 2 by PID: gone, port released.

## 6. Egress / telemetry check

`lsof -nP -a -p 83075 -i -o` while run 2 served traffic: zero established connections,
only the 127.0.0.1:14036 listener. No non-loopback connections observed. No network config
was changed.

## 7. Deployable package and clean-room test

- First attempt with `apps/server/dist` + README only FAILED clean-room: `Cannot find
  module '@cursor/sdk'` from dist/binCli-*.mjs (the bundle keeps runtime externals external
  by design). Recorded as a finding, not worked around by weakening anything.
- Fixed by replicating the repo's own archive staging (scripts/build-cli-archive.ts
  stageRuntimeExternals): stage `package.json` (t3-runtime) with the external dependencies
  pinned to lockfile-resolved versions (@cursor/sdk 1.0.35, @ff-labs/fff-node 0.11.0 plus
  fff-bin-darwin-x64 0.11.0, @napi-rs/keyring 1.3.0, node-pty 1.2.0-beta.15 with its
  workspace patch, playwright-core 1.60.0, undici 8.11.2), `pnpm-workspace.yaml` with
  supportedArchitectures darwin/x64, allowBuilds node-pty, both matching
  patchedDependencies, nodeLinker hoisted; `pnpm install --prod` (exit 0); pruned
  .pnpm/.bin/patch inputs and non-darwin-x64 prebuilds; added dist/ + README.md.
- Artifact: `dist-package/INVRT-CODE-SERVER.tar.gz`, 64M, sha256
  `0a57faf6b2c21afb455836f89dea081a072620ffa70738be4cd275ad413e94f1` (1611 entries in the
  first dist-only draft were replaced; final archive has dist + node_modules + README).
- Clean-room test PASSED: extracted to a fresh /tmp dir, `node dist/bin.mjs --base-dir
  <tmp>/state --host 127.0.0.1 --port 14041 --no-browser .`, PID 95904: root 200 with the
  built asset, descriptor 200 (fresh environmentId a246b301-1de6-4b11-8578-b3d1ee9b9d41),
  unauthenticated data route 401. Stopped by SIGTERM (gone, port 14041 released), temp dir
  deleted and confirmed gone.
- Package README: `dist-package/README.md`, sha256
  `e5a0fd111eaeb3d2122e7071530021939e48ac71d5ce0e1c749ae72d6820ddd1`.

## 8. Scoped regression

`pnpm exec vp run --filter t3 typecheck`: exit 0. Output shows pre-existing suggestion-level
notes (TS377019 in src/ws.ts, effect lint suggestions), no errors. No server source was
changed in this lane, so no test was added or altered; the baseline 52/52 focused suite
fact stands untouched on the base tip.

## 9. Findings for the orchestrator

1. Raw `apps/server/dist` is not self-contained (external runtime deps by design). Any
   deploy story must ship the staged externals, as the official CLI archive does. The
   package in this lane does that.
2. pnpm's self-managed pinned version rewrites `pnpm-lock.yaml` on every invocation
   (`@pnpm/exe` packageManagerDependencies). Restore after installs; never commit.
3. The pilot checkout has no `graphify-out/graph.json`; graphify lookups miss until a graph
   is built there. Recorded per law 13.
4. Startup WARN "Claude Agent CLI health check failed (PlatformError)" in this headless
   environment: provider CLIs are not configured; HTTP server unaffected.
5. The server state dir holds real key material under `userdata/secrets/` (cloud-link
   keypair, MCP OAuth signing key, request salt) and is not gitignored. It was never
   committed; it is deleted after evidence preservation (digests and redacted logs kept).
6. The 64M tarball is left untracked in `dist-package/` with its digest recorded here;
   committing a 64MB binary would bloat the branch. Rebuild procedure is documented in
   INVRT-CODE-SERVER-RUNBOOK.md section 9.

## Artifact digests (sha256)

- `dist-package/INVRT-CODE-SERVER.tar.gz`: 0a57faf6b2c21afb455836f89dea081a072620ffa70738be4cd275ad413e94f1
- `dist-package/README.md`: e5a0fd111eaeb3d2122e7071530021939e48ac71d5ce0e1c749ae72d6820ddd1
- `INVRT-CODE-SERVER-RUNBOOK.md`: 8e2ca08daa10646e9305f037b1cc673904b24a38dcaadddaa9b6b7a38d014842
- `oneday-evidence/server-run1-redacted.txt`: 679d6be61634a4f703064450c0b6cdb83ce9af4f4e828bbca1e820d3708d9c51
- `oneday-evidence/server-run2-redacted.txt`: bf403956cbec306d10b466219654409d7a2f14dedb7088a558c52f496a36c23a
- `oneday-evidence/invrt-server-lane-install.txt`: ed1ee5131b13eded33b2d07dd37d978326979135a6315a6e9397c48069891aa4
- `oneday-evidence/invrt-server-lane-build.txt`: 43a22981a5c6c013d93144b53a4b80d9b2dda92b81c6aa81e73752285798c73d
- `oneday-evidence/invrt-server-lane-typecheck.txt`: 3d8757941f222682532b99cc1bf87a7d020ebff5be10b009407cb486f6a287d7

## Resource ledger (law 6)

| Resource                                                 | Type                | Disposition                                                                 |
| -------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------- |
| pnpm install/build/typecheck background jobs             | processes           | completed, reaped                                                           |
| server run 1 (PID 81019)                                 | process             | SIGTERM, verified gone                                                      |
| server run 2 (PID 83075)                                 | process             | SIGTERM, verified gone                                                      |
| package test server (PID 95904, port 14041)              | process             | SIGTERM, verified gone                                                      |
| /tmp/invrt-pkg-test-* dirs                               | temp dirs           | deleted, confirmed gone                                                     |
| /tmp/invrt-server-pkg-stage                              | staging dir         | deleted after tar build                                                     |
| .headless-server-state (2.0M, contains userdata/secrets) | server state dir    | evidence preserved (redacted logs + digests), then deleted; never committed |
| dist-package/INVRT-CODE-SERVER.tar.gz                    | durable deliverable | retained untracked in worktree, digest recorded                             |
