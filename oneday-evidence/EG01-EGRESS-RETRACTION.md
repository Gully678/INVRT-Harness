# EG-01 egress retraction, additive correction record

Strictly Private and Confidential, INVRT internal. Last verified: 27 October 2026, ZCode, `builtin:zai-coding-plan/GLM-5.3-Flash`, branch `invrt/oneday-fix-platform-20261027` based on `8a61a818`. This record ADDS a correction; it does not rewrite the historical lane evidence it corrects. A different-harness re-audit follows this fix.

## Correction statement

The prior lane evidence claim of "zero egress" for the integrated server is RETRACTED as false:

- `INVRT-CODE-PLATFORM-EVIDENCE.json`, `server_headless.integrated_run`: "... loopback-only LISTEN, zero egress, clean stop".
- `INVRT-CODE-RELEASE-MANIFEST.json`, `tests_and_audits.server`: "... restart persistence; zero egress; ...".
- `oneday-evidence/SERVER-LANE-EVIDENCE.md` and `.json` carry the same claim and stay as historical records of what was (wrongly) reported.

Why the original claim was wrong: the original capture read only the LISTEN window of `lsof` output. A loopback LISTEN entry is an inbound binding, not proof of no outbound connections, and the original sampling missed short-lived outbound fetches that complete inside a few seconds. The independent Codex cross-harness audit observed fresh outbound HTTPS with raw `lsof` saved at `research/2026-10-27/ONE-DAY-RELEASE/AUDIT-CROSSHARNESS-CODEX-EGRESS.json`: fresh-state source PID 22694 opened `185.199.109.133:443` and `104.16.7.34:443`; package PID 22830 opened `104.16.7.34:443` and `185.199.109.133:443`; restart PID 23069 opened `104.16.10.34:443`.

Corrected statement: the server makes two kinds of non-loopback HTTPS connections at startup by default, both attributed below with source citations and differential reproduction. One is configurable by a server setting; the other by an environment variable defaulting to enabled. A third external fetch exists on the usage-read path.

## Caller attribution

### 1. `185.199.108.133` / `185.199.109.133` / `185.199.110.133:443` = `raw.githubusercontent.com` (GitHub content delivery anycast 185.199.108.0/22)

Caller: the model-manifest update check.

- URL definition: `apps/server/src/provider/ModelManifest.ts:24-25`, `MODEL_MANIFEST_URL = "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json"`.
- Fetch site: `apps/server/src/provider/ModelManifest.ts:226`, `httpClient.get(MODEL_MANIFEST_URL)` inside `refresh`, with a 10 second timeout (`FETCH_TIMEOUT_MS`, line 27), one-hour TTL (line 25) and a five-minute retry backoff (line 29). It falls back to the bundled manifest `apps/server/src/provider/model-manifest.json` on any failure and writes a disk cache under the state directory.
- Startup trigger: `apps/server/src/provider/ModelManifest.ts:255`, `refreshInBackground: Effect.forkIn(guardedRefresh, serviceScope)` runs the first refresh when the provider layer starts with the server.

Intended purpose: refresh the provider model catalog and compatibility gates so model defaults and update advisories track the published manifest; the bundled manifest keeps the server fully functional offline.

Configurable policy: server settings key `enableProviderUpdateChecks` (schema and default `true` at `packages/contracts/src/settings.ts:1122`; guard at `apps/server/src/provider/ModelManifest.ts:223`: `if (settings !== null && !settings.enableProviderUpdateChecks) return manifest;`). Documented gap: the guard is skipped while no settings file exists, so a genuinely fresh state performs the fetch before any explicit opt-in. Smallest proposed fix: treat missing settings as "use the bundled manifest" (invert to an explicit fetch-on-first-write default), or gate the startup refresh behind the same setting with a decoded default of `false` for first run. Not changed in this fix; recorded for the owner.

Related, not startup: `apps/server/src/usage/UsageService.ts:259` fetches `LITELLM_RATES_URL` (`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`, line 61-62) with an `api.github.com` fallback (line 63-64, 261). It runs on the usage-summary read path (`ensureRates(false)` at `apps/server/src/usage/UsageService.ts:715`), not at startup, and carries a 24 hour TTL (line 65). Gap: no offline toggle exists for the rates fetch; the smallest proposed setting is to reuse `enableProviderUpdateChecks` for it. Not observed in the startup captures below.

