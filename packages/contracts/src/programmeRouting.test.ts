/// <reference types="node" />
import { describe, expect, it } from "@effect/vitest";
// Native synchronous SHA-256 is limited to the trusted test attestor.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { EnvironmentId, ProjectId } from "./baseSchemas.ts";
import { OrgId, PrincipalId } from "./programmeDomain.ts";
import { Membership, Principal } from "./programmeIdentity.ts";
import {
  PolicyDeviceState,
  RoutingPolicy,
  acknowledgePolicyDevice,
  policyReference,
  publishRoutingPolicy,
  resolveManagedRoute,
  type RoutingAuthorityPort,
} from "./programmeRouting.ts";

const decodeWire = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(Schema.toCodecJson(schema) as never) as (value: unknown) => S["Type"];
const encodeRecord = <S extends Schema.Top & { readonly EncodingServices: never }>(schema: S) => {
  const encode = Schema.encodeSync(Schema.toCodecJson(schema));
  return (value: S["Type"]): Record<string, unknown> => {
    const json = encode(value);
    if (json === null || typeof json !== "object" || Array.isArray(json))
      throw new Error("Expected encoded contract object");
    return Object.fromEntries(Object.entries(json));
  };
};
const encodePolicy = encodeRecord(RoutingPolicy);
const encodeDevice = encodeRecord(PolicyDeviceState);
const toOrgId = Schema.decodeSync(OrgId);
const toProjectId = Schema.decodeSync(ProjectId);
const toPrincipalId = Schema.decodeSync(PrincipalId);
const toEnvironmentId = Schema.decodeSync(EnvironmentId);
const NOW = DateTime.makeUnsafe("2026-10-28T12:00:00.000Z");
const PAST = "2026-10-28T11:00:00.000Z";
const FUTURE = DateTime.makeUnsafe("2026-10-28T13:00:00.000Z");
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const ORG = toOrgId("org-a");
const PROJECT = toProjectId("project-a");
const PRINCIPAL = toPrincipalId("principal-a");
const ENV = toEnvironmentId("environment-a");
const scope = { scope: "org", orgId: ORG, projectId: null, ownerPrincipalId: null } as const;
const projectScope = { ...scope, scope: "project", projectId: PROJECT } as const;
const soloScope = {
  scope: "solo",
  orgId: null,
  projectId: null,
  ownerPrincipalId: PRINCIPAL,
} as const;
const common = {
  schemaVersion: 1,
  revision: 1,
  createdAt: PAST,
  updatedAt: PAST,
  retentionClass: "standard",
  visibilityClass: "private",
};
const wirePolicy = (overrides: Record<string, unknown> = {}) => ({
  ...common,
  ...scope,
  policyId: "policy-a",
  issuerPrincipalId: PRINCIPAL,
  parentPolicyRef: null,
  digest: HASH,
  effectiveAt: PAST,
  roleRules: [{ role: "builder", routeIds: ["route-a"] }],
  requiredSkillProfileRef: "skill-profile-1",
  requiredSkillProfileHash: HASH,
  permittedModels: ["user-selected-model"],
  permittedEfforts: ["high"],
  routes: [
    {
      routeId: "route-a",
      providerInstanceRef: "native-instance",
      model: "user-selected-model",
      effort: "high",
    },
  ],
  fallbackRules: [],
  budgetRules: { maxSpendMinorUnits: null, maxAttempts: 3 },
  continuationRule: "leaseBound",
  revokedRouteRules: [],
  supersedesRef: null,
  delegatedExceptionRefs: [],
  delegatedExceptionRef: null,
  rollbackOfRef: null,
  ...overrides,
});
const digest = (policy: RoutingPolicy) => {
  const { digest: _digest, ...content } = encodePolicy(policy);
  return NodeCrypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
};
const policy = (overrides: Record<string, unknown> = {}): RoutingPolicy => {
  const value = decodeWire(RoutingPolicy)(wirePolicy(overrides));
  return { ...value, digest: digest(value) };
};
const tagged = (run: () => unknown, tag: string) => {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect(thrown).toHaveProperty("_tag", tag);
};
const fixture = () => {
  const current = policy();
  const principal = decodeWire(Principal)({
    ...common,
    orgId: ORG,
    principalId: PRINCIPAL,
    kind: "human",
    identityRef: { provider: "native", identityId: "human-a", binding: "human" },
    status: "active",
    displayName: null,
  });
  const membership = decodeWire(Membership)({
    ...common,
    orgId: ORG,
    membershipId: "membership-a",
    principalId: PRINCIPAL,
    organisationRole: "admin",
    teamIds: [],
    projectGrants: [{ projectId: PROJECT, grant: "admin" }],
    policyVersion: "v1",
    status: "active",
  });
  const device = decodeWire(PolicyDeviceState)({
    ...common,
    ...scope,
    environmentId: ENV,
    incarnationId: "incarnation-a",
    requiredPolicyRef: policyReference(current),
    acknowledgedRevision: 1,
    acknowledgedDigest: current.digest,
    capabilitySnapshotRef: "snapshot-a",
    resolvedRoutesHash: HASH,
    state: "current",
    observedAt: PAST,
  });
  const snapshot = {
    ref: "snapshot-a",
    environmentId: ENV,
    incarnationId: "incarnation-a",
    policyRef: policyReference(current),
    resolvedRoutesHash: HASH,
    observedAt: DateTime.makeUnsafe(PAST),
    expiresAt: FUTURE,
    routes: [{ routeId: "route-a", state: "available" as const }],
  };
  const lease = {
    taskId: "task-a",
    principalId: PRINCIPAL,
    ...scope,
    environmentId: ENV,
    incarnationId: "incarnation-a",
    policyRef: policyReference(current),
    routeId: "route-a",
    role: "builder",
    capabilitySnapshotRef: "snapshot-a",
    expiresAt: FUTURE,
    revocationState: "clear" as const,
  };
  const assignment = {
    taskId: "task-a",
    principalId: PRINCIPAL,
    ...scope,
    environmentId: ENV,
    incarnationId: "incarnation-a",
    role: "builder",
    policyRef: policyReference(current),
    expiresAt: FUTURE,
  };
  const port: RoutingAuthorityPort = {
    resolveAdmissionAssignment: () => assignment,
    resolveAuthenticatedActor: () => PRINCIPAL,
    resolvePrincipalAuthority: () => ({ principal, membership }),
    resolveRequiredPolicy: () => current,
    resolvePolicy: () => current,
    attestPolicyDigest: digest,
    resolveDelegatedException: () => null,
    resolveDeviceState: () => device,
    resolveCapabilitySnapshot: () => snapshot,
    resolveContinuationLease: () => lease,
  };
  const request = {
    taskId: "task-a",
    principalId: PRINCIPAL,
    ...scope,
    environmentId: ENV,
    incarnationId: "incarnation-a",
    routeId: "route-a",
    role: "builder",
    now: NOW,
    port,
  };
  return { current, principal, membership, device, snapshot, lease, assignment, port, request };
};
const publish = (
  candidate: RoutingPolicy,
  port: RoutingAuthorityPort | undefined,
  expectedRevision = 1,
) => publishRoutingPolicy({ policy: candidate, expectedRevision, now: NOW, port });
const next = (current: RoutingPolicy, overrides: Record<string, unknown> = {}) =>
  policy({
    revision: 2,
    supersedesRef: policyReference(current),
    ...overrides,
  });

