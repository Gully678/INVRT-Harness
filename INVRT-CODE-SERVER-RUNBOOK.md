# INVRT Code Server Runbook

Owner: INVRT (Mark Gullickson). Lane: one-day INVRT Code programme, server lane.
Last verified: 27 October 2026, ZCode (GLM 5.3 Flash), server-archive lane: rebuilt the
deployable package from adopted tip d6191bcd and ran a clean-room package test on
127.0.0.1:14196 (runs 1 and 2 on the same state dir), after the earlier headless run on
127.0.0.1:14036.

## 1. Runtime and versions

- Node.js v26.12.1 (the only runtime the build was verified with; the binary under
  `/Users/mac/Repos/invrt-code-local-pilot/.pilot/toolchain/node-v26.12.1-darwin-x64/bin/node`).
- macOS 26.7 (darwin x64) at verification time. The server is plain Node, so any OS with
  Node 26.12.1 should behave the same; re-run the health check after an OS change.
- Server version: 0.1.3 (from `apps/server/package.json`, printed in the environment descriptor).
- pnpm 12.14.0 for the build (the repo pins it via `packageManager`; do not install globally).

## 2. Build

From the repository root (or an owned worktree):

```sh
export PATH="<node-v26.12.1-bin>:$PATH"
pnpm install --frozen-lockfile
pnpm exec vp run --filter t3 build
```

What this produces, verified 27 October 2026:

- `apps/web/dist/` (built web client; `index.html` plus hashed `assets/`).
- `apps/server/dist/bin.mjs` and bundled modules.
- `apps/server/dist/client/` (the web client copied into the server bundle; the build task
  depends on `@t3tools/web#build` and then copies it, log line: "Bundled web app into dist/client").

Note: system pnpm 11.17.0 self-manages to the pinned 12.14.0 and appends a `@pnpm/exe`
packageManagerDependencies block to `pnpm-lock.yaml`. Restore it after install
(`git restore pnpm-lock.yaml`); never commit that churn.

## 3. Run (headless)

Choose a free loopback port (example below uses 14036):

```sh
lsof -nP -iTCP:14036 -sTCP:LISTEN   # empty output means free
node apps/server/dist/bin.mjs \
  --base-dir <STATE_DIR> \
  --host 127.0.0.1 \
  --port 14036 \
  --no-browser .
```

- The trailing `.` is the working-directory argument (provider session cwd). Omit it to use
  the current directory.
- `t3 serve` (same flags) is the strictly headless variant: no browser, forced
  `auto-bootstrap-project-from-cwd=false`, and it prints the headless pairing block.
- On first start the log prints: "Authentication required. Open INVRT Code using the
  pairing URL." with `http://127.0.0.1:14036/pair#token=<one-time-token>`. The token is a secret:
  redact it in any shared log, never copy it into code or docs.
