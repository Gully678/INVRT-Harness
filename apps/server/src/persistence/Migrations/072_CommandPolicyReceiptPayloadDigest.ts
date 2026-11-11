import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The policy receipt payload digest binds a managed command to the content
 * the sender sent. Nullable: a row created before this column stays readable
 * and replayable. Only two defined digests that differ conflict.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE orchestration_command_policy_receipts
    ADD COLUMN payload_digest TEXT
  `;
});
