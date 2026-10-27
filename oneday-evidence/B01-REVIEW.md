# B01.1 review — SAME-HARNESS INTERNAL AUDIT

VERDICT: CHANGES REQUIRED (1 high, 2 medium, 3 low findings below; all gates green at the committed tip; mutation probe passed)

Label: SAME-HARNESS INTERNAL AUDIT (same harness/model as the builder: ZCode, builtin:zai-coding-plan/GLM-5.3-Flash). Engineering review only; NOT independent external certification. Auditor = fresh-context dedicated reviewer for story B01.1; builder model identity taken from the brief (native GLM-5.3-Flash) and not independently observable from the commit.

Skills loaded (all seven paths existed and were read in full before any audit action):
production-audit, production-guardrails, ai-native-agent, invrt-concise-code, api-designer, verification-before-completion, code-review. No missing paths.

## Audited commit (verified, not trusted)

- Worktree: /Users/mac/Repos/.worktrees/invrt-claude-domain-core-b01-20261027
- Branch: codex/claude-domain-core-b01-20261027
- HEAD: 6ff1de76da690743ab5f652fd7c002d935f8c39b, `git status --porcelain` clean at audit start and again after all gates and the probe (pnpm-lock.yaml churn restored with `git restore pnpm-lock.yaml` as instructed; nothing committed by the auditor).
- Changed paths vs parent 84b49e6151bae11d10adf97fac18b647b1c94ad6 (verified by `git diff --name-status`): exactly three — `M packages/contracts/src/index.ts` (+1 line, `export * from "./programmeDomain.ts";`, the only index change), `A packages/contracts/src/programmeDomain.ts` (1118 lines), `A packages/contracts/src/programmeDomain.test.ts` (932 lines).

## Gates rerun at the committed tip (machine-printed)

- Test selection printed explicitly before running: `packages/contracts/src/programmeDomain.test.ts` (file existence checked; empty-selection stop not applicable).
- `pnpm exec vp test run packages/contracts/src/programmeDomain.test.ts`: Test Files 1 passed (1), Tests 53 passed (53), exit 0.
- `pnpm --filter @t3tools/contracts typecheck` (tsc --noEmit): exit 0.
- `pnpm exec vp lint packages/contracts/src/programmeDomain.ts packages/contracts/src/programmeDomain.test.ts`: "Found 0 warnings and 0 errors" on 2 files with 200 rules, exit 0.
- Post-run: lockfile churn restored; `git status --porcelain` empty; HEAD unchanged at 6ff1de76.
- Node: v26.12.1 from /Users/mac/Repos/invrt-code-local-pilot/.pilot/toolchain/node-v26.12.1-darwin-x64/bin (printed).

## Mutation probe (auditor-run, adversarial)

- Target: the shared-lineage distinctness check inside `recordReview` (programmeDomain.ts ~L1028-1041), the most safety-critical denial. Mutation applied: `identity.contextId === auditorIdentity.contextId` inverted to `!==` (single occurrence verified before replacement).
- sha256 before: fab419e9aa5bf17206593057be046effc3dfdc200917dca814697108e769d662 (saved /tmp/b01-claude/audit/probe-sha-before.txt)
- Mutated run: `Tests 1 failed | 52 passed (53)` — the failing test is exactly "recordReview > rejects shared lineage: the auditor identity may not equal any builder-run lineage entry". The assertion is behavioural: it fails only when the denial condition is broken.
- Restore: byte-exact copy-back; sha256 after restore identical (fab419e9...d662; saved /tmp/b01-claude/audit/probe-sha-after-restore.txt); `diff -q` clean.
- Post-restore rerun: Tests 53 passed (53). Builder's own revokedAt-inversion claim is consistent with this design and with my read of the corresponding test ("denies a revoked approval" asserts the ProgrammePolicyDeniedError tag on a revoked fixture, which a null-inverted check would fail).

## Findings

Each finding names path, trigger, consequence, verification. Money/data/lawsuits ordering applied: authority first (lawsuit/data), then contract coherence (data), then documentation/weakness notes.

### F-1 (HIGH, authority boundary) admitBuildComplete trusts the body-supplied requestingRun instead of resolving it through the authority port

