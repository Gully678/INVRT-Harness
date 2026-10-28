/** Principal and Membership identity contracts v1 (PRD 02 section 5). Human promotion consults
 * only a trusted PrincipalAuthorityPort: message roles, tool output and request bodies never
 * mint a human identity. Roles belong to the membership, never to global user booleans; no
 * storage, receipts or enforcement here (B02 owns receipts, later slices enforce). */
import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  OrgId,
  PrincipalId,
  RetentionClass,
  SchemaVersion,
  VisibilityClass,
} from "./programmeDomain.ts";

/** Branded team identifier; no team id existed in the domain core. */
export const TeamId = TrimmedNonEmptyString.pipe(Schema.brand("TeamId"));
export type TeamId = typeof TeamId.Type;

export const MembershipId = TrimmedNonEmptyString.pipe(Schema.brand("MembershipId"));
export type MembershipId = typeof MembershipId.Type;

/** Principal kinds. Human binds to an authenticated person; service binds to infrastructure; agent binds to an autonomous run. */
export const PrincipalKind = Schema.Literals(["human", "service", "agent"]);
export type PrincipalKind = typeof PrincipalKind.Type;

export const PrincipalStatus = Schema.Literals(["active", "suspended", "deactivated"]);
export type PrincipalStatus = typeof PrincipalStatus.Type;

/**
 * Provider set for the future B05 authenticated identity store; extend by schema revision, never
 * by silently widening. "native" is the host's own account system, "relay" its device relay.
 */
export const IdentityProvider = Schema.Literals(["oidc", "native", "relay"]);
export type IdentityProvider = typeof IdentityProvider.Type;

/** The binding kind a provider identity points at. A declared "human" binding is a claim; only authority-port resolution proves it. */
export const IdentityBinding = Schema.Literals(["human", "service"]);
export type IdentityBinding = typeof IdentityBinding.Type;

/**
 * A provider-scoped opaque reference into the future B05 authenticated identity store. It
 * carries no credentials, emails or display names: provider plus opaque id plus declared
 * binding only. The binding field is untrusted until resolved through the authority port.
 */
export const IdentityRef = Schema.Struct({
  provider: IdentityProvider,
  identityId: TrimmedNonEmptyString,
  binding: IdentityBinding,
});
export type IdentityRef = typeof IdentityRef.Type;

export const Principal = Schema.Struct({
  schemaVersion: SchemaVersion,
  orgId: OrgId,
  revision: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
  principalId: PrincipalId,
  kind: PrincipalKind,
  identityRef: IdentityRef,
  status: PrincipalStatus,
  /** Display label only; a display name never proves identity, kind or humanity. */
  displayName: Schema.NullOr(TrimmedNonEmptyString),
});
export type Principal = typeof Principal.Type;

/**
 * Organisation membership roles, v1 set derived from the PRD. Orderings and semantics:
 * guest may only act through live session grants; auditor holds read-mostly oversight;
 * member contributes; admin administers the organisation; owner holds sole transfer and
 * dissolution authority.
 */
export const OrganisationRole = Schema.Literals(["owner", "admin", "member", "auditor", "guest"]);
export type OrganisationRole = typeof OrganisationRole.Type;

export const MembershipStatus = Schema.Literals(["active", "suspended", "revoked"]);
export type MembershipStatus = typeof MembershipStatus.Type;

/** Scoped project grant kinds; scope selects the project, never a wider right. */
export const ProjectGrantKind = Schema.Literals(["read", "contribute", "admin"]);
export type ProjectGrantKind = typeof ProjectGrantKind.Type;

export const ProjectGrant = Schema.Struct({
  projectId: ProjectId,
  grant: ProjectGrantKind,
});
export type ProjectGrant = typeof ProjectGrant.Type;

export const Membership = Schema.Struct({
  schemaVersion: SchemaVersion,
  orgId: OrgId,
  revision: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  retentionClass: RetentionClass,
  visibilityClass: VisibilityClass,
  membershipId: MembershipId,
  principalId: PrincipalId,
  /** The role belongs to this membership record; the same principal may hold different roles through different memberships. */
  organisationRole: OrganisationRole,
  teamIds: Schema.Array(TeamId),
  projectGrants: Schema.Array(ProjectGrant),
  /** Version of the policy revision this membership was issued under. */
  policyVersion: TrimmedNonEmptyString,
  status: MembershipStatus,
});
export type Membership = typeof Membership.Type;

export class IdentityCapabilityUnavailableError extends Schema.TaggedError<IdentityCapabilityUnavailableError>()(
  "IdentityCapabilityUnavailableError",
  { message: TrimmedNonEmptyString, detail: Schema.optional(TrimmedNonEmptyString) },
) {}

export class IdentityForbiddenError extends Schema.TaggedError<IdentityForbiddenError>()(
  "IdentityForbiddenError",
  { message: TrimmedNonEmptyString, detail: Schema.optional(TrimmedNonEmptyString) },
) {}

/** The trusted binding the identity store holds for an identity reference. */
export interface ResolvedIdentityBinding {
  readonly identityRef: IdentityRef;
  readonly binding: IdentityBinding;
}

