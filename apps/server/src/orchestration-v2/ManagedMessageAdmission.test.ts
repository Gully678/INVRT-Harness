// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  CommandId,
  EnvironmentId,
  GuestMessageId,
  Membership,
  MessageId,
  ModelSelection,
  OrgId,
  PolicyDeviceState,
  Principal,
  PrincipalId,
  ProjectId,
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
import * as FileSystem from "effect/FileSystem";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { createAttachmentId, createPendingAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  OrchestratorV2,
  OrchestratorDispatchError,
  commandReceiptIdentity,
} from "./Orchestrator.ts";
import { commandPayloadDigest } from "./CommandReceiptStore.ts";
import { ManagedRouteConstraint } from "./ManagedRouteConstraint.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import { dispatchCommand } from "./ThreadMessageIntake.ts";
import {
  ManagedCommandPolicyConflictError,
  ManagedCommandRefusedError,
  ManagedMessageAdmission,
  type ManagedMessageAdmissionShape,
  readManagedCommandDecision,
} from "./ManagedMessageAdmission.ts";

const decodeModelSelection = Schema.decodeSync(ModelSelection);
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
const routeB = { ...routeA, routeId: "route-b" };

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

const buildAdmission = (
  overrides: Record<string, unknown> = {},
  snapshotRoutes: PolicyCapabilitySnapshot["routes"] = [{ routeId: "route-a", state: "available" }],
  routeId = "route-a",
): ManagedMessageAdmissionShape => {
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
    ...overrides,
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
  const assignment = {
    taskId: "task-ic03",
    principalId: PRINCIPAL,
    ...scope,
    environmentId: ENV,
    incarnationId: "incarnation-ic03",
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
    attestPolicyDigest: digestOf,
    resolveDelegatedException: () => null,
    resolveDeviceState: () => device,
    resolveCapabilitySnapshot: () => snapshot,
    resolveContinuationLease: () => null,
  };
  const request: Omit<ResolveManagedRouteInput, "port"> = {
    taskId: "task-ic03",
    principalId: PRINCIPAL,
    ...scope,
    environmentId: ENV,
    incarnationId: "incarnation-ic03",
    routeId,
    role: "builder",
    now: NOW,
  };
  return { request, port };
};

const message = (commandId: string) => ({
  type: "message.dispatch" as const,
  commandId: CommandId.make(commandId),
  threadId: ThreadId.make("thread-ic03"),
  messageId: MessageId.make(`message-${commandId}`),
  text: "run the managed task",
  attachments: [] as const,
  dispatchMode: { type: "start_immediately" as const },
  createdBy: "user" as const,
  creationSource: "web" as const,
});

const persistence = (dbPath: string) =>
  SqlitePersistence.layerFromPath(dbPath).pipe(Layer.provide(NodeServices.layer));

const providerLayer = (
  effects: { count: number; throwNext: boolean },
  paths: { readonly directory: string; readonly marker: string },
) =>
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
            NodeFS.mkdirSync(paths.directory, { recursive: true });
            const threadId = "threadId" in command ? command.threadId : "thread-ic03";
            yield* sql`
          INSERT INTO orchestration_v2_events (
            event_id, command_id, thread_id, event_type, occurred_at, payload_json
          ) VALUES (
            ${`evt-${command.commandId}-${effects.count}`},
            ${command.commandId},
            ${threadId},
            'message.updated',
            '2026-10-28T12:00:00.000Z',
            '{}'
          )
        `;
            yield* sql`
          INSERT INTO orchestration_command_receipts (
            command_id, aggregate_kind, aggregate_id, command_type, accepted_at,
            result_sequence, status, error, payload_digest
          ) VALUES (
            ${command.commandId}, 'thread', ${threadId}, ${command.type},
            '2026-10-28T12:00:00.000Z', ${effects.count}, 'accepted', NULL,
            ${commandPayloadDigest(commandReceiptIdentity(command))}
          )
        `;
            if ((yield* ManagedRouteConstraint) !== undefined) {
              yield* sql`UPDATE orchestration_command_policy_receipts SET native_bound = 1 WHERE command_id = ${command.commandId}`;
            }
            NodeFS.writeFileSync(paths.marker, command.commandId);
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