describe("routing policy wire contracts", () => {
  it("roundtrips policy and device state through the shared wire codec", () => {
    const f = fixture();
    expect(decodeWire(RoutingPolicy)(encodePolicy(f.current))).toEqual(f.current);
    expect(decodeWire(PolicyDeviceState)(encodeDevice(f.device))).toEqual(f.device);
  });
  it.each([
    { schemaVersion: 2 },
    { policyId: " " },
    { digest: "abc" },
    { revision: 0 },
    { revision: 1.5 },
    { scope: "project", projectId: null },
    { scope: "solo" },
    { scope: "org", projectId: "foreign-project" },
    { requiredSkillProfileHash: "" },
    { permittedModels: [] },
    { routes: [] },
    { budgetRules: { maxAttempts: 0, maxSpendMinorUnits: null } },
  ])("rejects malformed policy %j", (change) => {
    expect(() => decodeWire(RoutingPolicy)(wirePolicy(change))).toThrow();
  });
  it("rejects partial acknowledgement and a current state without applied content", () => {
    const f = fixture();
    const encode = encodeDevice;
    expect(() =>
      decodeWire(PolicyDeviceState)({ ...encode(f.device), acknowledgedDigest: null }),
    ).toThrow();
    expect(() =>
      decodeWire(PolicyDeviceState)({ ...encode(f.device), capabilitySnapshotRef: null }),
    ).toThrow();
    expect(() =>
      decodeWire(PolicyDeviceState)({ ...encode(f.device), schemaVersion: 2 }),
    ).toThrow();
  });
});

