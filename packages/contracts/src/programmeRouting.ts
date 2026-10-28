import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  OrgId,
  PrincipalId,
  RetentionClass,
  SchemaVersion,
  Sha256Digest,
  VisibilityClass,
  ProgrammeCapabilityUnavailableError,
  ProgrammeForbiddenError,
  ProgrammeInvalidRequestError,
  ProgrammePolicyDeniedError,
  ProgrammeRevisionConflictError,
} from "./programmeDomain.ts";
import { effectiveProjectGrant, type Membership, type Principal } from "./programmeIdentity.ts";

export const RoutingPolicyId = TrimmedNonEmptyString.pipe(Schema.brand("RoutingPolicyId"));
export type RoutingPolicyId = typeof RoutingPolicyId.Type;
const scopeFields = {
  scope: Schema.Literals(["org", "project", "solo"]),
  orgId: Schema.NullOr(OrgId),
  projectId: Schema.NullOr(ProjectId),
  ownerPrincipalId: Schema.NullOr(PrincipalId),
};
export const RoutingScope = Schema.Struct(scopeFields).check(
  Schema.makeFilter((s) =>
    s.scope === "solo"
      ? s.orgId === null && s.projectId === null && s.ownerPrincipalId !== null
      : s.orgId !== null &&
        s.ownerPrincipalId === null &&
        (s.scope === "project" ? s.projectId !== null : s.projectId === null),
  ),
);
export type RoutingScope = typeof RoutingScope.Type;
const isRoutingScope = Schema.is(RoutingScope);
export const PolicyRevisionRef = Schema.Struct({
  policyId: RoutingPolicyId,
  revision: PositiveInt,
  digest: Sha256Digest,
});
export type PolicyRevisionRef = typeof PolicyRevisionRef.Type;
const commonFields = {
  schemaVersion: SchemaVersion,
  revision: PositiveInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
};
export const PolicyRoute = Schema.Struct({
  routeId: TrimmedNonEmptyString,
  providerInstanceRef: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  effort: Schema.NullOr(TrimmedNonEmptyString),
});
export type PolicyRoute = typeof PolicyRoute.Type;
export const RoutingPolicy = Schema.Struct({
  ...commonFields,
  ...scopeFields,
  policyId: RoutingPolicyId,
  issuerPrincipalId: PrincipalId,
  parentPolicyRef: Schema.NullOr(PolicyRevisionRef),
  digest: Sha256Digest,
  effectiveAt: Schema.DateTimeUtc,
  roleRules: Schema.Array(
    Schema.Struct({ role: TrimmedNonEmptyString, routeIds: Schema.Array(TrimmedNonEmptyString) }),
  ),
  requiredSkillProfileRef: TrimmedNonEmptyString,
  requiredSkillProfileHash: Sha256Digest,
  permittedModels: Schema.NonEmptyArray(TrimmedNonEmptyString),
  permittedEfforts: Schema.Array(TrimmedNonEmptyString),
  routes: Schema.NonEmptyArray(PolicyRoute),
  fallbackRules: Schema.Array(
    Schema.Struct({ fromRouteId: TrimmedNonEmptyString, toRouteId: TrimmedNonEmptyString }),
  ),
  budgetRules: Schema.Struct({
    maxSpendMinorUnits: Schema.NullOr(NonNegativeInt),
    maxAttempts: PositiveInt,
  }),
  continuationRule: Schema.Literals(["deny", "leaseBound"]),
  revokedRouteRules: Schema.Array(
    Schema.Struct({
      routeId: TrimmedNonEmptyString,
      mode: Schema.Literals(["newAdmission", "hard"]),
    }),
  ),
  supersedesRef: Schema.NullOr(PolicyRevisionRef),
  delegatedExceptionRefs: Schema.Array(TrimmedNonEmptyString),
  delegatedExceptionRef: Schema.NullOr(TrimmedNonEmptyString),
  rollbackOfRef: Schema.NullOr(PolicyRevisionRef),
}).check(Schema.makeFilter((p) => isRoutingScope(p)));
export type RoutingPolicy = typeof RoutingPolicy.Type;
const isRoutingPolicy = Schema.is(RoutingPolicy);
const policyCodec = Schema.toCodecJson(RoutingPolicy);
const encodePolicy = Schema.encodeSync(policyCodec);
const decodePolicy = Schema.decodeSync(policyCodec);
export const PolicyDeviceState = Schema.Struct({
  ...commonFields,
  ...scopeFields,
  environmentId: EnvironmentId,
  incarnationId: TrimmedNonEmptyString,
  requiredPolicyRef: PolicyRevisionRef,
  acknowledgedRevision: Schema.NullOr(PositiveInt),
  acknowledgedDigest: Schema.NullOr(Sha256Digest),
  capabilitySnapshotRef: Schema.NullOr(TrimmedNonEmptyString),
  resolvedRoutesHash: Schema.NullOr(Sha256Digest),
  state: Schema.Literals(["pending", "current", "drifted", "unavailable"]),
  observedAt: Schema.DateTimeUtc,
}).check(
  Schema.makeFilter(
    (s) =>
      isRoutingScope(s) &&
      (s.acknowledgedRevision === null) === (s.acknowledgedDigest === null) &&
      (s.state !== "current" ||
        (s.acknowledgedRevision === s.requiredPolicyRef.revision &&
          s.acknowledgedDigest === s.requiredPolicyRef.digest &&
          s.capabilitySnapshotRef !== null &&
          s.resolvedRoutesHash !== null)),
  ),
);
export type PolicyDeviceState = typeof PolicyDeviceState.Type;
const isPolicyDeviceState = Schema.is(PolicyDeviceState);
const isSha256Digest = Schema.is(Sha256Digest);

