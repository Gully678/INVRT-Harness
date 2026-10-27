# B01.2 Review, Round 1 — Principal/Membership identity contracts

**Label: SAME-HARNESS INTERNAL AUDIT** (engineering review by the dedicated ZCode auditor for story B01.2; NOT independent external certification. Builder harness/model was also ZCode/GLM; per the different-model law this review does not certify, it records evidence and findings for the parent to route.)

- Audited commit: 87f2088e4dbf248b5802f9779e22cad32d9db0de (branch codex/claude-b01-2-identity-20261027, worktree /Users/mac/Repos/.worktrees/invrt-claude-b01-2-identity-20261027)
- Parent: 50cbcd868405c2f8db6db4ac0f9b347bccce074e
- Acceptance sources: CLAUDE-B01-2-IDENTITY-BRIEF-2026-10-27.md; PRD 02 lines 124-224 (Principal ~L130, Membership ~L131, common shape L126, typed errors L197)
- Skills loaded and applied: production-audit, production-guardrails, ai-native-agent, invrt-concise-code, api-designer, verification-before-completion, code-review (all read from /Users/mac/.zcode/skills/&lt;name&gt;/SKILL.md before the first command; none missing)

## Verdict: PASS

All acceptance criteria in the brief hold at HEAD under my own reruns and my own mutation probe. One Low finding and two Info notes recorded below for the next slice; none blocks this story.

## Verified target shape

- `git rev-parse HEAD` = 87f2088e4dbf248b5802f9779e22cad32d9db0de; branch codex/claude-b01-2-identity-20261027; `git status --porcelain` empty (clean) at start and again after all gates and the probe.
- `git diff 50cbcd86..HEAD --name-status`: exactly `M packages/contracts/src/index.ts` (+1 line: `export * from "./programmeIdentity.ts";`), `A programmeIdentity.ts`, `A programmeIdentity.test.ts`. No other paths.
- `git diff 50cbcd86..HEAD -- packages/contracts/src/programmeDomain.ts` is EMPTY: domain core byte-identical to the round-2-PASS base. Typecheck (exit 0, `tsc --noEmit`) proves the cross-slice imports compile against that base.
- No commits made during this audit; after the gates I ran `git restore pnpm-lock.yaml` to clear pnpm churn; tree returned to clean at the same HEAD.

## Schema completeness vs PRD (Duty 1)

- Common shape L126: both `Principal` and `Membership` carry schemaVersion (reused `SchemaVersion` = Literal 1 from programmeDomain), orgId, revision (NonNegativeInt), createdAt/updatedAt (DateTimeUtc), retentionClass + visibilityClass (reused RetentionClass/VisibilityClass literals). Neither entity is project-scoped, so projectId belongs only inside the scoped `ProjectGrant` — correct per L126 "projectId where project-scoped".
- Principal row L130: principalId (branded), kind human|service|agent (Literals), identityRef (IdentityRef: provider oidc|native|relay + opaque identityId + declared binding human|service), status active|suspended|deactivated; nullable displayName per the brief. identityRef carries no credentials/emails — comment-verified and structurally true.
- Membership row L131: membershipId (brief adds it), principalId, organisationRole (owner|admin|member|auditor|guest), teamIds (branded TeamId array), projectGrants (scoped: projectId + grant read|contribute|admin), policyVersion, status active|suspended|revoked.
- Role ordering IS implemented in code, not just documented: `ROLE_RANK = { guest:0, auditor:1, member:2, admin:3, owner:4 }` (programmeIdentity.ts L242-248) matches the doc comment at L72-74 and the L241 summary. `requiresOrganisationRole` compares ranks and requires status "active".
- Typed errors L197: only `IdentityCapabilityUnavailableError` and `IdentityForbiddenError` (Schema.TaggedError subset), matching `capability_unavailable`/`forbidden`. No receipt/migration machinery.

## Core invariant: no human minting except through the port (Duty 2)

- `promoteToHuman` (L177-206): already-human passthrough; `port === undefined` throws capability_unavailable (no in-memory verifier fallback exists anywhere in the module); port returns null throws capability_unavailable; resolved binding not human throws forbidden; only a port-resolved human binding yields `kind: "human"`.
- Bypass hunt results (grep + source read):
  - `claimedHumanRole` appears ONLY at its declaration (L168). Never read by any function. Two tests prove behaviour: with/without the claim produce equal results (test L280-294), and a body claim without a port still denies (test L254-265).
  - `displayName` appears only at its schema definition (L66). Never read as identity evidence.
  - The only `.binding` read in the file is `resolved.binding` (L195) — the port's answer, never the request body's declared binding. The body copy's declared binding is never trusted.
  - No default-allow: the only path returning kind "human" for a non-human principal requires a port resolution; `resolvePrincipalOrFail` takes the port as a required first argument and denies null with capability_unavailable.
  - Fixture ports: `makeLabelledFixturePrincipalPort` hard-sets `fixtureLabel: "TEST-FIXTURE-IDENTITY-NOT-A-REAL-VERIFIER"`; a test asserts the label (L220). The fixture is caller-config-driven, not a hardcoded always-allow; grep for `always.allow|allowAll|ALLOW` across both files returns nothing.