const withFile = <A, E>(
  dbPath: string,
  effect: Effect.Effect<
    A,
    E,
    | SqlClient.SqlClient
    | ThreadManagement.ThreadManagementService
    | ManagedMessageAdmission
    | OrchestratorV2
    | DocumentText.DocumentText
    | FileSystem.FileSystem
    | ServerConfig.ServerConfig
  >,
  effects: { count: number; throwNext: boolean },
  paths: { readonly directory: string; readonly marker: string },
  admission: ManagedMessageAdmissionShape,
) =>
  effect.pipe(
    Effect.provideService(ManagedMessageAdmission, admission),
    Effect.provide(
      providerLayer(effects, paths).pipe(
        Layer.provideMerge(
          ProviderReplayHarness.layerWithRegistry(
            { name: "managed-receipt" },
            ProviderAdapterRegistry.layerFromAdapters([]),
            { databaseLayer: persistence(dbPath), runEffectWorker: false, recoverOnStartup: false },
          ),
        ),
        Layer.provideMerge(persistence(dbPath)),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "managed-intake-fixture-" }).pipe(
            Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
          ),
        ),
      ),
    ),
  );

const readDecision = (dbPath: string, commandId: CommandId) =>
  readManagedCommandDecision(commandId).pipe(Effect.provide(persistence(dbPath)));

const eventCount = (dbPath: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly n: number }>`
      SELECT COUNT(*) AS n FROM orchestration_v2_events
    `;
    return Number(rows[0]?.n ?? 0);
  }).pipe(Effect.provide(persistence(dbPath)));

const isManagedCommandPolicyConflictError = Schema.is(ManagedCommandPolicyConflictError);
const isManagedCommandRefusedError = Schema.is(ManagedCommandRefusedError);
const isOrchestratorDispatchError = Schema.is(OrchestratorDispatchError);

const squash = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

const tempCase = (name: string) => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `ic03-${name}-`));
  return {
    directory,
    dbPath: NodePath.join(directory, "state.sqlite"),
    providerDirectory: NodePath.join(directory, "provider-dir"),
    marker: NodePath.join(directory, "completion-marker"),
    remove: () => NodeFS.rmSync(directory, { recursive: true, force: true }),
  };
};