- Path: packages/contracts/src/programmeDomain.ts, AdmitBuildCompleteInput.requestingRun (L639) consumed at L789-814; contrast with recordReview, which resolves both runs via `port.resolveRunRecord` (L969, L984).
- Trigger: a future B02/B05 caller wires a client-supplied run body into `admitBuildComplete` (the module doc says "Callers cannot pass authority claims in the mutation body", yet the run record — role, taskId, ownerMemberId, executionEnvironmentId — is exactly the eligibility input and arrives in the body). An auditor principal whose port-verified member owns a run can forge `role: "builder"`, a matching `taskId`, and an `executionEnvironmentId` inside approval scope, and admit build complete; the authoritative store would record that run as an auditor run. The run's environment also selects which approval `environmentScope` is checked.
- Consequence: breaks the brief's rule that the port resolves "authoritative source/evidence/run records ... passed as a parameter to every mutation" and the explicit NO request-body trust rule; the frozen build completion feeds the whole review chain downstream.
- Mitigations observed (why HIGH, not critical): the owner-member binding to the port-verified actor limits forgery to runs the principal owns; the acceptance path (recordReview) is fully port-resolved; this is a pure contracts slice with no transport.
- Verification: full source read; the only port call in admitBuildComplete touches actor/approval/attempt-count, never `resolveRunRecord(run.runId)`; the test "denies forged principal claims" (test file L521-532) covers actor resolution only, not run-record forgery — the gap is untested, which is how it survived 53 green tests.
- Required change: resolve `requestingRun.runId` through `port.resolveRunRecord` and use the port-resolved record for role/task/owner/environment checks (keep body record only for comparison), plus a forged-run-body denial test.

### F-2 (MEDIUM, contract coherence) recordReview derives acceptance from the gates but ignores the review's own disposition and declared lineageCheck/coverage

- Path: packages/contracts/src/programmeDomain.ts L1110-1117 (unconditional `state: "accepted"`) and L944-945 / L1117 (returns `input.review` unchanged).
- Trigger: `recordReview` with a review whose `disposition` is `"rejected"` or `"incomplete"` (or `lineageCheck: "failed"`) that nonetheless passes every fact gate.
- Consequence: the work item transitions to `accepted` while the recorded review says rejected/incomplete; PRD 02 L148 requires "Disposition accepted/rejected/incomplete; missing required proof is incomplete, not a percentage pass" — the contract stores a caller-declared disposition it never validates or derives, so persisted records can contradict the enforced outcome. No security bypass: the gates still gate; the incoherence is in the stored record.
- Verification: code read (no disposition comparison anywhere in recordReview); no test exercises a mismatched disposition, so the suite cannot catch it.
- Required change: derive disposition from the gates (accept only when all pass; otherwise incomplete) or validate that `input.review.disposition === "accepted"` and consistency of declared lineageCheck/coverage before accepting; add a mismatch-denial test.

### F-3 (MEDIUM, approval scope) Approval.targetIds is never enforced

- Path: packages/contracts/src/programmeDomain.ts requireApprovalCovering L593-631 checks effect, project, environment, specHash, expiry, revocation and exclusions, but never `approval.targetIds`; the Approval schema carries targetIds (L143).
- Trigger: an approval scoped to target "workitem-A" is used to admit a build for "workitem-B" in the same project/environment with the same spec.
- Consequence: the brief's deny list ("excluded path/target/effect/environment") is only 3/4 implemented; approval scope is wider than the human approved.
- Verification: full read of requireApprovalCovering; grep for targetIds in programmeDomain.ts returns the schema field only; test matrix bullet 4 has no target test (expired/revoked/wrong-spec/effect/env/project/path/budget all covered).
- Required change: check that the work item (or its id reference) appears in `approval.targetIds` inside requireApprovalCovering, with a denial test.

### F-4 (LOW, port design) run/evidence/source port lookups carry no orgId, so tenant scoping is implicit

- Path: ProgrammeAuthorityPort L484-491: resolveRunRecord/resolveEvidenceRecord/resolveSourceRecord take no orgId (only resolveVerifiedActor and resolveApproval and resolveAttemptCount do).
- Trigger: a trusted-store implementation that keys those records without an org dimension.
- Consequence: the contract does not force org isolation on those lookups; today isolation is achieved indirectly (evidence.projectId vs workItem.projectId at L1082, run.taskId vs taskPacket.taskId, actor.orgId vs workItem.orgId), which holds only while ids are globally unique.
- Verification: interface read; no failing behaviour in this slice. Recommendation for B02: add orgId to those port methods when the trusted store lands.

### F-5 (LOW, graph accuracy) narrow-graph location offset and edge count

- Path: /tmp/b01-claude/graph/graph.json node "admitBuildComplete()" reports source_location "L739"; the actual `export const admitBuildComplete` is at programmeDomain.ts L756 (L739 falls inside requireNonTerminal). Symbol, file, and community assignment (community 68, named in GRAPH_REPORT-narrow.md) verified.
- Recount with the JSON's own keys (`links`, not `edges`): 3031 nodes (exact match), 4452 links plus a `hyperedges` key, 159 distinct communities (exact match). The builder's claimed 4456 edges is consistent with links+hyperedges but I could not decompose 4456 exactly; stated here as recounted, not accepted.

