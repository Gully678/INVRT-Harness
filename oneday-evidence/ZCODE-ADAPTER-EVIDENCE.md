# ZCode adapter evidence (Builder C, ZCode lane)

Last verified: 2026-10-27, ZCode harness, model builtin:zai-coding-plan/GLM-5.3-Flash.
Worktree: /Users/mac/Repos/.worktrees/invrt-oneday-zcode-adapter-20261027,
branch invrt/oneday-zcode-adapter-20261027, base 6ef29078c74d4cb82f0875d7f161ccdc24b4253c.
Skills loaded and applied: production-guardrails, production-audit, ai-native-agent,
invrt-concise-code, typescript-pro, test-driven-development.
Same-harness audits are never claimed as cross-harness acceptance.

## Outcome

A ZCode provider driver and adapter now exists in packages/provider-zcode, registered in
apps/server builtInDrivers alongside the untouched existing providers. It speaks the ZCode
Protocol (NDJSON app-server) directly, exposes usage/quota data through T3's usage seams,
and reports every capability the protocol lacks as explicitly unavailable.

## What was built

- packages/provider-zcode/src/settings.ts: ZCodeSettings (enabled, binaryPath with
  documented auto-discovery, customModels).
- packages/provider-zcode/src/server/protocol.ts: ZcodeProtocolClient (NDJSON framing,
  request/reply with timeouts, server-to-client request answering including the
  session/requestRuntimePreferences handshake, -32601 fail-closed default for unknown
  server requests, SIGTERM/SIGKILL disposal, deterministic ZcodeProtocolClosedError).
- packages/provider-zcode/src/server/protocolTypes.ts: tolerant payload types grounded in
  live transcripts; unknown part kinds degrade to "unknown" instead of failing.
- packages/provider-zcode/src/server/mapping.ts: usage/stats and session/usage to T3
  UsageRecord/token totals, context-window snapshot and percent, honest usage limits.
- packages/provider-zcode/src/server/eventMapping.ts: session/event payloads to turn
  items and terminals (UNAUDITED against a live stream, see BLOCKED).
- packages/provider-zcode/src/server/status.ts: version probe across PATH and the macOS
  app bundle fallback, honest auth "unknown", runtime mode mapping (never silently yolo).
- packages/provider-zcode/src/server/adapter.ts: ProviderAdapterV2 (openSession, session
  runtime, honest capabilities), ModelConfigMissing surfaced as validation_error.
- packages/provider-zcode/src/server/driver.ts + textGeneration.ts + usage.ts: driver
  registration, manual-only maintenance, scan-based usage reader, text generation that
  fails closed (protocol exposes workspace/generateText but it needs a model config).
- packages/provider-zcode/src/server/fakeServer.ts: in-process fake app-server for tests.
- packages/contracts/src/usage.ts: additive "zcode" UsageProviderKind.
- apps/server/src/provider/builtInDrivers.ts: ZcodeDriver in BUILT_IN_DRIVERS and
  BUILT_IN_USAGE_DRIVERS; every existing entry unchanged.
- apps/server/package.json + pnpm-lock.yaml: the one new workspace dependency
  (@t3tools/provider-zcode). Unrelated @pnpm/exe lockfile churn from the installer was
  reverted; only the 31 zcode-related lines remain.

## Protocol findings (full notes: ZCODE-PROTOCOL-NOTES.md)

1. Framing: NDJSON {id, method, params} without jsonrpc; errors -32601/-32602/-32603,
   -32004 session not active, -32020/-32021/-32022 client-call errors.
2. session/create and session/resume block on a server-to-client
   session/requestRuntimePreferences request; the adapter answers it with the
   preflight-v1 defaults the bundle schema declares.
3. usage/stats {range: "all"|"7d"|"30d"} returns aggregate summaries plus
   dailyModelUsage; cold calls need a generous timeout (adapter uses 30-45s).
4. session/usage {sessionId} returns per-session cumulative tokens and request counts.
5. session/read returns full transcripts whose part family is text, reasoning, tool,
   step-start, step-finish (per-step tokens), timeline (model_change).
6. server/discover is an MCP method, not an app-server method; method-not-found expected.
7. workspace/upsertModelProvider + workspace/setDefaultModel exist (kinds
   anthropic|openai|openai-compatible) for protocol-level provider configuration.
8. The protocol exposes NO 5-hour window, weekly window, reset times, or rate-limit
   remaining values.

## Live verification (real CLI 0.16.5, machine-authenticated)

- Probe transcripts: oneday-evidence/transcripts/t1, t3-t10 (session/list, usage/stats
  all and 7d, session/usage, error shapes, provider-config ZodError shapes) plus
  t11-structure.json, a structural extract of the 68-message real-session read (the
  full 2 MB transcript stayed local-only and was removed; the part-type samples and
  message envelope are preserved in the extract).
- Adapter client live check (read-only, no session created, no model called):
  `node oneday-evidence/transcripts/live-client-check.ts` printed:
  LIVE session/list: ok, sessions: 50
  LIVE usage/stats 7d: ok, range: 7d days: 8
  LIVE session/usage: ok, totalTokens: 722067
  LIVE CLIENT ACCEPTANCE: PASS
