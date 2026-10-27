# ZCode Protocol notes (empirical, CLI 0.16.5)

Last verified: 2026-10-27, ZCode (GLM-5.3-Flash), probes in oneday-evidence/transcripts/.
Every claim below is backed by a transcript file or a bundle inspection named inline.
Auth status: no credential values were read, copied or printed at any point.

## 1. Launch and framing (proven)

- Binary: `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`, version 0.16.5,
  run with `node <zcode.cjs> app-server` (node 26.12.1 from the pilot toolchain works).
  Evidence: t1-basic.json (all three probes answered on one process).
- Framing: newline-delimited JSON. Client to server: `{id, method, params}` with NO
  `jsonrpc` key. Server replies `{id, result}` or `{id, error: {code, message, data?}}`.
- `server/discover` returns -32601 on app-server. It is an MCP-protocol method, not an
  app-server method (bundle: it sits in the MCP method tables `fu("server/discover", ...)`).
  The generic ACP path is confirmed dead: not standard ACP, ZCode-specific adapter justified.

## 2. Error codes (observed)

- -32601 Method not found (t1: server/discover).
- -32602 Invalid params, ZodError details in `error.data` (t4, t5, t8, t9).
- -32603 internal, `ModelProtocolError` with `data.configPath` when model provider config
  is missing (t6-live-turn.json).
- -32004 "Session is not active: sess_..." (t10).
- -32020 no client attached; -32021 client request cancelled; -32022 client request timed
  out (server-to-client requests; t6 first run, t11 first run).

## 3. Server-to-client requests (two-way protocol, proven)

- During `session/create` and `session/resume`, the server sends the client a request
  `session/requestRuntimePreferences` with params `{sessionId, scope}` and aborts the
  original call with -32022 if the client does not answer (t6, t11 first runs).
- Reply schema (bundle `MEt`): `{nativeSearchEnhancementsEnabled: boolean,
  memoryEnabled: boolean (default false), askUserQuestionAutoResolutionEnabled: boolean
  (default true), integratedTerminalShell?: {mode:"auto"} | {mode:"shell",
  dialect:"cmd"|"git-bash", id, label, path}, modelContextBudgetStrategy:
  "legacy"|"preflight-v1" (default "preflight-v1")}`.
- With the reply answered, `session/resume` activates the persisted session (t11) and
  `session/create` proceeds up to model-config resolution (t6 second run).
- Unknown server requests must be answered with an error or they block the caller:
  the safe default is `{-32601}` per method (implemented in the adapter).

## 4. Method registry (bundle `rr={...}`, verified live where marked)