- Durability boundary documented in the module header: "no storage, receipts or enforcement here (B02 owns receipts, later slices enforce)". Grep confirms no storage/auth/session-grant/invitation/routing-policy code surface; "storage" occurs only inside comments.

## Pure-rule correctness and boundaries (Duty 3)

- `effectiveProjectGrant`: grant for project A answers only A (tests L310-313 use PROJ_A/PROJ_B); guests return explicit "none" even when a grant is listed on the record (L323-324); missing grant returns "none" (union `ProjectGrantKind | "none"`, not an empty success).
- `requiresOrganisationRole` ordering guest&lt;auditor&lt;member&lt;admin&lt;owner asserted at five pairs (L315-321) plus membership-role isolation (owner role on a different membership does not leak to a guest membership of the same principal, L298-308) and suspended fail-closed (suspended owner vs "owner" is false, L333-335).
- Unknown roles are unrepresentable: `OrganisationRole` is a Literals union, so invalid queries are TypeScript type errors, and wire decode rejects them at runtime (test L167-169 rejects "superadmin").
- Already-human passthrough without a port is idempotence, not minting: the input already carries kind "human"; nothing in the module sets kind "human" for a non-human input without the port.

## Test quality (Duty 4) — 10 assertions sampled

1. Wire decode of full Principal+Membership incl. role/grants/policyVersion (L144-151) — proves transport shape, not just internal construction.
2. No-port denial asserts the exact `_tag` `IdentityCapabilityUnavailableError` via `expectTagged` (L196-205).
3. Service binding resolved by port denies forbidden (L207-217).
4. Allowed promotion asserts fixtureLabel present, promoted kind/identityId/principalId (L219-229).
5. Unresolvable binding denies capability_unavailable with an unknown identityId (L231-241).
6. With-claim vs without-claim promotion deep-equal (L280-294) — the body claim has zero effect.
7. Project A read never answers project B (L310-313).
8. Role ordering matrix incl. below-minimum failures (L315-321).
9. Suspended owner fail-closed (L333-335).
10. Purity: input not mutated (structuredClone compare), repeated call identical (L354-369).

Meaningful, behaviour-anchored; negative schema tests target each union/brand/date/version independently.

## Gates rerun at HEAD (Duty 5) — my own runs, PATH prefixed with /Users/mac/Repos/invrt-code-local-pilot/.pilot/toolchain/node-v26.12.1-darwin-x64/bin

| Gate      | Command                                                                                                          | Result                       |
| --------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Tests     | `pnpm exec vp test run packages/contracts/src/programmeIdentity.test.ts`                                         | exit 0; 26/26 passed         |
| Typecheck | `pnpm --filter @t3tools/contracts typecheck`                                                                     | exit 0 (`tsc --noEmit`)      |
| Lint      | `pnpm exec vp lint packages/contracts/src/programmeIdentity.ts packages/contracts/src/programmeIdentity.test.ts` | exit 0; 0 warnings, 0 errors |

After the pnpm runs: `git restore pnpm-lock.yaml`; `git status --porcelain` empty; HEAD still 87f2088e. No commits.

## Builder claims checked against artifacts

- "26/26 tests": my rerun prints 26 passed; grep counts 26 `it(` blocks. TRUE.
- "typecheck/lint exit 0": my reruns both exit 0. TRUE.
- "RED was 16 failed/10 passed with behavioural failures": /tmp/b01-claude/b01-2/red.log prints `Tests 16 failed | 10 passed (26)` with NOT-IMPLEMENTED throws from the skeleton — behavioural, not import/config noise. TRUE.
- "Mutation probe disabled the human-denial gate, exactly two tests failed": /tmp/b01-claude/b01-2/mutation.log prints `2 failed | 24 passed (26)` (the two service-binding denial tests) and a byte-exact restore with matching sha256 f4707ca7... against its own pre-mutation snapshot. The snapshot file itself differs from HEAD only in comment wording (final polish happened after the probe); the restore proof is self-consistent. TRUE.
- "promoteToHuman port-gated only; forbidden on resolved non-human; capability_unavailable without port": verified in source. TRUE.
- "claimedHumanRole/body human-claims never read": grep + with/without-claim equality test. TRUE.
- "roles from membership not globals; guest explicit none; suspended fail-closed": verified. TRUE.
- "imports reuse programmeDomain exports": OrgId, PrincipalId, SchemaVersion, RetentionClass, VisibilityClass all exported from programmeDomain.ts (L23/27/43/54/57) and imported unchanged; ProjectId comes from baseSchemas.ts as documented. TRUE.

