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
  const port: RoutingAuthorityPort = {
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
    principalId: PRINCIPAL,
    ...scope,
    environmentId: ENV,
    incarnationId: "incarnation-a",
    routeId: "route-a",
    role: "builder",
    now: NOW,
    port,
  };
  return { current, principal, membership, device, snapshot, lease, port, request };
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
