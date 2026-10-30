// @effect-diagnostics-next-line nodeBuiltinImport:off -- Hash public selection metadata, never account credentials.
import * as NodeCrypto from "node:crypto";
import {
  ForgeBeginPlanningInput,
  ForgeStartPlanningInput,
  ForgePlanningError,
  type ForgePlanningBinding,
  type ForgePlanningPrepared,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import {
  validateNativeSessionMetadata,
  type AuthenticatedSession,
} from "../auth/EnvironmentAuth.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as Registry from "./ProviderInstanceRegistry.ts";

// Exact V5 content review is the preparation anchor, not runtime admission.
const MANIFEST = "baf90ec84e458e703b5ca84d3beb330988bd0a4b83f9f6a5ea3a09d4aaf4c782";
const TASK = "f750b1a33f27869ead78387309b31f8d11f4fe0b90684c1796810ff256419ee8";
const POLICY = "b11f942d543d2501b5e06a2b8f5d45a175ff8521ad12d31389c3725acff1880d";
// Rotate this compiled compatibility revision with any reviewed authority/trust change.
const SOURCE = "first-use-planning-real-v5/forge-local-planning-authority-v1";
const isPlanningError = Schema.is(ForgePlanningError);
const decodeBegin = Schema.decodeEffect(ForgeBeginPlanningInput);
const decodeStart = Schema.decodeEffect(ForgeStartPlanningInput);
const NATIVE_QUALIFICATIONS: readonly never[] = Object.freeze([]);
const bindingBrand: unique symbol = Symbol("LocalPlanningBinding");
export type LocalPlanningBinding = ForgePlanningBinding & { readonly [bindingBrand]: true };
const constructed = new WeakSet<object>();
export const isLocalPlanningBinding = (value: unknown): value is LocalPlanningBinding =>
  typeof value === "object" && value !== null && constructed.has(value);
const digest = (value: unknown) =>
  NodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ForgeLocalPlanningAuthority extends Context.Service<
  ForgeLocalPlanningAuthority,
  {
    readonly begin: (
      input: ForgeBeginPlanningInput,
      current: AuthenticatedSession,
    ) => Effect.Effect<ForgePlanningPrepared, ForgePlanningError>;
    readonly revalidate: (
      runId: string,
      revision: number,
      current: AuthenticatedSession,
    ) => Effect.Effect<LocalPlanningBinding, ForgePlanningError>;
    readonly start: (
      input: ForgeStartPlanningInput,
      current: AuthenticatedSession,
    ) => Effect.Effect<ForgePlanningPrepared, ForgePlanningError>;
  }
>()("t3/provider/ForgeLocalPlanningAuthority") {}

const Row = Schema.Struct({
  run_id: Schema.String,
  operation_id: Schema.String,
  native_session_id: Schema.String,
  subject: Schema.String,
  session_method: Schema.String,
  environment_id: Schema.String,
  project_id: Schema.String,
  thread_id: Schema.String,
  provider_instance_id: Schema.String,
  provider_binding: Schema.String,
  project_binding: Schema.String,
  task_sha256: Schema.String,
  manifest_sha256: Schema.String,
  trust_revision: Schema.Number,
  source_revision: Schema.String,
  revision: Schema.Number,
  expires_at: Schema.String,
  revoked_at: Schema.NullOr(Schema.String),
  state: Schema.String,
  native_policy_id: Schema.String,
  native_qualification_digest: Schema.NullOr(Schema.String),
  native_runtime_revision: Schema.NullOr(Schema.String),
  hold_reason: Schema.String,
  start_operation_id: Schema.NullOr(Schema.String),
  native_turn_held: Schema.Number,
});
type Row = typeof Row.Type;
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const brand = (row: Row): LocalPlanningBinding => {
  const binding: LocalPlanningBinding = Object.freeze({
    [bindingBrand]: true as const,
    purpose: "local-native-planning-v1",
    runId: row.run_id,
    revision: row.revision,
    nativeSessionId: row.native_session_id,
    subject: row.subject,
    sessionMethod: row.session_method,
    environmentId: row.environment_id,
    projectId: row.project_id,
    threadId: row.thread_id,
    providerInstanceId: row.provider_instance_id,
    taskSha256: row.task_sha256,
    manifestSha256: row.manifest_sha256,
    trustRevision: 1,
    sourceRevision: row.source_revision,
    humanVerified: false,
    buildAuthorised: false,
    allowedEffects: Object.freeze(["native-provider-plan-turn"] as const),
    nativeTurnHeld: true,
  });
  constructed.add(binding);
  return binding;
};
const prepared = (binding: LocalPlanningBinding): ForgePlanningPrepared => ({
  binding,
  state: "prepared",
  nativeTurnHeld: true,
  hold: { code: "plan_mode_unavailable", reason: "native_policy_unqualified" },
});
const unavailable = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapError((error) =>
      isPlanningError(error)
        ? Effect.void
        : Effect.logWarning("FORGE local planning storage or metadata unavailable"),
    ),
    Effect.mapError((error) =>
      isPlanningError(error) ? error : new ForgePlanningError({ code: "capability_unavailable" }),
    ),
  );

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sessions = yield* AuthSessions.make;
  const projects = yield* ProjectStore.make;
  const registry = yield* Registry.ProviderInstanceRegistry;
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const crypto = yield* Crypto.Crypto;
  const environmentId = yield* environment.getEnvironmentId;
  const read = (rows: readonly unknown[]) =>
    decodeRows(rows).pipe(Effect.map((decoded) => decoded[0]));
  const findRun = (id: string) =>
    sql`SELECT * FROM forge_local_planning_runs WHERE run_id = ${id} LIMIT 1`.pipe(
      Effect.flatMap(read),
    );
  const findOperation = (id: string) =>
    sql`SELECT * FROM forge_local_planning_runs WHERE operation_id = ${id} LIMIT 1`.pipe(
      Effect.flatMap(read),
    );
  const liveSession = Effect.fn("ForgeLocalPlanning.liveSession")(function* (
    current: AuthenticatedSession,
  ) {
    if (
      !current ||
      typeof current.sessionId !== "string" ||
      typeof current.subject !== "string" ||
      !Array.isArray(current.scopes)
    )
      return yield* new ForgePlanningError({ code: "unauthenticated" });
    const row = yield* sessions.getById({ sessionId: current.sessionId });
    if (Option.isNone(row)) return yield* new ForgePlanningError({ code: "unauthenticated" });
    const reason = validateNativeSessionMetadata(
      current,
      row.value,
      (yield* DateTime.now).epochMilliseconds,
    );
    if (reason) return yield* new ForgePlanningError({ code: reason });
    return row.value;
  });
  const selection = Effect.fn("ForgeLocalPlanning.selection")(function* (
    projectId: ProjectId,
    providerId: ProviderInstanceId,
  ) {
    const project = yield* projects.get(projectId);
    if (Option.isNone(project)) return yield* new ForgePlanningError({ code: "wrong_binding" });
    if (!registry.getSelectionRevision)
      return yield* new ForgePlanningError({ code: "capability_unavailable" });
    const selectionRevision = yield* registry.getSelectionRevision(providerId);
    if (!selectionRevision) return yield* new ForgePlanningError({ code: "wrong_binding" });
    const instance = yield* registry.getInstance(providerId);
    if (!instance?.enabled) return yield* new ForgePlanningError({ code: "wrong_binding" });
    // getSnapshot is cached metadata. Never use refresh/snapshotForCwd/auth/runtime here.
    const snapshot = yield* instance.snapshot.getSnapshot;
    if (
      !snapshot.enabled ||
      snapshot.instanceId !== providerId ||
      snapshot.driver !== instance.driverKind ||
      snapshot.availability === "unavailable"
    )
      return yield* new ForgePlanningError({ code: "wrong_binding" });
    if ((yield* registry.getSelectionRevision(providerId)) !== selectionRevision)
      return yield* new ForgePlanningError({ code: "wrong_binding" });
    return {
      project: digest([
        project.value.projectId,
        project.value.workspaceRoot,
        project.value.updatedAt,
      ]),
      provider: digest([
        selectionRevision,
        instance.driverKind,
        instance.continuationIdentity,
        snapshot.auth.status,
        snapshot.auth.type,
        snapshot.auth.profileId,
        snapshot.auth.workspaceId,
        snapshot.auth.email,
        snapshot.auth.label,
        snapshot.version,
        snapshot.installedVersion,
        snapshot.runtimePaths,
      ]),
    };
  });
  const validate = Effect.fn("ForgeLocalPlanning.validate")(function* (
    row: Row,
    revision: number,
    current: AuthenticatedSession,
  ) {
    const session = yield* liveSession(current);
    if (
      row.native_session_id !== current.sessionId ||
      row.subject !== current.subject ||
      row.session_method !== current.method ||
      row.environment_id !== environmentId
    )
      return yield* new ForgePlanningError({ code: "wrong_binding" });
    if (row.revoked_at !== null) return yield* new ForgePlanningError({ code: "revoked" });
    if (row.revision !== revision) return yield* new ForgePlanningError({ code: "stale_revision" });
    const now = (yield* DateTime.now).epochMilliseconds;
    const expires = Date.parse(row.expires_at);
    if (!Number.isFinite(expires) || expires > session.expiresAt.epochMilliseconds)
      return yield* new ForgePlanningError({ code: "wrong_binding" });
    if (expires <= now) return yield* new ForgePlanningError({ code: "expired" });
    if (
      row.trust_revision !== 1 ||
      row.source_revision !== SOURCE ||
      row.task_sha256 !== TASK ||
      row.manifest_sha256 !== MANIFEST ||
      row.native_policy_id !== POLICY
    )
      return yield* new ForgePlanningError({ code: "trust_mismatch" });
    if (
      row.state !== "prepared" ||
      row.native_turn_held !== 1 ||
      row.hold_reason !== "native_policy_unqualified" ||
      row.native_qualification_digest !== null ||
      row.native_runtime_revision !== null
    )
      return yield* new ForgePlanningError({ code: "wrong_binding" });
    const reservedThread =
      yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads WHERE thread_id = ${row.thread_id} LIMIT 1`;
    if (reservedThread.length !== 0)
      return yield* new ForgePlanningError({ code: "wrong_binding" });
    const selected = yield* selection(
      ProjectId.make(row.project_id),
      ProviderInstanceId.make(row.provider_instance_id),
    );
    if (selected.provider !== row.provider_binding || selected.project !== row.project_binding)
      return yield* new ForgePlanningError({ code: "wrong_binding" });
    return brand(row);
  });
  const begin = Effect.fn("ForgeLocalPlanning.begin")(
    function* (input: ForgeBeginPlanningInput, current: AuthenticatedSession) {
      const request = yield* decodeBegin(input).pipe(
        Effect.mapError(() => new ForgePlanningError({ code: "invalid_request" })),
      );
      const session = yield* liveSession(current);
      const existing = yield* findOperation(request.operationId);
      if (existing) {
        if (
          existing.native_session_id !== current.sessionId ||
          existing.project_id !== request.projectId ||
          existing.provider_instance_id !== request.providerInstanceId
        )
          return yield* new ForgePlanningError({ code: "idempotency_conflict" });
        return prepared(yield* validate(existing, existing.revision, current));
      }
      const selected = yield* selection(request.projectId, request.providerInstanceId);
      const runId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
      const threadId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
      const expires = DateTime.formatIso(
        DateTime.makeUnsafe(
          Math.min(
            session.expiresAt.epochMilliseconds,
            (yield* DateTime.now).epochMilliseconds + 30 * 60_000,
          ),
        ),
      );
      yield* sql`INSERT INTO forge_local_planning_runs (
      run_id,operation_id,native_session_id,subject,session_method,environment_id,project_id,thread_id,
      provider_instance_id,provider_binding,project_binding,task_sha256,manifest_sha256,trust_revision,
      source_revision,revision,expires_at,state,native_policy_id,hold_reason,native_turn_held
    ) VALUES (${runId},${request.operationId},${current.sessionId},${current.subject},${current.method},${environmentId},${request.projectId},${threadId},${request.providerInstanceId},${selected.provider},${selected.project},${TASK},${MANIFEST},1,${SOURCE},1,${expires},'prepared',${POLICY},'native_policy_unqualified',1)
      ON CONFLICT(operation_id) DO NOTHING`;
      const committed = yield* findOperation(request.operationId);
      if (!committed) return yield* new ForgePlanningError({ code: "capability_unavailable" });
      if (
        committed.native_session_id !== current.sessionId ||
        committed.project_id !== request.projectId ||
        committed.provider_instance_id !== request.providerInstanceId
      )
        return yield* new ForgePlanningError({ code: "idempotency_conflict" });
      return prepared(yield* validate(committed, committed.revision, current));
    },
    sql.withTransaction,
    unavailable,
  );
  const revalidate = Effect.fn("ForgeLocalPlanning.revalidate")(
    function* (runId: string, revision: number, current: AuthenticatedSession) {
      const row = yield* findRun(runId);
      if (!row) return yield* new ForgePlanningError({ code: "wrong_binding" });
      return yield* validate(row, revision, current);
    },
    sql.withTransaction,
    unavailable,
  );
  const start = Effect.fn("ForgeLocalPlanning.start")(
    function* (input: ForgeStartPlanningInput, current: AuthenticatedSession) {
      const request = yield* decodeStart(input).pipe(
        Effect.mapError(() => new ForgePlanningError({ code: "invalid_request" })),
      );
      const row = yield* findRun(request.runId);
      if (!row) return yield* new ForgePlanningError({ code: "wrong_binding" });
      const binding = yield* validate(row, request.revision, current);
      if (row.start_operation_id !== null && row.start_operation_id !== request.operationId)
        return yield* new ForgePlanningError({ code: "idempotency_conflict" });
      // No path from this empty code-owned registry to provider or intake effects.
      if (NATIVE_QUALIFICATIONS.length !== 0)
        return yield* new ForgePlanningError({ code: "capability_unavailable" });
      const claimed =
        yield* sql`SELECT run_id FROM forge_local_planning_runs WHERE start_operation_id = ${request.operationId} LIMIT 1`;
      if (claimed.length > 0 && row.start_operation_id !== request.operationId)
        return yield* new ForgePlanningError({ code: "idempotency_conflict" });
      yield* sql`UPDATE forge_local_planning_runs SET start_operation_id = ${request.operationId} WHERE run_id = ${request.runId}`;
      return prepared(binding);
    },
    sql.withTransaction,
    unavailable,
  );
  return ForgeLocalPlanningAuthority.of({ begin, revalidate, start });
});
export const layer = Layer.effect(ForgeLocalPlanningAuthority, make);