export interface PolicyCapabilitySnapshot {
  readonly ref: string;
  readonly environmentId: EnvironmentId;
  readonly incarnationId: string;
  readonly policyRef: PolicyRevisionRef;
  readonly resolvedRoutesHash: string;
  readonly observedAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
  readonly routes: ReadonlyArray<{
    readonly routeId: string;
    readonly state: "available" | "unavailable" | "unknown" | "stale" | "probeFailed";
  }>;
}
export interface PolicyContinuationLease extends RoutingScope {
  readonly taskId: string;
  readonly principalId: PrincipalId;
  readonly environmentId: EnvironmentId;
  readonly incarnationId: string;
  readonly policyRef: PolicyRevisionRef;
  readonly routeId: string;
  readonly role: string;
  readonly capabilitySnapshotRef: string;
  readonly expiresAt: DateTime.Utc;
  readonly revocationState: "clear" | "hardRevoked" | "unknown";
}
export interface PolicyDelegatedException {
  readonly ref: string;
  readonly parentPolicyRef: PolicyRevisionRef;
  readonly projectId: ProjectId;
  readonly policyDigest: string;
  readonly expiresAt: DateTime.Utc;
}
/** Injected by authenticated services, never constructed from mutation-body role claims. No port implementation or persistence is supplied here. */
export interface RoutingAuthorityPort {
  /** The current request's verified session principal, never a body claim or directory lookup. Services must bind a fresh port to each request; null means unauthenticated. */
  resolveAuthenticatedActor(): PrincipalId | null;
  resolvePrincipalAuthority(
    principalId: PrincipalId,
    scope: RoutingScope,
  ): { readonly principal: Principal; readonly membership: Membership | null } | null;
  resolveRequiredPolicy(scope: RoutingScope): RoutingPolicy | null;
  resolvePolicy(ref: PolicyRevisionRef, scope: RoutingScope): RoutingPolicy | null;
  /** Recompute/attest SHA-256 over ALL canonical policy content except digest itself; never return the supplied digest without verification. */
  attestPolicyDigest(policy: RoutingPolicy): string | null;
  resolveDelegatedException(ref: string, scope: RoutingScope): PolicyDelegatedException | null;
  resolveDeviceState(input: DeviceBinding): PolicyDeviceState | null;
  resolveCapabilitySnapshot(
    input: DeviceBinding & { readonly ref: string },
  ): PolicyCapabilitySnapshot | null;
  /** Current task assignment resolved from authenticated owning-service state for this request, never a body record or role claim. */
  resolveAdmissionAssignment(): PolicyAdmissionAssignment | null;
  resolveContinuationLease(taskId: string, scope: RoutingScope): PolicyContinuationLease | null;
}
export interface DeviceBinding extends RoutingScope {
  readonly environmentId: EnvironmentId;
  readonly incarnationId: string;
}
export interface PolicyAdmissionAssignment extends DeviceBinding {
  readonly taskId: string;
  readonly principalId: PrincipalId;
  readonly role: string;
  readonly policyRef: PolicyRevisionRef;
  readonly expiresAt: DateTime.Utc;
}
export const policyReference = (policy: RoutingPolicy): PolicyRevisionRef => ({
  policyId: policy.policyId,
  revision: policy.revision,
  digest: policy.digest,
});
export interface PublishRoutingPolicyInput {
  readonly policy: RoutingPolicy;
  readonly expectedRevision: number;
  readonly now: DateTime.Utc;
  readonly port?: RoutingAuthorityPort | undefined;
}
export interface ResolveManagedRouteInput extends DeviceBinding {
  readonly principalId: PrincipalId;
  readonly role: string;
  readonly routeId: string;
  readonly now: DateTime.Utc;
  readonly mode?: "new" | "continue";
  readonly taskId?: string;
  readonly port?: RoutingAuthorityPort | undefined;
}
export interface ResolvedManagedRoute {
  readonly policyRef: PolicyRevisionRef;
  readonly capabilitySnapshotRef: string;
  readonly route: PolicyRoute;
}
export interface AcknowledgePolicyDeviceInput extends DeviceBinding {
  readonly principalId: PrincipalId;
  readonly expectedRevision: number;
  readonly appliedPolicyRef: PolicyRevisionRef;
  readonly capabilitySnapshotRef: string;
  readonly resolvedRoutesHash: string;
  readonly now: DateTime.Utc;
  readonly port?: RoutingAuthorityPort | undefined;
}
const sameScope = (a: RoutingScope, b: RoutingScope): boolean =>
  a.scope === b.scope &&
  a.orgId === b.orgId &&
  a.projectId === b.projectId &&
  a.ownerPrincipalId === b.ownerPrincipalId;
