import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("070_CommandReceiptPayloadDigest", (it) => {
  it.effect("keeps pre-digest receipts readable and lets new rows carry a digest", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 69 });
      // The pre-070 receipt shape: no payload digest exists yet.
      yield* sql`
        INSERT INTO orchestration_command_receipts (
          command_id, aggregate_kind, aggregate_id, command_type, accepted_at,
          result_sequence, status, error
        ) VALUES (
          'command:pre-digest', 'thread', 'thread:pre-digest', 'legacy.thread', '2026-11-11T00:00:00.000Z',
          1, 'accepted', NULL
        )
      `;

      yield* runMigrations();

      const rows = yield* sql<{ readonly payload_digest: string | null }>`
        SELECT payload_digest FROM orchestration_command_receipts
        WHERE command_id = 'command:pre-digest'
      `;
      assert.deepEqual(rows, [{ payload_digest: null }]);
      yield* sql`
        INSERT INTO orchestration_command_receipts (
          command_id, aggregate_kind, aggregate_id, command_type, accepted_at,
          result_sequence, status, error, payload_digest
        ) VALUES (
          'command:with-digest', 'thread', 'thread:with-digest', 'new.thread', '2026-11-11T00:00:01.000Z',
          1, 'accepted', NULL, 'digest:new-payload'
        )
      `;
      const digested = yield* sql<{ readonly payload_digest: string }>`
        SELECT payload_digest FROM orchestration_command_receipts
        WHERE command_id = 'command:with-digest'
      `;
      assert.deepEqual(digested, [{ payload_digest: "digest:new-payload" }]);
    }),
  );
});