describe("trusted policy publication", () => {
  it("publishes an authorised increasing revision without changing supplied records", () => {
    const f = fixture();
    const candidate = next(f.current);
    const before = structuredClone(candidate);
    expect(publish(candidate, f.port)).toEqual(candidate);
    expect(candidate).toEqual(before);
  });
  it("publishes a first org policy only with no current head and expectedRevision zero", () => {
    const f = fixture();
    expect(publish(f.current, { ...f.port, resolveRequiredPolicy: () => null }, 0)).toEqual(
      f.current,
    );
  });
  it("requires trusted authority and content attestation, regardless of body role", () => {
    const f = fixture();
    const candidate = next(f.current);
    tagged(() => publish(candidate, undefined), "ProgrammeCapabilityUnavailableError");
    tagged(
      () => publish(candidate, { ...f.port, resolvePrincipalAuthority: () => null }),
      "ProgrammeCapabilityUnavailableError",
    );
    tagged(
      () => publish(candidate, { ...f.port, attestPolicyDigest: () => null }),
      "ProgrammeCapabilityUnavailableError",
    );
    tagged(
      () => publish({ ...candidate, digest: OTHER_HASH }, f.port),
      "ProgrammePolicyDeniedError",
    );
    tagged(
      () =>
        publish(candidate, {
          ...f.port,
          resolvePrincipalAuthority: () => ({
            principal: f.principal,
            membership: { ...f.membership, organisationRole: "member" },
          }),
        }),
      "ProgrammeForbiddenError",
    );
  });
  it.each(["principal", "org", "membership", "inactive"])("denies forged issuer %s", (field) => {
    const f = fixture();
    const principal = {
      ...f.principal,
      ...(field === "principal" ? { principalId: toPrincipalId("other") } : {}),
      ...(field === "org" ? { orgId: toOrgId("other") } : {}),
      ...(field === "inactive" ? { status: "suspended" as const } : {}),
    };
    const membership = {
      ...f.membership,
      ...(field === "membership" ? { principalId: toPrincipalId("other") } : {}),
    };
    const candidate = next(f.current);
    const before = structuredClone(candidate);
    tagged(
      () =>
        publish(candidate, {
          ...f.port,
          resolvePrincipalAuthority: () => ({ principal, membership }),
        }),
      "ProgrammeForbiddenError",
    );
    expect(candidate).toEqual(before);
  });
  it("rejects stale CAS, changed policy identity and incorrect supersedes bindings", () => {
    const f = fixture();
    tagged(() => publish(next(f.current), f.port, 0), "ProgrammeRevisionConflictError");
    for (const candidate of [
      next(f.current, { policyId: "different" }),
      next(f.current, { supersedesRef: null }),
      next(f.current, { revision: 1 }),
      next(f.current, { supersedesRef: { ...policyReference(f.current), digest: OTHER_HASH } }),
    ]) {
      tagged(() => publish(candidate, f.port), "ProgrammePolicyDeniedError");
    }
  });
  it("requires project admin authority and the exact current org parent", () => {
    const f = fixture();
    const child = policy({
      ...projectScope,
      policyId: "project-policy",
      parentPolicyRef: policyReference(f.current),
    });
    const port = {
      ...f.port,
      resolveRequiredPolicy: (s: { scope: string }) => (s.scope === "org" ? f.current : null),
    };
    expect(publish(child, port, 0)).toEqual(child);
    tagged(
      () =>
        publish(
          child,
          {
            ...port,
            resolvePrincipalAuthority: () => ({
              principal: f.principal,
              membership: {
                ...f.membership,
                organisationRole: "member" as const,
                projectGrants: [{ projectId: toProjectId("other"), grant: "admin" as const }],
              },
            }),
          },
          0,
        ),
      "ProgrammeForbiddenError",
    );
    tagged(
      () =>
        publish(
          { ...child, parentPolicyRef: { ...policyReference(f.current), revision: 9 } },
          port,
          0,
        ),
      "ProgrammePolicyDeniedError",
    );
  });
  it("allows inherited narrowing and forbids widening without a bound recorded exception", () => {
    const f = fixture();
    const parent = policy({ delegatedExceptionRefs: ["exception-a"] });
    const child = policy({
      ...projectScope,
      policyId: "project-policy",
      parentPolicyRef: policyReference(parent),
      budgetRules: { maxSpendMinorUnits: 100, maxAttempts: 2 },
    });
    const port: RoutingAuthorityPort = {
      ...f.port,
      resolveRequiredPolicy: (s) => (s.scope === "org" ? parent : null),
      resolvePolicy: () => parent,
    };
    expect(publish(child, port, 0)).toEqual(child);
    const wide = policy({
      ...projectScope,
      policyId: "project-policy",
      parentPolicyRef: policyReference(parent),
      permittedModels: ["another-model"],
      routes: [
        {
          routeId: "route-a",
          providerInstanceRef: "native-instance",
          model: "another-model",
          effort: "high",
        },
      ],
      delegatedExceptionRef: "exception-a",
    });
    tagged(() => publish(wide, port, 0), "ProgrammePolicyDeniedError");
    const exception = {
      ref: "exception-a",
      parentPolicyRef: policyReference(parent),
      projectId: PROJECT,
      policyDigest: wide.digest,
      expiresAt: FUTURE,
    };
    expect(publish(wide, { ...port, resolveDelegatedException: () => exception }, 0)).toEqual(wide);
    tagged(
      () =>
        publish(
          wide,
          {
            ...port,
            resolveDelegatedException: () => ({ ...exception, policyDigest: OTHER_HASH }),
          },
          0,
        ),
      "ProgrammePolicyDeniedError",
    );
  });
  it.each([
    { budgetRules: { maxAttempts: 9, maxSpendMinorUnits: null } },
    { continuationRule: "leaseBound" },
    { revokedRouteRules: [] },
    { roleRules: [{ role: "coordinator", routeIds: ["route-a"] }] },
    { requiredSkillProfileHash: OTHER_HASH },
    { fallbackRules: [{ fromRouteId: "route-a", toRouteId: "route-a" }] },
  ])("rejects inherited constraint widening %j", (change) => {
    const f = fixture();
    const parent = policy({
      continuationRule: "deny",
      budgetRules: { maxAttempts: 2, maxSpendMinorUnits: 100 },
      revokedRouteRules: [{ routeId: "route-a", mode: "hard" }],
    });
    const child = policy({
      ...projectScope,
      policyId: "child",
      parentPolicyRef: policyReference(parent),
      continuationRule: "deny",
      budgetRules: { maxAttempts: 2, maxSpendMinorUnits: 100 },
      revokedRouteRules: [{ routeId: "route-a", mode: "hard" }],
      ...change,
    });
    tagged(
      () =>
        publish(
          child,
          {
            ...f.port,
            resolveRequiredPolicy: (s) => (s.scope === "org" ? parent : null),
            resolvePolicy: () => parent,
          },
          0,
        ),
      "ProgrammePolicyDeniedError",
    );
  });
  it("allows a solo owner and denies another principal's solo policy", () => {
    const f = fixture();
    const solo = policy({ ...soloScope });
    const port = { ...f.port, resolveRequiredPolicy: () => null };
    expect(publish(solo, port, 0)).toEqual(solo);
    tagged(
      () => publish(policy({ ...soloScope, ownerPrincipalId: "other" }), port, 0),
      "ProgrammeForbiddenError",
    );
  });
  it("represents rollback as a new monotonic revision referring to prior content", () => {
    const f = fixture();
    const old = f.current;
    const current = next(old);
    const rollback = policy({
      revision: 3,
      supersedesRef: policyReference(current),
      rollbackOfRef: policyReference(old),
    });
    const port = {
      ...f.port,
      resolveRequiredPolicy: () => current,
      resolvePolicy: (ref: { revision: number }) => (ref.revision === 1 ? old : current),
    };
    expect(publish(rollback, port, 2).revision).toBe(3);
    tagged(() => publish({ ...rollback, revision: 1 }, port, 2), "ProgrammePolicyDeniedError");
  });
});

