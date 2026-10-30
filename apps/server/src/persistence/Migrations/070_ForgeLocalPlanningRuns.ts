import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Additive private preparation storage. Roll back the candidate by leaving this
// table in place; dropping it would discard durable idempotency receipts.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE forge_local_planning_runs (
    run_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
    native_session_id TEXT NOT NULL, subject TEXT NOT NULL, session_method TEXT NOT NULL,
    environment_id TEXT NOT NULL, project_id TEXT NOT NULL, thread_id TEXT NOT NULL UNIQUE,
    provider_instance_id TEXT NOT NULL, provider_binding TEXT NOT NULL,
    project_binding TEXT NOT NULL, task_sha256 TEXT NOT NULL, manifest_sha256 TEXT NOT NULL,
    trust_revision INTEGER NOT NULL, source_revision TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0), expires_at TEXT NOT NULL,
    revoked_at TEXT, state TEXT NOT NULL CHECK (state IN ('prepared','held','starting','active','finished')),
    native_policy_id TEXT NOT NULL, native_qualification_digest TEXT,
    native_runtime_revision TEXT, hold_reason TEXT NOT NULL,
    start_operation_id TEXT UNIQUE,
    native_turn_held INTEGER NOT NULL CHECK (native_turn_held = 1)
  )`;
});