### F-6 (LOW, test strength) the "typed errors" block asserts only tag distinctness

- Path: packages/contracts/src/programmeDomain.test.ts L917-932.
- Trigger/consequence: asserts 9 classes produce 9 distinct tags; no behaviour. Harmless because every denial path elsewhere is behavioural (typed-tag assertions plus state/revision zero-mutation checks), but it is the one tautology-adjacent assertion in the file.

## Verified sound (evidence, not trust)

- Schemas: all seven objects present (Programme, ProgrammeApproval, WorkItem, TaskPacket, ProgrammeAssignmentRun, ProgrammeEvidence, ProgrammeReview) with the full common shape (schemaVersion Literal(1), orgId, projectId where project-scoped — Programme correctly org-level, Approval's nullable projectId documented as org-wide, revision NonNegativeInt, createdAt/updatedAt DateTimeUtc, retentionClass, visibilityClass). Effects enum is EXACTLY the 22 PRD members in PRD order, no extras (compared member-by-member against PRD L159). WorkItemState is exactly the 13 PRD states; releaseReady/live absent from the schema and rejected by decode-negative tests; `tested` is a separate TestedMilestone field, asserted separate in the happy-path test.
- Branded ids: local makeDomainId (L20-21) mirrors native makeEntityId (baseSchemas.ts L246-248) byte-for-byte in logic; makeEntityId is a private const in baseSchemas, so a local mirror was the only reuse path; native ProjectId/RunId/RunAttemptId/EnvironmentId reused; grep found no pre-existing Programme/WorkItem symbols elsewhere in packages/contracts/src (no duplication).
- Authority port: no always-allow, default-memory verifier, boolean-flag authority, humanRole/runtimeMode trust, or schema-brand-as-authority anywhere (grep for bypass candidates: NO MATCHES; full source read). Every unresolvable lookup denies typed capability_unavailable (actor, approval, attempt ledger, auditor run, builder run, evidence, source). Fixture authority is clearly labelled: makeLabelledFixtureAuthorityPort + fixtureLabel "TEST-FIXTURE-AUTHORITY-NOT-A-REAL-VERIFIER" + "Never use in production" doc.
- Transitions: admitBuildComplete only from running|fixing (positives and negative tested); exact-assigned-writer checks present (against F-1's body-trust caveat); approval must cover editSource scoped to project/environment plus spec/expiry/revocation/exclusions; freeze of sourceCommit + build evidence refs; startReview only from buildComplete via verified actor; recordReview requires port-resolved eligible auditor, data-compared distinct identity across builder identity and full lineage (novel model accepted — no whitelist, tested), exactCommit == frozen commit, port-resolved current source == frozen commit (source_stale), resolvable project-matched builder-lineage content-bound evidence, coverage plan satisfied. All denials throw before any state update (code order verified; the stale-revision test additionally asserts the source aggregate is unmutated).
- Idempotency: same key+payload replays the original with no second revision (test asserts equal revisions and replayRecords.size === 1); key+payload conflict gives idempotency_conflict; cross-principal aggregate-key reuse denied via a secondary index; closed programme and integrated work item deny revival; the receipt map is documented non-durable in three places (module doc "durable dedup and persistence are owned by B02"; makeMutationContext "replay records live only for the life of the calling process").
- Budgets: attempts exercised through the port (exceeded and absent-ledger both tested); spend (maxSpendMinorUnits) defined but not enforced — matches the brief's honest split.
- Boundaries: no B01.2+ objects (Membership/Invitation/TransferManifest/TaskSlotLease/RoutingPolicy-object/Outbox/EventSink/migration grep: NO MATCHES; RoutingPolicyReference is the TaskPacket ref the brief requires, not the B01.2 policy object); no storage/outbox/event-sink claims beyond documentation; index.ts carries only the one export line.
- Test quality: sampled well over 8 assertions (schema negatives incl. uppercase digest, 39-hex commit, float revision, schemaVersion 2, blank id, invalid date, releaseReady/live, unknown effect; authority gates; replay suite; review suite). decodeWire runs fixtures through the same JSON codec transports use, not constructor calls. Assertions are behavioural (typed tags, state, revision, receipt counts), not mock-the-thing-under-test.

## Evidence artefacts (auditor-owned)

- /tmp/b01-claude/audit/probe-sha-before.txt, probe-sha-after-restore.txt (mutation probe shas)
- /tmp/b01-claude/graph/GRAPH_REPORT-narrow.md and graph.json (builder's narrow graph, spot-checked)
- This file and B01-REVIEW.json in the worktree's oneday-evidence/ directory