describe("managed admission and device acknowledgement", () => {
  it("resolves a current authorised route without funding telemetry or a vendor whitelist", () => {
    const f = fixture();
    expect(resolveManagedRoute(f.request).route.model).toBe("user-selected-model");
  });
  it.each(["pending", "drifted", "unavailable"] as const)(
    "blocks new work with %s device state",
    (state) => {
      const f = fixture();
      tagged(
        () =>
          resolveManagedRoute({
            ...f.request,
            port: { ...f.port, resolveDeviceState: () => ({ ...f.device, state }) },
          }),
        "ProgrammePolicyDeniedError",
      );
    },
  );
  it("blocks offline or missing authority and a future effective policy", () => {
    const f = fixture();
    tagged(
      () => resolveManagedRoute({ ...f.request, port: undefined }),
      "ProgrammeCapabilityUnavailableError",
    );
    tagged(
      () =>
        resolveManagedRoute({
          ...f.request,
          port: { ...f.port, resolveRequiredPolicy: () => null },
        }),
      "ProgrammeCapabilityUnavailableError",
    );
    const future = policy({ effectiveAt: "2026-10-28T13:00:00.000Z" });
    tagged(
      () =>
        resolveManagedRoute({
          ...f.request,
          port: { ...f.port, resolveRequiredPolicy: () => future },
        }),
      "ProgrammePolicyDeniedError",
    );
  });
  it.each(["unknown", "stale", "probeFailed", "unavailable"] as const)(
    "names %s capability as unavailable",
    (state) => {
      const f = fixture();
      tagged(
        () =>
          resolveManagedRoute({
            ...f.request,
            port: {
              ...f.port,
              resolveCapabilitySnapshot: () => ({
                ...f.snapshot,
                routes: [{ routeId: "route-a", state }],
              }),
            },
          }),
        "ProgrammeCapabilityUnavailableError",
      );
    },
  );
  it("rejects expired snapshots and stale incarnation/ack/digest/hash rather than cached defaults", () => {
    const f = fixture();
    for (const device of [
      { ...f.device, incarnationId: "old" },
      { ...f.device, acknowledgedRevision: 0 },
      { ...f.device, acknowledgedDigest: OTHER_HASH },
      { ...f.device, resolvedRoutesHash: OTHER_HASH },
    ]) {
      tagged(
        () =>
          resolveManagedRoute({
            ...f.request,
            port: { ...f.port, resolveDeviceState: () => device },
          }),
        "ProgrammePolicyDeniedError",
      );
    }
    tagged(
      () =>
        resolveManagedRoute({
          ...f.request,
          port: { ...f.port, resolveCapabilitySnapshot: () => ({ ...f.snapshot, expiresAt: NOW }) },
        }),
      "ProgrammeCapabilityUnavailableError",
    );
  });
  it("reconciles an exact policy acknowledgement against trusted device capability content", () => {
    const f = fixture();
    const pending = {
      ...f.device,
      state: "pending" as const,
      acknowledgedRevision: null,
      acknowledgedDigest: null,
      capabilitySnapshotRef: null,
      resolvedRoutesHash: null,
    };
    const input = {
      ...f.request,
      expectedRevision: 1,
      appliedPolicyRef: policyReference(f.current),
      capabilitySnapshotRef: "snapshot-a",
      resolvedRoutesHash: HASH,
      port: { ...f.port, resolveDeviceState: () => pending },
    };
    const ack = acknowledgePolicyDevice(input);
    expect(ack.state).toBe("current");
    expect(ack.revision).toBe(2);
    expect(pending.state).toBe("pending");
    expect(pending.acknowledgedDigest).toBeNull();
    tagged(
      () => acknowledgePolicyDevice({ ...input, expectedRevision: 0 }),
      "ProgrammeRevisionConflictError",
    );
    tagged(
      () =>
        acknowledgePolicyDevice({
          ...input,
          appliedPolicyRef: { ...input.appliedPolicyRef, digest: OTHER_HASH },
        }),
      "ProgrammePolicyDeniedError",
    );
    tagged(
      () => acknowledgePolicyDevice({ ...input, resolvedRoutesHash: OTHER_HASH }),
      "ProgrammePolicyDeniedError",
    );
    tagged(
      () => acknowledgePolicyDevice({ ...input, incarnationId: "new-device" }),
      "ProgrammePolicyDeniedError",
    );
  });
  it("allows only originally approved continuation within a live trusted lease while offline", () => {
    const f = fixture();
    const input = {
      ...f.request,
      taskId: "task-a",
      mode: "continue" as const,
      port: {
        ...f.port,
        resolveRequiredPolicy: () => null,
        resolveDeviceState: () => null,
        resolveCapabilitySnapshot: () => null,
      },
    };
    expect(resolveManagedRoute(input).policyRef).toEqual(policyReference(f.current));
    tagged(
      () =>
        resolveManagedRoute({
          ...input,
          port: { ...input.port, resolveContinuationLease: () => ({ ...f.lease, expiresAt: NOW }) },
        }),
      "ProgrammePolicyDeniedError",
    );
    tagged(
      () =>
        resolveManagedRoute({
          ...input,
          port: {
            ...input.port,
            resolveContinuationLease: () => ({ ...f.lease, revocationState: "unknown" }),
          },
        }),
      "ProgrammePolicyDeniedError",
    );
  });
  it("denies original-policy continuation prohibition, hard revocation and forged lease bindings", () => {
    const f = fixture();
    const input = { ...f.request, mode: "continue" as const, taskId: "task-a" };
    for (const lease of [
      { ...f.lease, principalId: toPrincipalId("other") },
      { ...f.lease, incarnationId: "other" },
      { ...f.lease, taskId: "other" },
      { ...f.lease, revocationState: "hardRevoked" as const },
    ]) {
      tagged(
        () =>
          resolveManagedRoute({
            ...input,
            port: { ...f.port, resolveContinuationLease: () => lease },
          }),
        "ProgrammePolicyDeniedError",
      );
    }
    const denied = policy({ continuationRule: "deny" });
    tagged(
      () =>
        resolveManagedRoute({
          ...input,
          port: {
            ...f.port,
            resolvePolicy: () => denied,
            resolveContinuationLease: () => ({ ...f.lease, policyRef: policyReference(denied) }),
          },
        }),
      "ProgrammePolicyDeniedError",
    );
    const revoked = policy({
      revision: 2,
      revokedRouteRules: [{ routeId: "route-a", mode: "hard" }],
    });
    tagged(
      () =>
        resolveManagedRoute({
          ...input,
          port: { ...f.port, resolveRequiredPolicy: () => revoked },
        }),
      "ProgrammePolicyDeniedError",
    );
  });
});

