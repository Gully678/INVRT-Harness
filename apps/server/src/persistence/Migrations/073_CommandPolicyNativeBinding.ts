import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Existing rows have no atomic proof that the native receipt used their policy.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE orchestration_command_policy_receipts
    ADD COLUMN native_bound INTEGER NOT NULL DEFAULT 0 CHECK (native_bound IN (0, 1))`;
});
