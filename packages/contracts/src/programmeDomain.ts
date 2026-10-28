/** Programme domain contracts v1 (PRD 02 sections 5-6). Typed data is NOT an authorisation
 * mechanism: every mutation consults a trusted ProgrammeAuthorityPort, and unresolvable
 * records deny with capability_unavailable. Replay receipts prove semantics only; durable
 * dedup and persistence are owned by B02. */
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  RunAttemptId,
  RunId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const makeDomainId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) =>
  TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));

export const OrgId = makeDomainId("OrgId");
export type OrgId = typeof OrgId.Type;
export const MemberId = makeDomainId("MemberId");
export type MemberId = typeof MemberId.Type;
export const PrincipalId = makeDomainId("PrincipalId");
export type PrincipalId = typeof PrincipalId.Type;
export const ProgrammeId = makeDomainId("ProgrammeId");
export type ProgrammeId = typeof ProgrammeId.Type;
export const ApprovalId = makeDomainId("ApprovalId");
export type ApprovalId = typeof ApprovalId.Type;
export const WorkItemId = makeDomainId("WorkItemId");
export type WorkItemId = typeof WorkItemId.Type;
export const TaskId = makeDomainId("TaskId");
export type TaskId = typeof TaskId.Type;
export const EvidenceId = makeDomainId("EvidenceId");
export type EvidenceId = typeof EvidenceId.Type;
export const ReviewId = makeDomainId("ReviewId");
export type ReviewId = typeof ReviewId.Type;

/** Monotonic aggregate revision used for compare-and-swap on every mutation. */
export const SchemaVersion = Schema.Literal(1);
export type SchemaVersion = typeof SchemaVersion.Type;

/** Lower-case sha-256 hex digest of content; absence must be explicit null, never blank. */
export const Sha256Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export type Sha256Digest = typeof Sha256Digest.Type;

/** 40-character lower-case git commit sha. */
export const GitCommitSha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
export type GitCommitSha = typeof GitCommitSha.Type;

export const RetentionClass = Schema.Literals(["ephemeral", "standard", "archival"]);
export type RetentionClass = typeof RetentionClass.Type;

export const VisibilityClass = Schema.Literals(["private", "team", "organisation"]);
export type VisibilityClass = typeof VisibilityClass.Type;

/** Approval effects are exact members fixed by the PRD; scope limits them, never widens them. */
export const ApprovalEffect = Schema.Literals([
  "read",
  "writePlanningArtifact",
  "createTask",
  "assign",
  "runInvestigation",
  "editSource",
  "runChecks",
  "runDedicatedAudit",
  "fixFindings",
  "prepareIntegration",
  "publishBranch",
  "openPR",
  "merge",
  "deploy",
  "install",
  "sendMessage",
  "publishContent",
  "spend",
  "manageGrant",
  "transferOwnership",
  "schedule",
  "cleanupOwned",
]);
export type ApprovalEffect = typeof ApprovalEffect.Type;

/** Programme state tracks draft -> readyForReview -> approved -> executing -> awaitingRelease -> closed. */
export const ProgrammeState = Schema.Literals([
  "draft",
  "readyForReview",
  "approved",
  "executing",
  "awaitingRelease",
  "closed",
]);
export type ProgrammeState = typeof ProgrammeState.Type;