describe("additional policy boundary probes", () => {
  it("keeps acknowledged capability absence explicit as unavailable", () => {
    const f = fixture();
    const state = acknowledgePolicyDevice({
      ...f.request,
      expectedRevision: 1,
      appliedPolicyRef: policyReference(f.current),
      capabilitySnapshotRef: "snapshot-a",
      resolvedRoutesHash: HASH,
      port: { ...f.port, resolveCapabilitySnapshot: () => ({ ...f.snapshot, routes: [] }) },
    });
    expect(state.state).toBe("unavailable");
    expect(state.acknowledgedDigest).toBe(f.current.digest);
  });
  it("rejects a project continuation when the current organisation parent hard-revokes the route", () => {
    const f = fixture();
    const parent = f.current;
    const child = policy({
      ...projectScope,
      policyId: "child",
      parentPolicyRef: policyReference(parent),
    });
    const revokedParent = policy({
      revision: 2,
      revokedRouteRules: [{ routeId: "route-a", mode: "hard" }],
    });
    tagged(
      () =>
        resolveManagedRoute({
          ...f.request,
          ...projectScope,
          mode: "continue",
          taskId: "task-a",
          port: {
            ...f.port,
            resolvePolicy: () => child,
            resolveRequiredPolicy: (s) => (s.scope === "org" ? revokedParent : child),
            resolveContinuationLease: () => ({
              ...f.lease,
              ...projectScope,
              policyRef: policyReference(child),
            }),
          },
        }),
      "ProgrammePolicyDeniedError",
    );
  });
  it("denies cross-scope required records and capability bindings without mutating records", () => {
    const f = fixture();
    const before = structuredClone(f.device);
    const foreign = policy({ orgId: "foreign" });
    tagged(
      () =>
        resolveManagedRoute({
          ...f.request,
          port: { ...f.port, resolveRequiredPolicy: () => foreign },
        }),
      "ProgrammePolicyDeniedError",
    );
    tagged(
      () =>
        resolveManagedRoute({
          ...f.request,
          port: {
            ...f.port,
            resolveCapabilitySnapshot: () => ({ ...f.snapshot, incarnationId: "foreign" }),
          },
        }),
      "ProgrammeCapabilityUnavailableError",
    );
    tagged(
      () =>
        resolveManagedRoute({
          ...f.request,
          port: {
            ...f.port,
            resolvePrincipalAuthority: () => ({
              principal: f.principal,
              membership: { ...f.membership, orgId: toOrgId("foreign") },
            }),
          },
        }),
      "ProgrammeForbiddenError",
    );
    expect(f.device).toEqual(before);
  });
  it("rejects altered policy content with the previously attested digest", () => {
    const f = fixture();
    const candidate = next(f.current);
    const tampered = { ...candidate, requiredSkillProfileRef: "altered" };
    tagged(() => publish(tampered, f.port), "ProgrammePolicyDeniedError");
  });
});