Session: session/create, session/resume, session/list, session/subagents,
session/requestRuntimePreferences (server-to-client), session/read, session/messages,
session/events, session/subscribe, session/send, session/stop,
session/cancelBackgroundTask, session/fork, session/compact, session/goal,
session/close, session/setModel, session/setThoughtLevel,
session/updateRuntimeModelConfig, session/setMode, session/usage.
Workspace: workspace/readState, workspace/hooks/trustGrant,
workspace/updateProviderRegistry, workspace/updateInteractionPreferences,
workspace/updateModelIoPreferences, workspace/upsertModelProvider,
workspace/removeModelProvider, workspace/setDefaultModel,
workspace/setDefaultThoughtLevel, workspace/setDefaultMode, workspace/generateText,
workspace/cancelGenerateText. Plus mcp/list, plugins/_, automation/_,
usage/stats, interaction/* (permissions, user input, browser).

## 5. Shapes proven live

- session/list {} -> {sessions: [{sessionId, status, mode, title, titleSource,
  sessionKind, traceId, createdAt, updatedAt, workspace: {workspaceKey, workspacePath}}]}
  (t1).
- usage/stats {range: "all"|"7d"|"30d"} -> {range, generatedAt, timeZone,
  source: "agent-db", summary: {totalTokens, inputTokens, outputTokens, reasoningTokens,
  cacheCreationTokens, cacheReadTokens, cacheHitRate, totalSessions, totalTurns,
  toolCallCount, toolErrorRate, modelErrorRate, avgTimeToFirstTokenMs,
  avgTurnDurationMs, activeDays, currentStreakDays, longestSessionMs, longestStreakDays,
  peakDayTokens, favoriteModel}, heatmap: {weeks: [...]}, dailyModelUsage: [...],
  models: [...], tools: [...]} (t3-usage-long.json). First call takes >8s cold;
  needs a generous timeout (adapter uses 30s).
- session/usage {sessionId} -> {sessionId, totalTokens, inputTokens, outputTokens,
  reasoningTokens, cacheCreationTokens, cacheReadTokens, modelRequestCount,
  modelErrorCount, inputBaselineBySource} (t5).
- session/resume {sessionId}: slow (replays a long transcript; 40s timeout hit on a
  68-message session) but the session becomes active even if the request is still
  running; then session/read works (t11).
- session/read {sessionId} -> {messages: [{info: {role, agent, cost, finish, messageId,
  model: {modelId, providerId}, path, semantics, sessionId, time, tokens: {input, output,
  reasoning, cache}}, parts: [...]}]} (t11).
- Part types in a real transcript (t11): text, reasoning, tool (callId, state),
  step-start, step-finish (cost, reason: "tool-calls"|"completed", tokens: {total,
  input, output, reasoning, cache}), timeline (model_change).
- Param minimums (ZodError-driven): session/create needs
  `workspace: {workspaceKey, workspacePath}`; session/send needs `{sessionId, content}`;
  session/events, session/usage need `{sessionId}`; workspace/upsertModelProvider needs
  `{workspace, provider: {providerId, kind: "anthropic"|"openai"|"openai-compatible",
  models: [...]}}`; workspace/setDefaultModel needs `{workspace, model: {providerId,
  modelId}}` (t4, t5, t8, t9).

## 6. Streaming events

- Notifications arrive on stdout as `{method: "session/event", params: {eventId,
  deliveryKind, payload: {kind: ...}, ...}}` (bundle TLi logs payload.kind; the client
  receives them without subscribing per call; session/subscribe exists for interest
  registration). Live capture of a full model turn was NOT possible on this machine
  (see section 8); adapter fixtures for stream mapping are hand-built from the part
  shapes in t11 (same part type family, so the mapping is grounded in real data).
- Session state (bundle `ije` schema, delivered in state-bearing events) includes
  `usage: {contextWindow: {usedTokens, maxTokens, autoCompactThresholdTokens, cache,
  breakdown} | null, cumulative: {...}}`. This is the context-used signal for the UI.
- Unknown event payload kinds MUST be ignored, not rejected, for forward compatibility.

## 7. Cancellation and cleanup

- session/stop {sessionId} is the cancellation method (registry). The headless CLI also
  supports --max-turns style bounds but the app-server does not expose that flag.
- Process exit: SIGTERM then SIGKILL backstop; the app-server writes nothing to stdout
  except protocol frames in these probes (stderr stayed empty in t1-t11).

## 8. Model provider config (blocks live model turns on this machine)

- Both headless (--prompt) and app-server session/create fail with
  `ModelProtocolError: Model config is missing. Create /Users/mac/.zcode/cli/config.json
  with an explicit model provider before running ZCode.` (t6; headless run 2026-10-27).
- `~/.zcode/cli/config.json` exists but carries only plugins/mcp/hooks keys; the model
  section is supplied by the desktop harness out-of-band. The adapter therefore must
  (a) treat ModelConfigMissing as a first-class unavailable state and (b) support a
  settingsFile override passed to the app-server via `--settings <path>` so a host can
  point it at a configured file.
- workspace/upsertModelProvider + workspace/setDefaultModel allow a client to configure
  providers over the protocol (kinds: anthropic | openai | openai-compatible). Doing so
  with real keys is Mark's call only; no keys were read, written or embedded here.

## 9. Usage/quota availability (Mark's requirement, honest)

- AVAILABLE: per-session context usage (session state usage.contextWindow.usedTokens /
  maxTokens / autoCompactThresholdTokens), per-session cumulative tokens (session/usage),
  step-level tokens (step-finish parts), aggregate and daily usage (usage/stats with
  7d/30d/all ranges, dailyModelUsage), favourite model share, streaks.
- NOT PROVIDED by the protocol: 5-hour rolling window percentage, weekly window
  percentage, provider reset times, explicit rate-limit remaining values. These are
  reported as unavailable by the adapter; no numbers are invented.
