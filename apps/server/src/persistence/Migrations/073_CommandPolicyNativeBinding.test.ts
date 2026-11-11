import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
layer("073_CommandPolicyNativeBinding", (it) => {
  it.effect("keeps pre-existing policy receipts explicitly unverified", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 72 });
      yield* sql`INSERT INTO orchestration_command_policy_receipts
        (command_id, policy_id, policy_revision, policy_digest, route_id, decision)
        VALUES ('legacy', 'policy', 1, 'digest', 'route', 'accepted')`;
      yield* runMigrations();
      const rows = yield* sql<{ readonly native_bound: number }>`
        SELECT native_bound FROM orchestration_command_policy_receipts WHERE command_id = 'legacy'`;
      assert.deepEqual(rows, [{ native_bound: 0 }]);
    }),
  );
});
