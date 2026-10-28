/**
 * Behavioural tests for the Principal/Membership identity slice B01.2.
 * Promotion tests inject the clearly labelled fixture port from
 * makeLabelledFixturePrincipalPort; no production identity store exists in this slice.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import { OrgId, PrincipalId } from "./programmeDomain.ts";
import {
  IdentityRef,
  Membership,
  Principal,
  effectiveProjectGrant,
  makeLabelledFixturePrincipalPort,
  promoteToHuman,
  requiresOrganisationRole,
  resolvePrincipalOrFail,
} from "./programmeIdentity.ts";

// Wire helper: decodes JSON-shaped fixtures the same way production transports do.
const decodeWire = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(Schema.toCodecJson(schema) as never) as (value: unknown) => S["Type"];

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
const ORG = "org-1";
const AGENT_PID = "principal-agent-1";
const SERVICE_PID = "principal-service-1";
const HUMAN_PID = "principal-human-1";
const PROJ_A = "project-a";
const PROJ_B = "project-b";
const TEAM = "team-1";
const MEMBERSHIP = "membership-1";

const humanIdentityRef: { provider: "oidc"; identityId: string; binding: "human" } = {
  provider: "oidc",
  identityId: "sub-123",
  binding: "human",
};
const serviceIdentityRef = { provider: "native", identityId: "svc-9", binding: "service" } as const;

const principalWire = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  orgId: ORG,
  revision: 3,
  createdAt: NOW,
  updatedAt: NOW,
  retentionClass: "standard",
  visibilityClass: "organisation",
  principalId: AGENT_PID,
  kind: "agent",
  identityRef: { provider: "relay", identityId: "device-relay-7", binding: "service" },
  status: "active",
  displayName: null,
  ...overrides,
});

const membershipWire = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  orgId: ORG,
  revision: 2,
  createdAt: NOW,
  updatedAt: NOW,
  retentionClass: "standard",
  visibilityClass: "private",
  membershipId: MEMBERSHIP,
  principalId: HUMAN_PID,
  organisationRole: "member",
  teamIds: [TEAM],
  projectGrants: [{ projectId: PROJ_A, grant: "read" }],
  policyVersion: "policy-v1",
  status: "active",
  ...overrides,
});

const agentPrincipal = decodeWire(Principal)(principalWire({}));
const servicePrincipal = decodeWire(Principal)(
  principalWire({ principalId: SERVICE_PID, kind: "service" }),
);
const humanPrincipal = decodeWire(Principal)(
  principalWire({
    principalId: HUMAN_PID,
    kind: "human",
    identityRef: humanIdentityRef,
    displayName: "Mark",
  }),
);

const memberOfA = decodeWire(Membership)(membershipWire({}));
const ownerOfSamePrincipal = decodeWire(Membership)(
  membershipWire({
    membershipId: "membership-owner",
    principalId: AGENT_PID,
    organisationRole: "owner",
  }),
);
const guestWithListedGrant = decodeWire(Membership)(
  membershipWire({ membershipId: "membership-guest", organisationRole: "guest" }),
);
const suspendedOwner = decodeWire(Membership)(
  membershipWire({
    membershipId: "membership-susp",
    organisationRole: "owner",
    status: "suspended",
  }),
);
const adminMembership = decodeWire(Membership)(
  membershipWire({ membershipId: "membership-admin", organisationRole: "admin" }),
);
const auditorMembership = decodeWire(Membership)(
  membershipWire({
    membershipId: "membership-aud",
    organisationRole: "auditor",
    projectGrants: [],
  }),
);

/** Fixture port: the only trusted identity surface in these tests, clearly labelled as such. */
const fixturePort = makeLabelledFixturePrincipalPort({
  resolveIdentityRef: ({ identityRef }) => {
    if (identityRef.identityId === "sub-123") return { identityRef, binding: "human" };
    if (identityRef.identityId === "svc-9") return { identityRef, binding: "service" };
    return null;
  },
  resolvePrincipal: ({ principalId }) => (principalId === HUMAN_PID ? humanPrincipal : null),
});

