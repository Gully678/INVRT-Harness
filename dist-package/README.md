# INVRT Code Server (deployable package)

Self-contained headless build of the INVRT Code server (`t3`, version 0.1.3) bundled from
the one-day INVRT Code programme. The archive extracts `dist/`, `node_modules/` and this
README at the archive root; the compiled server plus the built web client live under
`dist/client`, so nothing else is needed at run time.

## Contents

- `dist/bin.mjs`: entry point (Node CLI).
- `dist/client/`: built web client served by the server on the same port.
- `dist/*.mjs` and sourcemaps: bundled server modules and workers.

## Requirements

- Node.js v26.12.1 (the build was produced and verified with this runtime).
- No global installs, no database service, no external network access required.

## Run

```sh
node dist/bin.mjs \
  --base-dir /var/lib/invrt-code/state \
  --host 127.0.0.1 \
  --port 14036 \
  --no-browser
```

On first start the server prints a one-time pairing URL (`http://<host>:<port>/pair#token=...`).
Open it in a browser on the same machine to create a session. Treat the token as a secret:
it is printed once to the server log, so keep that log private and redact it when sharing.

- Bind to 127.0.0.1 unless you have reviewed the exposure. `0.0.0.0` listens on all interfaces.
- Authentication cannot be disabled. Data routes return 401 without a valid credential.
- `t3 serve` is the fully headless variant: it forces `--no-browser` behaviour and prints the
  headless pairing block (`Connection string`, `Token`, `Pairing URL`, QR code).

## State

All durable state lives under `--base-dir` (equivalent to `T3CODE_HOME`):

- `userdata/statev2.sqlite` (+ `-wal`, `-shm`): orchestration state, threads, projections.
- `userdata/secrets/`: server-owned secrets.
- `userdata/logs/`: server trace and provider logs.
- `userdata/attachments/`, `userdata/browser-artifacts/`: user data.
- `userdata/server-runtime.json`: last-run pid/port record.
- `caches/`: provider status caches, safe to delete while stopped.

## Stop

Send SIGTERM to the recorded pid. The server releases its ownership lock and flushes SQLite
before exit. Verify with `lsof -nP -iTCP:<port> -sTCP:LISTEN` returning nothing.

See the companion runbook (INVRT-CODE-SERVER-RUNBOOK.md in the source repository) for build,
backup, restore, health check, and rollback procedures.
