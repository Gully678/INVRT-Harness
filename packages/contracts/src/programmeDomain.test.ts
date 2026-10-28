/**
 * Behavioural tests for the programme domain slice B01.1.
 * Every transition test injects the clearly labelled fixture authority from
 * makeLabelledFixtureAuthorityPort; no production verifier exists in this slice.
 */
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  ApprovalId,
  EvidenceId,
  MemberId,
  type MutationReceipt,
  OrgId,
  PrincipalId,
  Programme,
  ProgrammeApproval,
  ProgrammeAssignmentRun,
  ProgrammeCapabilityUnavailableError,
  ProgrammeEvidence,
  ProgrammeEvidenceMissingError,
  ProgrammeForbiddenError,
  ProgrammeBudgetExceededError,
  ProgrammeIdempotencyConflictError,
  ProgrammeInvalidRequestError,
  ProgrammePolicyDeniedError,
  ProgrammeReview,
  ProgrammeRevisionConflictError,
  ProgrammeSourceStaleError,
  TaskId,
  TaskPacket,
  WorkItem,
  WorkItemId,
  admitBuildComplete,
  makeLabelledFixtureAuthorityPort,
  makeMutationContext,
  recordReview,
  startReview,
} from "./programmeDomain.ts";
import { EnvironmentId, ProjectId, RunId } from "./baseSchemas.ts";

// Wire helper: decodes JSON-shaped fixtures the same way production transports do.
const decodeWire = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(Schema.toCodecJson(schema) as never) as (value: unknown) => S["Type"];

const encodeWorkItem = Schema.encodeSync(Schema.toCodecJson(WorkItem));
const encodeReview = Schema.encodeSync(Schema.toCodecJson(ProgrammeReview));

