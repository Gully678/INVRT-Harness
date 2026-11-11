import type { OrchestrationV2Command } from "@t3tools/contracts";
import {
  CommandId,
  resolveManagedRoute,
  type OrchestrationV2StoredEvent,
  type PolicyRoute,
  type ResolveManagedRouteInput,
  type RoutingAuthorityPort,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { commandPayloadDigest } from "./CommandReceiptStore.ts";
import {
  OrchestratorV2,
  commandReceiptIdentity,
  type OrchestratorV2DispatchResult,
} from "./Orchestrator.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import { ManagedRouteConstraint, matchesManagedRoute } from "./ManagedRouteConstraint.ts";

export interface ManagedMessageAdmissionShape {
  /** Trusted route request. The port is supplied beside it and is not read from the installed pack. */
  readonly request: Omit<ResolveManagedRouteInput, "port">;
  readonly port: RoutingAuthorityPort;
}

export class ManagedMessageAdmission extends Context.Service<
  ManagedMessageAdmission,
  ManagedMessageAdmissionShape
>()("t3/orchestration-v2/ManagedMessageAdmission") {}

const Decision = Schema.Literals(["admitted", "accepted", "refused", "failed"]);
type Decision = typeof Decision.Type;

export class ManagedCommandRefusedError extends Schema.TaggedError<ManagedCommandRefusedError>()(
  "ManagedCommandRefusedError",
  {
    commandId: CommandId,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Command ${this.commandId} was refused by managed route policy: ${this.detail}`;
  }
}

export class ManagedCommandPolicyConflictError extends Schema.TaggedError<ManagedCommandPolicyConflictError>()(
  "ManagedCommandPolicyConflictError",
  { commandId: CommandId },
) {
  override get message(): string {
    return `Command ${this.commandId} does not match the stored managed decision and was not applied again.`;
  }
}

export class ManagedCommandDecisionNotFoundError extends Schema.TaggedError<ManagedCommandDecisionNotFoundError>()(
  "ManagedCommandDecisionNotFoundError",
  { commandId: CommandId },
) {
  override get message(): string {
    return `No managed policy receipt is stored for command ${this.commandId}.`;
  }
}

/** A managed task reached intake with no caller-supplied local port. No provider effect and no receipt. */
export class ManagedCommandAuthorityUnavailableError extends Schema.TaggedError<ManagedCommandAuthorityUnavailableError>()(
  "ManagedCommandAuthorityUnavailableError",
  { commandId: CommandId },
) {
  override get message(): string {
    return `Command ${this.commandId} was not sent because no local routing authority is available.`;
  }
}

export interface ManagedCommandDecision {
  readonly policyId: string | null;
  readonly policyRevision: number | null;
  readonly policyDigest: string | null;
  readonly routeId: string | null;
  readonly payloadDigest: string | null;
  readonly decision: Decision;
}

type MessageDispatchCommand = Extract<
  OrchestrationV2Command,
  { readonly type: "message.dispatch" }
>;

interface StoredDecision extends ManagedCommandDecision {
  readonly nativeBound: boolean;
}

const decodeDecision = Schema.decodeUnknownSync(Decision);

const readRow = Effect.fn("ManagedMessageAdmission.readRow")(function* (commandId: CommandId) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly policyId: string | null;
    readonly policyRevision: number | null;
    readonly policyDigest: string | null;
    readonly routeId: string | null;
    readonly payloadDigest: string | null;
    readonly decision: string;
    readonly nativeBound: number;
  }>`
      SELECT
        policy_id AS "policyId",
        policy_revision AS "policyRevision",
        policy_digest AS "policyDigest",
        route_id AS "routeId",
        payload_digest AS "payloadDigest",
        native_bound AS "nativeBound",
        decision
      FROM orchestration_command_policy_receipts
      WHERE command_id = ${commandId}
    `.pipe(NodeSqliteClient.readOnly);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    policyId: row.policyId,
    policyRevision: row.policyRevision,
    policyDigest: row.policyDigest,
    routeId: row.routeId,
    payloadDigest: row.payloadDigest,
    decision: decodeDecision(row.decision),
    nativeBound: row.nativeBound === 1,
  } satisfies StoredDecision;
});

/** Local read of the policy decision stored for one command id. No network. */
export const readManagedCommandDecision = Effect.fn(
  "ManagedMessageAdmission.readManagedCommandDecision",
)(function* (commandId: CommandId) {
  const stored = yield* readRow(commandId);
  if (stored === null) return yield* new ManagedCommandDecisionNotFoundError({ commandId });
  const { nativeBound: _nativeBound, ...decision } = stored;
  return decision;
});

const resolveAdmission = (admission: ManagedMessageAdmissionShape) => {
  try {
    const resolved = resolveManagedRoute({ ...admission.request, port: admission.port });
    return {
      kind: "allowed" as const,
      policyId: resolved.policyRef.policyId,
      policyRevision: resolved.policyRef.revision,
      policyDigest: resolved.policyRef.digest,
      routeId: resolved.route.routeId,
      route: resolved.route,
    };
  } catch (cause) {
    const detail =
      cause instanceof Error && cause.message.trim().length > 0
        ? cause.message
        : "Managed route was refused";
    return { kind: "refused" as const, detail };
  }
};

const sameDecision = (
  stored: StoredDecision,
  next: ReturnType<typeof resolveAdmission>,
): boolean => {
  if (next.kind === "refused") {
    return (
      stored.decision === "refused" &&
      stored.policyId === null &&
      stored.policyRevision === null &&
      stored.policyDigest === null &&
      stored.routeId === null
    );
  }
  return (
    stored.decision !== "refused" &&
    stored.policyId === next.policyId &&
    stored.policyRevision === next.policyRevision &&
    stored.policyDigest === next.policyDigest &&
    stored.routeId === next.routeId
  );
};

const insertReceipt = Effect.fn("ManagedMessageAdmission.insertReceipt")(function* (input: {
  readonly commandId: CommandId;
  readonly policyId: string | null;
  readonly policyRevision: number | null;
  readonly policyDigest: string | null;
  readonly routeId: string | null;
  readonly payloadDigest: string | null;
  readonly decision: Decision;
}) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly command_id: string }>`
      INSERT INTO orchestration_command_policy_receipts (
        command_id, policy_id, policy_revision, policy_digest, route_id, payload_digest, decision
      ) SELECT
        ${input.commandId},
        ${input.policyId},
        ${input.policyRevision},
        ${input.policyDigest},
        ${input.routeId},
        ${input.payloadDigest},
        ${input.decision}
      WHERE NOT EXISTS (
        SELECT 1 FROM orchestration_command_receipts WHERE command_id = ${input.commandId}
      )
      RETURNING command_id
    `;
  if (rows.length === 0) {
    return yield* new ManagedCommandPolicyConflictError({ commandId: input.commandId });
  }
});

const setDecision = Effect.fn("ManagedMessageAdmission.setDecision")(function* (
  commandId: CommandId,
  decision: Decision,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
      UPDATE orchestration_command_policy_receipts
      SET decision = ${decision}
      WHERE command_id = ${commandId}
    `;
});

// Legacy rows lack atomic binding. Only a native event for the same message and
// run can prove which model actually received it; steer-only receipts cannot.
const hasVerifiedLegacyRoute = (
  events: ReadonlyArray<OrchestrationV2StoredEvent>,
  route: PolicyRoute,
) =>
  events.some(
    ({ event }) =>
      event.type === "run.created" &&
      event.payload.status === "starting" &&
      event.payload.providerInstanceId === route.providerInstanceRef &&
      matchesManagedRoute(route, event.payload.modelSelection) &&
      events.some(
        ({ event: message }) =>
          message.type === "message.updated" &&
          message.payload.role === "user" &&
          message.payload.id === event.payload.userMessageId &&
          message.payload.runId === event.payload.id,
      ),
  );

export const dispatchManagedMessage = Effect.fn("ManagedMessageAdmission.dispatchManagedMessage")(
  function* <E, R>(
    command: MessageDispatchCommand,
    runDispatch?: Effect.Effect<OrchestratorV2DispatchResult, E, R>,
  ) {
    const admission = yield* ManagedMessageAdmission;
    const stored = yield* readRow(command.commandId);
    const resolved = resolveAdmission(admission);
    const payloadDigest = commandPayloadDigest(commandReceiptIdentity(command));

    if (stored !== null && !sameDecision(stored, resolved)) {
      return yield* new ManagedCommandPolicyConflictError({ commandId: command.commandId });
    }
    if (
      stored?.payloadDigest != null &&
      stored.payloadDigest !== payloadDigest &&
      stored.payloadDigest !== commandPayloadDigest(command)
    ) {
      return yield* new ManagedCommandPolicyConflictError({ commandId: command.commandId });
    }
    if (stored !== null && stored.decision !== "refused") {
      const orchestrator = yield* OrchestratorV2;
      const replay = yield* orchestrator.replayManagedMessage(command);
      if (Option.isSome(replay)) {
        if (
          resolved.kind !== "allowed" ||
          (!stored.nativeBound &&
            !hasVerifiedLegacyRoute(replay.value.storedEvents, resolved.route))
        ) {
          return yield* new ManagedCommandPolicyConflictError({ commandId: command.commandId });
        }
        if (stored.decision !== "accepted") yield* setDecision(command.commandId, "accepted");
        return replay.value;
      }
      if (stored.decision === "accepted") {
        return yield* new ManagedCommandPolicyConflictError({ commandId: command.commandId });
      }
    }
    if (
      stored !== null &&
      (stored.payloadDigest == null ||
        (stored.payloadDigest !== payloadDigest &&
          stored.payloadDigest !== commandPayloadDigest(command)))
    ) {
      return yield* new ManagedCommandPolicyConflictError({ commandId: command.commandId });
    }
    if (stored?.decision === "refused" || (stored === null && resolved.kind === "refused")) {
      if (stored === null) {
        yield* insertReceipt({
          commandId: command.commandId,
          policyId: null,
          policyRevision: null,
          policyDigest: null,
          routeId: null,
          payloadDigest,
          decision: "refused",
        });
      }
      return yield* new ManagedCommandRefusedError({
        commandId: command.commandId,
        detail: resolved.kind === "refused" ? resolved.detail : "Stored managed route refusal",
      });
    }
    if (resolved.kind !== "allowed") {
      return yield* new ManagedCommandPolicyConflictError({ commandId: command.commandId });
    }
    if (
      command.modelSelection !== undefined &&
      !matchesManagedRoute(resolved.route, command.modelSelection)
    ) {
      return yield* new ManagedCommandRefusedError({
        commandId: command.commandId,
        detail: "Selection does not match the admitted route",
      });
    }
    if (stored === null) {
      const orchestrator = yield* OrchestratorV2;
      const native = yield* orchestrator.replayManagedMessage(command);
      if (Option.isSome(native)) {
        return yield* new ManagedCommandPolicyConflictError({ commandId: command.commandId });
      }
      yield* insertReceipt({
        commandId: command.commandId,
        policyId: resolved.policyId,
        policyRevision: resolved.policyRevision,
        policyDigest: resolved.policyDigest,
        routeId: resolved.routeId,
        payloadDigest,
        decision: "admitted",
      });
    }

    const threads = yield* ThreadManagement.ThreadManagementService;
    const recordDispatch = <DispatchError, Services>(
      dispatch: Effect.Effect<OrchestratorV2DispatchResult, DispatchError, Services>,
    ) =>
      dispatch.pipe(
        Effect.provideService(ManagedRouteConstraint, resolved.route),
        Effect.tap(() => setDecision(command.commandId, "accepted")),
        Effect.tapError(() => setDecision(command.commandId, "failed")),
      );
    if (runDispatch !== undefined) return yield* recordDispatch(runDispatch);
    return yield* recordDispatch(threads.dispatch(command));
  },
);