### 2. `104.16.7.34` / `104.16.10.34` / `104.21.3.218` / `172.67.153.155:443` = `ingest.t3.codes` (Cloudflare edges)

Caller: product telemetry (PostHog-compatible ingest).

- Host default: `apps/server/src/telemetry/AnalyticsService.ts:68`, `posthogHost` default `"https://ingest.t3.codes"` in `TelemetryEnvConfig`; the PostHog project key is also a built-in default at lines 62-64.
- Toggle: `T3CODE_TELEMETRY_ENABLED` environment variable, default `true` (`apps/server/src/telemetry/AnalyticsService.ts:73`).
- DNS check this session: `dig +short ingest.t3.codes` returns exactly `104.21.3.218` and `172.67.153.155`, matching the addresses captured in the runs below; Codex's `104.16.7.34` / `104.16.10.34` are Cloudflare edges for the same anycast origin.

Intended purpose: aggregate product telemetry (install and owner observations, feature counters). It is not required for any server function.

Configurable policy: `T3CODE_TELEMETRY_ENABLED=0` disables it (verified below). Documented gap: the default is enabled without a first-run consent prompt; the settings surface exposes no user-facing telemetry switch. Smallest proposed setting: a `enableTelemetry` server-settings key mapped onto the same env default. Not changed in this fix; recorded for the owner.

## Reproduction results (this session, source bundle `apps/server/dist` built once from this branch)

Harness: `node apps/server/dist/bin.mjs --mode web --host 127.0.0.1 --port <p> --base-dir <dir> --no-browser .`, sampled with `lsof -a -p <pid> -i -n -P` every 1 s for the first 20 s then every 5 s to 60 s, plus `lsof` on each `pgrep -P` child. Raw captures: `/tmp/eg01-captures/{A,B,C,E}-lsof.txt` (temporary, removed after this record was written; the summarised results below are the durable record).

| Run                          | Base dir | Settings/env                                                     | Non-loopback destinations seen                                | First seen    |
| ---------------------------- | -------- | ---------------------------------------------------------------- | ------------------------------------------------------------- | ------------- |
| A (fresh state)              | fresh    | defaults                                                         | `185.199.108.133:443`, `172.67.153.155:443` (ingest.t3.codes) | ~3 s / ~13 s  |
| B (same-state restart of A)  | reused   | defaults                                                         | `185.199.109.133:443`, `104.21.3.218:443` (ingest.t3.codes)   | ~4 s / ~14 s  |
| C (fresh, telemetry off)     | fresh    | `T3CODE_TELEMETRY_ENABLED=0`                                     | `185.199.110.133:443` only                                    | ~3 s          |
| E (fresh, update checks off) | fresh    | `userdata/settings.json` `{"enableProviderUpdateChecks": false}` | `172.67.153.155:443` only                                     | within window |

Attribution by differential: the GitHub-raw connection disappears exactly when `enableProviderUpdateChecks=false` (E vs A), and the ingest.t3.codes connection disappears exactly when `T3CODE_TELEMETRY_ENABLED=0` (C vs A). Ports 14611-14614 were free loopback ports; all four processes were stopped with SIGTERM and verified gone.

Child helper processes: no child process opened any network socket in any capture (the server spawned no children in these runs; `pgrep -P` found none). The packaged tarball behaves the same as the source bundle here because it bundles the same modules; Codex's package-mode capture (PID 22830) shows both destinations, consistent with this attribution. The shipped tarball itself was not re-run in this fix; packaging is a separate controlled step.

## Disposition

The corrected evidence statement is: "the server binds loopback only; with default settings its process opens short-lived outbound HTTPS to `raw.githubusercontent.com` (model-manifest update check, suppressible with `enableProviderUpdateChecks: false`) and to `ingest.t3.codes` (telemetry, suppressible with `T3CODE_TELEMETRY_ENABLED=0`); the litellm rates fetch adds GitHub-raw traffic on the usage-read path". `INVRT-CODE-PLATFORM-EVIDENCE.json` and `INVRT-CODE-RELEASE-MANIFEST.json` on this branch now carry this corrected statement with a pointer to this record.
