// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  Membership,
  MessageId,
  OrgId,
  PolicyDeviceState,
  Principal,
  PrincipalId,
  RoutingPolicy,
  ThreadId,
  policyReference,
  resolveManagedRoute,
  type PolicyCapabilitySnapshot,
  type ResolveManagedRouteInput,
  type RoutingAuthorityPort,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "./persistence/Sqlite.ts";
import * as ServerConfig from "./config.ts";
import * as DocumentText from "./provider/DocumentText.ts";
import {
  OrchestratorDispatchError,
  commandReceiptIdentity,
} from "./orchestration-v2/Orchestrator.ts";
import { commandPayloadDigest } from "./orchestration-v2/CommandReceiptStore.ts";
import { ManagedRouteConstraint } from "./orchestration-v2/ManagedRouteConstraint.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProviderReplayHarness from "./orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ProviderAdapterRegistry from "./orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagement from "./orchestration-v2/ThreadManagementService.ts";
import { dispatchCommand } from "./orchestration-v2/ThreadMessageIntake.ts";
import {
  ManagedCommandAuthorityUnavailableError,
  ManagedCommandDecisionNotFoundError,
  ManagedCommandRefusedError,
  readManagedCommandDecision,
} from "./orchestration-v2/ManagedMessageAdmission.ts";
import { messageIntakeContext } from "./ws.ts";
import { LocalRoutingAuthority } from "./orchestration-v2/LocalRoutingAuthority.ts";

const decodeWire = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(Schema.toCodecJson(schema) as never) as (value: unknown) => S["Type"];
const encodePolicy = Schema.encodeSync(Schema.toCodecJson(RoutingPolicy));
const NOW = DateTime.makeUnsafe("2026-10-28T12:00:00.000Z");
const PAST = "2026-10-28T11:00:00.000Z";
const FUTURE = DateTime.makeUnsafe("2026-10-28T13:00:00.000Z");
const HASH = "a".repeat(64);
const ORG = Schema.decodeSync(OrgId)("org-ic03");
const PRINCIPAL = Schema.decodeSync(PrincipalId)("principal-ic03");
const ENV = Schema.decodeSync(EnvironmentId)("environment-ic03");
const scope = { scope: "org", orgId: ORG, projectId: null, ownerPrincipalId: null } as const;
const common = {
  schemaVersion: 1,
  revision: 1,
  createdAt: PAST,
  updatedAt: PAST,
  retentionClass: "standard",
  visibilityClass: "private",
};
const routeA = {
  routeId: "route-a",
  providerInstanceRef: "native-instance",
  model: "user-selected-model",
  effort: "high",
};

const digestOf = (policy: RoutingPolicy) => {
  const encoded = encodePolicy(policy);
  if (
    encoded === null ||
    typeof encoded !== "object" ||
    Array.isArray(encoded) ||
    !("digest" in encoded)
  ) {
    throw new Error("Expected encoded policy");
  }
  const { digest: _digest, ...content } = encoded;
  return NodeCrypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
};