describe("Principal and Membership schemas", () => {
  it("decodes a principal and a membership from the wire shape", () => {
    expect(agentPrincipal.kind).toBe("agent");
    expect(agentPrincipal.identityRef.provider).toBe("relay");
    expect(agentPrincipal.displayName).toBeNull();
    expect(memberOfA.organisationRole).toBe("member");
    expect(memberOfA.projectGrants).toEqual([{ projectId: PROJ_A, grant: "read" }]);
    expect(memberOfA.policyVersion).toBe("policy-v1");
  });

  it("rejects a principal missing a common-shape field", () => {
    const wire = principalWire({ principalId: HUMAN_PID, kind: "human" });
    delete (wire as Record<string, unknown>).updatedAt;
    expectDecodeFails(Principal, wire);
  });

  it("rejects an unknown principal kind literal", () => {
    expectDecodeFails(Principal, principalWire({ kind: "robot" }));
  });

  it("rejects an unknown principal status literal", () => {
    expectDecodeFails(Principal, principalWire({ status: "paused" }));
  });

  it("rejects an unknown organisation role literal", () => {
    expectDecodeFails(Membership, membershipWire({ organisationRole: "superadmin" }));
  });

  it("rejects a negative revision", () => {
    expectDecodeFails(Membership, membershipWire({ revision: -1 }));
  });

  it("rejects an empty branded principal id", () => {
    expectDecodeFails(Principal, principalWire({ principalId: "" }));
  });

  it("rejects an invalid createdAt date", () => {
    expectDecodeFails(Principal, principalWire({ createdAt: "not-a-date" }));
  });

  it("rejects an unknown schemaVersion major", () => {
    expectDecodeFails(Principal, principalWire({ schemaVersion: 2 }));
  });

  it("rejects an unknown identityRef binding literal", () => {
    expectDecodeFails(
      Principal,
      principalWire({ identityRef: { ...humanIdentityRef, binding: "bot" } }),
    );
  });
});

describe("identity promotion authority", () => {
  it("denies an agent principal promoting to human without a port with capability_unavailable", () => {
    expectTagged(
      () =>
        promoteToHuman({
          principal: agentPrincipal,
          claimedIdentityRef: humanIdentityRef as IdentityRef,
        }),
      "IdentityCapabilityUnavailableError",
    );
  });

  it("denies a service principal whose claimed ref resolves to a non-human binding", () => {
    expectTagged(
      () =>
        promoteToHuman({
          principal: servicePrincipal,
          claimedIdentityRef: serviceIdentityRef as IdentityRef,
          port: fixturePort,
        }),
      "IdentityForbiddenError",
    );
  });

  it("allows promotion only through a port resolving a verified human binding", () => {
    expect(fixturePort.fixtureLabel).toBe("TEST-FIXTURE-IDENTITY-NOT-A-REAL-VERIFIER");
    const promoted = promoteToHuman({
      principal: agentPrincipal,
      claimedIdentityRef: humanIdentityRef as IdentityRef,
      port: fixturePort,
    });
    expect(promoted.kind).toBe("human");
    expect(promoted.identityRef.identityId).toBe("sub-123");
    expect(promoted.principalId).toBe(agentPrincipal.principalId);
  });

  it("denies with capability_unavailable when the port cannot resolve the binding", () => {
    expectTagged(
      () =>
        promoteToHuman({
          principal: agentPrincipal,
          claimedIdentityRef: { provider: "oidc", identityId: "unknown-sub", binding: "human" },
          port: fixturePort,
        }),
      "IdentityCapabilityUnavailableError",
    );
  });

  it("passes a principal that is already human through unchanged, even without a port", () => {
    const result = promoteToHuman({
      principal: humanPrincipal,
      claimedIdentityRef: humanIdentityRef as IdentityRef,
    });
    expect(result.kind).toBe("human");
    expect(result).toEqual(humanPrincipal);
  });
});

describe("message-role and tool-output claims are never trusted", () => {
  it("still denies promotion when the request body claims role human without a port", () => {
    expectTagged(
      () =>
        promoteToHuman({
          principal: agentPrincipal,
          claimedIdentityRef: humanIdentityRef as IdentityRef,
          claimedHumanRole: "human",
          port: undefined,
        }),
      "IdentityCapabilityUnavailableError",
    );
  });

  it("still denies promotion when tool output claims humanity against a service binding", () => {
    expectTagged(
      () =>
        promoteToHuman({
          principal: servicePrincipal,
          claimedIdentityRef: serviceIdentityRef as IdentityRef,
          claimedHumanRole: true,
          port: fixturePort,
        }),
      "IdentityForbiddenError",
    );
  });

  it("returns the same promotion regardless of any claimed role field", () => {
    const withClaim = promoteToHuman({
      principal: agentPrincipal,
      claimedIdentityRef: humanIdentityRef as IdentityRef,
      claimedHumanRole: "human",
      port: fixturePort,
    });
    const withoutClaim = promoteToHuman({
      principal: agentPrincipal,
      claimedIdentityRef: humanIdentityRef as IdentityRef,
      port: fixturePort,
    });
    expect(withClaim).toEqual(withoutClaim);
    expect(withClaim.kind).toBe("human");
  });
});