const sameRef = (a: PolicyRevisionRef | null, b: PolicyRevisionRef): boolean =>
  a !== null && a.policyId === b.policyId && a.revision === b.revision && a.digest === b.digest;
function deny(message: string): never {
  throw new ProgrammePolicyDeniedError({ message });
}
function unavailable(message: string): never {
  throw new ProgrammeCapabilityUnavailableError({ message });
}
const trustedPort = (port: RoutingAuthorityPort | undefined): RoutingAuthorityPort =>
  port ?? unavailable("Routing requires the trusted policy authority port");
const checkScope = (scope: RoutingScope): void => {
  if (!isRoutingScope(scope))
    throw new ProgrammeInvalidRequestError({ message: "Routing scope is invalid" });
};
const checkRevision = (expected: number, actual: number): void => {
  if (!Number.isSafeInteger(expected) || expected < 0)
    throw new ProgrammeInvalidRequestError({
      message: "Expected revision must be a non-negative integer",
    });
  if (expected !== actual)
    throw new ProgrammeRevisionConflictError({
      message: "Routing revision changed",
      expectedRevision: expected,
      currentRevision: actual,
    });
};
const verifiedPolicy = (policy: RoutingPolicy, port: RoutingAuthorityPort): RoutingPolicy => {
  if (!isRoutingPolicy(policy))
    throw new ProgrammeInvalidRequestError({ message: "Routing policy is invalid" });
  const attested = port.attestPolicyDigest(policy);
  if (attested === null) unavailable("Policy content digest cannot be attested");
  if (attested !== policy.digest) deny("Policy digest does not bind its content");
  const ids = policy.routes.map((r) => r.routeId);
  if (
    new Set(ids).size !== ids.length ||
    new Set(policy.roleRules.map((r) => r.role)).size !== policy.roleRules.length ||
    policy.routes.some(
      (r) =>
        !policy.permittedModels.includes(r.model) ||
        (r.effort !== null && !policy.permittedEfforts.includes(r.effort)),
    ) ||
    policy.roleRules.some((r) => r.routeIds.some((id) => !ids.includes(id))) ||
    policy.fallbackRules.some((r) => !ids.includes(r.fromRouteId) || !ids.includes(r.toRouteId))
  )
    deny("Policy routes and constraints disagree");
  return policy;
};
const checkPrincipal = (
  port: RoutingAuthorityPort,
  principalId: PrincipalId,
  scope: RoutingScope,
  publication: boolean,
): void => {
  checkScope(scope);
  const actor =
    port.resolveAuthenticatedActor?.() ?? unavailable("Authenticated routing actor is unavailable");
  if (actor !== principalId)
    throw new ProgrammeForbiddenError({
      message: "Routing subject differs from the authenticated actor",
    });
  const authority =
    port.resolvePrincipalAuthority(principalId, scope) ??
    unavailable("Scoped principal authority is unavailable");
  const { principal, membership } = authority;
  let permitted = principal.principalId === principalId && principal.status === "active";
  if (scope.scope === "solo") permitted = permitted && scope.ownerPrincipalId === principalId;
  else {
    permitted =
      permitted &&
      principal.orgId === scope.orgId &&
      membership !== null &&
      membership.principalId === principalId &&
      membership.orgId === scope.orgId &&
      membership.status === "active";
    if (membership !== null) {
      const orgAdmin =
        membership.organisationRole === "owner" || membership.organisationRole === "admin";
      if (publication)
        permitted =
          permitted &&
          (orgAdmin ||
            (scope.scope === "project" &&
              scope.projectId !== null &&
              effectiveProjectGrant(membership, scope.projectId) === "admin"));
      else
        permitted =
          permitted &&
          membership.organisationRole !== "guest" &&
          (scope.scope === "org" ||
            orgAdmin ||
            (scope.projectId !== null &&
              effectiveProjectGrant(membership, scope.projectId) !== "none"));
    }
  }
  if (!permitted)
    throw new ProgrammeForbiddenError({
      message: "Principal has no authority for this routing scope",
    });
};
const rules = (p: RoutingPolicy) => ({
  roleRules: p.roleRules,
  requiredSkillProfileRef: p.requiredSkillProfileRef,
  requiredSkillProfileHash: p.requiredSkillProfileHash,
  permittedModels: p.permittedModels,
  permittedEfforts: p.permittedEfforts,
  routes: p.routes,
  fallbackRules: p.fallbackRules,
  budgetRules: p.budgetRules,
  continuationRule: p.continuationRule,
  revokedRouteRules: p.revokedRouteRules,
});
const narrows = (child: RoutingPolicy, parent: RoutingPolicy): boolean => {
  const subset = (a: readonly string[], b: readonly string[]) => a.every((v) => b.includes(v));
  return (
    child.requiredSkillProfileRef === parent.requiredSkillProfileRef &&
    child.requiredSkillProfileHash === parent.requiredSkillProfileHash &&
    subset(child.permittedModels, parent.permittedModels) &&
    subset(child.permittedEfforts, parent.permittedEfforts) &&
    child.routes.every((r) =>
      parent.routes.some(
        (p) =>
          r.routeId === p.routeId &&
          r.providerInstanceRef === p.providerInstanceRef &&
          r.model === p.model &&
          r.effort === p.effort,
      ),
    ) &&
    child.roleRules.every((r) =>
      parent.roleRules.some((p) => p.role === r.role && subset(r.routeIds, p.routeIds)),
    ) &&
    child.fallbackRules.every((r) =>
      parent.fallbackRules.some(
        (p) => p.fromRouteId === r.fromRouteId && p.toRouteId === r.toRouteId,
      ),
    ) &&
    child.budgetRules.maxAttempts <= parent.budgetRules.maxAttempts &&
    (parent.budgetRules.maxSpendMinorUnits === null ||
      (child.budgetRules.maxSpendMinorUnits !== null &&
        child.budgetRules.maxSpendMinorUnits <= parent.budgetRules.maxSpendMinorUnits)) &&
    (parent.continuationRule !== "deny" || child.continuationRule === "deny") &&
    parent.revokedRouteRules.every((p) =>
      child.revokedRouteRules.some(
        (r) => p.routeId === r.routeId && (p.mode !== "hard" || r.mode === "hard"),
      ),
    ) &&
    child.delegatedExceptionRefs.length === 0
  );
};
const checkParent = (
  policy: RoutingPolicy,
  port: RoutingAuthorityPort,
  now: DateTime.Utc,
): void => {
  if (policy.scope !== "project") {
    if (policy.parentPolicyRef !== null || policy.delegatedExceptionRef !== null)
      deny("Only a project policy may inherit organisation policy");
    return;
  }
  const parentScope: RoutingScope = {
    scope: "org",
    orgId: policy.orgId,
    projectId: null,
    ownerPrincipalId: null,
  };
  const parent = verifiedPolicy(
    port.resolveRequiredPolicy(parentScope) ??
      unavailable("Current organisation policy is unavailable"),
    port,
  );
  if (
    !sameScope(parent, parentScope) ||
    !sameRef(policy.parentPolicyRef, policyReference(parent)) ||
    DateTime.toEpochMillis(parent.effectiveAt) > DateTime.toEpochMillis(now)
  )
    deny("Project policy is not bound to the effective organisation parent");
  if (narrows(policy, parent)) return;
  const ref = policy.delegatedExceptionRef;
  if (ref === null || !parent.delegatedExceptionRefs.includes(ref))
    deny("Project policy widens organisation rules without delegation");
  const exception = port.resolveDelegatedException(ref, policy);
  if (
    exception === null ||
    exception.ref !== ref ||
    exception.projectId !== policy.projectId ||
    !sameRef(exception.parentPolicyRef, policyReference(parent)) ||
    exception.policyDigest !== policy.digest ||
    DateTime.toEpochMillis(exception.expiresAt) <= DateTime.toEpochMillis(now)
  )
    deny("Delegated policy exception is absent, stale or bound to other content");
};
/** Returns a publication decision only. The owning service must atomically CAS/persist the unchanged revision and digest. */
export const publishRoutingPolicy = (input: PublishRoutingPolicyInput): RoutingPolicy => {
  const port = trustedPort(input.port);
  const policy = verifiedPolicy(input.policy, port);
  checkPrincipal(port, policy.issuerPrincipalId, policy, true);
  const head = port.resolveRequiredPolicy(policy);
  if (head !== null) {
    verifiedPolicy(head, port);
    if (!sameScope(head, policy)) deny("Current policy belongs to another scope");
  }
  checkRevision(input.expectedRevision, head?.revision ?? 0);
  if (
    policy.revision !== (head?.revision ?? 0) + 1 ||
    (head === null
      ? policy.supersedesRef !== null
      : policy.policyId !== head.policyId || !sameRef(policy.supersedesRef, policyReference(head)))
  )
    deny("Policy publication must append the next immutable revision");
  checkParent(policy, port, input.now);
  if (policy.rollbackOfRef !== null) {
    const previous =
      port.resolvePolicy(policy.rollbackOfRef, policy) ??
      unavailable("Rollback content is unavailable");
    verifiedPolicy(previous, port);
    if (
      !sameScope(previous, policy) ||
      previous.policyId !== policy.policyId ||
      !sameRef(policy.rollbackOfRef, policyReference(previous)) ||
      previous.revision >= policy.revision ||
      JSON.stringify(rules(previous)) !== JSON.stringify(rules(policy))
    )
      deny("Rollback must bind prior content in a new increasing revision");
  }
  return decodePolicy(encodePolicy(policy));
};
const requiredPolicy = (
  scope: RoutingScope,
  port: RoutingAuthorityPort,
  now: DateTime.Utc,
): RoutingPolicy => {
  const policy = verifiedPolicy(
    port.resolveRequiredPolicy(scope) ??
      unavailable(
        "Authoritative required policy is unavailable; reconcile before new managed admission",
      ),
    port,
  );
  if (
    !sameScope(policy, scope) ||
    DateTime.toEpochMillis(policy.effectiveAt) > DateTime.toEpochMillis(now)
  )
    deny("Required policy is outside scope or not effective");
  checkParent(policy, port, now);
  return policy;
};
const deviceRecord = (input: DeviceBinding, port: RoutingAuthorityPort): PolicyDeviceState => {
  const device =
    port.resolveDeviceState(input) ??
    unavailable("Device policy state is unavailable; reconcile this incarnation");
  if (
    !isPolicyDeviceState(device) ||
    !sameScope(input, device) ||
    device.environmentId !== input.environmentId ||
    device.incarnationId !== input.incarnationId
  )
    deny("Device policy record does not match this scope and incarnation");
  return device;
};
const capability = (
  input: DeviceBinding,
  ref: string,
  policy: RoutingPolicy,
  now: DateTime.Utc,
  port: RoutingAuthorityPort,
): PolicyCapabilitySnapshot => {
  const snapshot =
    port.resolveCapabilitySnapshot({ ...input, ref }) ??
    unavailable("Capability snapshot is unavailable");
  if (
    snapshot.ref !== ref ||
    snapshot.environmentId !== input.environmentId ||
    snapshot.incarnationId !== input.incarnationId ||
    !sameRef(snapshot.policyRef, policyReference(policy)) ||
    !isSha256Digest(snapshot.resolvedRoutesHash) ||
    DateTime.toEpochMillis(snapshot.observedAt) > DateTime.toEpochMillis(now) ||
    DateTime.toEpochMillis(snapshot.expiresAt) <= DateTime.toEpochMillis(now)
  )
    unavailable("Capability snapshot is stale or bound to another policy/incarnation");
  return snapshot;
};
const selectedRoute = (
  policy: RoutingPolicy,
  routeId: string,
  role: string,
  continuation: boolean,
): PolicyRoute => {
  const route = policy.routes.find((r) => r.routeId === routeId);
  if (
    route === undefined ||
    !policy.roleRules.some((r) => r.role === role && r.routeIds.includes(routeId)) ||
    policy.revokedRouteRules.some(
      (r) => r.routeId === routeId && (!continuation || r.mode === "hard"),
    )
  )
    deny("Route is not permitted for this role or is revoked");
  return route;
};
export const resolveManagedRoute = (input: ResolveManagedRouteInput): ResolvedManagedRoute => {
  const port = trustedPort(input.port);
  checkPrincipal(port, input.principalId, input, false);
  if (input.mode === "continue") {
    const lease =
      input.taskId === undefined ? null : port.resolveContinuationLease(input.taskId, input);
    if (lease === null) unavailable("Original continuation lease is unavailable");
    if (
      !sameScope(lease, input) ||
      lease.taskId !== input.taskId ||
      lease.principalId !== input.principalId ||
      lease.environmentId !== input.environmentId ||
      lease.incarnationId !== input.incarnationId ||
      lease.routeId !== input.routeId ||
      lease.role !== input.role ||
      lease.revocationState !== "clear" ||
      DateTime.toEpochMillis(lease.expiresAt) <= DateTime.toEpochMillis(input.now)
    )
      deny("Original continuation lease is expired, revoked or outside this task binding");
    const original = verifiedPolicy(
      port.resolvePolicy(lease.policyRef, input) ??
        unavailable("Original approved policy is unavailable"),
      port,
    );
    if (
      !sameScope(original, input) ||
      !sameRef(lease.policyRef, policyReference(original)) ||
      original.continuationRule !== "leaseBound" ||
      DateTime.toEpochMillis(original.effectiveAt) > DateTime.toEpochMillis(input.now)
    )
      deny("Original policy does not permit this continuation");
    const current = port.resolveRequiredPolicy(input);
    if (current !== null) {
      verifiedPolicy(current, port);
      if (
        !sameScope(current, input) ||
        current.revokedRouteRules.some((r) => r.routeId === input.routeId && r.mode === "hard")
      )
        deny("Current policy hard-revokes this route or has wrong scope");
    }
    if (input.scope === "project") {
      const parentScope: RoutingScope = {
        scope: "org",
        orgId: input.orgId,
        projectId: null,
        ownerPrincipalId: null,
      };
      const parent = port.resolveRequiredPolicy(parentScope);
      if (parent !== null) {
        verifiedPolicy(parent, port);
        if (
          !sameScope(parent, parentScope) ||
          parent.revokedRouteRules.some((r) => r.routeId === input.routeId && r.mode === "hard")
        )
          deny("Organisation policy hard-revokes this continuation route or has wrong scope");
      }
    }
    return {
      policyRef: policyReference(original),
      capabilitySnapshotRef: lease.capabilitySnapshotRef,
      route: { ...selectedRoute(original, input.routeId, input.role, true) },
    };
  }
  const policy = requiredPolicy(input, port, input.now);
  if (input.taskId === undefined) unavailable("Managed admission requires a task binding");
  const assignment =
    port.resolveAdmissionAssignment?.() ??
    unavailable("Authoritative admission assignment is unavailable");
  if (
    !sameScope(assignment, input) ||
    assignment.taskId !== input.taskId ||
    assignment.principalId !== input.principalId ||
    assignment.environmentId !== input.environmentId ||
    assignment.incarnationId !== input.incarnationId ||
    assignment.role !== input.role ||
    !sameRef(assignment.policyRef, policyReference(policy)) ||
    DateTime.toEpochMillis(assignment.expiresAt) <= DateTime.toEpochMillis(input.now)
  )
    deny("Admission assignment is expired or outside this task, actor, role or policy binding");
  const device = deviceRecord(input, port);
  if (
    device.state !== "current" ||
    !sameRef(device.requiredPolicyRef, policyReference(policy)) ||
    device.acknowledgedRevision !== policy.revision ||
    device.acknowledgedDigest !== policy.digest ||
    device.capabilitySnapshotRef === null ||
    DateTime.toEpochMillis(device.observedAt) > DateTime.toEpochMillis(input.now)
  )
    deny("Device policy is pending or drifted; reconcile before new managed admission");
  const snapshot = capability(input, device.capabilitySnapshotRef, policy, input.now, port);
  if (snapshot.resolvedRoutesHash !== device.resolvedRoutesHash)
    deny("Device acknowledgement differs from trusted route resolution");
  const route = selectedRoute(policy, input.routeId, input.role, false);
  const routeCapability = snapshot.routes.find((r) => r.routeId === route.routeId);
  if (routeCapability === undefined || routeCapability.state !== "available")
    unavailable(`Route capability is ${routeCapability?.state ?? "unavailable"}`);
  return {
    policyRef: policyReference(policy),
    capabilitySnapshotRef: snapshot.ref,
    route: { ...route },
  };
};
export const acknowledgePolicyDevice = (input: AcknowledgePolicyDeviceInput): PolicyDeviceState => {
  const port = trustedPort(input.port);
  checkPrincipal(port, input.principalId, input, false);
  const policy = requiredPolicy(input, port, input.now);
  const device = deviceRecord(input, port);
  checkRevision(input.expectedRevision, device.revision);
  if (!sameRef(input.appliedPolicyRef, policyReference(policy)))
    deny("Acknowledgement does not bind the authoritative required policy");
  const snapshot = capability(input, input.capabilitySnapshotRef, policy, input.now, port);
  if (input.resolvedRoutesHash !== snapshot.resolvedRoutesHash)
    deny("Acknowledgement does not bind the trusted applied routes hash");
  return {
    ...device,
    revision: device.revision + 1,
    createdAt: DateTime.toUtc(device.createdAt),
    updatedAt: DateTime.toUtc(input.now),
    requiredPolicyRef: policyReference(policy),
    acknowledgedRevision: policy.revision,
    acknowledgedDigest: policy.digest,
    capabilitySnapshotRef: snapshot.ref,
    resolvedRoutesHash: snapshot.resolvedRoutesHash,
    state: snapshot.routes.some(
      (r) => r.state === "available" && policy.routes.some((p) => p.routeId === r.routeId),
    )
      ? "current"
      : "unavailable",
    observedAt: DateTime.toUtc(input.now),
  };
};
