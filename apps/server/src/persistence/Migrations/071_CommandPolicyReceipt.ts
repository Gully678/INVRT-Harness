import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * One policy decision per existing command id. Nullable policy fields are a
 * refusal that never resolved a revision. The decision is not a principal.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE orchestration_command_policy_receipts (
      command_id TEXT PRIMARY KEY,
      policy_id TEXT,
      policy_revision INTEGER,
      policy_digest TEXT,
      route_id TEXT,
      decision TEXT NOT NULL CHECK (
        decision IN ('admitted', 'accepted', 'refused', 'failed')
      )
    )
  `;
});
