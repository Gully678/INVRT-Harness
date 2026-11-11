import { CommandId, IsoDateTime, NonNegativeInt, ProjectId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  toPersistenceSqlError,
  type OrchestrationCommandReceiptRepositoryError,
} from "./Errors.ts";

export class OrchestrationCommandReceiptConflictError extends Schema.TaggedError<OrchestrationCommandReceiptConflictError>()(
  "OrchestrationCommandReceiptConflictError",
  {
    commandId: CommandId,
  },
) {
  override get message(): string {
    return `Command ${this.commandId} was already recorded with a different payload digest.`;
  }
}

export const OrchestrationCommandReceipt = Schema.Struct({
  commandId: CommandId,
  aggregateKind: Schema.Literals(["project", "thread"]),
  aggregateId: Schema.Union([ProjectId, ThreadId]),
  commandType: Schema.String,
  acceptedAt: IsoDateTime,
  resultSequence: NonNegativeInt,
  status: Schema.Literals(["accepted", "rejected"]),
  error: Schema.NullOr(Schema.String),
  // Absent or NULL on pre-migration receipts; only two defined digests that differ conflict.
  payloadDigest: Schema.optional(Schema.NullOr(Schema.String)),
});
export type OrchestrationCommandReceipt = typeof OrchestrationCommandReceipt.Type;

export const GetByCommandIdInput = Schema.Struct({
  commandId: CommandId,
});
export type GetByCommandIdInput = typeof GetByCommandIdInput.Type;

export class OrchestrationCommandReceiptRepository extends Context.Service<
  OrchestrationCommandReceiptRepository,
  {
    readonly insertIfAbsent: (
      receipt: OrchestrationCommandReceipt,
    ) => Effect.Effect<
      boolean,
      OrchestrationCommandReceiptRepositoryError | OrchestrationCommandReceiptConflictError
    >;

    readonly upsert: (
      receipt: OrchestrationCommandReceipt,
    ) => Effect.Effect<void, OrchestrationCommandReceiptRepositoryError>;

    readonly getByCommandId: (
      input: GetByCommandIdInput,
    ) => Effect.Effect<
      Option.Option<OrchestrationCommandReceipt>,
      OrchestrationCommandReceiptRepositoryError
    >;
  }
>()("t3/persistence/OrchestrationCommandReceipts/OrchestrationCommandReceiptRepository") {}

const makeOrchestrationCommandReceiptRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertReceiptRow = SqlSchema.void({
    Request: OrchestrationCommandReceipt,
    execute: (receipt) =>
      sql`
        INSERT INTO orchestration_command_receipts (
          command_id,
          aggregate_kind,
          aggregate_id,
          command_type,
          accepted_at,
          result_sequence,
          status,
          error,
          payload_digest
        )
        VALUES (
          ${receipt.commandId},
          ${receipt.aggregateKind},
          ${receipt.aggregateId},
          ${receipt.commandType},
          ${receipt.acceptedAt},
          ${receipt.resultSequence},
          ${receipt.status},
          ${receipt.error},
          ${receipt.payloadDigest ?? null}
        )
        ON CONFLICT (command_id)
        DO UPDATE SET
          aggregate_kind = excluded.aggregate_kind,
            aggregate_id = excluded.aggregate_id,
            command_type = excluded.command_type,
          accepted_at = excluded.accepted_at,
          result_sequence = excluded.result_sequence,
          status = excluded.status,
          error = excluded.error,
          payload_digest = excluded.payload_digest
      `,
  });

  const findReceiptByCommandId = SqlSchema.findOneOption({
    Request: GetByCommandIdInput,
    Result: OrchestrationCommandReceipt,
    execute: ({ commandId }) =>
      sql`
        SELECT
          command_id AS "commandId",
          aggregate_kind AS "aggregateKind",
          aggregate_id AS "aggregateId",
          command_type AS "commandType",
          accepted_at AS "acceptedAt",
          result_sequence AS "resultSequence",
          status,
          error,
          payload_digest AS "payloadDigest"
        FROM orchestration_command_receipts
        WHERE command_id = ${commandId}
      `,
  });

  const upsert: OrchestrationCommandReceiptRepository["Service"]["upsert"] = (receipt) =>
    upsertReceiptRow(receipt).pipe(
      Effect.mapError(toPersistenceSqlError("OrchestrationCommandReceiptRepository.upsert:query")),
    );

  const insertIfAbsent: OrchestrationCommandReceiptRepository["Service"]["insertIfAbsent"] = (
    receipt,
  ) =>
    sql<{ readonly command_id: string }>`
      INSERT INTO orchestration_command_receipts (
        command_id,
        aggregate_kind,
        aggregate_id,
        command_type,
        accepted_at,
        result_sequence,
        status,
        error,
        payload_digest
      )
      VALUES (
        ${receipt.commandId},
        ${receipt.aggregateKind},
        ${receipt.aggregateId},
        ${receipt.commandType},
        ${receipt.acceptedAt},
        ${receipt.resultSequence},
        ${receipt.status},
        ${receipt.error},
        ${receipt.payloadDigest ?? null}
      )
      ON CONFLICT(command_id) DO NOTHING
      RETURNING command_id
    `.pipe(
      Effect.mapError(
        toPersistenceSqlError("OrchestrationCommandReceiptRepository.insertIfAbsent:query"),
      ),
      Effect.flatMap((rows) => {
        if (rows.length === 1) return Effect.succeed(true);
        // The read-back runs inside the caller's transaction, so the row it sees is
        // the committed winner. Only two defined digests that differ prove different
        // content; a NULL digest (pre-migration row, or a caller that carries none)
        // still replays.
        return sql<{ readonly payload_digest: string | null }>`
          SELECT payload_digest
          FROM orchestration_command_receipts
          WHERE command_id = ${receipt.commandId}
        `.pipe(
          Effect.mapError(
            toPersistenceSqlError("OrchestrationCommandReceiptRepository.insertIfAbsent:readback"),
          ),
          Effect.flatMap(([stored]) =>
            stored?.payload_digest != null &&
            receipt.payloadDigest != null &&
            stored.payload_digest !== receipt.payloadDigest
              ? Effect.fail(
                  new OrchestrationCommandReceiptConflictError({ commandId: receipt.commandId }),
                )
              : Effect.succeed(false),
          ),
        );
      }),
    );

  const getByCommandId: OrchestrationCommandReceiptRepository["Service"]["getByCommandId"] = (
    input,
  ) =>
    findReceiptByCommandId(input).pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(
        toPersistenceSqlError("OrchestrationCommandReceiptRepository.getByCommandId:query"),
      ),
    );

  return {
    insertIfAbsent,
    upsert,
    getByCommandId,
  } satisfies OrchestrationCommandReceiptRepository["Service"];
});

export const layer = Layer.effect(
  OrchestrationCommandReceiptRepository,
  makeOrchestrationCommandReceiptRepository,
);