describe("request-bound routing authority", () => {
  it.each(
    [scope, projectScope, soloScope].flatMap((routingScope) =>
      ["publication", "acknowledgement", "admission", "continuation"].map((decision) => ({
        routingScope,
        decision,
      })),
    ),
  )(
    "binds $decision to the authenticated $routingScope.scope actor",
    ({ routingScope, decision }) => {
      const f = fixture();
      const current = policy({
        ...routingScope,
        parentPolicyRef: routingScope.scope === "project" ? policyReference(f.current) : null,
      });
      const candidate = policy({
        ...encodePolicy(current),
        revision: 2,
        supersedesRef: policyReference(current),
      });
      const device = {
        ...f.device,
        ...routingScope,
        requiredPolicyRef: policyReference(current),
        acknowledgedDigest: current.digest,
      };
      const snapshot = { ...f.snapshot, policyRef: policyReference(current) };
      const member = { ...f.membership, organisationRole: "member" as const };
      const viewerId = toPrincipalId("active-viewer");
      const viewer = { ...f.principal, principalId: viewerId };
      const viewerMembership = {
        ...member,
        principalId: viewerId,
        organisationRole: "member" as const,
        projectGrants: [],
      };
      const authority = {
        principal: f.principal,
        membership: routingScope.scope === "project" ? member : f.membership,
      };
      const port = {
        ...f.port,
        resolvePrincipalAuthority: (id: PrincipalId) =>
          id === PRINCIPAL
            ? authority
            : id === viewerId
              ? { principal: viewer, membership: viewerMembership }
              : null,
        resolveRequiredPolicy: (s: { scope: string }) =>
          routingScope.scope === "project" && s.scope === "org" ? f.current : current,
        resolveDeviceState: () => device,
        resolveCapabilitySnapshot: () => snapshot,
        resolvePolicy: () => current,
        resolveContinuationLease: () => ({
          ...f.lease,
          ...routingScope,
          policyRef: policyReference(current),
        }),
        resolveAdmissionAssignment: () => ({
          ...f.assignment,
          ...routingScope,
          policyRef: policyReference(current),
        }),
      };
      const request = { ...f.request, ...routingScope, port };
      const acknowledgement = {
        ...request,
        expectedRevision: 1,
        appliedPolicyRef: policyReference(current),
        capabilitySnapshotRef: "snapshot-a",
        resolvedRoutesHash: HASH,
      };
      const before = structuredClone({
        current,
        candidate,
        device,
        snapshot,
        authority,
        viewer,
        viewerMembership,
      });
      const decide = (boundPort: RoutingAuthorityPort) => {
        if (decision === "publication") return publish(candidate, boundPort);
        if (decision === "acknowledgement")
          return acknowledgePolicyDevice({ ...acknowledgement, port: boundPort });
        return resolveManagedRoute({
          ...request,
          port: boundPort,
          ...(decision === "continuation" ? { mode: "continue" as const, taskId: "task-a" } : {}),
        });
      };
      expect(decide(port)).toMatchObject(
        decision === "publication" || decision === "acknowledgement"
          ? { revision: 2 }
          : { policyRef: policyReference(current) },
      );
      const otherActorPort = { ...port, resolveAuthenticatedActor: () => viewerId };
      tagged(() => decide(otherActorPort), "ProgrammeForbiddenError");
      expect({ current, candidate, device, snapshot, authority, viewer, viewerMembership }).toEqual(
        before,
      );
    },
  );
  it.each(
    ["org", "project"].flatMap((scopeKind) =>
      ["publication", "acknowledgement", "admission", "continuation"].map((decision) => ({
        scopeKind,
        decision,
      })),
    ),
  )(
    "denies $scopeKind scope forgery during $decision even for the matching authenticated principal",
    ({ scopeKind, decision }) => {
      const f = fixture();
      const foreignScope =
        scopeKind === "org"
          ? { ...scope, orgId: toOrgId("other-org") }
          : { ...projectScope, projectId: toProjectId("other-project") };
      const port = {
        ...f.port,
        resolvePrincipalAuthority: () => ({
          principal: f.principal,
          membership: { ...f.membership, organisationRole: "member" as const },
        }),
      };
      const candidate = policy({ ...foreignScope });
      const request = { ...f.request, ...foreignScope, port };
      const before = structuredClone({
        candidate,
        current: f.current,
        device: f.device,
        principal: f.principal,
        membership: f.membership,
      });
      const decide = () => {
        if (decision === "publication") return publish(candidate, port, 0);
        if (decision === "acknowledgement")
          return acknowledgePolicyDevice({
            ...request,
            expectedRevision: 1,
            appliedPolicyRef: policyReference(f.current),
            capabilitySnapshotRef: "snapshot-a",
            resolvedRoutesHash: HASH,
          });
        return resolveManagedRoute({
          ...request,
          ...(decision === "continuation" ? { mode: "continue" as const, taskId: "task-a" } : {}),
        });
      };
      tagged(decide, "ProgrammeForbiddenError");
      expect({
        candidate,
        current: f.current,
        device: f.device,
        principal: f.principal,
        membership: f.membership,
      }).toEqual(before);
    },
  );
  it("requires an authenticated actor even when genuine directory authority exists", () => {
    const f = fixture();
    for (const port of [
      { ...f.port, resolveAuthenticatedActor: () => null },
      Object.assign({}, f.port),
    ]) {
      if (port.resolveAuthenticatedActor() !== null)
        Reflect.deleteProperty(port, "resolveAuthenticatedActor");
      const before = structuredClone({ current: f.current, device: f.device });
      tagged(() => publish(next(f.current), port), "ProgrammeCapabilityUnavailableError");
      tagged(
        () => resolveManagedRoute({ ...f.request, port }),
        "ProgrammeCapabilityUnavailableError",
      );
      tagged(
        () =>
          acknowledgePolicyDevice({
            ...f.request,
            port,
            expectedRevision: 1,
            appliedPolicyRef: policyReference(f.current),
            capabilitySnapshotRef: "snapshot-a",
            resolvedRoutesHash: HASH,
          }),
        "ProgrammeCapabilityUnavailableError",
      );
      expect({ current: f.current, device: f.device }).toEqual(before);
    }
  });
});