const localAuthority = (
  snapshotRoutes: PolicyCapabilitySnapshot["routes"] = [{ routeId: "route-a", state: "available" }],
) => {
  const drafted = decodeWire(RoutingPolicy)({
    ...common,
    ...scope,
    policyId: "policy-ic03",
    issuerPrincipalId: PRINCIPAL,
    parentPolicyRef: null,
    digest: HASH,
    effectiveAt: PAST,
    roleRules: [{ role: "builder", routeIds: ["route-a"] }],
    requiredSkillProfileRef: "skill-profile-ic03",
    requiredSkillProfileHash: HASH,
    permittedModels: ["user-selected-model"],
    permittedEfforts: ["high"],
    routes: [routeA],
    fallbackRules: [],
    budgetRules: { maxSpendMinorUnits: null, maxAttempts: 3 },
    continuationRule: "leaseBound",
    revokedRouteRules: [],
    supersedesRef: null,
    delegatedExceptionRefs: [],
    delegatedExceptionRef: null,
    rollbackOfRef: null,
  });
  const current = { ...drafted, digest: digestOf(drafted) };
  const principal = decodeWire(Principal)({
    ...common,
    orgId: ORG,
    principalId: PRINCIPAL,
    kind: "human",
    identityRef: { provider: "native", identityId: "human-ic03", binding: "human" },
    status: "active",
    displayName: null,
  });
  const membership = decodeWire(Membership)({
    ...common,
    orgId: ORG,
    membershipId: "membership-ic03",
    principalId: PRINCIPAL,
    organisationRole: "admin",
    teamIds: [],
    projectGrants: [],
    policyVersion: "v1",
    status: "active",
  });
  const device = decodeWire(PolicyDeviceState)({
    ...common,
    ...scope,
    environmentId: ENV,
    incarnationId: "incarnation-ic03",
    requiredPolicyRef: policyReference(current),
    acknowledgedRevision: current.revision,
    acknowledgedDigest: current.digest,
    capabilitySnapshotRef: "snapshot-ic03",
    resolvedRoutesHash: HASH,
    state: "current",
    observedAt: PAST,
  });
  const snapshot: PolicyCapabilitySnapshot = {
    ref: "snapshot-ic03",
    environmentId: ENV,
    incarnationId: "incarnation-ic03",
    policyRef: policyReference(current),
    resolvedRoutesHash: HASH,
    observedAt: DateTime.makeUnsafe(PAST),
    expiresAt: FUTURE,
    routes: snapshotRoutes,
  };
  const port: RoutingAuthorityPort = {
    resolveAdmissionAssignment: () => ({
      taskId: "task-ic03",
      principalId: PRINCIPAL,
      ...scope,
      environmentId: ENV,
      incarnationId: "incarnation-ic03",
      role: "builder",
      policyRef: policyReference(current),
      expiresAt: FUTURE,
    }),
    resolveAuthenticatedActor: () => PRINCIPAL,
    resolvePrincipalAuthority: () => ({ principal, membership }),
    resolveRequiredPolicy: () => current,
    resolvePolicy: () => current,
    attestPolicyDigest: digestOf,
    resolveDelegatedException: () => null,
    resolveDeviceState: () => device,
    resolveCapabilitySnapshot: () => snapshot,
    resolveContinuationLease: () => null,
  };
  const task: Omit<ResolveManagedRouteInput, "port"> = {
    taskId: "task-ic03",
    principalId: PRINCIPAL,
    ...scope,
    environmentId: ENV,
    incarnationId: "incarnation-ic03",
    routeId: "route-a",
    role: "builder",
    now: NOW,
  };
  return { port, task };
};

const message = (commandId: string, text = "run the managed task") => ({
  type: "message.dispatch" as const,
  commandId: CommandId.make(commandId),
  threadId: ThreadId.make("thread-ic03-ws"),
  messageId: MessageId.make(`message-${commandId}`),
  text,
  attachments: [] as const,
  dispatchMode: { type: "start_immediately" as const },
  createdBy: "user" as const,
  creationSource: "web" as const,
});

const persistence = (dbPath: string) =>
  SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer));

const providerLayer = (effects: { count: number; throwNext: boolean }, marker: string) =>
  Layer.unwrap(
    Effect.map(SqlClient.SqlClient, (sql) =>
      Layer.mock(ThreadManagement.ThreadManagementService)({
        dispatch: (command) =>
          Effect.gen(function* () {
            effects.count += 1;
            if (effects.throwNext) {
              effects.throwNext = false;
              return yield* new OrchestratorDispatchError({
                commandId: command.commandId,
                commandType: command.type,
                cause: "provider failed after admission",
              });
            }
            yield* sql`
          INSERT INTO orchestration_command_receipts (
            command_id, aggregate_kind, aggregate_id, command_type, accepted_at,
            result_sequence, status, error, payload_digest
          ) VALUES (
            ${command.commandId}, 'thread', ${"threadId" in command ? command.threadId : "thread-ic03-ws"},
            ${command.type}, '2026-10-28T12:00:00.000Z', ${effects.count}, 'accepted', NULL,
            ${commandPayloadDigest(commandReceiptIdentity(command))}
          )
        `;
            if ((yield* ManagedRouteConstraint) !== undefined) {
              yield* sql`UPDATE orchestration_command_policy_receipts SET native_bound = 1 WHERE command_id = ${command.commandId}`;
            }
            NodeFS.mkdirSync(NodePath.dirname(marker), { recursive: true });
            NodeFS.writeFileSync(marker, command.commandId);
            return { sequence: effects.count, storedEvents: [] };
          }).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestratorDispatchError({
                  commandId: command.commandId,
                  commandType: command.type,
                  cause,
                }),
            ),
          ),
      }),
    ),
  );