describe("membership roles and scoped project grants", () => {
  it("resolves roles from the membership, not from the principal", () => {
    expect(requiresOrganisationRole(ownerOfSamePrincipal, "member")).toBe(true);
    expect(
      requiresOrganisationRole(
        decodeWire(Membership)(
          membershipWire({ principalId: AGENT_PID, organisationRole: "guest" }),
        ),
        "member",
      ),
    ).toBe(false);
  });

  it("scopes a project grant so project A never answers project B", () => {
    expect(effectiveProjectGrant(memberOfA, ProjectId.make(PROJ_A))).toBe("read");
    expect(effectiveProjectGrant(memberOfA, ProjectId.make(PROJ_B))).toBe("none");
  });

  it("respects the documented role ordering", () => {
    expect(requiresOrganisationRole(adminMembership, "member")).toBe(true);
    expect(requiresOrganisationRole(memberOfA, "admin")).toBe(false);
    expect(requiresOrganisationRole(auditorMembership, "member")).toBe(false);
    expect(requiresOrganisationRole(ownerOfSamePrincipal, "admin")).toBe(true);
    expect(requiresOrganisationRole(guestWithListedGrant, "guest")).toBe(true);
  });

  it("answers explicit none for guests and for projects a membership holds no grant for", () => {
    expect(effectiveProjectGrant(guestWithListedGrant, ProjectId.make(PROJ_A))).toBe("none");
    expect(
      effectiveProjectGrant(
        decodeWire(Membership)(membershipWire({ projectGrants: [] })),
        ProjectId.make(PROJ_B),
      ),
    ).toBe("none");
  });

  it("fails closed: a suspended owner never satisfies a role requirement", () => {
    expect(requiresOrganisationRole(suspendedOwner, "owner")).toBe(false);
  });
});

describe("trusted principal resolution", () => {
  it("resolves a principal through the port", () => {
    expect(
      resolvePrincipalOrFail(fixturePort, PrincipalId.make(HUMAN_PID), OrgId.make(ORG)),
    ).toEqual(humanPrincipal);
  });

  it("denies an unresolvable principal with capability_unavailable", () => {
    expectTagged(
      () => resolvePrincipalOrFail(fixturePort, PrincipalId.make(AGENT_PID), OrgId.make(ORG)),
      "IdentityCapabilityUnavailableError",
    );
  });
});

describe("pure rule shape", () => {
  it("promotes without mutating its input and repeats identically", () => {
    const before = structuredClone(agentPrincipal);
    const first = promoteToHuman({
      principal: agentPrincipal,
      claimedIdentityRef: humanIdentityRef as IdentityRef,
      port: fixturePort,
    });
    const second = promoteToHuman({
      principal: agentPrincipal,
      claimedIdentityRef: humanIdentityRef as IdentityRef,
      port: fixturePort,
    });
    expect(agentPrincipal).toEqual(before);
    expect(first).toEqual(second);
    expect(agentPrincipal.kind).toBe("agent");
  });
});

describe("D5 inactive project grant denial", () => {
  it.each([
    ["suspended", "read"],
    ["revoked", "read"],
    ["suspended", "contribute"],
    ["revoked", "contribute"],
    ["suspended", "admin"],
    ["revoked", "admin"],
  ])("returns none for %s membership with %s grant", (status, grant) => {
    const membership = decodeWire(Membership)(
      membershipWire({ status, projectGrants: [{ projectId: PROJ_A, grant }] }),
    );
    expect(effectiveProjectGrant(membership, ProjectId.make(PROJ_A))).toBe("none");
    expect(effectiveProjectGrant(membership, ProjectId.make(PROJ_B))).toBe("none");
  });
  it.each(["read", "contribute", "admin"])("preserves active %s grant", (grant) => {
    const membership = decodeWire(Membership)(
      membershipWire({ projectGrants: [{ projectId: PROJ_A, grant }] }),
    );
    expect(effectiveProjectGrant(membership, ProjectId.make(PROJ_A))).toBe(grant);
  });
});