/** Orthogonal holds: a reason present means the hold is active; null or absent means it is not. */
export const ProgrammeHoldReasons = Schema.Struct({
  paused: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  needsDecision: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  blocked: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  cancelRequested: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  cancelled: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ProgrammeHoldReasons = typeof ProgrammeHoldReasons.Type;

export const Programme = Schema.Struct({
  schemaVersion: SchemaVersion,
  orgId: OrgId,
  revision: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
  programmeId: ProgrammeId,
  ownerMemberId: MemberId,
  requirementRevision: NonNegativeInt,
  taskGraphRevision: NonNegativeInt,
  /** Opaque controller lease reference; null while no controller epoch is advancing effects. */
  controllerLease: Schema.NullOr(TrimmedNonEmptyString),
  approvalRefs: Schema.Array(ApprovalId),
  budgetPolicyRef: TrimmedNonEmptyString,
  state: ProgrammeState,
  holds: ProgrammeHoldReasons,
});
export type Programme = typeof Programme.Type;

export const ProgrammeApproval = Schema.Struct({
  schemaVersion: SchemaVersion,
  orgId: OrgId,
  /** Null means the approval is organisation-wide; otherwise it covers exactly this project. */
  projectId: Schema.NullOr(ProjectId),
  revision: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
  approvalId: ApprovalId,
  humanPrincipalId: PrincipalId,
  capturedIntentRef: TrimmedNonEmptyString,
  actionScopes: Schema.Array(ApprovalEffect),
  targetIds: Schema.Array(TrimmedNonEmptyString),
  specHash: Sha256Digest,
  allowedChanges: Schema.Array(TrimmedNonEmptyString),
  /** Paths the approval never covers, matched exactly or by directory prefix. */
  exclusions: Schema.Array(TrimmedNonEmptyString),
  environmentScope: Schema.Array(EnvironmentId),
  budgetRef: TrimmedNonEmptyString,
  expiresAt: Schema.DateTimeUtc,
  revokedAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type ProgrammeApproval = typeof ProgrammeApproval.Type;

/** Work item lifecycle; `tested` is a separate evidence milestone. releaseReady/live are release-record states and are deliberately not members. */
export const WorkItemState = Schema.Literals([
  "proposed",
  "ready",
  "queued",
  "assigned",
  "starting",
  "running",
  "buildComplete",
  "reviewQueued",
  "reviewing",
  "changesRequested",
  "fixing",
  "accepted",
  "integrated",
]);
export type WorkItemState = typeof WorkItemState.Type;

export const WorkItemKind = Schema.Literals(["build", "documentation", "investigation"]);
export type WorkItemKind = typeof WorkItemKind.Type;

export const WorkItemPriority = Schema.Literals(["low", "normal", "high"]);
export type WorkItemPriority = typeof WorkItemPriority.Type;

/** Frozen when the builder admits build complete; the tested milestone stays separate. */
export const BuildCompletion = Schema.Struct({
  sourceCommit: GitCommitSha,
  builderRunId: RunId,
  evidenceIds: Schema.Array(EvidenceId),
  admittedAt: Schema.DateTimeUtc,
});
export type BuildCompletion = typeof BuildCompletion.Type;

export const TestedMilestone = Schema.Struct({
  evidenceIds: Schema.Array(EvidenceId),
  recordedAt: Schema.DateTimeUtc,
});
export type TestedMilestone = typeof TestedMilestone.Type;

export const WorkItem = Schema.Struct({
  schemaVersion: SchemaVersion,
  orgId: OrgId,
  projectId: ProjectId,
  revision: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
  workItemId: WorkItemId,
  programmeId: ProgrammeId,
  kind: WorkItemKind,
  title: TrimmedNonEmptyString,
  requirementIds: Schema.Array(TrimmedNonEmptyString),
  acceptance: Schema.Array(TrimmedNonEmptyString),
  assigneeMemberId: Schema.NullOr(MemberId),
  executorRole: TrimmedNonEmptyString,
  reviewerRole: TrimmedNonEmptyString,
  dependencies: Schema.Array(WorkItemId),
  sourceRefs: Schema.Array(TrimmedNonEmptyString),
  priority: WorkItemPriority,
  dueAt: Schema.NullOr(Schema.DateTimeUtc),
  state: WorkItemState,
  buildCompletion: Schema.optional(Schema.NullOr(BuildCompletion)),
  testedMilestone: Schema.optional(Schema.NullOr(TestedMilestone)),
});
export type WorkItem = typeof WorkItem.Type;

export const RoutingPolicyReference = Schema.Struct({
  ref: TrimmedNonEmptyString,
  hash: Sha256Digest,
});
export type RoutingPolicyReference = typeof RoutingPolicyReference.Type;

export const EvidencePlan = Schema.Struct({
  /** Coverage labels a review must be satisfied by accepted evidence before it may accept. */
  requiredCoverage: Schema.Array(TrimmedNonEmptyString),
  requireBuildEvidence: Schema.Boolean,
});
export type EvidencePlan = typeof EvidencePlan.Type;

/** Machine-checkable budget: attempt count against a positive cap; null spend cap means unbounded. */
export const ResourceBudget = Schema.Struct({
  maxAttempts: PositiveInt,
  maxSpendMinorUnits: Schema.NullOr(NonNegativeInt),
});
export type ResourceBudget = typeof ResourceBudget.Type;

export const TaskPacket = Schema.Struct({
  schemaVersion: SchemaVersion,
  orgId: OrgId,
  projectId: ProjectId,
  revision: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
  taskId: TaskId,
  workItemId: WorkItemId,
  specHash: Sha256Digest,
  baseCommit: GitCommitSha,
  projectMappingRevision: NonNegativeInt,
  knowledgeRevision: NonNegativeInt,
  effectiveRoutingPolicy: RoutingPolicyReference,
  resolvedCapabilitySnapshotRef: TrimmedNonEmptyString,
  allowedPaths: Schema.Array(TrimmedNonEmptyString),
  doNotModify: Schema.Array(TrimmedNonEmptyString),
  inputs: Schema.Array(TrimmedNonEmptyString),
  outputs: Schema.Array(TrimmedNonEmptyString),
  failureCases: Schema.Array(TrimmedNonEmptyString),
  skillUnion: Schema.Array(TrimmedNonEmptyString),
  graphRefs: Schema.Array(TrimmedNonEmptyString),
  decisions: Schema.Array(TrimmedNonEmptyString),
  testSelection: Schema.Array(TrimmedNonEmptyString),
  /** Opaque eligibility references resolved by trusted storage; typed data is not eligibility. */
  builderEligibility: TrimmedNonEmptyString,
  auditorEligibility: TrimmedNonEmptyString,
  evidencePlan: EvidencePlan,
  resourceBudget: ResourceBudget,
});
export type TaskPacket = typeof TaskPacket.Type;

/** Recorded model/context identity of a run; null means unknown, which is never eligible to accept a review. */
export const ModelIdentity = Schema.Struct({
  model: TrimmedNonEmptyString,
  harness: TrimmedNonEmptyString,
  contextId: TrimmedNonEmptyString,
  account: Schema.NullOr(TrimmedNonEmptyString),
});
export type ModelIdentity = typeof ModelIdentity.Type;

export const RunRole = Schema.Literals(["builder", "auditor"]);
export type RunRole = typeof RunRole.Type;

export const RunLineageEntry = Schema.Struct({
  runId: RunId,
  role: RunRole,
  modelIdentity: Schema.NullOr(ModelIdentity),
});
export type RunLineageEntry = typeof RunLineageEntry.Type;

export const ProgrammeAssignmentRun = Schema.Struct({
  schemaVersion: SchemaVersion,
  orgId: OrgId,
  projectId: ProjectId,
  revision: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
  /** Canonical run identity referenced by reviews, lineage and build completions. */
  runId: RunId,
  assignmentId: TrimmedNonEmptyString,
  taskId: TaskId,
  ownerMemberId: MemberId,
  executionEnvironmentId: EnvironmentId,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  workspaceRef: TrimmedNonEmptyString,
  role: RunRole,
  modelIdentity: Schema.NullOr(ModelIdentity),
  parentRunId: Schema.NullOr(RunId),
  /** Complete contributor identities; an auditor must differ from every entry recorded here. */
  lineage: Schema.Array(RunLineageEntry),
  authorityRef: TrimmedNonEmptyString,
  epoch: NonNegativeInt,
  attemptId: RunAttemptId,
});
export type ProgrammeAssignmentRun = typeof ProgrammeAssignmentRun.Type;

export const ProgrammeEvidence = Schema.Struct({
  schemaVersion: SchemaVersion,
  orgId: OrgId,
  projectId: ProjectId,
  revision: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
  evidenceId: EvidenceId,
  kind: Schema.Literals(["build", "test", "check", "artifact", "log"]),
  uri: TrimmedNonEmptyString,
  digest: Sha256Digest,
  byteLength: NonNegativeInt,
  producedByRunId: RunId,
  sourceCommit: Schema.NullOr(GitCommitSha),
  inputsHash: Sha256Digest,
  observedAt: Schema.DateTimeUtc,
  toolIdentity: TrimmedNonEmptyString,
  result: Schema.Literals(["pass", "fail", "unknown"]),
  /** Coverage labels this evidence satisfies. */
  coverage: Schema.Array(TrimmedNonEmptyString),
  /** Redaction descriptors only; redacted values never enter contracts. */
  redactions: Schema.Array(TrimmedNonEmptyString),
});
export type ProgrammeEvidence = typeof ProgrammeEvidence.Type;

export const ReviewFinding = Schema.Struct({
  severity: Schema.Literals(["critical", "major", "minor", "note"]),
  description: TrimmedNonEmptyString,
  path: Schema.NullOr(TrimmedNonEmptyString),
});
export type ReviewFinding = typeof ReviewFinding.Type;

export const ProgrammeReview = Schema.Struct({
  schemaVersion: SchemaVersion,
  orgId: OrgId,
  projectId: ProjectId,
  revision: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
  reviewId: ReviewId,
  taskId: TaskId,
  builderRunId: RunId,
  auditorRunId: RunId,
  exactCommit: GitCommitSha,
  scope: Schema.Array(TrimmedNonEmptyString),
  evidenceRefs: Schema.Array(EvidenceId),
  findings: Schema.Array(ReviewFinding),
  disposition: Schema.Literals(["accepted", "rejected", "incomplete"]),
  lineageCheck: Schema.Literals(["verified", "failed", "incomplete"]),
  coverage: Schema.Array(TrimmedNonEmptyString),
});
export type ProgrammeReview = typeof ProgrammeReview.Type;

export class ProgrammeCapabilityUnavailableError extends Schema.TaggedError<ProgrammeCapabilityUnavailableError>()(
  "ProgrammeCapabilityUnavailableError",
  { message: TrimmedNonEmptyString, detail: Schema.optional(TrimmedNonEmptyString) },
) {}

export class ProgrammeRevisionConflictError extends Schema.TaggedError<ProgrammeRevisionConflictError>()(
  "ProgrammeRevisionConflictError",
  {
    message: TrimmedNonEmptyString,
    expectedRevision: Schema.optional(NonNegativeInt),
    currentRevision: Schema.optional(NonNegativeInt),
  },
) {}

export class ProgrammeIdempotencyConflictError extends Schema.TaggedError<ProgrammeIdempotencyConflictError>()(
  "ProgrammeIdempotencyConflictError",
  { message: TrimmedNonEmptyString, operationKey: Schema.optional(TrimmedNonEmptyString) },
) {}

export class ProgrammeForbiddenError extends Schema.TaggedError<ProgrammeForbiddenError>()(
  "ProgrammeForbiddenError",
  { message: TrimmedNonEmptyString, detail: Schema.optional(TrimmedNonEmptyString) },
) {}

export class ProgrammeInvalidRequestError extends Schema.TaggedError<ProgrammeInvalidRequestError>()(
  "ProgrammeInvalidRequestError",
  { message: TrimmedNonEmptyString, detail: Schema.optional(TrimmedNonEmptyString) },
) {}

export class ProgrammeEvidenceMissingError extends Schema.TaggedError<ProgrammeEvidenceMissingError>()(
  "ProgrammeEvidenceMissingError",
  {
    message: TrimmedNonEmptyString,
    /** Reviews with missing proof record disposition `incomplete`. */
    suggestedDisposition: Schema.optional(Schema.Literals(["incomplete"])),
    missingCoverage: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  },
) {}

export class ProgrammeSourceStaleError extends Schema.TaggedError<ProgrammeSourceStaleError>()(
  "ProgrammeSourceStaleError",
  {
    message: TrimmedNonEmptyString,
    frozenCommit: Schema.optional(GitCommitSha),
    currentCommit: Schema.optional(GitCommitSha),
  },
) {}

export class ProgrammeBudgetExceededError extends Schema.TaggedError<ProgrammeBudgetExceededError>()(
  "ProgrammeBudgetExceededError",
  {
    message: TrimmedNonEmptyString,
    attempts: Schema.optional(NonNegativeInt),
    maxAttempts: Schema.optional(PositiveInt),
  },
) {}

export class ProgrammePolicyDeniedError extends Schema.TaggedError<ProgrammePolicyDeniedError>()(
  "ProgrammePolicyDeniedError",
  { message: TrimmedNonEmptyString, detail: Schema.optional(TrimmedNonEmptyString) },
) {}

export interface ProgrammeVerifiedActor {
  readonly principalId: PrincipalId;
  readonly memberId: MemberId;
  readonly orgId: OrgId;
}

export interface ProgrammeResolvedApproval {
  readonly approval: ProgrammeApproval;
  readonly revision: typeof NonNegativeInt.Type;
}

export interface ProgrammeResolvedRun {
  readonly run: ProgrammeAssignmentRun;
  readonly revision: typeof NonNegativeInt.Type;
}

export interface ProgrammeResolvedEvidence {
  readonly evidence: ProgrammeEvidence;
  readonly revision: typeof NonNegativeInt.Type;
}

export interface ProgrammeResolvedSource {
  readonly projectId: ProjectId;
  readonly commit: GitCommitSha;
}

/**
 * The only authority surface a mutation may consult. Implementations come from trusted
 * authenticated storage (B02/B05); every lookup returning null denies with
 * `capability_unavailable`. Callers cannot pass authority claims in the mutation body.
 */
export interface ProgrammeAuthorityPort {
  /** Label naming a test injection; production ports must leave it undefined. */
  readonly fixtureLabel?: "TEST-FIXTURE-AUTHORITY-NOT-A-REAL-VERIFIER" | undefined;
  resolveVerifiedActor(input: {
    readonly requestedPrincipalId: PrincipalId;
    readonly orgId: OrgId;
  }): ProgrammeVerifiedActor | null;
  resolveApproval(input: {
    readonly approvalId: ApprovalId;
    readonly orgId: OrgId;
  }): ProgrammeResolvedApproval | null;
  /** Org-scoped so a record from another organisation can never satisfy a mutation. */
  resolveRunRecord(input: {
    readonly runId: RunId;
    readonly orgId: OrgId;
  }): ProgrammeResolvedRun | null;
  resolveEvidenceRecord(input: {
    readonly evidenceId: EvidenceId;
    readonly orgId: OrgId;
  }): ProgrammeResolvedEvidence | null;
  /** Current authoritative head of the project source, used to detect stale freezes. */
  resolveSourceRecord(input: {
    readonly projectId: ProjectId;
    readonly orgId: OrgId;
  }): ProgrammeResolvedSource | null;
  /** Authoritative attempt ledger for the task; the trusted store owns budget accounting. */
  resolveAttemptCount(input: { readonly taskId: TaskId; readonly orgId: OrgId }): number | null;
}

/**
 * Clearly labelled test fixture authority. The name names the injection; the port also carries
 * `fixtureLabel` so a fixture can never be mistaken for a real verifier. Never use in production.
 */
export const makeLabelledFixtureAuthorityPort = (
  config: Pick<
    ProgrammeAuthorityPort,
    | "resolveVerifiedActor"
    | "resolveApproval"
    | "resolveRunRecord"
    | "resolveEvidenceRecord"
    | "resolveSourceRecord"
    | "resolveAttemptCount"
  >,
): ProgrammeAuthorityPort => ({
  fixtureLabel: "TEST-FIXTURE-AUTHORITY-NOT-A-REAL-VERIFIER",
  resolveVerifiedActor: config.resolveVerifiedActor,
  resolveApproval: config.resolveApproval,
  resolveRunRecord: config.resolveRunRecord,
  resolveEvidenceRecord: config.resolveEvidenceRecord,
  resolveSourceRecord: config.resolveSourceRecord,
  resolveAttemptCount: config.resolveAttemptCount,
});

export const MutationReceipt = Schema.Struct({
  principalId: PrincipalId,
  orgId: OrgId,
  aggregateId: TrimmedNonEmptyString,
  operation: TrimmedNonEmptyString,
  operationKey: TrimmedNonEmptyString,
  payloadDigest: Sha256Digest,
  revisionAfter: NonNegativeInt,
});
export type MutationReceipt = typeof MutationReceipt.Type;

export interface ProgrammeReplayRecord {
  readonly receipt: MutationReceipt;
  readonly aggregate: WorkItem;
  readonly authorityScope: string;
  readonly review?: ProgrammeReview;
}

// Snapshot known mutable fields without adding validation to the mutation's existing gates.
const snapshotReplayRecord = (record: ProgrammeReplayRecord): ProgrammeReplayRecord => ({
  receipt: { ...record.receipt },
  authorityScope: record.authorityScope,
  aggregate: {
    ...record.aggregate,
    createdAt: DateTime.toUtc(record.aggregate.createdAt),
    updatedAt: DateTime.toUtc(record.aggregate.updatedAt),
    dueAt: record.aggregate.dueAt === null ? null : DateTime.toUtc(record.aggregate.dueAt),
    requirementIds: [...record.aggregate.requirementIds],
    acceptance: [...record.aggregate.acceptance],
    dependencies: [...record.aggregate.dependencies],
    sourceRefs: [...record.aggregate.sourceRefs],
    ...(record.aggregate.buildCompletion == null
      ? {}
      : {
          buildCompletion: {
            ...record.aggregate.buildCompletion,
            evidenceIds: [...record.aggregate.buildCompletion.evidenceIds],
            admittedAt: DateTime.toUtc(record.aggregate.buildCompletion.admittedAt),
          },
        }),
    ...(record.aggregate.testedMilestone == null
      ? {}
      : {
          testedMilestone: {
            ...record.aggregate.testedMilestone,
            evidenceIds: [...record.aggregate.testedMilestone.evidenceIds],
            recordedAt: DateTime.toUtc(record.aggregate.testedMilestone.recordedAt),
          },
        }),
  },
  ...(record.review === undefined
    ? {}
    : {
        review: {
          ...record.review,
          createdAt: DateTime.toUtc(record.review.createdAt),
          updatedAt: DateTime.toUtc(record.review.updatedAt),
          scope: [...record.review.scope],
          evidenceRefs: [...record.review.evidenceRefs],
          findings: record.review.findings.map((finding) => ({ ...finding })),
          coverage: [...record.review.coverage],
        },
      }),
});

/** Caller-owned context: replay records live only for the life of the calling process. */
export interface ProgrammeMutationContext {
  readonly replayRecords: Map<string, ProgrammeReplayRecord>;
  /** Organisation-scoped aggregate/operation/key tuple denying cross-principal reuse. */
  readonly aggregateKeyIndex: Map<string, PrincipalId>;
}

export const makeMutationContext = (): ProgrammeMutationContext => ({
  replayRecords: new Map(),
  aggregateKeyIndex: new Map(),
});

const receiptScope = (input: {
  readonly principalId: PrincipalId;
  readonly orgId: OrgId;
  readonly aggregateId: string;
  readonly operation: string;
  readonly operationKey: string;
}) =>
  JSON.stringify([
    input.principalId,
    input.orgId,
    input.aggregateId,
    input.operation,
    input.operationKey,
  ]);

const aggregateScope = (input: {
  readonly orgId: OrgId;
  readonly aggregateId: string;
  readonly operation: string;
  readonly operationKey: string;
}) => JSON.stringify([input.orgId, input.aggregateId, input.operation, input.operationKey]);

const expectRevision = (
  current: typeof NonNegativeInt.Type,
  expectedRevision: typeof NonNegativeInt.Type,
  aggregateId: string,
) => {
  if (current !== expectedRevision) {
    return new ProgrammeRevisionConflictError({
      message: `Stale expectedRevision for ${aggregateId}`,
      expectedRevision,
      currentRevision: current,
    });
  }
  return null;
};

const toEpochMillis = (value: IsoDateTime | DateTime.DateTime) =>
  typeof value === "string"
    ? DateTime.makeUnsafe(value).epochMilliseconds
    : DateTime.toEpochMillis(value);

const isBeforeOrAt = (
  earlier: IsoDateTime | DateTime.DateTime,
  later: IsoDateTime | DateTime.DateTime,
) => toEpochMillis(earlier) <= toEpochMillis(later);

const pathIsExcluded = (path: string, exclusions: ReadonlyArray<string>) =>
  exclusions.some((exclusion) => path === exclusion || path.startsWith(`${exclusion}/`));

/**
 * Validates that the resolved approval is current, unrevoked and covers the effect scoped to
 * the project, environment, target and task paths. Denies with policy_denied on every scope
 * failure.
 */
export const requireApprovalCovering = (input: {
  readonly port: ProgrammeAuthorityPort;
  readonly approvalId: ApprovalId;
  readonly orgId: OrgId;
  readonly projectId: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly effect: ApprovalEffect;
  readonly targetId: string;
  readonly specHash: Sha256Digest;
  readonly paths: ReadonlyArray<string>;
  readonly now: IsoDateTime;
}): ProgrammeResolvedApproval => {
  const resolved = input.port.resolveApproval({ approvalId: input.approvalId, orgId: input.orgId });
  if (resolved === null) {
    throw new ProgrammeCapabilityUnavailableError({
      message: "Approval record is absent or unresolvable",
      detail: input.approvalId,
    });
  }
  const approval = resolved.approval;
  const deny = (detail: string) => {
    throw new ProgrammePolicyDeniedError({
      message: "Approval does not cover the requested effect",
      detail,
    });
  };
  if (approval.approvalId !== input.approvalId || approval.orgId !== input.orgId)
    return deny("resolved approval identity or organisation differs");
  if (approval.revokedAt !== null) return deny("approval revoked");
  if (isBeforeOrAt(approval.expiresAt, input.now)) return deny("approval expired");
  if (approval.specHash !== input.specHash)
    return deny("approval spec hash does not match the task packet");
  if (!approval.actionScopes.includes(input.effect))
    return deny(`effect ${input.effect} not in actionScopes`);
  if (approval.projectId !== null && approval.projectId !== input.projectId)
    return deny("project outside approval scope");
  if (!approval.environmentScope.includes(input.environmentId))
    return deny("environment outside approval scope");
  const excluded = input.paths.find((path) => pathIsExcluded(path, approval.exclusions));
  if (excluded !== undefined) return deny(`path excluded by approval: ${excluded}`);
  if (!approval.targetIds.includes(input.targetId))
    return deny(`target ${input.targetId} outside approval scope`);
  return resolved;
};

export interface AdmitBuildCompleteInput {
  readonly port: ProgrammeAuthorityPort;
  readonly context: ProgrammeMutationContext;
  readonly programme: Programme;
  readonly workItem: WorkItem;
  readonly taskPacket: TaskPacket;
  readonly requestingRun: ProgrammeAssignmentRun;
  readonly requestingPrincipalId: PrincipalId;
  readonly approvalId: ApprovalId;
  readonly buildEvidenceIds: ReadonlyArray<EvidenceId>;
  readonly sourceCommit: GitCommitSha;
  readonly expectedRevision: typeof NonNegativeInt.Type;
  readonly idempotencyKey: string;
  readonly payloadDigest: Sha256Digest;
  readonly now: IsoDateTime;
}

// Scope and current authority precede replay; a replay does not repeat CAS or effects.

interface MutationScope {
  readonly authorityScope: string;
  readonly principalId: PrincipalId;
  readonly orgId: OrgId;
  readonly aggregateId: string;
  readonly operation: string;
  readonly operationKey: string;
  readonly payloadDigest: Sha256Digest;
  readonly context: ProgrammeMutationContext;
}

/** Replay hit returns the ORIGINAL result; same key with a different payload conflicts; a key another principal used on the same aggregate is a reuse attempt. */
const replayOrDeny = (scope: MutationScope): ProgrammeReplayRecord | null => {
  const existing = scope.context.replayRecords.get(receiptScope(scope));
  if (existing !== undefined) {
    if (existing.authorityScope !== scope.authorityScope) {
      throw new ProgrammeIdempotencyConflictError({
        message: "Replay target or authority differs from the original operation",
        operationKey: scope.operationKey,
      });
    }
    if (existing.receipt.payloadDigest === scope.payloadDigest)
      return snapshotReplayRecord(existing);
    throw new ProgrammeIdempotencyConflictError({
      message: "Operation key was already used with a different payload",
      operationKey: scope.operationKey,
    });
  }
  const otherPrincipal = scope.context.aggregateKeyIndex.get(aggregateScope(scope));
  if (otherPrincipal !== undefined && otherPrincipal !== scope.principalId) {
    throw new ProgrammeForbiddenError({
      message: "Operation key was already recorded for a different principal on this aggregate",
      detail: scope.operationKey,
    });
  }
  return null;
};

const commitReceipt = (
  scope: MutationScope,
  aggregate: WorkItem,
  review?: ProgrammeReview,
): { workItem: WorkItem; receipt: MutationReceipt } => {
  const receipt: MutationReceipt = {
    principalId: scope.principalId,
    orgId: scope.orgId,
    aggregateId: scope.aggregateId,
    operation: scope.operation,
    operationKey: scope.operationKey,
    payloadDigest: scope.payloadDigest,
    revisionAfter: aggregate.revision,
  };
  scope.context.replayRecords.set(
    receiptScope(scope),
    snapshotReplayRecord({
      receipt,
      aggregate,
      authorityScope: scope.authorityScope,
      ...(review === undefined ? {} : { review }),
    }),
  );
  scope.context.aggregateKeyIndex.set(aggregateScope(scope), scope.principalId);
  return { workItem: aggregate, receipt };
};

const requireVerifiedActor = (
  port: ProgrammeAuthorityPort,
  requestingPrincipalId: PrincipalId,
  orgId: OrgId,
): ProgrammeVerifiedActor => {
  const actor = port.resolveVerifiedActor({ requestedPrincipalId: requestingPrincipalId, orgId });
  if (actor === null) {
    throw new ProgrammeCapabilityUnavailableError({
      message: "Verified actor record is absent or unresolvable",
      detail: orgId,
    });
  }
  if (actor.principalId !== requestingPrincipalId || actor.orgId !== orgId) {
    throw new ProgrammeForbiddenError({
      message: "Resolved actor differs from the requested principal or organisation",
    });
  }
  return actor;
};

/** Current programme holds prevent new build effects. */
const requireProgrammeActive = (programme: Programme) => {
  if (programme.state === "closed") {
    throw new ProgrammeForbiddenError({
      message: "Programme is closed; a terminal programme cannot take new mutations",
      detail: programme.programmeId,
    });
  }
  if (
    (programme.holds.paused ?? null) !== null ||
    (programme.holds.needsDecision ?? null) !== null ||
    (programme.holds.blocked ?? null) !== null ||
    (programme.holds.cancelled ?? null) !== null ||
    (programme.holds.cancelRequested ?? null) !== null
  ) {
    throw new ProgrammeForbiddenError({
      message: "Programme carries an active hold",
      detail: programme.programmeId,
    });
  }
};

const requireNonTerminal = (workItem: WorkItem) => {
  if (workItem.state === "integrated") {
    throw new ProgrammeForbiddenError({
      message: "Work item is integrated; a terminal work item cannot be revived",
      detail: workItem.workItemId,
    });
  }
};

const casOrFail = (workItem: WorkItem, expectedRevision: typeof NonNegativeInt.Type) => {
  const conflict = expectRevision(workItem.revision, expectedRevision, workItem.workItemId);
  if (conflict !== null) throw conflict;
};

const stampAt = (now: IsoDateTime) => DateTime.makeUnsafe(now);

/**
 * Builder admits build complete: freezes the exact source commit and build evidence refs.
 * Only valid from `running` or `fixing`, by the exact assigned writer run resolved through
 * the authority port (the body copy only names the run), with a current approval covering
 * `editSource` scoped to project, environment and target. Denied without mutation otherwise.
 */
export const admitBuildComplete = (
  input: AdmitBuildCompleteInput,
): { workItem: WorkItem; receipt: MutationReceipt } => {
  const scope: MutationScope = {
    principalId: input.requestingPrincipalId,
    orgId: input.programme.orgId,
    aggregateId: input.workItem.workItemId,
    authorityScope: JSON.stringify([
      input.workItem.orgId,
      input.workItem.projectId,
      input.workItem.programmeId,
      input.workItem.workItemId,
      input.taskPacket.taskId,
      input.requestingRun.runId,
    ]),
    operation: "admitBuildComplete",
    operationKey: input.idempotencyKey,
    payloadDigest: input.payloadDigest,
    context: input.context,
  };
  requireProgrammeActive(input.programme);
  requireNonTerminal(input.workItem);
  if (
    input.workItem.programmeId !== input.programme.programmeId ||
    input.workItem.orgId !== input.programme.orgId ||
    input.taskPacket.orgId !== input.workItem.orgId ||
    input.taskPacket.projectId !== input.workItem.projectId ||
    input.taskPacket.workItemId !== input.workItem.workItemId
  ) {
    throw new ProgrammeForbiddenError({
      message: "Programme, work item and task packet scope differ",
    });
  }

  const actor = requireVerifiedActor(
    input.port,
    input.requestingPrincipalId,
    input.programme.orgId,
  );
  if (actor.orgId !== input.programme.orgId) {
    throw new ProgrammeForbiddenError({ message: "Actor organisation differs from the programme" });
  }
  // Authority: the run record comes from the port; the body copy only identifies the run.
  const resolvedRun = input.port.resolveRunRecord({
    runId: input.requestingRun.runId,
    orgId: input.programme.orgId,
  });
  if (resolvedRun === null) {
    throw new ProgrammeCapabilityUnavailableError({
      message: "Requesting run record is absent or unresolvable",
      detail: input.requestingRun.runId,
    });
  }
  const run = resolvedRun.run;
  if (
    run.runId !== input.requestingRun.runId ||
    run.orgId !== input.workItem.orgId ||
    run.projectId !== input.workItem.projectId ||
    run.role !== "builder" ||
    run.taskId !== input.taskPacket.taskId ||
    run.ownerMemberId !== actor.memberId ||
    input.workItem.assigneeMemberId !== actor.memberId
  ) {
    throw new ProgrammeForbiddenError({
      message: "Only the exact assigned writer run may admit build complete",
      detail: run.runId,
    });
  }
  if (input.workItem.projectId !== input.taskPacket.projectId) {
    throw new ProgrammeForbiddenError({ message: "Task packet belongs to a different project" });
  }

  requireApprovalCovering({
    port: input.port,
    approvalId: input.approvalId,
    orgId: input.programme.orgId,
    projectId: input.workItem.projectId,
    environmentId: run.executionEnvironmentId,
    effect: "editSource",
    targetId: input.workItem.workItemId,
    specHash: input.taskPacket.specHash,
    paths: input.taskPacket.allowedPaths,
    now: input.now,
  });

  const replay = replayOrDeny(scope);
  if (replay !== null) return { workItem: replay.aggregate, receipt: replay.receipt };
  casOrFail(input.workItem, input.expectedRevision);
  if (input.workItem.state !== "running" && input.workItem.state !== "fixing") {
    throw new ProgrammeInvalidRequestError({
      message: "admitBuildComplete requires state running or fixing",
      detail: input.workItem.state,
    });
  }

  const attempts = input.port.resolveAttemptCount({
    taskId: run.taskId,
    orgId: input.programme.orgId,
  });
  if (attempts === null) {
    throw new ProgrammeCapabilityUnavailableError({
      message: "Attempt ledger is absent or unresolvable",
      detail: run.taskId,
    });
  }
  if (attempts >= input.taskPacket.resourceBudget.maxAttempts) {
    throw new ProgrammeBudgetExceededError({
      message: "Attempt budget exhausted for the task",
      attempts,
      maxAttempts: input.taskPacket.resourceBudget.maxAttempts,
    });
  }
  if (input.taskPacket.evidencePlan.requireBuildEvidence && input.buildEvidenceIds.length === 0) {
    throw new ProgrammeEvidenceMissingError({
      message: "Build evidence is required by the evidence plan",
      suggestedDisposition: "incomplete",
    });
  }

  const updatedAt = stampAt(input.now);
  const updated: WorkItem = {
    ...input.workItem,
    revision: input.workItem.revision + 1,
    updatedAt,
    state: "buildComplete",
    buildCompletion: {
      sourceCommit: input.sourceCommit,
      builderRunId: run.runId,
      evidenceIds: [...input.buildEvidenceIds],
      admittedAt: updatedAt,
    },
  };
  return commitReceipt(scope, updated);
};

export interface StartReviewInput {
  readonly port: ProgrammeAuthorityPort;
  readonly context: ProgrammeMutationContext;
  readonly requestingPrincipalId: PrincipalId;
  readonly workItem: WorkItem;
  readonly expectedRevision: typeof NonNegativeInt.Type;
  readonly idempotencyKey: string;
  readonly payloadDigest: Sha256Digest;
  readonly now: IsoDateTime;
}

/** Verified authority moves a buildComplete work item to reviewQueued; every other state denies. */
export const startReview = (
  input: StartReviewInput,
): { workItem: WorkItem; receipt: MutationReceipt } => {
  const scope: MutationScope = {
    principalId: input.requestingPrincipalId,
    orgId: input.workItem.orgId,
    aggregateId: input.workItem.workItemId,
    authorityScope: JSON.stringify([
      input.workItem.orgId,
      input.workItem.projectId,
      input.workItem.programmeId,
      input.workItem.workItemId,
    ]),
    operation: "startReview",
    operationKey: input.idempotencyKey,
    payloadDigest: input.payloadDigest,
    context: input.context,
  };
  requireNonTerminal(input.workItem);
  const actor = requireVerifiedActor(input.port, input.requestingPrincipalId, input.workItem.orgId);
  if (actor.orgId !== input.workItem.orgId) {
    throw new ProgrammeForbiddenError({ message: "Actor organisation differs from the work item" });
  }
  if (actor.memberId !== input.workItem.assigneeMemberId) {
    throw new ProgrammeForbiddenError({
      message: "Only the assignee may start the review",
      detail: actor.memberId,
    });
  }

  const replay = replayOrDeny(scope);
  if (replay !== null) return { workItem: replay.aggregate, receipt: replay.receipt };
  casOrFail(input.workItem, input.expectedRevision);
  if (input.workItem.state !== "buildComplete") {
    throw new ProgrammeInvalidRequestError({
      message: "startReview requires state buildComplete",
      detail: input.workItem.state,
    });
  }

  const updated: WorkItem = {
    ...input.workItem,
    revision: input.workItem.revision + 1,
    updatedAt: stampAt(input.now),
    state: "reviewQueued",
  };
  return commitReceipt(scope, updated);
};

export interface RecordReviewInput {
  readonly port: ProgrammeAuthorityPort;
  readonly context: ProgrammeMutationContext;
  readonly requestingPrincipalId: PrincipalId;
  readonly workItem: WorkItem;
  readonly taskPacket: TaskPacket;
  readonly review: ProgrammeReview;
  readonly expectedRevision: typeof NonNegativeInt.Type;
  readonly idempotencyKey: string;
  readonly payloadDigest: Sha256Digest;
  readonly now: IsoDateTime;
}

/**
 * Records a review on a reviewQueued or reviewing work item. Acceptance requires a separate
 * eligible auditor run whose recorded model/context identity differs (by data, not labels)
 * from every builder-run lineage entry, the current authoritative commit equal to the frozen
 * source, resolvable content-bound evidence and the evidence plan coverage satisfied.
 */
export const recordReview = (
  input: RecordReviewInput,
): { workItem: WorkItem; review: ProgrammeReview; receipt: MutationReceipt } => {
  const scope: MutationScope = {
    principalId: input.requestingPrincipalId,
    orgId: input.workItem.orgId,
    aggregateId: input.review.reviewId,
    authorityScope: JSON.stringify([
      input.workItem.orgId,
      input.workItem.projectId,
      input.workItem.programmeId,
      input.workItem.workItemId,
      input.taskPacket.taskId,
      input.review.builderRunId,
      input.review.auditorRunId,
    ]),
    operation: "recordReview",
    operationKey: input.idempotencyKey,
    payloadDigest: input.payloadDigest,
    context: input.context,
  };
  requireNonTerminal(input.workItem);
  if (
    input.taskPacket.workItemId !== input.workItem.workItemId ||
    input.taskPacket.orgId !== input.workItem.orgId ||
    input.taskPacket.projectId !== input.workItem.projectId ||
    input.review.orgId !== input.workItem.orgId ||
    input.review.projectId !== input.workItem.projectId
  ) {
    throw new ProgrammeInvalidRequestError({
      message: "Review, task packet and work item scope differ",
    });
  }
  if (input.review.taskId !== input.taskPacket.taskId) {
    throw new ProgrammeInvalidRequestError({
      message: "Review belongs to a different task packet",
      detail: input.review.reviewId,
    });
  }
  // Self-review is structural: the auditor run may never be the builder run.
  if (input.review.auditorRunId === input.review.builderRunId) {
    throw new ProgrammeForbiddenError({
      message: "Self-review denied: the auditor run is the builder run",
      detail: input.review.auditorRunId,
    });
  }

  const resolvedAuditor = input.port.resolveRunRecord({
    runId: input.review.auditorRunId,
    orgId: input.workItem.orgId,
  });
  if (resolvedAuditor === null) {
    throw new ProgrammeCapabilityUnavailableError({
      message: "Auditor run record is absent or unresolvable",
      detail: input.review.auditorRunId,
    });
  }
  const auditor = resolvedAuditor.run;
  if (
    auditor.runId !== input.review.auditorRunId ||
    auditor.orgId !== input.workItem.orgId ||
    auditor.projectId !== input.workItem.projectId ||
    auditor.role !== "auditor" ||
    auditor.taskId !== input.taskPacket.taskId
  ) {
    throw new ProgrammeInvalidRequestError({
      message: "Recorded run is not the eligible auditor of this task",
      detail: auditor.runId,
    });
  }

  const resolvedBuilder = input.port.resolveRunRecord({
    runId: input.review.builderRunId,
    orgId: input.workItem.orgId,
  });
  if (resolvedBuilder === null) {
    throw new ProgrammeCapabilityUnavailableError({
      message: "Builder run record is absent or unresolvable",
      detail: input.review.builderRunId,
    });
  }
  const builder = resolvedBuilder.run;
  if (
    builder.runId !== input.review.builderRunId ||
    builder.orgId !== input.workItem.orgId ||
    builder.projectId !== input.workItem.projectId ||
    builder.role !== "builder" ||
    builder.taskId !== input.taskPacket.taskId
  ) {
    throw new ProgrammeInvalidRequestError({
      message: "Builder run belongs to a different task packet",
      detail: builder.runId,
    });
  }

  // Shared lineage and port aliasing: compare recorded identity DATA, never labels.
  if (auditor.runId === builder.runId) {
    throw new ProgrammeForbiddenError({
      message: "Self-review denied: the auditor run is the builder run",
      detail: auditor.runId,
    });
  }
  const actor = requireVerifiedActor(input.port, input.requestingPrincipalId, input.workItem.orgId);
  if (actor.orgId !== input.workItem.orgId) {
    throw new ProgrammeForbiddenError({ message: "Actor organisation differs from the work item" });
  }
  if (actor.memberId !== auditor.ownerMemberId) {
    throw new ProgrammeForbiddenError({
      message: "Only the auditor run owner may record the review",
      detail: actor.memberId,
    });
  }

  const frozen = input.workItem.buildCompletion ?? null;
  if (frozen === null) {
    if (input.workItem.state !== "reviewQueued" && input.workItem.state !== "reviewing") {
      throw new ProgrammeInvalidRequestError({
        message: "recordReview requires state reviewQueued or reviewing",
        detail: input.workItem.state,
      });
    }
    throw new ProgrammeEvidenceMissingError({
      message: "Work item carries no frozen build completion to review",
      suggestedDisposition: "incomplete",
    });
  }
  if (input.review.builderRunId !== frozen.builderRunId) {
    throw new ProgrammeInvalidRequestError({
      message: "Review builder differs from the frozen writer",
    });
  }
  const replay = replayOrDeny(scope);
  if (replay !== null) {
    if (replay.review === undefined)
      throw new ProgrammeIdempotencyConflictError({
        message: "Original review result is unavailable",
      });
    return { workItem: replay.aggregate, review: replay.review, receipt: replay.receipt };
  }
  casOrFail(input.workItem, input.expectedRevision);
  if (input.workItem.state !== "reviewQueued" && input.workItem.state !== "reviewing") {
    throw new ProgrammeInvalidRequestError({
      message: "recordReview requires state reviewQueued or reviewing",
      detail: input.workItem.state,
    });
  }

  const builderIdentities = [
    builder.modelIdentity,
    ...builder.lineage.map((entry) => entry.modelIdentity),
  ];
  if (auditor.modelIdentity === null || builderIdentities.some((identity) => identity === null)) {
    throw new ProgrammeEvidenceMissingError({
      message: "Builder or auditor model/context identity is not recorded",
      suggestedDisposition: "incomplete",
    });
  }
  const auditorIdentity = auditor.modelIdentity;
  const sameIdentity =
    auditorIdentity !== null &&
    builderIdentities.some(
      (identity) =>
        identity !== null &&
        (identity.model === auditorIdentity.model ||
          identity.contextId === auditorIdentity.contextId),
    );
  if (sameIdentity || builder.lineage.some((entry) => entry.runId === auditor.runId)) {
    throw new ProgrammeForbiddenError({
      message: "Shared lineage denied: auditor model/context matches a builder lineage entry",
      detail: auditor.runId,
    });
  }

  if (input.review.exactCommit !== frozen.sourceCommit) {
    throw new ProgrammeInvalidRequestError({
      message: "Review exactCommit differs from the frozen source commit",
      detail: input.review.exactCommit,
    });
  }
  const source = input.port.resolveSourceRecord({
    projectId: input.workItem.projectId,
    orgId: input.workItem.orgId,
  });
  if (source === null) {
    throw new ProgrammeCapabilityUnavailableError({
      message: "Authoritative source record is absent or unresolvable",
      detail: input.workItem.projectId,
    });
  }
  if (source.projectId !== input.workItem.projectId) {
    throw new ProgrammeInvalidRequestError({
      message: "Resolved source belongs to a different project",
    });
  }
  if (source.commit !== frozen.sourceCommit) {
    throw new ProgrammeSourceStaleError({
      message: "Authoritative source moved after the build was frozen",
      frozenCommit: frozen.sourceCommit,
      currentCommit: source.commit,
    });
  }

  if (
    input.taskPacket.evidencePlan.requireBuildEvidence &&
    (frozen.evidenceIds.length === 0 ||
      frozen.evidenceIds.some((id) => !input.review.evidenceRefs.includes(id)))
  ) {
    throw new ProgrammeEvidenceMissingError({
      message: "Review omits frozen build evidence",
      suggestedDisposition: "incomplete",
    });
  }
  const covered = new Set<string>();
  for (const evidenceId of input.review.evidenceRefs) {
    const resolvedEvidence = input.port.resolveEvidenceRecord({
      evidenceId,
      orgId: input.workItem.orgId,
    });
    if (resolvedEvidence === null) {
      throw new ProgrammeEvidenceMissingError({
        message: "Referenced evidence record is absent or unresolvable",
        suggestedDisposition: "incomplete",
        missingCoverage: [evidenceId],
      });
    }
    const evidence = resolvedEvidence.evidence;
    if (
      evidence.evidenceId !== evidenceId ||
      evidence.orgId !== input.workItem.orgId ||
      evidence.projectId !== input.workItem.projectId
    ) {
      throw new ProgrammeInvalidRequestError({
        message: "Evidence belongs to a different project",
        detail: evidence.evidenceId,
      });
    }
    const inBuilderLineage =
      evidence.producedByRunId === builder.runId ||
      builder.lineage.some((entry) => entry.runId === evidence.producedByRunId);
    if (!inBuilderLineage) {
      throw new ProgrammeInvalidRequestError({
        message: "Evidence was not produced by the builder run lineage",
        detail: evidence.evidenceId,
      });
    }
    // Every counted v1 proof is source-dependent, including artifact and log coverage.
    if (evidence.result !== "pass" || evidence.sourceCommit === null) {
      throw new ProgrammeEvidenceMissingError({
        message: "Evidence lacks successful source-bound proof",
        suggestedDisposition: "incomplete",
      });
    }
    if (evidence.sourceCommit !== frozen.sourceCommit) {
      throw new ProgrammeSourceStaleError({
        message: "Evidence source differs from the frozen source",
        frozenCommit: frozen.sourceCommit,
        currentCommit: evidence.sourceCommit,
      });
    }
    for (const label of evidence.coverage) covered.add(label);
  }
  const missingCoverage = input.taskPacket.evidencePlan.requiredCoverage.filter(
    (label) => !covered.has(label),
  );
  if (missingCoverage.length > 0) {
    throw new ProgrammeEvidenceMissingError({
      message: "Evidence coverage does not satisfy the evidence plan",
      suggestedDisposition: "incomplete",
      missingCoverage,
    });
  }

  // Only a review the auditor marked accepted (with every gate above passed) accepts the work
  // item; rejected and incomplete dispositions record their outcome without mutating state.
  if (input.review.disposition === "incomplete") {
    throw new ProgrammeEvidenceMissingError({
      message: "Review disposition incomplete does not accept the work item",
      suggestedDisposition: "incomplete",
    });
  }
  if (input.review.disposition === "rejected") {
    throw new ProgrammeInvalidRequestError({
      message: "Review disposition rejected does not accept the work item",
      detail: input.review.reviewId,
    });
  }

  const updated: WorkItem = {
    ...input.workItem,
    revision: input.workItem.revision + 1,
    updatedAt: stampAt(input.now),
    state: "accepted",
  };
  const review: ProgrammeReview = {
    ...input.review,
    scope: [...input.review.scope],
    evidenceRefs: [...input.review.evidenceRefs],
    findings: input.review.findings.map((finding) => ({ ...finding })),
    coverage: [...input.review.coverage],
  };
  const committed = commitReceipt(scope, updated, review);
  return { workItem: committed.workItem, review, receipt: committed.receipt };
};
