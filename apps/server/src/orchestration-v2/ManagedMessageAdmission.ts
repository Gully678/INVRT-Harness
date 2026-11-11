import type { OrchestrationV2Command } from "@t3tools/contracts";
import {
  CommandId,
  resolveManagedRoute,
  type ResolveManagedRouteInput,
  type RoutingAuthorityPort,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import type { OrchestratorV2DispatchResult } from "./Orchestrator.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

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
    return `Command ${this.commandId} already has a different policy decision and was not applied again.`;
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

export interface ManagedCommandDecision {
  readonly policyId: string | null;
  readonly policyRevision: number | null;
  readonly policyDigest: string | null;
  readonly routeId: string | null;
  readonly decision: Decision;
}

type MessageDispatchCommand = Extract<
  OrchestrationV2Command,
  { readonly type: "message.dispatch" }
>;

interface StoredDecision extends ManagedCommandDecision {}

const decodeDecision = Schema.decodeUnknownSync(Decision);

const readRow = (commandId: CommandId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      readonly policyId: string | null;
      readonly policyRevision: number | null;
      readonly policyDigest: string | null;
      readonly routeId: string | null;
      readonly decision: string;
    }>`
      SELECT
        policy_id AS "policyId",
        policy_revision AS "policyRevision",
        policy_digest AS "policyDigest",
        route_id AS "routeId",
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
      decision: decodeDecision(row.decision),
    } satisfies StoredDecision;
  });

/** Local read of the policy decision stored for one command id. No network. */
export const readManagedCommandDecision = Effect.fn(
  "ManagedMessageAdmission.readManagedCommandDecision",
)(function* (commandId: CommandId) {
  const stored = yield* readRow(commandId);
  if (stored === null) return yield* new ManagedCommandDecisionNotFoundError({ commandId });
  return stored;
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

const insertReceipt = (input: {
  readonly commandId: CommandId;
  readonly policyId: string | null;
  readonly policyRevision: number | null;
  readonly policyDigest: string | null;
  readonly routeId: string | null;
  readonly decision: Decision;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO orchestration_command_policy_receipts (
        command_id, policy_id, policy_revision, policy_digest, route_id, decision
      ) VALUES (
        ${input.commandId},
        ${input.policyId},
        ${input.policyRevision},
        ${input.policyDigest},
        ${input.routeId},
        ${input.decision}
      )
    `;
  });

const setDecision = (commandId: CommandId, decision: Decision) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      UPDATE orchestration_command_policy_receipts
      SET decision = ${decision}
      WHERE command_id = ${commandId}
    `;
  });

const replayResult: OrchestratorV2DispatchResult = {
  sequence: 0,
  storedEvents: [],
  replayed: true,
};

/**
 * Decides message.dispatch with resolveManagedRoute before any provider effect.
 * The same command id replays the stored decision. A changed digest or route conflicts.
 */
export const dispatchManagedMessage = Effect.fn("ManagedMessageAdmission.dispatchManagedMessage")(
  function* (command: MessageDispatchCommand) {
    const admission = yield* ManagedMessageAdmission;
    const stored = yield* readRow(command.commandId);
    const resolved = resolveAdmission(admission);

    if (stored !== null && !sameDecision(stored, resolved)) {
      return yield* new ManagedCommandPolicyConflictError({ commandId: command.commandId });
    }
    if (stored?.decision === "accepted") return replayResult;
    if (stored?.decision === "refused" || (stored === null && resolved.kind === "refused")) {
      if (stored === null) {
        yield* insertReceipt({
          commandId: command.commandId,
          policyId: null,
          policyRevision: null,
          policyDigest: null,
          routeId: null,
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
    if (stored === null) {
      yield* insertReceipt({
        commandId: command.commandId,
        policyId: resolved.policyId,
        policyRevision: resolved.policyRevision,
        policyDigest: resolved.policyDigest,
        routeId: resolved.routeId,
        decision: "admitted",
      });
    }

    const threads = yield* ThreadManagement.ThreadManagementService;
    return yield* threads.dispatch(command).pipe(
      Effect.tap(() => setDecision(command.commandId, "accepted")),
      Effect.tapError(() => setDecision(command.commandId, "failed")),
    );
  },
);