- A second server over the same `--base-dir` is refused ("A INVRT Code server is already
  running for <base-dir>"), enforced by the persisted runtime state plus a process-liveness
  preflight. This is intentional; use a different `--base-dir` for a second instance.

### CLI flags (from `apps/server/src/cli/config.ts`, all optional)

`--mode` (desktop|web), `--port`, `--host`, `--base-dir`, `--dev-url`, `--no-browser`,
`--bootstrap-fd`, `--auto-bootstrap-project-from-cwd`, `--log-websocket-events` (alias
`--log-ws-events`), `--tailscale-serve`, `--tailscale-serve-port`, and the optional
positional `cwd`. Precedence is flag, then environment variable, then bootstrap envelope.

### Environment variables actually read (same file)

`T3CODE_MODE`, `T3CODE_PORT`, `T3CODE_HOST`, `T3CODE_HOME` (data dir, same as `--base-dir`),
`T3CODE_NO_BROWSER`, `T3CODE_BOOTSTRAP_FD`, `T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD`,
`T3CODE_LOG_WS_EVENTS`, `T3CODE_TAILSCALE_SERVE`, `T3CODE_TAILSCALE_SERVE_PORT`,
`T3CODE_DEV_ALLOWED_ORIGINS`, `VITE_DEV_SERVER_URL` (dev proxy only),
`T3CODE_DEV_AUTH_TOKEN` (web mode with `--dev-url` only; must be at least 32 characters),
`T3CODE_LOG_LEVEL` (default Info), and the trace/OTLP set: `T3CODE_TRACE_FILE`,
`T3CODE_TRACE_MIN_LEVEL`, `T3CODE_TRACE_TIMING_ENABLED`, `T3CODE_TRACE_MAX_BYTES`,
`T3CODE_TRACE_MAX_FILES`, `T3CODE_TRACE_BATCH_WINDOW_MS`, `T3CODE_OTLP_TRACES_URL`,
`T3CODE_OTLP_METRICS_URL`, `T3CODE_OTLP_LOGS_URL`, `T3CODE_OTLP_HEADERS`,
`T3CODE_OTLP_PROTOCOL` (default http/json), `T3CODE_OTLP_EXPORT_INTERVAL_MS`. Native
OpenTelemetry variables (`OTEL_EXPORTER_OTLP_*`) are also honoured by the OTel loader.

Never put secret values in code, commits, logs or this document; reference secret files by
path only.

## 4. State and data locations

With an explicit `--base-dir`, all state is under `<base-dir>/userdata` (from
`deriveServerPaths` in `apps/server/src/config.ts`):

| Path                                                    | Contents                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `userdata/statev2.sqlite` (+`-wal`, `-shm`)             | Orchestration state: threads, projections, checkpoints. The durability anchor. |
| `userdata/secrets/`                                     | Server-owned secrets. Never copy, print or back up outside approved storage.   |
| `userdata/logs/`                                        | `server.trace.ndjson`, provider logs, terminal logs.                           |
| `userdata/attachments/`                                 | Uploaded attachments.                                                          |
| `userdata/browser-artifacts/`                           | Browser session artifacts.                                                     |
| `userdata/environment-id`, `anonymous-id`               | Stable instance identities (survive restarts; verified).                       |
| `userdata/server-runtime.json`                          | Last-run pid/port record (ownership preflight).                                |
| `userdata/settings.json`, `keybindings.json`, `themes/` | Server and UI settings.                                                        |
| `<base-dir>/caches/`                                    | Provider status caches. Safe to delete while stopped.                          |

## 5. Health check

```sh
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:14036/                       # expect 200
curl -sS http://127.0.0.1:14036/.well-known/t3/environment                              # expect descriptor JSON
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:14036/api/orchestration/shell # expect 401 unauthenticated
```

Verified 27 October 2026 on the rebuilt archive: root 200 with HTML referencing
`/assets/index-DJpS8QtT.js`; descriptor 200; unauthenticated data routes 401
`EnvironmentAuthInvalidError` (`reason:"missing_credential"`) and a forged Bearer header
401 (`reason:"invalid_credential"`). `/api/auth/session` returns 200 with
`authenticated:false` by design (it is the auth-state probe, not a data route).

## 6. Graceful shutdown

```sh
kill <pid>          # SIGTERM
sleep 4
ps -p <pid> > /dev/null 2>&1; echo $?    # expect 1 (gone)
lsof -nP -iTCP:14036 -sTCP:LISTEN        # expect empty (port released)
```

SIGTERM is clean: the server releases its ownership lock and flushes SQLite. Verified across
two runs on 27 October 2026. Use SIGKILL only if SIGTERM was ignored. Do not delete the
`statev2.sqlite-shm` and `-wal` files manually; leave them in place for SQLite to recover
automatically on next start.

## 7. Backup and restore of the state dir

Backup (server stopped, so the WAL is checkpointed):

```sh
tar -czf invrt-code-state-$(date +%Y%m%d-%H%M%S).tar.gz -C <base-dir> userdata
```

Restore:

1. Stop the server (section 6) and confirm the port is free.
2. Move the damaged state aside: `mv <base-dir>/userdata <base-dir>/userdata.broken.$(date +%s)`.
3. Extract: `tar -xzf invrt-code-state-<stamp>.tar.gz -C <base-dir>`.
4. Start again with the same `--base-dir` and run the section 5 health checks.

Do not back up a running state dir: `statev2.sqlite-wal` may be mid-flight. If you must,
run `sqlite3 statev2.sqlite ".backup '<target>'"` on the live database instead.

## 8. Rollback

To roll a deploy back:

1. Stop the server (section 6).
2. Replace the code: restore the previous `apps/server/dist` tree (or re-extract the
   previous `INVRT-CODE-SERVER.tar.gz` package). No database migration rollback is manual:
   the server applies its own migrations on start and tolerates an older schema only by
   re-migrating from the restored state, so always pair a code rollback with the section 7
   state restore if the new version migrated the database.
3. Start with the same `--base-dir` and run the section 5 health checks.
4. If the new version is bad, keep its dist aside for diagnosis; never delete a broken
   artifact before the incident note is written.

## 9. Deployable package

`dist-package/INVRT-CODE-SERVER.tar.gz` extracts `dist/`, `node_modules/` and
`README.md` at the archive root (extract into an empty directory; the repo-tree paths
in sections 2-4 are `apps/server/dist/` and do not exist inside the archive). Current
archive binding (server-archive lane, 27 October 2026): built from source tip
`d6191bcd5655b770f2e84d61238022e46aa6c858` (branch `codex/claude-server-archive-20261027`),
server version 0.1.3, 94,870,610 bytes,
sha256 `562e8052cd4d53046c5241e1a70d8f79be1d523c0c7ddcf3e03f4e7b67dbaae8`.
A durable copy with a SHA256SUMS file is kept under
`.pilot/oneday-release-2026-10-27/server-archive-candidate/` of the pilot checkout;
the archive itself stays untracked in git. The two earlier archives in this lane
(65,009,201 and 66,477,760 bytes, built from superseded source tips) predate the adopted
source, are retained untouched, and are superseded by the binding above. Repackage and
reverify after every relevant source change.

- `dist/`: the server bundle including `dist/client` web assets.
- `node_modules/`: the runtime external dependencies the bundle requires at run time
  (`@cursor/sdk` 1.0.38, `playwright-core` 1.60.0, `node-pty` (patched 1.2.0-beta.15),
  `@ff-labs/fff-node` (patched 0.11.0) plus its `fff-bin-darwin-x64` binary,
  `@napi-rs/keyring`, `zod`, `undici` 8.11.2, and the Cursor SDK transitive runtime
  dependencies), pruned to darwin-x64.
- A top-level README.md with run instructions.

The raw `apps/server/dist` alone is NOT runnable: the bundle keeps these packages external
by design (`scripts/lib/cli-external-packages.ts`), so a dist-only archive fails with
`Cannot find module '@cursor/sdk'` (observed 27 October 2026). The package follows the
same staging flow as the official CLI archive (`scripts/build-cli-archive.ts`:
stageRuntimeExternals): write a stage `package.json` (name `t3-runtime`) with the external
dependencies pinned to the lockfile-resolved versions, a `pnpm-workspace.yaml` with
`supportedArchitectures: {os: [darwin], cpu: [x64]}`, `allowBuilds` carried from the root
workspace, the matching `patchedDependencies` (`@ff-labs/fff-node@0.11.0`,
`node-pty@1.2.0-beta.15`), the resolved `overrides`, and `nodeLinker: hoisted`; run
`pnpm install --prod`; then prune `.pnpm`, `.bin`, patch inputs, and non-darwin-x64
prebuilds.

Clean-room verification of this archive on 27 October 2026: extracted to a fresh temporary
directory, started with a fresh `--base-dir` on 127.0.0.1:14196: root 200 with the built
asset, descriptor 200 (fresh environmentId 6067a482-8824-4e41-9df5-1c787f485633),
unauthenticated data route 401 `missing_credential`, forged Bearer header 401
`invalid_credential`; stopped with SIGTERM (process gone, port released); restarted on the
same state dir and the SAME environmentId persisted; stopped again and the port freed.
The listener was sampled with lsof and bound 127.0.0.1 only. Loopback binding is NOT a
zero-egress claim: external HTTPS traffic under default settings was observed and the
earlier egress retraction stands (see oneday-evidence/EG01-EGRESS-RETRACTION.md); make no
egress certification from these checks.