const tempCase = (name: string) => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `ic03-ws-${name}-`));
  return {
    directory,
    dbPath: NodePath.join(directory, "state.sqlite"),
    marker: NodePath.join(directory, "provider-dir", "completion-marker"),
    remove: () => NodeFS.rmSync(directory, { recursive: true, force: true }),
  };
};

const isManagedCommandRefusedError = Schema.is(ManagedCommandRefusedError);
const isOrchestratorDispatchError = Schema.is(OrchestratorDispatchError);
const isManagedCommandAuthorityUnavailableError = Schema.is(
  ManagedCommandAuthorityUnavailableError,
);
const isManagedCommandDecisionNotFoundError = Schema.is(ManagedCommandDecisionNotFoundError);

const squash = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

const throughWebsocket = (
  dbPath: string,
  marker: string,
  effects: { count: number; throwNext: boolean },
  local: {
    readonly port?: RoutingAuthorityPort;
    readonly task?: Omit<ResolveManagedRouteInput, "port">;
  },
  command: ReturnType<typeof message>,
) =>
  Effect.gen(function* () {
    const base = yield* Effect.context<
      SqlClient.SqlClient | ThreadManagement.ThreadManagementService | Orchestrator.OrchestratorV2
    >();
    return yield* dispatchCommand(command).pipe(Effect.provide(messageIntakeContext(base, local)));
  }).pipe(
    Effect.provide(
      providerLayer(effects, marker).pipe(
        Layer.provideMerge(
          ProviderReplayHarness.layerWithRegistry(
            { name: "managed-ws-receipt" },
            ProviderAdapterRegistry.layerFromAdapters([]),
            { databaseLayer: persistence(dbPath), runEffectWorker: false, recoverOnStartup: false },
          ),
        ),
        Layer.provideMerge(persistence(dbPath)),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "managed-ws-intake-" }).pipe(
            Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
          ),
        ),
      ),
    ),
  );

const readDecision = (dbPath: string, commandId: CommandId) =>
  readManagedCommandDecision(commandId).pipe(Effect.provide(persistence(dbPath)));