## My own mutation probe (independent of the builder's)

- Attack: make `promoteToHuman` trust the body field when the port is absent — insert `if (input.claimedHumanRole === "human") { return { ...input.principal, kind: "human", identityRef: input.claimedIdentityRef }; }` before the no-port denial.
- sha256 before: 6f1312e3197e01ca7b9e761ef024c5fd046bb63b89fb2dbca1d373ac335e118c (saved to /tmp/b01-claude/b01-2-audit/sha-before.txt; original copied to programmeIdentity.orig.ts).
- Result: suite exit 1, `1 failed | 25 passed` — exactly the matching test "still denies promotion when the request body claims role human without a port" failed. The test suite catches a body-field trust bypass.
- Restore: `cp` from snapshot; `cmp` BYTE-EXACT; sha256 after restore 6f1312e3197e01ca7b9e761ef024c5fd046bb63b89fb2dbca1d373ac335e118c (sha-after-restore.txt) — identical to before.
- Rerun green: exit 0, 26/26. Logs: /tmp/b01-claude/b01-2-audit/{audit-mutation.log, audit-restore-test.log, sha-before.txt, sha-after-restore.txt}.

## Findings

### F1 (Low, non-blocking) — promoted record copies the claimed identityRef, not the port's resolved record

- Path: packages/contracts/src/programmeIdentity.ts L201-205 (`return { ...input.principal, kind: "human", identityRef: input.claimedIdentityRef }`).
- Trigger: a caller supplies a claimedIdentityRef whose declared `binding` field (attacker-controlled text) differs from what the port resolves; the port says human, the stored record may then carry e.g. `binding: "service"` next to `kind: "human"`.
- Consequence: no bypass today — the minting invariant holds (the kind only changes after the port resolves that exact ref to human), and nothing in this module reads the declared binding as evidence (verified: the only `.binding` read is `resolved.binding`). But a future slice reading `identityRef.binding` directly instead of consulting the port would read an inconsistent field. The PRD/common-shape contract favours the authority record.
- Verification: source read + grep (`grep -n "\.binding" programmeIdentity.ts` yields only the resolved.binding check and the schema/comment lines).
- Recommendation (for B05 integration, not a rework of this slice): on success write `resolved.identityRef` (the port's authoritative `ResolvedIdentityBinding.identityRef`) instead of `input.claimedIdentityRef`.

### F2 (Info, test-coverage note) — exact-minimum boundary asserted only at the guest edge

`requiresOrganisationRole(x, "guest") === true` covers the lowest exact-minimum pair; the member/member pair is not directly asserted (member is exercised only above-min true and below-min false). `revoked` fail-closed is likewise unasserted (only `suspended`); both are blocked by the same `status === "active"` guard, and the ROLE_RANK map is exhaustive over the union, so risk is minimal. Optional: one more assert each in a later test pass.

### F3 (Info, process note) — builder's pre-mutation snapshot differs from HEAD in comment wording

/tmp/b01-claude/b01-2/programmeIdentity.pre-mutation.ts carries earlier comment text and one differently formatted Literals list; the restore was byte-exact against that snapshot, after which the builder reworded comments before the final green run and commit. No behavioural difference (comments/formatting only — verified by diff). Recorded so nobody later treats the snapshot as the committed bytes.

## Cross-slice and boundary confirmation (Duties 6, 7)

- programmeDomain.ts bytes at HEAD equal those at 50cbcd86 (empty git diff). Typecheck exit 0 covers the cross-slice import compiling against the round-2-PASS base.
- index.ts change is exactly the one export line (diff shown above).
- No storage/auth flows, session grants, invitations or routing-policy surface introduced; no durability/receipt claims made (module header defers to B02; later slices enforce).
- No always-allow port exists; the only exported port factory is the labelled fixture used by tests.

## Evidence index

- Onedev durable: this file and B01-2-REVIEW-R1.json in oneday-evidence/.
- /tmp/b01-claude/b01-2-audit/: audit-test.log, audit-typecheck.log, audit-lint.log, audit-mutation.log, audit-restore-test.log, sha-before.txt, sha-after-restore.txt, programmeIdentity.orig.ts.
- /tmp/b01-claude/b01-2/ (builder's, inspected not modified): red.log, green.log, mutation.log, lint.log, typecheck.log, programmeIdentity.pre-mutation.ts.
- Audit worktree status at close: clean, HEAD 87f2088e4dbf248b5802f9779e22cad32d9db0de, no commits, evidence files written under oneday-evidence/ (untracked, as evidence writes).