describe("acknowledgement timestamp isolation", () => {
  it("detaches every returned mutable timestamp and policy reference from the prior device and request", () => {
    const f = fixture();
    const now = DateTime.toUtc(NOW);
    const input = {
      ...f.request,
      now,
      expectedRevision: 1,
      appliedPolicyRef: policyReference(f.current),
      capabilitySnapshotRef: "snapshot-a",
      resolvedRoutesHash: HASH,
    };
    const before = encodeDevice(f.device);
    const ack = acknowledgePolicyDevice(input);
    expect(ack.createdAt).not.toBe(f.device.createdAt);
    expect(ack.updatedAt).not.toBe(f.device.updatedAt);
    expect(ack.observedAt).not.toBe(f.device.observedAt);
    expect(ack.updatedAt).not.toBe(now);
    expect(ack.observedAt).not.toBe(now);
    expect(ack.updatedAt).not.toBe(ack.observedAt);
    expect(ack.requiredPolicyRef).not.toBe(f.device.requiredPolicyRef);
    for (const timestamp of [ack.createdAt, ack.updatedAt, ack.observedAt]) {
      expect(DateTime.isDateTime(timestamp)).toBe(true);
      Reflect.set(timestamp, "epochMilliseconds", 0);
    }
    Reflect.set(ack.requiredPolicyRef, "revision", 99);
    expect(encodeDevice(f.device)).toEqual(before);
    expect(DateTime.toEpochMillis(now)).toBe(DateTime.toEpochMillis(NOW));
    expect(input.appliedPolicyRef).toEqual(policyReference(f.current));
  });
  it("retains the accepted timestamps when prior device dates and request time later change", () => {
    const f = fixture();
    const now = DateTime.toUtc(NOW);
    const ack = acknowledgePolicyDevice({
      ...f.request,
      now,
      expectedRevision: 1,
      appliedPolicyRef: policyReference(f.current),
      capabilitySnapshotRef: "snapshot-a",
      resolvedRoutesHash: HASH,
    });
    const before = encodeDevice(ack);
    for (const timestamp of [f.device.createdAt, f.device.updatedAt, f.device.observedAt, now])
      Reflect.set(timestamp, "epochMilliseconds", 0);
    Reflect.set(f.device.requiredPolicyRef, "revision", 99);
    expect(encodeDevice(ack)).toEqual(before);
    expect(ack.revision).toBe(2);
  });
});