it.effect("binds an allowed message.dispatch to one durable policy receipt", () => {
  const files = tempCase("allow");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const command = message("cmd-ic03-allow");
  const expected = resolveManagedRoute({ ...admission.request, port: admission.port });
  return Effect.gen(function* () {
    const first = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    const firstDecision = yield* readDecision(files.dbPath, command.commandId);
    const second = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    const secondDecision = yield* readDecision(files.dbPath, command.commandId);
    assert.equal(first._tag, "Success");
    assert.equal(second._tag, "Success");
    assert.equal(effects.count, 1);
    assert.equal(yield* eventCount(files.dbPath), 1);
    assert.equal(NodeFS.existsSync(files.providerDirectory), true);
    assert.equal(NodeFS.existsSync(files.marker), true);
    assert.deepEqual(firstDecision, secondDecision);
    assert.equal(firstDecision.decision, "accepted");
    assert.equal(firstDecision.policyId, expected.policyRef.policyId);
    assert.equal(firstDecision.policyRevision, expected.policyRef.revision);
    assert.equal(firstDecision.policyDigest, expected.policyRef.digest);
    assert.equal(firstDecision.routeId, expected.route.routeId);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("refuses a denied capability without a provider effect", () => {
  const files = tempCase("deny");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const denied = buildAdmission(undefined, [{ routeId: "route-a", state: "unavailable" }]);
  const command = message("cmd-ic03-deny");
  return Effect.gen(function* () {
    const first = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, denied),
    );
    const decision = yield* readDecision(files.dbPath, command.commandId);
    const second = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, denied),
    );
    assert.isTrue(isManagedCommandRefusedError(squash(first)));
    assert.isTrue(isManagedCommandRefusedError(squash(second)));
    assert.equal(effects.count, 0);
    assert.equal(yield* eventCount(files.dbPath), 0);
    assert.equal(NodeFS.existsSync(files.providerDirectory), false);
    assert.equal(NodeFS.existsSync(files.marker), false);
    assert.equal(decision.decision, "refused");
    assert.equal(decision.policyDigest, null);
    assert.notEqual(decision.decision, "accepted");
    assert.notEqual(decision.decision, "completed");
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect(
  "replays the stored decision after restart and conflicts on a changed digest or route",
  () => {
    const files = tempCase("restart");
    const effects = { count: 0, throwNext: false };
    const paths = { directory: files.providerDirectory, marker: files.marker };
    const admission = buildAdmission();
    const command = message("cmd-ic03-restart");
    const changedDigest = buildAdmission({
      budgetRules: { maxSpendMinorUnits: null, maxAttempts: 4 },
    });
    const bothRoutes = buildAdmission(
      {
        roleRules: [{ role: "builder", routeIds: ["route-a", "route-b"] }],
        routes: [routeA, routeB],
      },
      [
        { routeId: "route-a", state: "available" },
        { routeId: "route-b", state: "available" },
      ],
    );
    const otherRoute: ManagedMessageAdmissionShape = {
      ...bothRoutes,
      request: { ...bothRoutes.request, routeId: "route-b" },
    };
    const routeCommand = message("cmd-ic03-route");
    return Effect.gen(function* () {
      const admitted = yield* Effect.exit(
        withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
      );
      const stored = yield* readDecision(files.dbPath, command.commandId);
      assert.equal(admitted._tag, "Success");
      assert.equal(effects.count, 1);

      const replay = yield* Effect.exit(
        withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
      );
      const replayed = yield* readDecision(files.dbPath, command.commandId);
      assert.equal(replay._tag, "Success");
      assert.deepEqual(replayed, stored);
      assert.equal(effects.count, 1);

      const digestConflict = yield* Effect.exit(
        withFile(files.dbPath, dispatchCommand(command), effects, paths, changedDigest),
      );
      const afterDigest = yield* readDecision(files.dbPath, command.commandId);
      assert.isTrue(isManagedCommandPolicyConflictError(squash(digestConflict)));
      assert.deepEqual(afterDigest, stored);
      assert.equal(effects.count, 1);

      const routed = yield* Effect.exit(
        withFile(files.dbPath, dispatchCommand(routeCommand), effects, paths, bothRoutes),
      );
      assert.equal(routed._tag, "Success");
      assert.equal(effects.count, 2);
      const storedRoute = yield* readDecision(files.dbPath, routeCommand.commandId);
      const routeConflict = yield* Effect.exit(
        withFile(files.dbPath, dispatchCommand(routeCommand), effects, paths, otherRoute),
      );
      const afterRoute = yield* readDecision(files.dbPath, routeCommand.commandId);
      assert.isTrue(isManagedCommandPolicyConflictError(squash(routeConflict)));
      assert.deepEqual(afterRoute, storedRoute);
      assert.equal(afterRoute.routeId, "route-a");
      assert.equal(effects.count, 2);
      assert.equal(yield* eventCount(files.dbPath), 2);
    }).pipe(Effect.ensuring(Effect.sync(files.remove)));
  },
);

it.effect("does not report success when the provider effect fails", () => {
  const files = tempCase("fail");
  const effects = { count: 0, throwNext: true };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const command = message("cmd-ic03-fail");
  return Effect.gen(function* () {
    const failed = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    const failedDecision = yield* readDecision(files.dbPath, command.commandId);
    assert.equal(failed._tag, "Failure");
    assert.isTrue(isOrchestratorDispatchError(squash(failed)));
    assert.equal(failedDecision.decision, "failed");
    assert.notEqual(failedDecision.decision, "accepted");
    assert.notEqual(failedDecision.decision, "completed");
    assert.equal(effects.count, 1);
    assert.equal(yield* eventCount(files.dbPath), 0);
    assert.equal(NodeFS.existsSync(files.marker), false);

    const recovered = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    const recoveredDecision = yield* readDecision(files.dbPath, command.commandId);
    assert.equal(recovered._tag, "Success");
    assert.equal(recoveredDecision.decision, "accepted");
    assert.equal(recoveredDecision.policyDigest, failedDecision.policyDigest);
    assert.equal(effects.count, 2);

    const replay = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    assert.equal(replay._tag, "Success");
    assert.equal(effects.count, 2);
    assert.equal(yield* eventCount(files.dbPath), 1);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("conflicts when an accepted command id is reused with a different payload", () => {
  const files = tempCase("payload");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const command = message("cmd-ic03-payload");
  const changed = { ...command, text: "a different payload" };
  return Effect.gen(function* () {
    const first = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    const second = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(changed), effects, paths, admission),
    );
    assert.equal(first._tag, "Success");
    assert.isTrue(isManagedCommandPolicyConflictError(squash(second)));
    assert.equal(effects.count, 1);
    assert.equal(yield* eventCount(files.dbPath), 1);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("replays a pre-digest accepted row when the stored payload digest is null", () => {
  const files = tempCase("pre-digest");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const command = message("cmd-ic03-pre-digest");
  const clearDigest = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      UPDATE orchestration_command_policy_receipts
      SET payload_digest = NULL
      WHERE command_id = ${command.commandId}
    `;
  }).pipe(Effect.provide(persistence(files.dbPath)));
  return Effect.gen(function* () {
    const first = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    yield* clearDigest;
    const replay = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    const changed = yield* Effect.exit(
      withFile(
        files.dbPath,
        dispatchCommand({ ...command, text: "different text, no stored digest" }),
        effects,
        paths,
        admission,
      ),
    );
    assert.equal(first._tag, "Success");
    assert.equal(replay._tag, "Success");
    assert.equal(changed._tag, "Failure");
    assert.equal(effects.count, 1);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("sends a managed guest message with the stored guest files", () => {
  const files = tempCase("guest");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const guestFile = {
    type: "image" as const,
    id: ChatAttachmentId.make(createAttachmentId("thread-ic03")!),
    name: "screen.png",
    mimeType: "image/png",
    sizeBytes: 3,
  };
  const guestMessageId = GuestMessageId.make("guest-message:ic03");
  const command = {
    ...message("cmd-ic03-guest"),
    guestMessageId,
    text: "",
    attachments: [{ ...guestFile, id: ChatAttachmentId.make("thread-ic03-owner-file") }],
  };
  let seenName = "";
  const layer = Layer.mock(ThreadManagement.ThreadManagementService)({
    dispatch: (dispatched) =>
      Effect.sync(() => {
        effects.count += 1;
        if (dispatched.type === "message.dispatch")
          seenName = dispatched.attachments[0]?.name ?? "";
        if (dispatched.type === "message.dispatch") {
          assert.deepEqual(dispatched.attachments, [guestFile]);
        }
        NodeFS.mkdirSync(paths.directory, { recursive: true });
        NodeFS.writeFileSync(paths.marker, dispatched.commandId);
        return { sequence: effects.count, storedEvents: [] };
      }),
    getThreadSnapshotWindow: () =>
      Effect.succeed({
        projection: {
          thread: {
            guestShare: {
              messages: [{ id: guestMessageId, status: "pending", attachments: [guestFile] }],
            },
          },
        },
      } as never),
  });
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(
      dispatchCommand(command).pipe(
        Effect.provideService(ManagedMessageAdmission, admission),
        Effect.provide(
          Layer.mergeAll(
            layer,
            persistence(files.dbPath),
            Layer.mock(OrchestratorV2)({ replayManagedMessage: () => Effect.succeedNone }),
          ),
        ),
      ),
    );
    assert.equal(exit._tag, "Success");
    assert.equal(seenName, "screen.png");
    assert.equal(effects.count, 1);
    const decision = yield* readDecision(files.dbPath, command.commandId);
    assert.equal(decision.decision, "accepted");
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(files.directory, { prefix: "ic03-guest-" }).pipe(
        Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
      ),
    ),
    Effect.ensuring(Effect.sync(files.remove)),
  );
});

it.effect("claims a pending attachment before the managed provider runs", () => {
  const files = tempCase("claim");
  const admission = buildAdmission();
  const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
  const command = {
    ...message("cmd-ic03-claim"),
    attachments: [
      {
        type: "image" as const,
        id: pendingId,
        name: "screen.png",
        mimeType: "image/png",
        sizeBytes: 3,
      },
    ],
  };
  let claimedId = "";
  const layer = Layer.mock(ThreadManagement.ThreadManagementService)({
    dispatch: (dispatched) =>
      Effect.sync(() => {
        if (dispatched.type === "message.dispatch") claimedId = dispatched.attachments[0]?.id ?? "";
        return { sequence: 1, storedEvents: [] };
      }),
  });
  const runtime = ServerConfig.layerTest(files.directory, { prefix: "ic03-claim-" }).pipe(
    Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    Layer.provideMerge(ServerSettings.layerTest()),
  );
  return Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    const exit = yield* Effect.exit(
      dispatchCommand(command).pipe(
        Effect.provideService(ManagedMessageAdmission, admission),
        Effect.provide(
          Layer.mergeAll(
            layer,
            persistence(files.dbPath),
            Layer.mock(OrchestratorV2)({ replayManagedMessage: () => Effect.succeedNone }),
          ),
        ),
      ),
    );
    assert.equal(exit._tag, "Success");
    assert.notEqual(claimedId, pendingId);
    assert.equal(claimedId.startsWith("pending"), false);
    const decision = yield* readDecision(files.dbPath, command.commandId);
    assert.equal(decision.decision, "accepted");
  }).pipe(Effect.provide(runtime), Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("AUDIT rejects a dispatch selection outside its authorised route", () => {
  const files = tempCase("audit-route-binding");
  const admission = buildAdmission();
  const selection = decodeModelSelection({
    instanceId: "unapproved-instance",
    model: "unapproved-model",
  });
  const command = { ...message("cmd-audit-route-binding"), modelSelection: selection };
  let received: unknown;
  const dispatch = Layer.mock(ThreadManagement.ThreadManagementService)({
    dispatch: (actual) =>
      Effect.sync(() => {
        received = actual;
        return { sequence: 41, storedEvents: [] };
      }),
  });
  return Effect.gen(function* () {
    const result = yield* Effect.exit(
      dispatchCommand(command).pipe(
        Effect.provideService(ManagedMessageAdmission, admission),
        Effect.provide(
          Layer.mergeAll(
            dispatch,
            persistence(files.dbPath),
            Layer.mock(OrchestratorV2)({ replayManagedMessage: () => Effect.succeedNone }),
          ),
        ),
      ),
    );
    assert.equal(result._tag, "Failure", JSON.stringify({ result, received }));
    assert.isTrue(isManagedCommandRefusedError(squash(result)));
    assert.equal(received, undefined);
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(files.directory, { prefix: "ic03-route-" }).pipe(
        Layer.provideMerge(DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer))),
      ),
    ),
    Effect.ensuring(Effect.sync(files.remove)),
  );
});

it.effect("AUDIT equivalent newly allocated message id replays successfully", () => {
  const files = tempCase("audit-id-replay");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const command = message("cmd-audit-id-replay");
  return Effect.gen(function* () {
    yield* withFile(files.dbPath, dispatchCommand(command), effects, paths, admission);
    const retry = yield* Effect.exit(
      withFile(
        files.dbPath,
        dispatchCommand({ ...command, messageId: MessageId.make("message-reallocated") }),
        effects,
        paths,
        admission,
      ),
    );
    assert.equal(retry._tag, "Success", JSON.stringify(retry));
    assert.equal(effects.count, 1);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("AUDIT legacy unknown payload never grants a changed thread success", () => {
  const files = tempCase("audit-null-target");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const command = message("cmd-audit-null-target");
  return Effect.gen(function* () {
    yield* withFile(files.dbPath, dispatchCommand(command), effects, paths, admission);
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE orchestration_command_policy_receipts
        SET payload_digest = NULL WHERE command_id = ${command.commandId}`;
    }).pipe(Effect.provide(persistence(files.dbPath)));
    const changed = yield* Effect.exit(
      withFile(
        files.dbPath,
        dispatchCommand({ ...command, threadId: ThreadId.make("thread-foreign-target") }),
        effects,
        paths,
        admission,
      ),
    );
    assert.equal(changed._tag, "Failure", JSON.stringify(changed));
    assert.equal(effects.count, 1);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("AUDIT accepted replay returns the original durable sequence", () => {
  const files = tempCase("audit-sequence");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const command = message("cmd-audit-sequence");
  return Effect.gen(function* () {
    const first = yield* withFile(
      files.dbPath,
      dispatchCommand(command),
      effects,
      paths,
      admission,
    );
    const replay = yield* withFile(
      files.dbPath,
      dispatchCommand(command),
      effects,
      paths,
      admission,
    );
    assert.equal(replay.sequence, first.sequence, JSON.stringify({ first, replay }));
    assert.equal(effects.count, 1);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("recovers a native commit when the policy outcome remained failed", () => {
  const files = tempCase("native-commit-policy-failed");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const command = message("cmd-native-commit-policy-failed");
  const admission = buildAdmission();
  return Effect.gen(function* () {
    const first = yield* withFile(
      files.dbPath,
      dispatchCommand(command),
      effects,
      paths,
      admission,
    );
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE orchestration_command_policy_receipts SET decision = 'failed' WHERE command_id = ${command.commandId}`;
    }).pipe(Effect.provide(persistence(files.dbPath)));
    const replay = yield* withFile(
      files.dbPath,
      dispatchCommand(command),
      effects,
      paths,
      admission,
    );
    assert.equal(replay.sequence, first.sequence);
    assert.equal(replay.replayed, true);
    assert.equal(effects.count, 1);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("refuses an accepted legacy policy row without a verifiable native receipt", () => {
  const files = tempCase("unverifiable-native-receipt");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const command = message("cmd-unverifiable-native-receipt");
  const admission = buildAdmission();
  return Effect.gen(function* () {
    yield* withFile(files.dbPath, dispatchCommand(command), effects, paths, admission);
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE orchestration_command_policy_receipts SET payload_digest = NULL WHERE command_id = ${command.commandId}`;
      yield* sql`UPDATE orchestration_command_receipts SET payload_digest = NULL WHERE command_id = ${command.commandId}`;
    }).pipe(Effect.provide(persistence(files.dbPath)));
    const replay = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    assert.equal(replay._tag, "Failure");
    assert.equal(effects.count, 1);
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("FRESH refuses a different ordinary native receipt under a failed policy payload", () => {
  const files = tempCase("fresh-policy-native-mismatch");
  const effects = { count: 0, throwNext: true };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const original = { ...message("fresh-policy-native-mismatch"), text: "admitted original A" };
  const changed = {
    ...original,
    text: "ordinary replacement B",
    modelSelection: decodeModelSelection({
      instanceId: "unapproved-instance",
      model: "unapproved-model",
    }),
  };
  return Effect.gen(function* () {
    const failed = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(original), effects, paths, admission),
    );
    assert.equal(failed._tag, "Failure");
    const before = yield* readDecision(files.dbPath, original.commandId);
    assert.equal(before.decision, "failed");
    yield* withFile(
      files.dbPath,
      Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        return yield* threads.dispatch(changed);
      }),
      effects,
      paths,
      admission,
    );
    const replay = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(changed), effects, paths, admission),
    );
    const after = yield* readDecision(files.dbPath, original.commandId);
    assert.equal(
      replay._tag,
      "Failure",
      JSON.stringify({
        replay,
        before,
        after,
        changedDigest: commandPayloadDigest(commandReceiptIdentity(changed)),
        effects,
      }),
    );
    assert.equal(after.decision, "failed");
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("FRESH refuses to create managed authorisation over an ordinary native receipt", () => {
  const files = tempCase("fresh-ordinary-first");
  const effects = { count: 0, throwNext: false };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const command = {
    ...message("fresh-ordinary-first"),
    text: "ordinary B before any managed policy",
  };
  const ordinarySelection = decodeModelSelection({
    instanceId: "ordinary-B-instance",
    model: "ordinary-B-model",
  });
  return Effect.gen(function* () {
    yield* withFile(
      files.dbPath,
      Effect.gen(function* () {
        const native = yield* OrchestratorV2;
        yield* native.dispatch({
          type: "thread.create",
          commandId: CommandId.make("fresh-create-ordinary-thread"),
          threadId: command.threadId,
          projectId: ProjectId.make("fresh-ordinary-project"),
          title: "Ordinary model B",
          modelSelection: ordinarySelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
        });
      }),
      effects,
      paths,
      admission,
    );
    yield* withFile(
      files.dbPath,
      Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        return yield* threads.dispatch(command);
      }),
      effects,
      paths,
      admission,
    );
    const before = yield* Effect.exit(readDecision(files.dbPath, command.commandId));
    assert.equal(before._tag, "Failure");
    const replay = yield* Effect.exit(
      withFile(
        files.dbPath,
        Effect.gen(function* () {
          const native = yield* OrchestratorV2;
          return yield* dispatchCommand(command).pipe(
            Effect.provide(
              Layer.mock(ThreadManagement.ThreadManagementService)({ dispatch: native.dispatch }),
            ),
          );
        }),
        effects,
        paths,
        admission,
      ),
    );
    const after = yield* Effect.exit(readDecision(files.dbPath, command.commandId));
    assert.equal(replay._tag, "Failure", JSON.stringify({ replay, after, effects }));
    assert.isTrue(
      isManagedCommandPolicyConflictError(squash(replay)),
      JSON.stringify({ replay, after, effects }),
    );
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect("FRESH refuses an unbound same-payload native receipt after managed failure", () => {
  const files = tempCase("fresh-unbound-same-payload");
  const effects = { count: 0, throwNext: true };
  const paths = { directory: files.providerDirectory, marker: files.marker };
  const admission = buildAdmission();
  const command = message("fresh-unbound-same-payload");
  return Effect.gen(function* () {
    const first = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    assert.equal(first._tag, "Failure");
    // Simulates a legacy ordinary writer that ignored the managed reservation.
    yield* withFile(
      files.dbPath,
      Effect.gen(function* () {
        const threads = yield* ThreadManagement.ThreadManagementService;
        return yield* threads.dispatch(command);
      }),
      effects,
      paths,
      admission,
    );
    const replay = yield* Effect.exit(
      withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
    );
    const after = yield* readDecision(files.dbPath, command.commandId);
    assert.isTrue(isManagedCommandPolicyConflictError(squash(replay)));
    assert.equal(after.decision, "failed");
  }).pipe(Effect.ensuring(Effect.sync(files.remove)));
});

it.effect(
  "accepts an unbound legacy receipt only when native events prove the admitted route",
  () => {
    const files = tempCase("verified-legacy-route");
    const effects = { count: 0, throwNext: false };
    const paths = { directory: files.providerDirectory, marker: files.marker };
    const admission = buildAdmission();
    const command = message("verified-legacy-route");
    const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
    const when = "2026-10-28T12:00:00.000Z";
    const runId = "run:verified-legacy-route";
    const run = {
      id: runId,
      threadId: command.threadId,
      ordinal: 1,
      providerInstanceId: "native-instance",
      modelSelection: {
        instanceId: "native-instance",
        model: "user-selected-model",
        options: [{ id: "effort", value: "high" }],
      },
      providerThreadId: null,
      userMessageId: command.messageId,
      rootNodeId: null,
      activeAttemptId: null,
      status: "starting",
      requestedAt: when,
      startedAt: null,
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    };
    const storedMessage = {
      id: command.messageId,
      threadId: command.threadId,
      runId,
      nodeId: null,
      role: "user",
      text: command.text,
      attachments: [],
      streaming: false,
      createdBy: "user",
      creationSource: "web",
      createdAt: when,
      updatedAt: when,
    };
    return Effect.gen(function* () {
      yield* withFile(files.dbPath, dispatchCommand(command), effects, paths, admission);
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE orchestration_command_policy_receipts SET native_bound = 0, payload_digest = NULL WHERE command_id = ${command.commandId}`;
        yield* sql`INSERT INTO orchestration_events
        (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, command_id, actor_kind, payload_json, metadata_json, application_event_version)
        VALUES ('legacy-run', 'thread', ${command.threadId}, 1, 'run.created', ${when}, ${command.commandId}, 'server', ${json(run)}, '{}', 2)`;
        yield* sql`INSERT INTO orchestration_events
        (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, command_id, actor_kind, payload_json, metadata_json, application_event_version)
        VALUES ('legacy-message', 'thread', ${command.threadId}, 2, 'message.updated', ${when}, ${command.commandId}, 'server', ${json(storedMessage)}, '{}', 2)`;
      }).pipe(Effect.provide(persistence(files.dbPath)));
      const replay = yield* Effect.exit(
        withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
      );
      assert.equal(replay._tag, "Success", JSON.stringify(replay));
      assert.equal(effects.count, 1);
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE orchestration_events SET payload_json = ${json({ ...run, modelSelection: { ...run.modelSelection, model: "other-model" } })} WHERE event_id = 'legacy-run'`;
      }).pipe(Effect.provide(persistence(files.dbPath)));
      const changed = yield* Effect.exit(
        withFile(files.dbPath, dispatchCommand(command), effects, paths, admission),
      );
      assert.isTrue(isManagedCommandPolicyConflictError(squash(changed)));
      assert.equal(effects.count, 1);
    }).pipe(Effect.ensuring(Effect.sync(files.remove)));
  },
);