/**
 * The only authority surface a human-promotion decision may consult. Implementations come from
 * trusted authenticated storage (B05); every lookup returning null denies with
 * capability_unavailable. Request bodies can never supply authority claims.
 */
export interface PrincipalAuthorityPort {
  /** Label naming a test injection; production ports must leave it undefined. */
  readonly fixtureLabel?: "TEST-FIXTURE-IDENTITY-NOT-A-REAL-VERIFIER" | undefined;
  /** Org-scoped so a binding from another organisation can never satisfy a promotion. */
  resolveIdentityRef(input: {
    readonly identityRef: IdentityRef;
    readonly orgId: OrgId;
  }): ResolvedIdentityBinding | null;
  /** Org-scoped trusted principal record; null means absent or unresolvable. */
  resolvePrincipal(input: {
    readonly principalId: PrincipalId;
    readonly orgId: OrgId;
  }): Principal | null;
}

/**
 * Clearly labelled test fixture port. The name names the injection; the port also carries
 * fixtureLabel so a fixture can never be mistaken for a real verifier. Never use in production.
 */
export const makeLabelledFixturePrincipalPort = (
  config: Pick<PrincipalAuthorityPort, "resolveIdentityRef" | "resolvePrincipal">,
): PrincipalAuthorityPort => ({
  fixtureLabel: "TEST-FIXTURE-IDENTITY-NOT-A-REAL-VERIFIER",
  resolveIdentityRef: config.resolveIdentityRef,
  resolvePrincipal: config.resolvePrincipal,
});

export interface PromoteToHumanInput {
  readonly principal: Principal;
  /** Request-body copy of the claimed identity; the authority port is the only trusted path. */
  readonly claimedIdentityRef: IdentityRef;
  /**
   * Any message-role or tool-output humanity claim ("I am human", role: "human"). Recorded for
   * audit symmetry only and NEVER read: the promotion ignores it entirely.
   */
  readonly claimedHumanRole?: string | boolean | undefined;
  readonly port?: PrincipalAuthorityPort | undefined;
}

/**
 * Promotes an agent or service principal to human only when the port resolves the claimed
 * reference to a verified human binding: absent port or unresolvable binding denies with
 * capability_unavailable, a non-human binding denies as forbidden, already human is unchanged.
 */
export const promoteToHuman = (input: PromoteToHumanInput): Principal => {
  if (input.principal.kind === "human") return input.principal;
  if (input.port === undefined) {
    throw new IdentityCapabilityUnavailableError({
      message: "Human identity promotion requires the trusted identity authority port",
      detail: input.principal.principalId,
    });
  }
  const resolved = input.port.resolveIdentityRef({
    identityRef: input.claimedIdentityRef,
    orgId: input.principal.orgId,
  });
  if (resolved === null) {
    throw new IdentityCapabilityUnavailableError({
      message: "Claimed identity binding is absent or unresolvable",
      detail: input.claimedIdentityRef.identityId,
    });
  }
  if (resolved.binding !== "human") {
    throw new IdentityForbiddenError({
      message: "Claimed identity binding is not a verified human binding",
      detail: input.claimedIdentityRef.identityId,
    });
  }
  return {
    ...input.principal,
    kind: "human",
    identityRef: input.claimedIdentityRef,
  };
};

/**
 * Org-scoped trusted principal lookup; null resolution denies with capability_unavailable so a
 * missing record can never be mistaken for an existing one.
 */
export const resolvePrincipalOrFail = (
  port: PrincipalAuthorityPort,
  principalId: PrincipalId,
  orgId: OrgId,
): Principal => {
  const resolved = port.resolvePrincipal({ principalId, orgId });
  if (resolved === null) {
    throw new IdentityCapabilityUnavailableError({
      message: "Principal record is absent or unresolvable",
      detail: principalId,
    });
  }
  return resolved;
};

/**
 * The scoped project grant of this membership, or the explicit "none": a grant held for one
 * project never answers another project. Inactive and guest memberships hold no standing grants
 * (guests act through live session grants per the PRD).
 */
export const effectiveProjectGrant = (
  membership: Membership,
  projectId: ProjectId,
): ProjectGrantKind | "none" => {
  if (membership.status !== "active" || membership.organisationRole === "guest") return "none";
  const grant = membership.projectGrants.find((entry) => entry.projectId === projectId);
  return grant === undefined ? "none" : grant.grant;
};

/** Minimum role rank per role; admin outranks member, member outranks auditor, auditor outranks guest. */
const ROLE_RANK: Readonly<Record<OrganisationRole, number>> = {
  guest: 0,
  auditor: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

/**
 * Whether this membership satisfies the minimum organisation role. Only an active membership
 * can satisfy a role requirement, so suspension fails closed. A pure decision input: it makes
 * no authority or enforcement decision.
 */
export const requiresOrganisationRole = (
  membership: Membership,
  minimumRole: OrganisationRole,
): boolean =>
  membership.status === "active" &&
  ROLE_RANK[membership.organisationRole] >= ROLE_RANK[minimumRole];