it.effect("admits one websocket task and replays it without a second provider effect", () => {
  const files = tempCase("allow");
  const effects = { count: 0, throwNext: false };
  const authority = localAuthority();
  const command = message("cmd-ic03-ws-allow");
  const expected = resolveManagedRoute({ ...authority.task, port: authority.port });
  return Effect.gen(function* () {
    const first = yield* Effect.exit(
      throughWebsocket(files.dbPath, files.marker, effects, authority, command),
    );
    const firstDecision = yield* readDecision(files.dbPath, command.commandId);
    const retry = yield* Effect.exit(
      throughWebsocket(files.dbPath, files.marker, effects, authority, command),
    );
    const retryDecision = yield* readDecision(files.dbPath, command.commandId);
    assert.equal(first._tag, "Success");
    assert.equal(retry._tag, "Success");
    assert.equal(effects.count, 1);
    assert.equal(NodeFS.existsSync(files.marker), true);
    assert.deepEqual(retryDecision, firstDecision);
    assert.equal(firstDecision.decision, "accepted");
    assert.equal(firstDecision.policyId, expected.policyRef.policyId);
    assert.equal(firstDecision.policyRevision, expected.policyRef.revision);
    assert.equal(firstDecision.policyDigest, expected.policyRef.digest);
    assert.equal(firstDecision.routeId, expected.route.routeId);
    assert.notEqual(firstDecision.decision, "completed");
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("refuses a denied websocket task without a provider effect", () => {
  const files = tempCase("deny");
  const effects = { count: 0, throwNext: false };
  const denied = localAuthority([{ routeId: "route-a", state: "unavailable" }]);
  const command = message("cmd-ic03-ws-deny");
  return Effect.gen(function* () {
    const first = yield* Effect.exit(
      throughWebsocket(files.dbPath, files.marker, effects, denied, command),
    );
    const decision = yield* readDecision(files.dbPath, command.commandId);
    const retry = yield* Effect.exit(
      throughWebsocket(files.dbPath, files.marker, effects, denied, command),
    );
    assert.isTrue(isManagedCommandRefusedError(squash(first)));
    assert.isTrue(isManagedCommandRefusedError(squash(retry)));
    assert.equal(effects.count, 0);
    assert.equal(NodeFS.existsSync(files.marker), false);
    assert.equal(decision.decision, "refused");
    assert.notEqual(decision.decision, "accepted");
    assert.notEqual(decision.decision, "completed");
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("does not record a failed websocket attempt as a completed receipt", () => {
  const files = tempCase("fail");
  const effects = { count: 0, throwNext: true };
  const authority = localAuthority();
  const command = message("cmd-ic03-ws-fail");
  return Effect.gen(function* () {
    const failed = yield* Effect.exit(
      throughWebsocket(files.dbPath, files.marker, effects, authority, command),
    );
    const failedDecision = yield* readDecision(files.dbPath, command.commandId);
    assert.equal(failed._tag, "Failure");
    assert.isTrue(isOrchestratorDispatchError(squash(failed)));
    assert.equal(failedDecision.decision, "failed");
    assert.notEqual(failedDecision.decision, "accepted");
    assert.notEqual(failedDecision.decision, "completed");
    assert.equal(NodeFS.existsSync(files.marker), false);
    assert.equal(effects.count, 1);

    const recovered = yield* Effect.exit(
      throughWebsocket(files.dbPath, files.marker, effects, authority, command),
    );
    const recoveredDecision = yield* readDecision(files.dbPath, command.commandId);
    assert.equal(recovered._tag, "Success");
    assert.equal(recoveredDecision.decision, "accepted");
    assert.equal(effects.count, 2);

    const replay = yield* Effect.exit(
      throughWebsocket(files.dbPath, files.marker, effects, authority, command),
    );
    assert.equal(replay._tag, "Success");
    assert.equal(effects.count, 2);
    assert.equal(NodeFS.existsSync(files.marker), true);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("fails a managed websocket task closed when the local port is absent", () => {
  const files = tempCase("closed");
  const effects = { count: 0, throwNext: false };
  const authority = localAuthority();
  const command = message("cmd-ic03-ws-closed");
  return Effect.gen(function* () {
    const closed = yield* Effect.exit(
      throughWebsocket(files.dbPath, files.marker, effects, { task: authority.task }, command),
    );
    const decision = yield* Effect.exit(readDecision(files.dbPath, command.commandId));
    assert.isTrue(isManagedCommandAuthorityUnavailableError(squash(closed)));
    assert.isTrue(isManagedCommandDecisionNotFoundError(squash(decision)));
    assert.equal(effects.count, 0);
    assert.equal(NodeFS.existsSync(files.marker), false);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect(
  "keeps an ordinary message.dispatch on today's path when no local port is supplied",
  () => {
    const files = tempCase("ordinary");
    const effects = { count: 0, throwNext: false };
    const command = message("cmd-ic03-ws-ordinary", "ordinary chat");
    return Effect.gen(function* () {
      const sent = yield* Effect.exit(
        throughWebsocket(files.dbPath, files.marker, effects, {}, command),
      );
      const decision = yield* Effect.exit(readDecision(files.dbPath, command.commandId));
      assert.equal(sent._tag, "Success");
      assert.equal(effects.count, 1);
      assert.equal(NodeFS.existsSync(files.marker), true);
      assert.isTrue(isManagedCommandDecisionNotFoundError(squash(decision)));
    }).pipe(Effect.ensuring(Effect.sync(files.remove)));
  },
);

it.effect("refuses a managed task when native receipt services are unavailable", () => {
  const authority = localAuthority();
  const command = message("cmd-ic03-ws-missing-receipts");
  let calls = 0;
  return Effect.gen(function* () {
    const result = yield* Effect.exit(
      dispatchCommand(command).pipe(
        Effect.provideService(LocalRoutingAuthority, authority),
        Effect.provide(
          Layer.mock(ThreadManagement.ThreadManagementService)({
            dispatch: () =>
              Effect.sync(() => {
                calls += 1;
                return { sequence: 1, storedEvents: [] };
              }),
          }),
        ),
      ),
    );
    assert.isTrue(isManagedCommandAuthorityUnavailableError(squash(result)));
    assert.equal(calls, 0);
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "managed-no-receipts-" }).pipe(
        Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
      ),
    ),
  );
});