describe("trusted task assignment admission", () => {
  it("denies a reviewer assignment claiming builder while the assigned builder is admitted", () => {
    const f = fixture();
    const member = { ...f.membership, organisationRole: "member" as const, projectGrants: [] };
    const reviewerAssignment = { ...f.assignment, role: "reviewer" };
    const port = {
      ...f.port,
      resolvePrincipalAuthority: () => ({ principal: f.principal, membership: member }),
    };
    expect(resolveManagedRoute({ ...f.request, port }).route.routeId).toBe("route-a");
    const request = {
      ...f.request,
      assignment: f.assignment,
      port: { ...port, resolveAdmissionAssignment: () => reviewerAssignment },
    };
    const before = structuredClone({
      assignment: f.assignment,
      reviewerAssignment,
      member,
      current: f.current,
      device: f.device,
      snapshot: f.snapshot,
    });
    tagged(() => resolveManagedRoute(request), "ProgrammePolicyDeniedError");
    expect(request.role).toBe("builder");
    expect(request.taskId).toBe("task-a");
    expect({
      assignment: f.assignment,
      reviewerAssignment,
      member,
      current: f.current,
      device: f.device,
      snapshot: f.snapshot,
    }).toEqual(before);
  });
  it.each(["null resolver result", "missing resolver", "missing task"])(
    "fails closed for %s even with a body assignment",
    (missing) => {
      const f = fixture();
      const port = {
        ...f.port,
        resolveAdmissionAssignment: () =>
          missing === "null resolver result" ? null : f.assignment,
      };
      if (missing === "missing resolver")
        Reflect.deleteProperty(port, "resolveAdmissionAssignment");
      const request = {
        ...f.request,
        assignment: f.assignment,
        port,
      };
      if (missing === "missing task") Reflect.deleteProperty(request, "taskId");
      const before = structuredClone({
        assignment: f.assignment,
        current: f.current,
        device: f.device,
      });
      tagged(() => resolveManagedRoute(request), "ProgrammeCapabilityUnavailableError");
      expect({ assignment: f.assignment, current: f.current, device: f.device }).toEqual(before);
    },
  );
  it.each([
    "task",
    "principal",
    "scope",
    "org",
    "project",
    "solo owner",
    "environment",
    "incarnation",
    "role",
    "expired",
    "policy id",
    "policy revision",
    "policy digest",
  ])("denies an assignment with a mismatched or stale %s", (field) => {
    const f = fixture();
    const assignment = {
      ...f.assignment,
      ...(field === "task" ? { taskId: "other-task" } : {}),
      ...(field === "principal" ? { principalId: toPrincipalId("other-principal") } : {}),
      ...(field === "scope" ? { scope: "project" as const, projectId: PROJECT } : {}),
      ...(field === "org" ? { orgId: toOrgId("other-org") } : {}),
      ...(field === "project" ? { projectId: toProjectId("other-project") } : {}),
      ...(field === "solo owner" ? { ownerPrincipalId: toPrincipalId("other-owner") } : {}),
      ...(field === "environment" ? { environmentId: toEnvironmentId("other-environment") } : {}),
      ...(field === "incarnation" ? { incarnationId: "other-incarnation" } : {}),
      ...(field === "role" ? { role: "reviewer" } : {}),
      ...(field === "expired" ? { expiresAt: NOW } : {}),
      policyRef: {
        ...f.assignment.policyRef,
        ...(field === "policy id"
          ? { policyId: policy({ policyId: "other-policy" }).policyId }
          : {}),
        ...(field === "policy revision" ? { revision: 2 } : {}),
        ...(field === "policy digest" ? { digest: OTHER_HASH } : {}),
      },
    };
    const request = {
      ...f.request,
      port: { ...f.port, resolveAdmissionAssignment: () => assignment },
    };
    const before = structuredClone({
      assignment,
      current: f.current,
      device: f.device,
      snapshot: f.snapshot,
    });
    tagged(() => resolveManagedRoute(request), "ProgrammePolicyDeniedError");
    expect({ assignment, current: f.current, device: f.device, snapshot: f.snapshot }).toEqual(
      before,
    );
  });
  it.each([scope, projectScope, soloScope])(
    "admits a trusted user-defined role in $scope scope with a request-bound lookup",
    (routingScope) => {
      const f = fixture();
      const parent = policy({
        roleRules: [{ role: "user-defined-reviewer", routeIds: ["route-a"] }],
      });
      const current = policy({
        ...routingScope,
        roleRules: parent.roleRules,
        parentPolicyRef: routingScope.scope === "project" ? policyReference(parent) : null,
      });
      const assignment = {
        ...f.assignment,
        ...routingScope,
        role: "user-defined-reviewer",
        policyRef: policyReference(current),
      };
      const lookupArguments: ReadonlyArray<unknown>[] = [];
      const port = {
        ...f.port,
        resolveAdmissionAssignment: (...args: unknown[]) => {
          lookupArguments.push(args);
          return assignment;
        },
        resolveRequiredPolicy: (s: { scope: string }) =>
          routingScope.scope === "project" && s.scope === "org" ? parent : current,
        resolveDeviceState: () => ({
          ...f.device,
          ...routingScope,
          requiredPolicyRef: policyReference(current),
          acknowledgedDigest: current.digest,
        }),
        resolveCapabilitySnapshot: () => ({ ...f.snapshot, policyRef: policyReference(current) }),
      };
      const request = { ...f.request, ...routingScope, role: assignment.role, port };
      const before = structuredClone({
        assignment,
        current,
        device: f.device,
        snapshot: f.snapshot,
      });
      expect(resolveManagedRoute(request).policyRef).toEqual(policyReference(current));
      expect(lookupArguments).toEqual([[]]);
      expect({ assignment, current, device: f.device, snapshot: f.snapshot }).toEqual(before);
    },
  );
  it("keeps approved offline continuation independent of new assignment availability", () => {
    const f = fixture();
    expect(
      resolveManagedRoute({
        ...f.request,
        mode: "continue",
        port: {
          ...f.port,
          resolveRequiredPolicy: () => null,
          resolveAdmissionAssignment: () => {
            throw new Error("New admission lookup must not run");
          },
        },
      }).policyRef,
    ).toEqual(policyReference(f.current));
  });
});
