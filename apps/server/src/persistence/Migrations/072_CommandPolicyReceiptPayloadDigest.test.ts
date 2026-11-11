import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("072_CommandPolicyReceiptPayloadDigest", (it) => {
  it.effect("adds payload_digest when migration 71 has already been recorded", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 71 });
      yield* sql`
        INSERT INTO orchestration_command_policy_receipts (
          command_id, policy_id, policy_revision, policy_digest, route_id, decision
        ) VALUES (
          'command:pre-digest', 'policy-ic03', 1, 'digest-ic03', 'route-a', 'accepted'
        )
      `;

      yield* runMigrations();

      const rows = yield* sql<{ readonly payload_digest: string | null }>`
        SELECT payload_digest FROM orchestration_command_policy_receipts
        WHERE command_id = 'command:pre-digest'
      `;
      assert.deepEqual(rows, [{ payload_digest: null }]);
    }),
  );
});