- No credential values were read, copied or printed at any point. ~/.zcode was never
  modified; /Applications/ZCode.app was never modified.

## Capability matrix

| Capability                           | State                                             | Basis                                                |
| ------------------------------------ | ------------------------------------------------- | ---------------------------------------------------- |
| Model listing without live config    | unavailable (single default slug)                 | protocol exposes no catalog                          |
| session/create in workspace          | supported (code path)                             | t6 + bundle schema; blocked live by model config     |
| session/resume by sess_ id           | supported (code path)                             | t11 live resume                                      |
| session/send turn start              | supported (code path)                             | registry + param schema                              |
| Streaming text/reasoning/tool items  | supported (code path), UNAUDITED live             | part family verified via session/read                |
| Turn terminal detection              | heuristic (finish value / step reason), UNAUDITED | no live stream capturable here                       |
| Interrupt (session/stop)             | supported                                         | registry method; declared supportsInterrupt          |
| Read thread snapshot                 | supported                                         | t11 session/read                                     |
| Model switch in session              | unsupported (declared false)                      | session/setModel exists but unverified; honest false |
| Steering mid-turn                    | unsupported (explicit error)                      | protocol has no steer                                |
| Fork / rollback thread               | unsupported (explicit errors)                     | protocol has neither                                 |
| Approval callbacks                   | unsupported (declared false)                      | interaction/* unverified; fail-closed                |
| Subagents                            | unsupported (declared false)                      | unverified                                           |
| Context window display               | supported when session state provides it          | usage.contextWindow used/max/autoCompactThreshold    |
| 5-hour window percentage             | unavailable (reported, never invented)            | protocol lacks it                                    |
| Weekly window percentage             | unavailable (reported, never invented)            | protocol lacks it                                    |
| Reset times                          | unavailable (reported, never invented)            | protocol lacks it                                    |
| Daily aggregate usage (usage page)   | supported via usage/stats scan                    | t3 live payload                                      |
| Text generation (commit msg, titles) | fail-closed with explicit error                   | workspace/generateText needs model config            |

## Usage mapping result (Mark's requirement)

- Context used: live session state usage.contextWindow.usedTokens maps to
  ThreadTokenUsageSnapshot (usedTokens/maxTokens/autoCompactThreshold) and a "session"
  usage window percent; the UI can display it and routing can act on it.
- Totals: session/usage and step-finish tokens map into T3 token totals.
- Usage page: usage/stats dailyModelUsage becomes per-day UsageRecords with stable
  dedupe keys (zcode:usage-stats:<date>).
- 5-hour window, weekly window, reset times: the protocol does not expose them; the
  snapshot reports unavailable {reason: "unsupported"} with an explanatory message. The
  APP-LIMIT-01 stop-at-95% rule cannot be driven by invented numbers; when ZCode exposes
  window data in a future version, the ServerProviderUsageWindow seam already accepts it.

## Tests (TDD: fixtures captured from live transcripts first, then client/mapping written)

- packages/provider-zcode: `pnpm test` = 4 files, 42 tests, all passing
  (protocol client against the fake app-server: handshake, error codes, invalid params,
  closed-process rejection, notifications, unknown-server-request -32601; mapping against
  the t3/t5 payload shapes; event mapping and terminals; driver registration, honest
  capabilities, mode mapping, command candidate resolution).
- apps/server: `vp test run src/provider/builtInDrivers.test.ts` = 2 tests passing
  (zcode registered; existing kinds untouched; usage aggregation list).
- Typecheck: packages/provider-zcode 0 errors; apps/server 0 errors; packages/contracts
  shows one pre-existing suggestion in src/auth.test.ts (untouched by this lane).

## Commands (toolchain: pilot node v26.12.1, no global changes)

- pnpm install --frozen-lockfile (worktree root) - then a deliberate non-frozen install
  to register the new workspace package; unrelated churn reverted afterwards.
- (cd packages/provider-zcode && pnpm typecheck && pnpm test)
- (cd apps/server && pnpm typecheck && vp test run --config ../../vite.config.ts
  src/provider/builtInDrivers.test.ts)
- node oneday-evidence/transcripts/live-client-check.ts

## BLOCKED (owner actions, not code gaps)

1. LIVE model turn and stream mapping audit: both headless --prompt and app-server
   session/create fail with "Model config is missing. Create /Users/mac/.zcode/cli/
   config.json with an explicit model provider before running ZCode." on this machine;
   the desktop harness supplies model config out-of-band. UNAUDITED items (turn event
   stream mapping, terminal heuristics, interrupt end-to-end) need one configured run.
   Resolution needs Mark's decision (add a model provider section or authorise a
   --settings file); the adapter surfaces ModelConfigMissing explicitly meanwhile.
2. Model catalog: the protocol exposes no model listing without a live configured
   session; the snapshot offers a single "zcode-default" slug. If Mark wants real slugs,
   that needs a configured session to enumerate (session/setModel / workspace state).

## Honest limitations

- The turn event mapping in eventMapping.ts is marked UNAUDITED in-file: the payload
  shapes are grounded in the verified session/read part family, but no live turn was
  capturable. It must be audited against a live configured session before release.
- Everything not proven is declared false in ZcodeProviderCapabilitiesV2, so the
  orchestrator cannot route work the adapter cannot honour.
