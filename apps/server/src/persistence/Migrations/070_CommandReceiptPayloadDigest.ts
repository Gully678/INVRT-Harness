import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The command payload digest binds a receipt to the content the sender sent.
 * Nullable: pre-migration rows keep a NULL digest and stay readable and
 * replayable; only two defined digests that differ conflict (IC-02 case g).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE orchestration_command_receipts
    ADD COLUMN payload_digest TEXT
  `;
});