const expectTagged = (run: () => unknown, tag: string) => {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected a denial tagged ${tag}`).toBeDefined();
  expect((thrown as { readonly _tag?: string })._tag).toBe(tag);
};

const expectDecodeFails = (schema: Schema.Top, wire: unknown) =>
  expect(() => decodeWire(schema)(wire)).toThrow();

const NOW = "2026-10-27T12:00:00.000Z";
const LATER = "2026-10-27T13:00:00.000Z";
const EARLIER = "2026-10-27T11:00:00.000Z";

const ORG = "org-1";
const MARK = "member-mark";
const BUILDER = "member-builder";
const AUDITOR = "member-auditor";
const OTHER = "member-other";
const PROJ = "project-1";
const OTHER_PROJECT = "project-2";
const ENV = "env-1";
const PGM = "programme-1";
const APPROVAL = "approval-1";
const WI = "workitem-1";
const TASK = "task-1";
const BUILDER_RUN = "run-builder-1";
const AUDITOR_RUN = "run-auditor-1";
const EV_BUILD = "evidence-build-1";
const EV_TEST = "evidence-test-1";
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const sha = (c: string) => c.repeat(64);
const SPEC_SHA = sha("1");
const POLICY_SHA = sha("2");
const DIGEST_1 = sha("3");
const DIGEST_2 = sha("4");
const INPUTS_SHA = sha("5");

const programmeWire = {
  schemaVersion: 1,
  orgId: ORG,
  revision: 2,
  createdAt: NOW,
  updatedAt: NOW,
  retentionClass: "standard",
  visibilityClass: "organisation",
  programmeId: PGM,
  ownerMemberId: MARK,
  requirementRevision: 3,
  taskGraphRevision: 2,
  controllerLease: null,
  approvalRefs: [APPROVAL],
  budgetPolicyRef: "budget-policy-1",
  state: "executing",
  holds: {},
};

const approvalWire = {
  schemaVersion: 1,
  orgId: ORG,
  projectId: PROJ,
  revision: 2,
  createdAt: NOW,
  updatedAt: NOW,
  retentionClass: "standard",
  visibilityClass: "organisation",
  approvalId: APPROVAL,
  humanPrincipalId: "principal-human-1",
  capturedIntentRef: "intent-1",
  actionScopes: ["editSource", "runChecks", "runDedicatedAudit", "fixFindings"],
  targetIds: ["workitem-1"],
  specHash: SPEC_SHA,
  allowedChanges: ["packages/contracts/**"],
  exclusions: [],
  environmentScope: [ENV],
  budgetRef: "budget-1",
  expiresAt: "2026-10-28T12:00:00.000Z",
  revokedAt: null,
};

const workItemWire = {
  schemaVersion: 1,
  orgId: ORG,
  projectId: PROJ,
  revision: 5,
  createdAt: NOW,
  updatedAt: NOW,
  retentionClass: "standard",
  visibilityClass: "team",
  workItemId: WI,
  programmeId: PGM,
  kind: "build",
  title: "B01.1 domain core",
  requirementIds: ["req-1"],
  acceptance: ["acceptance-1"],
  assigneeMemberId: BUILDER,
  executorRole: "builder",
  reviewerRole: "auditor",
  dependencies: [],
  sourceRefs: ["repo#main"],
  priority: "normal",
  dueAt: null,
  state: "running",
};

const taskPacketWire = {
  schemaVersion: 1,
  orgId: ORG,
  projectId: PROJ,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
  retentionClass: "standard",
  visibilityClass: "team",
  taskId: TASK,
  workItemId: WI,
  specHash: SPEC_SHA,
  baseCommit: COMMIT_A,
  projectMappingRevision: 1,
  knowledgeRevision: 1,
  effectiveRoutingPolicy: { ref: "policy-1", hash: POLICY_SHA },
  resolvedCapabilitySnapshotRef: "cap-snap-1",
  allowedPaths: ["packages/contracts/src/**"],
  doNotModify: ["pnpm-lock.yaml"],
  inputs: ["spec-1"],
  outputs: ["programmeDomain.ts"],
  failureCases: ["source_stale"],
  skillUnion: ["test-driven-development"],
  graphRefs: ["graph-report-1"],
  decisions: ["reuse-native-seams"],
  testSelection: ["programmeDomain.test.ts"],
  builderEligibility: "elig-builder-1",
  auditorEligibility: "elig-auditor-1",
  evidencePlan: { requiredCoverage: ["build", "test"], requireBuildEvidence: true },
  resourceBudget: { maxAttempts: 3, maxSpendMinorUnits: null },
};

const builderIdentity = {
  model: "model-A",
  harness: "harness-X",
  contextId: "ctx-A",
  account: null,
};

const builderRunWire = {
  schemaVersion: 1,
  orgId: ORG,
  projectId: PROJ,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
  retentionClass: "standard",
  visibilityClass: "team",
  runId: BUILDER_RUN,
  assignmentId: "assignment-1",
  taskId: TASK,
  ownerMemberId: BUILDER,
  executionEnvironmentId: ENV,
  providerInstanceId: null,
  workspaceRef: "ws-1",
  role: "builder",
  modelIdentity: builderIdentity,
  parentRunId: null,
  lineage: [{ runId: BUILDER_RUN, role: "builder", modelIdentity: builderIdentity }],
  authorityRef: "authority-1",
  epoch: 1,
  attemptId: "attempt-builder-1",
};

const auditorIdentity = {
  model: "model-B",
  harness: "harness-Y",
  contextId: "ctx-B",
  account: null,
};

const auditorRunWire = {
  ...builderRunWire,
  runId: AUDITOR_RUN,
  assignmentId: "assignment-2",
  ownerMemberId: AUDITOR,
  workspaceRef: "ws-2",
  role: "auditor",
  modelIdentity: auditorIdentity,
  lineage: [{ runId: AUDITOR_RUN, role: "auditor", modelIdentity: auditorIdentity }],
  attemptId: "attempt-auditor-1",
};

const evidenceWire = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  orgId: ORG,
  projectId: PROJ,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
  retentionClass: "standard",
  visibilityClass: "team",
  evidenceId: EV_BUILD,
  kind: "build",
  uri: "file:///tmp/build.log",
  digest: DIGEST_1,
  byteLength: 100,
  producedByRunId: BUILDER_RUN,
  sourceCommit: COMMIT_A,
  inputsHash: INPUTS_SHA,
  observedAt: NOW,
  toolIdentity: "vite-plus/1.0",
  result: "pass",
  coverage: ["build"],
  redactions: [],
  ...overrides,
});

const reviewWire = {
  schemaVersion: 1,
  orgId: ORG,
  projectId: PROJ,
  revision: 1,
  createdAt: LATER,
  updatedAt: LATER,
  retentionClass: "standard",
  visibilityClass: "team",
  reviewId: "review-1",
  taskId: TASK,
  builderRunId: BUILDER_RUN,
  auditorRunId: AUDITOR_RUN,
  exactCommit: COMMIT_A,
  scope: ["packages/contracts/src"],
  evidenceRefs: [EV_BUILD, EV_TEST],
  findings: [],
  disposition: "accepted",
  lineageCheck: "verified",
  coverage: ["build", "test"],
};

const PROGRAMME = decodeWire(Programme)(programmeWire);
const APPROVAL_DECODED = decodeWire(ProgrammeApproval)(approvalWire);
const WORK_ITEM = decodeWire(WorkItem)(workItemWire);
const TASK_PACKET = decodeWire(TaskPacket)(taskPacketWire);
const BUILDER_RUN_DECODED = decodeWire(ProgrammeAssignmentRun)(builderRunWire);
const AUDITOR_RUN_DECODED = decodeWire(ProgrammeAssignmentRun)(auditorRunWire);
const EVIDENCE_BUILD = decodeWire(ProgrammeEvidence)(evidenceWire());
const EVIDENCE_TEST = decodeWire(ProgrammeEvidence)(
  evidenceWire({
    evidenceId: EV_TEST,
    kind: "test",
    uri: "file:///tmp/test.log",
    digest: DIGEST_2,
    coverage: ["test"],
  }),
);

// Branded constants for typed port inputs; wire fixtures above stay plain strings.
const ORG_B = decodeWire(OrgId)(ORG);
const PROJECT2_B = decodeWire(ProjectId)(OTHER_PROJECT);
const PROJ_B = decodeWire(ProjectId)(PROJ);
const TASK2_B = decodeWire(TaskId)("task-2");
const AUDITOR_RUN_B = decodeWire(RunId)(AUDITOR_RUN);
const ENV2_B = decodeWire(EnvironmentId)("env-2");
const APPROVAL_B = decodeWire(ApprovalId)(APPROVAL);
const EV_BUILD_B = decodeWire(EvidenceId)(EV_BUILD);
const EV_TEST_B = decodeWire(EvidenceId)(EV_TEST);
const member = (s: string) => decodeWire(MemberId)(s);
const PRINCIPAL_BUILDER = decodeWire(PrincipalId)("principal-builder-1");
const PRINCIPAL_OTHER = decodeWire(PrincipalId)("principal-other-1");
const PRINCIPAL_ATTACKER = decodeWire(PrincipalId)("principal-attacker-1");
const PRINCIPAL_AUDITOR = decodeWire(PrincipalId)("principal-auditor-1");

const approvalVariant = (overrides: Record<string, unknown>) =>
  decodeWire(ProgrammeApproval)({ ...approvalWire, ...overrides });

const basePort = () =>
  makeLabelledFixtureAuthorityPort({
    resolveVerifiedActor: ({ requestedPrincipalId }) => ({
      principalId: requestedPrincipalId,
      memberId:
        requestedPrincipalId === PRINCIPAL_AUDITOR
          ? member(AUDITOR)
          : requestedPrincipalId === PRINCIPAL_BUILDER
            ? member(BUILDER)
            : member(OTHER),
      orgId: ORG_B,
    }),
    resolveApproval: () => ({ approval: APPROVAL_DECODED, revision: 2 }),
    resolveRunRecord: ({ runId }) =>
      runId === BUILDER_RUN
        ? { run: BUILDER_RUN_DECODED, revision: 1 }
        : runId === AUDITOR_RUN
          ? { run: AUDITOR_RUN_DECODED, revision: 1 }
          : null,
    resolveEvidenceRecord: ({ evidenceId }) =>
      evidenceId === EV_BUILD
        ? { evidence: EVIDENCE_BUILD, revision: 1 }
        : evidenceId === EV_TEST
          ? { evidence: EVIDENCE_TEST, revision: 1 }
          : null,
    resolveSourceRecord: () => ({ projectId: PROJ_B, commit: COMMIT_A }),
    resolveAttemptCount: () => 1,
  });

const admitInput = (overrides: Partial<Parameters<typeof admitBuildComplete>[0]> = {}) => ({
  port: basePort(),
  context: makeMutationContext(),
  programme: PROGRAMME,
  workItem: WORK_ITEM,
  taskPacket: TASK_PACKET,
  requestingRun: BUILDER_RUN_DECODED,
  requestingPrincipalId: PRINCIPAL_BUILDER,
  approvalId: APPROVAL_B,
  buildEvidenceIds: [EV_BUILD_B, EV_TEST_B],
  sourceCommit: COMMIT_A,
  expectedRevision: 5,
  idempotencyKey: "op-1",
  payloadDigest: DIGEST_1,
  now: NOW,
  ...overrides,
});

const reviewInput = (
  workItem: WorkItem,
  overrides: Partial<Parameters<typeof recordReview>[0]> = {},
) => ({
  port: basePort(),
  context: makeMutationContext(),
  requestingPrincipalId: PRINCIPAL_AUDITOR,
  workItem,
  taskPacket: TASK_PACKET,
  review: decodeWire(ProgrammeReview)(reviewWire),
  expectedRevision: workItem.revision,
  idempotencyKey: "review-1",
  payloadDigest: DIGEST_2,
  now: LATER,
  ...overrides,
});

// Full happy path up to reviewQueued: buildComplete admission then startReview.
const queuedWorkItem = () => {
  const admitted = admitBuildComplete(admitInput());
  const started = startReview({
    port: basePort(),
    context: makeMutationContext(),
    requestingPrincipalId: PRINCIPAL_BUILDER,
    workItem: admitted.workItem,
    expectedRevision: admitted.workItem.revision,
    idempotencyKey: "start-review-1",
    payloadDigest: DIGEST_1,
    now: LATER,
  });
  return started.workItem;
};

describe("schema negatives", () => {
  it("rejects an approval without actionScopes", () => {
    const { actionScopes: _scope, ...withoutScope } = approvalWire;
    expectDecodeFails(ProgrammeApproval, withoutScope);
  });

  it("rejects a work item without revision", () => {
    const { revision: _rev, ...withoutRevision } = workItemWire;
    expectDecodeFails(WorkItem, withoutRevision);
  });

  it("rejects malformed and upper-case digests", () => {
    expectDecodeFails(ProgrammeApproval, { ...approvalWire, specHash: "zz" });
    expectDecodeFails(ProgrammeApproval, { ...approvalWire, specHash: sha("A") });
  });

  it("rejects a malformed base commit hex", () => {
    expectDecodeFails(TaskPacket, { ...taskPacketWire, baseCommit: "a".repeat(39) });
    expectDecodeFails(TaskPacket, { ...taskPacketWire, baseCommit: "zz".repeat(20) });
  });

  it("rejects negative and non-integer revisions", () => {
    expectDecodeFails(WorkItem, { ...workItemWire, revision: -1 });
    expectDecodeFails(WorkItem, { ...workItemWire, revision: 1.5 });
  });

  it("rejects an unknown schema major version", () => {
    expectDecodeFails(Programme, { ...programmeWire, schemaVersion: 2 });
  });

  it("rejects blank branded identifiers", () => {
    expectDecodeFails(WorkItem, { ...workItemWire, workItemId: "   " });
  });

  it("rejects invalid dates", () => {
    expectDecodeFails(WorkItem, { ...workItemWire, createdAt: "not-a-date" });
  });

  it("rejects unsupported work item states including releaseReady and live", () => {
    expectDecodeFails(WorkItem, { ...workItemWire, state: "releaseReady" });
    expectDecodeFails(WorkItem, { ...workItemWire, state: "live" });
  });

  it("rejects unsupported approval effects", () => {
    expectDecodeFails(ProgrammeApproval, {
      ...approvalWire,
      actionScopes: ["editSource", "reboot"],
    });
  });

  it("rejects evidence with a missing or malformed digest", () => {
    expectDecodeFails(ProgrammeEvidence, evidenceWire({ digest: "" }));
    expectDecodeFails(ProgrammeEvidence, evidenceWire({ digest: "nothex" }));
  });
});

describe("admitBuildComplete", () => {
  it("admits from running, freezing the exact source commit and build proof; tested stays separate", () => {
    const result = admitBuildComplete(admitInput());
    expect(result.workItem.state).toBe("buildComplete");
    expect(result.workItem.buildCompletion?.sourceCommit).toBe(COMMIT_A);
    expect(result.workItem.buildCompletion?.builderRunId).toBe(BUILDER_RUN);
    expect(result.workItem.buildCompletion?.evidenceIds).toEqual([EV_BUILD, EV_TEST]);
    expect(result.workItem.testedMilestone ?? null).toBeNull();
    expect(result.workItem.state).not.toBe("accepted");
    expect(result.workItem.state).not.toBe("integrated");
    expect(result.receipt.revisionAfter).toBe(6);
  });

  it("admits from fixing as well", () => {
    const result = admitBuildComplete(admitInput({ workItem: { ...WORK_ITEM, state: "fixing" } }));
    expect(result.workItem.state).toBe("buildComplete");
  });

  it("rejects states outside running|fixing", () => {
    expectTagged(
      () => admitBuildComplete(admitInput({ workItem: { ...WORK_ITEM, state: "ready" } })),
      "ProgrammeInvalidRequestError",
    );
  });

  it("denies a stale expectedRevision with zero mutation", () => {
    expectTagged(
      () => admitBuildComplete(admitInput({ expectedRevision: 4 })),
      "ProgrammeRevisionConflictError",
    );
    expect(WORK_ITEM.revision).toBe(5);
    expect(WORK_ITEM.state).toBe("running");
  });

  it("denies a terminal work item", () => {
    expectTagged(
      () => admitBuildComplete(admitInput({ workItem: { ...WORK_ITEM, state: "integrated" } })),
      "ProgrammeForbiddenError",
    );
  });

  it("denies when the programme is closed: cancellation cannot revive terminal", () => {
    const closed = { ...PROGRAMME, state: "closed" as const };
    expectTagged(
      () => admitBuildComplete(admitInput({ programme: closed })),
      "ProgrammeForbiddenError",
    );
  });

  it("denies an unknown or wrong assignment", () => {
    // The authoritative run record, not the body, carries the assignment: a resolved wrong
    // task or wrong role denies, and a runId the port cannot resolve denies outright.
    const wrongTask = basePort();
    expectTagged(
      () =>
        admitBuildComplete(
          admitInput({
            port: {
              ...wrongTask,
              resolveRunRecord: ({ runId }: { runId: string }) =>
                runId === BUILDER_RUN
                  ? { run: { ...BUILDER_RUN_DECODED, taskId: TASK2_B }, revision: 1 }
                  : null,
            },
          }),
        ),
      "ProgrammeForbiddenError",
    );
    const wrongRole = basePort();
    expectTagged(
      () =>
        admitBuildComplete(
          admitInput({
            port: {
              ...wrongRole,
              resolveRunRecord: ({ runId }: { runId: string }) =>
                runId === BUILDER_RUN
                  ? { run: { ...BUILDER_RUN_DECODED, role: "auditor" as const }, revision: 1 }
                  : null,
            },
          }),
        ),
      "ProgrammeForbiddenError",
    );
    expectTagged(
      () =>
        admitBuildComplete(
          admitInput({
            requestingRun: { ...BUILDER_RUN_DECODED, runId: decodeWire(RunId)("run-unknown") },
          }),
        ),
      "ProgrammeCapabilityUnavailableError",
    );
  });

  it("denies forged principal claims: the port, not the body, names the actor", () => {
    const forged = basePort();
    const port = {
      ...forged,
      resolveVerifiedActor: () => ({
        principalId: PRINCIPAL_OTHER,
        memberId: member(OTHER),
        orgId: ORG_B,
      }),
    };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammeForbiddenError");
  });

  it("denies a forged run role: the port, not the body, names the run record", () => {
    // The authoritative record for the body's runId is an auditor run owned by the principal.
    const ownedAuditorRun = { ...AUDITOR_RUN_DECODED, ownerMemberId: member(BUILDER) };
    const forged = basePort();
    const port = {
      ...forged,
      resolveRunRecord: ({ runId }: { runId: string }) =>
        runId === AUDITOR_RUN ? { run: ownedAuditorRun, revision: 1 } : null,
    };
    // Body forges role builder with a matching owner, task and in-scope environment.
    const body = {
      ...AUDITOR_RUN_DECODED,
      ownerMemberId: member(BUILDER),
      role: "builder" as const,
    };
    expectTagged(
      () => admitBuildComplete(admitInput({ port, requestingRun: body })),
      "ProgrammeForbiddenError",
    );
  });

  it("denies body run fields that disagree with the resolved record: approval environment", () => {
    // Resolved record carries env-2 (outside approval scope); the body claims the in-scope env.
    const outOfScopeEnv = { ...BUILDER_RUN_DECODED, executionEnvironmentId: ENV2_B };
    const forged = basePort();
    const port = {
      ...forged,
      resolveRunRecord: ({ runId }: { runId: string }) =>
        runId === BUILDER_RUN ? { run: outOfScopeEnv, revision: 1 } : null,
    };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammePolicyDeniedError");
  });

  it("denies a wrong project", () => {
    const foreign = { ...TASK_PACKET, projectId: PROJECT2_B };
    expectTagged(
      () => admitBuildComplete(admitInput({ taskPacket: foreign })),
      "ProgrammeForbiddenError",
    );
  });

  it("denies a wrong organisation", () => {
    const forged = basePort();
    const port = {
      ...forged,
      resolveVerifiedActor: () => ({
        principalId: PRINCIPAL_BUILDER,
        memberId: member(BUILDER),
        orgId: decodeWire(OrgId)("org-2"),
      }),
    };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammeForbiddenError");
  });
});

describe("authority and approval gates", () => {
  it("denies when the port cannot resolve the actor: capability_unavailable", () => {
    const forged = basePort();
    const port = { ...forged, resolveVerifiedActor: () => null };
    expectTagged(
      () => admitBuildComplete(admitInput({ port })),
      "ProgrammeCapabilityUnavailableError",
    );
  });

  it("denies when the approval record is absent or unresolvable", () => {
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => null };
    expectTagged(
      () => admitBuildComplete(admitInput({ port })),
      "ProgrammeCapabilityUnavailableError",
    );
  });

  it("denies when the attempt ledger is absent", () => {
    const forged = basePort();
    const port = { ...forged, resolveAttemptCount: () => null };
    expectTagged(
      () => admitBuildComplete(admitInput({ port })),
      "ProgrammeCapabilityUnavailableError",
    );
  });

  it("denies an expired approval", () => {
    const expired = approvalVariant({ expiresAt: EARLIER });
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => ({ approval: expired, revision: 2 }) };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammePolicyDeniedError");
  });

  it("denies a revoked approval", () => {
    const revoked = approvalVariant({ revokedAt: EARLIER });
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => ({ approval: revoked, revision: 2 }) };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammePolicyDeniedError");
  });

  it("denies an approval bound to a different spec hash", () => {
    const staleSpec = approvalVariant({ specHash: sha("9") });
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => ({ approval: staleSpec, revision: 2 }) };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammePolicyDeniedError");
  });

  it("denies when the effect is not in the approval actionScopes", () => {
    const narrowed = approvalVariant({ actionScopes: ["read"] });
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => ({ approval: narrowed, revision: 2 }) };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammePolicyDeniedError");
  });

  it("denies an environment outside the approval scope", () => {
    const narrowed = approvalVariant({ environmentScope: ["env-2"] });
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => ({ approval: narrowed, revision: 2 }) };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammePolicyDeniedError");
  });

  it("denies a project outside the approval scope", () => {
    const narrowed = approvalVariant({ projectId: OTHER_PROJECT });
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => ({ approval: narrowed, revision: 2 }) };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammePolicyDeniedError");
  });

  it("denies paths the approval excludes", () => {
    const excluded = approvalVariant({ exclusions: ["packages/contracts/src"] });
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => ({ approval: excluded, revision: 2 }) };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammePolicyDeniedError");
  });

  it("admits when the approval target covers the work item", () => {
    const covered = approvalVariant({ targetIds: [WI] });
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => ({ approval: covered, revision: 2 }) };
    const result = admitBuildComplete(admitInput({ port }));
    expect(result.workItem.state).toBe("buildComplete");
  });

  it("denies a target outside the approval scope", () => {
    const narrowed = approvalVariant({ targetIds: ["workitem-99"] });
    const forged = basePort();
    const port = { ...forged, resolveApproval: () => ({ approval: narrowed, revision: 2 }) };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammePolicyDeniedError");
  });

  it("resolves port lookups with the aggregate organisation: cross-org records cannot satisfy a mutation", () => {
    const orgScoped = basePort();
    const seenRunOrgs: Array<string | undefined> = [];
    const port = {
      ...orgScoped,
      resolveRunRecord: (input: { runId: string; orgId?: string }) => {
        seenRunOrgs.push(input.orgId);
        return input.orgId === ORG
          ? orgScoped.resolveRunRecord({
              runId: decodeWire(RunId)(input.runId),
              orgId: decodeWire(OrgId)(input.orgId),
            })
          : null;
      },
    };
    const admitted = admitBuildComplete(admitInput({ port }));
    const reviewed = recordReview(reviewInput(queuedWorkItem(), { port }));
    expect(admitted.workItem.state).toBe("buildComplete");
    expect(reviewed.workItem.state).toBe("accepted");
    expect(seenRunOrgs.length).toBeGreaterThan(0);
    expect(seenRunOrgs.every((orgId) => orgId === ORG)).toBe(true);
  });

  it("denies an exceeded attempt budget", () => {
    const forged = basePort();
    const port = { ...forged, resolveAttemptCount: () => 3 };
    expectTagged(() => admitBuildComplete(admitInput({ port })), "ProgrammeBudgetExceededError");
  });
});

describe("replay and idempotency", () => {
  it("replays the original result for the same scoped key and payload with no second revision", () => {
    const context = makeMutationContext();
    const first = admitBuildComplete(admitInput({ context }));
    const second = admitBuildComplete(admitInput({ context }));
    expect(second.workItem.state).toBe("buildComplete");
    expect(second.workItem.revision).toBe(first.workItem.revision);
    expect(second.receipt.revisionAfter).toBe(first.receipt.revisionAfter);
    expect(context.replayRecords.size).toBe(1);
  });

  it("denies the same key with a different payload digest: idempotency_conflict", () => {
    const context = makeMutationContext();
    admitBuildComplete(admitInput({ context }));
    expectTagged(
      () => admitBuildComplete(admitInput({ context, payloadDigest: DIGEST_2 })),
      "ProgrammeIdempotencyConflictError",
    );
  });

  it("denies cross-principal reuse of the same aggregate/operation/key", () => {
    const context = makeMutationContext();
    admitBuildComplete(admitInput({ context }));
    expectTagged(
      () => admitBuildComplete(admitInput({ context, requestingPrincipalId: PRINCIPAL_ATTACKER })),
      "ProgrammeForbiddenError",
    );
  });

  it("denies startReview on a terminal work item even with a fresh key", () => {
    expectTagged(
      () =>
        startReview({
          port: basePort(),
          context: makeMutationContext(),
          requestingPrincipalId: PRINCIPAL_BUILDER,
          workItem: { ...WORK_ITEM, state: "integrated" },
          expectedRevision: 5,
          idempotencyKey: "revive-1",
          payloadDigest: DIGEST_1,
          now: LATER,
        }),
      "ProgrammeForbiddenError",
    );
  });
});

describe("startReview", () => {
  it("moves a buildComplete work item to reviewQueued with verified authority", () => {
    const admitted = admitBuildComplete(admitInput());
    const started = startReview({
      port: basePort(),
      context: makeMutationContext(),
      requestingPrincipalId: PRINCIPAL_BUILDER,
      workItem: admitted.workItem,
      expectedRevision: admitted.workItem.revision,
      idempotencyKey: "start-review-1",
      payloadDigest: DIGEST_1,
      now: LATER,
    });
    expect(started.workItem.state).toBe("reviewQueued");
    expect(started.receipt.revisionAfter).toBe(7);
  });

  it("denies startReview from a non-buildComplete state", () => {
    expectTagged(
      () =>
        startReview({
          port: basePort(),
          context: makeMutationContext(),
          requestingPrincipalId: PRINCIPAL_BUILDER,
          workItem: WORK_ITEM,
          expectedRevision: 5,
          idempotencyKey: "start-review-2",
          payloadDigest: DIGEST_1,
          now: LATER,
        }),
      "ProgrammeInvalidRequestError",
    );
  });

  it("denies startReview when the port cannot verify the actor", () => {
    const admitted = admitBuildComplete(admitInput());
    const forged = basePort();
    const port = { ...forged, resolveVerifiedActor: () => null };
    expectTagged(
      () =>
        startReview({
          port,
          context: makeMutationContext(),
          requestingPrincipalId: PRINCIPAL_BUILDER,
          workItem: admitted.workItem,
          expectedRevision: admitted.workItem.revision,
          idempotencyKey: "start-review-3",
          payloadDigest: DIGEST_1,
          now: LATER,
        }),
      "ProgrammeCapabilityUnavailableError",
    );
  });
});

describe("recordReview", () => {
  it("accepts a separate eligible review and records the disposition with exact data comparison", () => {
    const workItem = queuedWorkItem();
    const result = recordReview(reviewInput(workItem));
    expect(result.workItem.state).toBe("accepted");
    expect(result.review.disposition).toBe("accepted");
    expect(result.review.lineageCheck).toBe("verified");
    expect(result.receipt.revisionAfter).toBe(8);
  });

  it("accepts an auditor on a model name that appears on no fixed list", () => {
    const workItem = queuedWorkItem();
    const novelAuditor = {
      ...AUDITOR_RUN_DECODED,
      modelIdentity: {
        model: "made-up-model-xyz",
        harness: "harness-Z",
        contextId: "ctx-novel",
        account: null,
      },
      lineage: [
        {
          runId: AUDITOR_RUN_B,
          role: "auditor" as const,
          modelIdentity: {
            model: "made-up-model-xyz",
            harness: "harness-Z",
            contextId: "ctx-novel",
            account: null,
          },
        },
      ],
    };
    const forged = basePort();
    const port = {
      ...forged,
      resolveRunRecord: ({ runId }: { runId: string }) =>
        runId === AUDITOR_RUN
          ? { run: novelAuditor, revision: 1 }
          : { run: BUILDER_RUN_DECODED, revision: 1 },
    };
    const result = recordReview(reviewInput(workItem, { port }));
    expect(result.workItem.state).toBe("accepted");
  });

  it("rejects a review with disposition rejected: no acceptance and no mutation", () => {
    const workItem = queuedWorkItem();
    const rejected = { ...reviewWire, disposition: "rejected" };
    expectTagged(
      () => recordReview(reviewInput(workItem, { review: decodeWire(ProgrammeReview)(rejected) })),
      "ProgrammeInvalidRequestError",
    );
    expect(workItem.state).toBe("reviewQueued");
    expect(workItem.revision).toBe(7);
  });

  it("rejects a review with disposition incomplete: evidence_missing path without mutation", () => {
    const workItem = queuedWorkItem();
    const incomplete = { ...reviewWire, disposition: "incomplete" };
    expectTagged(
      () =>
        recordReview(reviewInput(workItem, { review: decodeWire(ProgrammeReview)(incomplete) })),
      "ProgrammeEvidenceMissingError",
    );
    expect(workItem.state).toBe("reviewQueued");
    expect(workItem.revision).toBe(7);
  });

  it("rejects self-review: the auditor run cannot be the builder run", () => {
    const workItem = queuedWorkItem();
    const selfReview = { ...reviewWire, auditorRunId: BUILDER_RUN, disposition: "accepted" };
    expectTagged(
      () =>
        recordReview(reviewInput(workItem, { review: decodeWire(ProgrammeReview)(selfReview) })),
      "ProgrammeForbiddenError",
    );
  });

  it("rejects shared lineage: the auditor identity may not equal any builder-run lineage entry", () => {
    const workItem = queuedWorkItem();
    const sharedAuditor = { ...AUDITOR_RUN_DECODED, modelIdentity: builderIdentity };
    const forged = basePort();
    const port = {
      ...forged,
      resolveRunRecord: ({ runId }: { runId: string }) =>
        runId === AUDITOR_RUN
          ? { run: sharedAuditor, revision: 1 }
          : { run: BUILDER_RUN_DECODED, revision: 1 },
    };
    expectTagged(() => recordReview(reviewInput(workItem, { port })), "ProgrammeForbiddenError");
  });

  it("rejects an auditor with unknown model/context identity", () => {
    const workItem = queuedWorkItem();
    const unknownAuditor = { ...AUDITOR_RUN_DECODED, modelIdentity: null };
    const forged = basePort();
    const port = {
      ...forged,
      resolveRunRecord: ({ runId }: { runId: string }) =>
        runId === AUDITOR_RUN
          ? { run: unknownAuditor, revision: 1 }
          : { run: BUILDER_RUN_DECODED, revision: 1 },
    };
    expectTagged(
      () => recordReview(reviewInput(workItem, { port })),
      "ProgrammeEvidenceMissingError",
    );
  });

  it("rejects an auditor run bound to the wrong task", () => {
    const workItem = queuedWorkItem();
    const stranger = { ...AUDITOR_RUN_DECODED, taskId: TASK2_B };
    const forged = basePort();
    const port = {
      ...forged,
      resolveRunRecord: ({ runId }: { runId: string }) =>
        runId === AUDITOR_RUN
          ? { run: stranger, revision: 1 }
          : { run: BUILDER_RUN_DECODED, revision: 1 },
    };
    expectTagged(
      () => recordReview(reviewInput(workItem, { port })),
      "ProgrammeInvalidRequestError",
    );
  });

  it("rejects a review bound to the wrong task packet", () => {
    const workItem = queuedWorkItem();
    const wrongReview = { ...reviewWire, taskId: "task-2" };
    expectTagged(
      () =>
        recordReview(reviewInput(workItem, { review: decodeWire(ProgrammeReview)(wrongReview) })),
      "ProgrammeInvalidRequestError",
    );
  });

  it("rejects a review whose exactCommit differs from the frozen source", () => {
    const workItem = queuedWorkItem();
    const wrongCommit = { ...reviewWire, exactCommit: COMMIT_B };
    expectTagged(
      () =>
        recordReview(reviewInput(workItem, { review: decodeWire(ProgrammeReview)(wrongCommit) })),
      "ProgrammeInvalidRequestError",
    );
  });

  it("rejects evidence references that do not resolve", () => {
    const workItem = queuedWorkItem();
    const missingEvidence = { ...reviewWire, evidenceRefs: ["evidence-unknown"] };
    expectTagged(
      () =>
        recordReview(
          reviewInput(workItem, { review: decodeWire(ProgrammeReview)(missingEvidence) }),
        ),
      "ProgrammeEvidenceMissingError",
    );
  });

  it("rejects evidence produced outside the builder lineage", () => {
    const workItem = queuedWorkItem();
    const foreignEvidence = decodeWire(ProgrammeEvidence)(
      evidenceWire({ producedByRunId: AUDITOR_RUN, coverage: ["build", "test"] }),
    );
    const forged = basePort();
    const port = {
      ...forged,
      resolveEvidenceRecord: () => ({ evidence: foreignEvidence, revision: 1 }),
    };
    expectTagged(
      () => recordReview(reviewInput(workItem, { port })),
      "ProgrammeInvalidRequestError",
    );
  });

  it("rejects a review whose evidence does not satisfy the required coverage", () => {
    const workItem = queuedWorkItem();
    const partial = { ...reviewWire, evidenceRefs: [EV_BUILD] };
    expectTagged(
      () => recordReview(reviewInput(workItem, { review: decodeWire(ProgrammeReview)(partial) })),
      "ProgrammeEvidenceMissingError",
    );
  });

  it("rejects when the authoritative source moved after the build was frozen: source_stale", () => {
    const workItem = queuedWorkItem();
    const forged = basePort();
    const port = {
      ...forged,
      resolveSourceRecord: () => ({ projectId: PROJ_B, commit: COMMIT_B }),
    };
    expectTagged(() => recordReview(reviewInput(workItem, { port })), "ProgrammeSourceStaleError");
  });

  it("denies recording a review outside reviewQueued|reviewing", () => {
    expectTagged(() => recordReview(reviewInput(WORK_ITEM)), "ProgrammeInvalidRequestError");
  });
});

describe("typed errors", () => {
  it("exposes each exercised PRD error with its exact tag and preserves its payload fields", () => {
    expect(new ProgrammeCapabilityUnavailableError({ message: "probe" })._tag).toBe(
      "ProgrammeCapabilityUnavailableError",
    );
    expect(new ProgrammeRevisionConflictError({ message: "probe" })._tag).toBe(
      "ProgrammeRevisionConflictError",
    );
    expect(new ProgrammeIdempotencyConflictError({ message: "probe" })._tag).toBe(
      "ProgrammeIdempotencyConflictError",
    );
    expect(new ProgrammeForbiddenError({ message: "probe" })._tag).toBe("ProgrammeForbiddenError");
    expect(new ProgrammeInvalidRequestError({ message: "probe" })._tag).toBe(
      "ProgrammeInvalidRequestError",
    );
    expect(new ProgrammePolicyDeniedError({ message: "probe" })._tag).toBe(
      "ProgrammePolicyDeniedError",
    );
    const stale = new ProgrammeSourceStaleError({
      message: "probe",
      frozenCommit: COMMIT_A,
      currentCommit: COMMIT_B,
    });
    expect(stale._tag).toBe("ProgrammeSourceStaleError");
    expect(stale.frozenCommit).toBe(COMMIT_A);
    expect(stale.currentCommit).toBe(COMMIT_B);
    const missing = new ProgrammeEvidenceMissingError({
      message: "probe",
      suggestedDisposition: "incomplete",
      missingCoverage: ["build"],
    });
    expect(missing._tag).toBe("ProgrammeEvidenceMissingError");
    expect(missing.suggestedDisposition).toBe("incomplete");
    expect(missing.missingCoverage).toEqual(["build"]);
    const budget = new ProgrammeBudgetExceededError({
      message: "probe",
      attempts: 3,
      maxAttempts: 3,
    });
    expect(budget._tag).toBe("ProgrammeBudgetExceededError");
    expect(budget.attempts).toBe(3);
    expect(budget.maxAttempts).toBe(3);
  });
});

const expectReviewDenial = (
  overrides: Partial<Parameters<typeof recordReview>[0]>,
  tag: string,
) => {
  const input = reviewInput(queuedWorkItem(), overrides);
  const before = JSON.stringify(input.workItem);
  expectTagged(() => recordReview(input), tag);
  expect(JSON.stringify(input.workItem)).toBe(before);
  expect(input.context.replayRecords.size).toBe(0);
  expect(input.context.aggregateKeyIndex.size).toBe(0);
};

const expectBuildDenial = (
  overrides: Partial<Parameters<typeof admitBuildComplete>[0]>,
  tag = "ProgrammeForbiddenError",
) => {
  const input = admitInput(overrides);
  const before = JSON.stringify(input.workItem);
  expectTagged(() => admitBuildComplete(input), tag);
  expect(JSON.stringify(input.workItem)).toBe(before);
  expect(input.context.replayRecords.size).toBe(0);
  expect(input.context.aggregateKeyIndex.size).toBe(0);
};

describe("D1 evidence proof binding", () => {
  it.each(["fail", "unknown"])("denies %s evidence", (result) => {
    const fixture = basePort();
    expectReviewDenial(
      {
        port: {
          ...fixture,
          resolveEvidenceRecord: (request) => {
            const resolved = fixture.resolveEvidenceRecord(request);
            return resolved === null
              ? null
              : {
                  ...resolved,
                  evidence: { ...resolved.evidence, result: result as "fail" | "unknown" },
                };
          },
        },
      },
      "ProgrammeEvidenceMissingError",
    );
  });
  it.each([COMMIT_B, null])("denies evidence source %s", (sourceCommit) => {
    const fixture = basePort();
    expectReviewDenial(
      {
        port: {
          ...fixture,
          resolveEvidenceRecord: (request) => {
            const resolved = fixture.resolveEvidenceRecord(request);
            return resolved === null
              ? null
              : { ...resolved, evidence: { ...resolved.evidence, sourceCommit } };
          },
        },
      },
      sourceCommit === null ? "ProgrammeEvidenceMissingError" : "ProgrammeSourceStaleError",
    );
  });
  it.each([{ evidenceId: "wrong-evidence" }, { orgId: "wrong-org" }])(
    "denies returned evidence scope %j",
    (variant) => {
      const fixture = basePort();
      expectReviewDenial(
        {
          port: {
            ...fixture,
            resolveEvidenceRecord: () => ({
              evidence: decodeWire(ProgrammeEvidence)(
                evidenceWire({ ...variant, coverage: ["build", "test"] }),
              ),
              revision: 1,
            }),
          },
        },
        "ProgrammeInvalidRequestError",
      );
    },
  );
});

describe("D2 complete independent identity", () => {
  it.each([
    { modelIdentity: null },
    { lineage: [{ runId: BUILDER_RUN, role: "builder", modelIdentity: null }] },
  ])("denies unknown builder lineage %j", (variant) => {
    const builder = decodeWire(ProgrammeAssignmentRun)({ ...builderRunWire, ...variant });
    const fixture = basePort();
    expectReviewDenial(
      {
        port: {
          ...fixture,
          resolveRunRecord: (request) =>
            request.runId === BUILDER_RUN
              ? { run: builder, revision: 1 }
              : fixture.resolveRunRecord(request),
        },
      },
      "ProgrammeEvidenceMissingError",
    );
  });
  it.each([
    { ...auditorIdentity, model: builderIdentity.model },
    { ...auditorIdentity, contextId: builderIdentity.contextId },
  ])("denies shared model or context %j", (identity) => {
    const fixture = basePort();
    expectReviewDenial(
      {
        port: {
          ...fixture,
          resolveRunRecord: (request) =>
            request.runId === AUDITOR_RUN
              ? { run: { ...AUDITOR_RUN_DECODED, modelIdentity: identity }, revision: 1 }
              : fixture.resolveRunRecord(request),
        },
      },
      "ProgrammeForbiddenError",
    );
  });
  it("denies an auditor run ID present in builder lineage despite distinct labels", () => {
    const fixture = basePort();
    expectReviewDenial(
      {
        port: {
          ...fixture,
          resolveRunRecord: (request) =>
            request.runId === BUILDER_RUN
              ? {
                  run: {
                    ...BUILDER_RUN_DECODED,
                    lineage: [
                      { runId: AUDITOR_RUN_B, role: "builder", modelIdentity: builderIdentity },
                    ],
                  },
                  revision: 1,
                }
              : fixture.resolveRunRecord(request),
        },
      },
      "ProgrammeForbiddenError",
    );
  });
});

describe("D3 aggregate and authoritative record joins", () => {
  it.each([
    { taskPacket: decodeWire(TaskPacket)({ ...taskPacketWire, workItemId: "wrong-work" }) },
    { taskPacket: decodeWire(TaskPacket)({ ...taskPacketWire, orgId: "wrong-org" }) },
    { workItem: decodeWire(WorkItem)({ ...workItemWire, programmeId: "wrong-programme" }) },
    { workItem: decodeWire(WorkItem)({ ...workItemWire, orgId: "wrong-org" }) },
  ])("denies build aggregate mismatch %j", (variant) => expectBuildDenial(variant));
  it.each([
    { taskPacket: decodeWire(TaskPacket)({ ...taskPacketWire, workItemId: "wrong-work" }) },
    { taskPacket: decodeWire(TaskPacket)({ ...taskPacketWire, orgId: "wrong-org" }) },
    { taskPacket: decodeWire(TaskPacket)({ ...taskPacketWire, projectId: OTHER_PROJECT }) },
    { review: decodeWire(ProgrammeReview)({ ...reviewWire, orgId: "wrong-org" }) },
    { review: decodeWire(ProgrammeReview)({ ...reviewWire, projectId: OTHER_PROJECT }) },
  ])("denies review aggregate mismatch %j", (variant) =>
    expectReviewDenial(variant, "ProgrammeInvalidRequestError"),
  );
  it("denies substitution of another builder attempt for the frozen writer", () => {
    const fixture = basePort();
    const alternateId = RunId.make("alternate-builder");
    expectReviewDenial(
      {
        review: { ...decodeWire(ProgrammeReview)(reviewWire), builderRunId: alternateId },
        port: {
          ...fixture,
          resolveRunRecord: (request) =>
            request.runId === alternateId
              ? { run: { ...BUILDER_RUN_DECODED, runId: alternateId }, revision: 1 }
              : fixture.resolveRunRecord(request),
        },
      },
      "ProgrammeInvalidRequestError",
    );
  });
  it.each([{ runId: "wrong-run" }, { orgId: "wrong-org" }, { projectId: OTHER_PROJECT }])(
    "denies build resolved run mismatch %j",
    (variant) => {
      expectBuildDenial({
        port: {
          ...basePort(),
          resolveRunRecord: () => ({
            run: decodeWire(ProgrammeAssignmentRun)({ ...builderRunWire, ...variant }),
            revision: 1,
          }),
        },
      });
    },
  );
  for (const role of ["builder", "auditor"] as const) {
    it.each([
      { runId: "wrong-run" },
      { orgId: "wrong-org" },
      { projectId: OTHER_PROJECT },
      { taskId: "wrong-task" },
      { role: role === "builder" ? "auditor" : "builder" },
    ])(`denies review resolved ${role} mismatch %j`, (variant) => {
      const target = role === "builder" ? BUILDER_RUN : AUDITOR_RUN;
      const wire = role === "builder" ? builderRunWire : auditorRunWire;
      const fixture = basePort();
      expectReviewDenial(
        {
          port: {
            ...fixture,
            resolveRunRecord: (request) =>
              request.runId === target
                ? { run: decodeWire(ProgrammeAssignmentRun)({ ...wire, ...variant }), revision: 1 }
                : fixture.resolveRunRecord(request),
          },
        },
        "ProgrammeInvalidRequestError",
      );
    });
  }
  it("denies a returned source record for another project", () =>
    expectReviewDenial(
      {
        port: {
          ...basePort(),
          resolveSourceRecord: () => ({ projectId: PROJECT2_B, commit: COMMIT_A }),
        },
      },
      "ProgrammeInvalidRequestError",
    ));
  it.each(["admit", "start", "record"])(
    "denies a mismatched verified principal for %s",
    (operation) => {
      const fixture = basePort();
      const port = {
        ...fixture,
        resolveVerifiedActor: (request: { requestedPrincipalId: PrincipalId; orgId: OrgId }) => {
          const actor = fixture.resolveVerifiedActor(request);
          return actor === null ? null : { ...actor, principalId: PRINCIPAL_OTHER };
        },
      };
      if (operation === "admit") expectBuildDenial({ port });
      else if (operation === "record") expectReviewDenial({ port }, "ProgrammeForbiddenError");
      else {
        const admitted = admitBuildComplete(admitInput());
        const context = makeMutationContext();
        expectTagged(
          () =>
            startReview({
              port,
              context,
              requestingPrincipalId: PRINCIPAL_BUILDER,
              workItem: admitted.workItem,
              expectedRevision: 6,
              idempotencyKey: "start",
              payloadDigest: DIGEST_1,
              now: LATER,
            }),
          "ProgrammeForbiddenError",
        );
        expect(context.replayRecords.size).toBe(0);
        expect(admitted.workItem.revision).toBe(6);
      }
    },
  );
});

describe("D4 original result and safe replay scope", () => {
  it("returns the saved review when a caller changes review findings and disposition", () => {
    const input = reviewInput(queuedWorkItem());
    const first = recordReview(input);
    const second = recordReview({
      ...input,
      review: {
        ...input.review,
        disposition: "rejected",
        findings: [{ severity: "major", description: "caller changed", path: null }],
      },
    });
    expect(second).toEqual(first);
    expect(input.context.replayRecords.size).toBe(1);
  });
  it("denies reusing a review receipt for another work item", () => {
    const input = reviewInput(queuedWorkItem());
    recordReview(input);
    const other = { ...input.workItem, workItemId: WorkItemId.make("other-work") };
    expectTagged(
      () =>
        recordReview({
          ...input,
          workItem: other,
          taskPacket: { ...input.taskPacket, workItemId: other.workItemId },
        }),
      "ProgrammeIdempotencyConflictError",
    );
    expect(input.context.replayRecords.size).toBe(1);
  });
  it.each(["admit", "start", "record"])("rechecks verified authority on %s replay", (operation) => {
    const port = { ...basePort(), resolveVerifiedActor: () => null };
    if (operation === "admit") {
      const input = admitInput();
      admitBuildComplete(input);
      expectTagged(
        () => admitBuildComplete({ ...input, port }),
        "ProgrammeCapabilityUnavailableError",
      );
    } else if (operation === "record") {
      const input = reviewInput(queuedWorkItem());
      recordReview(input);
      expectTagged(() => recordReview({ ...input, port }), "ProgrammeCapabilityUnavailableError");
    } else {
      const admitted = admitBuildComplete(admitInput());
      const input = {
        port: basePort(),
        context: makeMutationContext(),
        requestingPrincipalId: PRINCIPAL_BUILDER,
        workItem: admitted.workItem,
        expectedRevision: 6,
        idempotencyKey: "start",
        payloadDigest: DIGEST_1,
        now: LATER,
      };
      startReview(input);
      expectTagged(() => startReview({ ...input, port }), "ProgrammeCapabilityUnavailableError");
    }
  });
  it("keeps arbitrary delimiter identifiers distinct in receipt scope", () => {
    const context = makeMutationContext();
    const first = admitInput({
      context,
      workItem: { ...WORK_ITEM, workItemId: WorkItemId.make("work|admitBuildComplete") },
      taskPacket: { ...TASK_PACKET, workItemId: WorkItemId.make("work|admitBuildComplete") },
      idempotencyKey: "key",
    });
    const second = admitInput({
      context,
      workItem: { ...WORK_ITEM, workItemId: WorkItemId.make("work") },
      taskPacket: { ...TASK_PACKET, workItemId: WorkItemId.make("work") },
      idempotencyKey: "admitBuildComplete|key",
    });
    const port = {
      ...basePort(),
      resolveApproval: () => ({
        approval: {
          ...APPROVAL_DECODED,
          targetIds: [first.workItem.workItemId, second.workItem.workItemId],
        },
        revision: 2,
      }),
    };
    admitBuildComplete({ ...first, port });
    const result = admitBuildComplete({ ...second, port });
    expect(result.workItem.workItemId).toBe(second.workItem.workItemId);
    expect(context.replayRecords.size).toBe(2);
  });
});

describe("D6 active programme holds", () => {
  it.each(["paused", "needsDecision", "blocked"])("denies %s with zero mutation", (hold) =>
    expectBuildDenial({ programme: { ...PROGRAMME, holds: { [hold]: "active hold" } } }),
  );
  it("admits when all hold reasons are explicitly null", () =>
    expect(
      admitBuildComplete(
        admitInput({
          programme: {
            ...PROGRAMME,
            holds: {
              paused: null,
              needsDecision: null,
              blocked: null,
              cancelRequested: null,
              cancelled: null,
            },
          },
        }),
      ).workItem.state,
    ).toBe("buildComplete"));
});

describe("D1 frozen evidence and D4 organisation replay controls", () => {
  it("requires the frozen build evidence even if substitute proof covers every label", () => {
    const fixture = basePort();
    const substitute = decodeWire(ProgrammeEvidence)(
      evidenceWire({ evidenceId: "substitute", coverage: ["build", "test"] }),
    );
    expectReviewDenial(
      {
        review: decodeWire(ProgrammeReview)({ ...reviewWire, evidenceRefs: ["substitute"] }),
        port: { ...fixture, resolveEvidenceRecord: () => ({ evidence: substitute, revision: 1 }) },
      },
      "ProgrammeEvidenceMissingError",
    );
  });
  it("keeps the same operation key independent between organisations and principals", () => {
    const context = makeMutationContext();
    admitBuildComplete(admitInput({ context }));
    const orgId = OrgId.make("org-2");
    const principalId = PRINCIPAL_OTHER;
    const port = {
      ...basePort(),
      resolveVerifiedActor: () => ({ principalId, orgId, memberId: member(BUILDER) }),
      resolveRunRecord: () => ({ run: { ...BUILDER_RUN_DECODED, orgId }, revision: 1 }),
      resolveApproval: () => ({ approval: { ...APPROVAL_DECODED, orgId }, revision: 2 }),
    };
    const result = admitBuildComplete(
      admitInput({
        context,
        port,
        requestingPrincipalId: principalId,
        programme: { ...PROGRAMME, orgId },
        workItem: { ...WORK_ITEM, orgId },
        taskPacket: { ...TASK_PACKET, orgId },
      }),
    );
    expect(result.workItem.orgId).toBe(orgId);
    expect(context.replayRecords.size).toBe(2);
    expect(context.aggregateKeyIndex.size).toBe(2);
  });
  it.each(["admit", "start", "record"])("denies changing project on %s replay", (operation) => {
    if (operation === "admit") {
      const input = admitInput();
      admitBuildComplete(input);
      expectTagged(
        () =>
          admitBuildComplete({ ...input, workItem: { ...input.workItem, projectId: PROJECT2_B } }),
        "ProgrammeForbiddenError",
      );
    } else if (operation === "record") {
      const input = reviewInput(queuedWorkItem());
      recordReview(input);
      expectTagged(
        () => recordReview({ ...input, workItem: { ...input.workItem, projectId: PROJECT2_B } }),
        "ProgrammeInvalidRequestError",
      );
    } else {
      const admitted = admitBuildComplete(admitInput());
      const input = {
        port: basePort(),
        context: makeMutationContext(),
        requestingPrincipalId: PRINCIPAL_BUILDER,
        workItem: admitted.workItem,
        expectedRevision: 6,
        idempotencyKey: "start",
        payloadDigest: DIGEST_1,
        now: LATER,
      };
      startReview(input);
      expectTagged(
        () => startReview({ ...input, workItem: { ...input.workItem, projectId: PROJECT2_B } }),
        "ProgrammeIdempotencyConflictError",
      );
    }
  });
  it.each(["paused", "needsDecision", "blocked"])("denies %s hold on build replay", (hold) => {
    const input = admitInput();
    admitBuildComplete(input);
    expectTagged(
      () =>
        admitBuildComplete({
          ...input,
          programme: { ...input.programme, holds: { [hold]: "active hold" } },
        }),
      "ProgrammeForbiddenError",
    );
    expect(input.context.replayRecords.size).toBe(1);
  });
});

describe("D4 original review snapshot", () => {
  it("preserves saved proof when the caller retains and changes a findings array", () => {
    const findings: Array<ProgrammeReview["findings"][number]> = [];
    const input = reviewInput(queuedWorkItem(), {
      review: { ...decodeWire(ProgrammeReview)(reviewWire), findings },
    });
    recordReview(input);
    findings.push({ severity: "major", description: "changed after acceptance", path: null });
    const replay = recordReview(input);
    expect(replay.review.findings).toEqual([]);
    expect(replay.review.disposition).toBe("accepted");
    expect(input.context.replayRecords.size).toBe(1);
  });
});

describe("D4 replay result isolation", () => {
  const operations = ["admitBuildComplete", "startReview", "recordReview"] as const;
  const returnedCases = operations.flatMap((operation) =>
    (["initial", "replay"] as const).map((returned) => ({ operation, returned })),
  );

  const setupReplay = (operation: (typeof operations)[number]) => {
    const workItem = decodeWire(WorkItem)({
      ...workItemWire,
      dependencies: ["dependency-1"],
      dueAt: LATER,
      testedMilestone: { evidenceIds: [EV_TEST], recordedAt: NOW },
      ...(operation === "admitBuildComplete"
        ? {}
        : {
            state: operation === "startReview" ? "buildComplete" : "reviewQueued",
            buildCompletion: {
              sourceCommit: COMMIT_A,
              builderRunId: BUILDER_RUN,
              evidenceIds: [EV_BUILD, EV_TEST],
              admittedAt: NOW,
            },
          }),
    });
    const context = makeMutationContext();
    const review = decodeWire(ProgrammeReview)({
      ...reviewWire,
      findings: [{ severity: "note", description: "original note", path: "original.ts" }],
    });
    const buildEvidenceIds = [EV_BUILD_B, EV_TEST_B];
    const admit = admitInput({ context, workItem, buildEvidenceIds });
    const start = {
      port: basePort(),
      context,
      requestingPrincipalId: PRINCIPAL_BUILDER,
      workItem,
      expectedRevision: workItem.revision,
      idempotencyKey: "isolated-start",
      payloadDigest: DIGEST_1,
      now: LATER,
    };
    const record = reviewInput(workItem, { context, review });
    const invoke = (): {
      workItem: WorkItem;
      receipt: MutationReceipt;
      review?: ProgrammeReview;
    } => {
      switch (operation) {
        case "admitBuildComplete":
          return admitBuildComplete(admit);
        case "startReview":
          return startReview(start);
        case "recordReview":
          return recordReview(record);
      }
    };
    return { context, workItem, review, buildEvidenceIds, invoke };
  };

  type ReplayResult = ReturnType<ReturnType<typeof setupReplay>["invoke"]>;
  const encodeResult = (result: ReplayResult) =>
    structuredClone({
      workItem: encodeWorkItem(result.workItem),
      receipt: { ...result.receipt },
      ...(result.review !== undefined ? { review: encodeReview(result.review) } : {}),
    });

  const mutateWorkItem = (workItem: WorkItem) => {
    Object.assign(workItem, { title: "changed", state: "running", revision: 999 });
    Object.assign(workItem.acceptance, { 0: "changed" });
    Object.assign(workItem.sourceRefs, { 0: "changed" });
    Object.assign(workItem.requirementIds, { 0: "changed" });
    Object.assign(workItem.dependencies, { 0: "changed" });
    Object.assign(workItem.createdAt, { epochMilliseconds: 0 });
    Object.assign(workItem.updatedAt, { epochMilliseconds: 0 });
    if (workItem.dueAt !== null) Object.assign(workItem.dueAt, { epochMilliseconds: 0 });
    if (workItem.buildCompletion) {
      Object.assign(workItem.buildCompletion, { sourceCommit: COMMIT_B });
      Object.assign(workItem.buildCompletion.evidenceIds, { 0: EV_TEST_B });
      Object.assign(workItem.buildCompletion.admittedAt, { epochMilliseconds: 0 });
    }
    if (workItem.testedMilestone) {
      Object.assign(workItem.testedMilestone.evidenceIds, { 0: EV_BUILD_B });
      Object.assign(workItem.testedMilestone.recordedAt, { epochMilliseconds: 0 });
    }
  };

  const mutateReview = (review: ProgrammeReview) => {
    Object.assign(review.scope, { 0: "changed" });
    Object.assign(review.evidenceRefs, { 0: EV_TEST_B });
    Object.assign(review.findings[0]!, { description: "changed", path: "changed.ts" });
    Object.assign(review.coverage, { 0: "changed" });
    Object.assign(review.createdAt, { epochMilliseconds: 0 });
    Object.assign(review.updatedAt, { epochMilliseconds: 0 });
  };

  const expectOriginalReplay = (
    fixture: ReturnType<typeof setupReplay>,
    expected: ReturnType<typeof encodeResult>,
  ) => {
    const replay = fixture.invoke();
    expect(encodeResult(replay)).toEqual(expected);
    expect(DateTime.isUtc(replay.workItem.createdAt)).toBe(true);
    expect(DateTime.isUtc(replay.workItem.updatedAt)).toBe(true);
    expect(DateTime.isUtc(replay.workItem.dueAt!)).toBe(true);
    expect(DateTime.isUtc(replay.workItem.buildCompletion!.admittedAt)).toBe(true);
    expect(DateTime.isUtc(replay.workItem.testedMilestone!.recordedAt)).toBe(true);
    if (replay.review !== undefined) {
      expect(DateTime.isUtc(replay.review.createdAt)).toBe(true);
      expect(DateTime.isUtc(replay.review.updatedAt)).toBe(true);
    }
    expect(replay.workItem.revision).toBe(6);
    expect(fixture.context.replayRecords.size).toBe(1);
    expect(fixture.context.aggregateKeyIndex.size).toBe(1);
  };

  it.each(returnedCases)(
    "$operation isolates work item nesting from its $returned return",
    ({ operation, returned }) => {
      const fixture = setupReplay(operation);
      const initial = fixture.invoke();
      const expected = encodeResult(initial);
      mutateWorkItem(returned === "initial" ? initial.workItem : fixture.invoke().workItem);
      expectOriginalReplay(fixture, expected);
    },
  );

  it.each(returnedCases)(
    "$operation isolates receipt fields from its $returned return",
    ({ operation, returned }) => {
      const fixture = setupReplay(operation);
      const initial = fixture.invoke();
      const expected = encodeResult(initial);
      const result = returned === "initial" ? initial : fixture.invoke();
      Object.assign(result.receipt, {
        operation: "changed",
        payloadDigest: DIGEST_2 === result.receipt.payloadDigest ? DIGEST_1 : DIGEST_2,
        revisionAfter: 999,
      });
      expectOriginalReplay(fixture, expected);
    },
  );

  it.each(["initial", "replay"] as const)(
    "recordReview isolates nested review proof from its %s return",
    (returned) => {
      const fixture = setupReplay("recordReview");
      const initial = fixture.invoke();
      const expected = encodeResult(initial);
      const result = returned === "initial" ? initial : fixture.invoke();
      expect(result.review).toBeDefined();
      if (result.review === undefined) throw new Error("review result required");
      mutateReview(result.review);
      expectOriginalReplay(fixture, expected);
    },
  );

  it.each(operations)("%s snapshots caller-retained nested inputs at commit", (operation) => {
    const fixture = setupReplay(operation);
    const initial = fixture.invoke();
    const expected = encodeResult(initial);
    // Keep authority-relevant identity/state valid so the next call reaches replay lookup.
    Object.assign(fixture.workItem.acceptance, { 0: "changed" });
    Object.assign(fixture.workItem.sourceRefs, { 0: "changed" });
    Object.assign(fixture.workItem.requirementIds, { 0: "changed" });
    Object.assign(fixture.workItem.createdAt, { epochMilliseconds: 0 });
    Object.assign(fixture.workItem.testedMilestone!.evidenceIds, { 0: EV_BUILD_B });
    Object.assign(fixture.workItem.testedMilestone!.recordedAt, { epochMilliseconds: 0 });
    if (fixture.workItem.buildCompletion) {
      Object.assign(fixture.workItem.buildCompletion.evidenceIds, { 0: EV_TEST_B });
      Object.assign(fixture.workItem.buildCompletion.admittedAt, { epochMilliseconds: 0 });
    }
    fixture.buildEvidenceIds[0] = EV_TEST_B;
    mutateReview(fixture.review);
    expectOriginalReplay(fixture, expected);
  });
});

describe("D4 replay boundary compatibility", () => {
  const cases = (["admitBuildComplete", "startReview", "recordReview"] as const).flatMap(
    (operation) =>
      (["operation key", "payload digest", "acceptance text"] as const).map((field) => ({
        operation,
        field,
      })),
  );

  it.each(cases)("$operation preserves existing $field input behaviour", ({ operation, field }) => {
    const context = makeMutationContext();
    const originalWorkItem =
      operation === "admitBuildComplete"
        ? decodeWire(WorkItem)(workItemWire)
        : operation === "startReview"
          ? admitBuildComplete(admitInput()).workItem
          : queuedWorkItem();
    const workItem = {
      ...originalWorkItem,
      ...(field === "acceptance text" ? { acceptance: [""] } : {}),
    };
    const common = {
      context,
      workItem,
      expectedRevision: workItem.revision,
      idempotencyKey: field === "operation key" ? "" : "compatibility",
      payloadDigest: field === "payload digest" ? "caller-supplied-digest" : DIGEST_1,
    };
    const invoke = () => {
      switch (operation) {
        case "admitBuildComplete":
          return admitBuildComplete(admitInput(common));
        case "startReview":
          return startReview({
            ...common,
            port: basePort(),
            requestingPrincipalId: PRINCIPAL_BUILDER,
            now: LATER,
          });
        case "recordReview":
          return recordReview(reviewInput(workItem, common));
      }
    };
    const initial = invoke();
    const replay = invoke();
    expect(replay).toEqual(initial);
    expect(replay.workItem.revision).toBe(workItem.revision + 1);
    expect(context.replayRecords.size).toBe(1);
    expect(context.aggregateKeyIndex.size).toBe(1);
  });
});
