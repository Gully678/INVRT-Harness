import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as Registry from "./ProviderInstanceRegistry.ts";
import * as Authority from "./ForgeLocalPlanningAuthority.ts";
import {
  config,
  env,
  id,
  projectId,
  request,
  blocked,
  driver,
  configs,
  fixture,
  run,
} from "./ForgeNativePlanning.test-support.ts";

it.layer(NodeServices.layer)("FORGE actual native auth and SQLite preparation", (it) => {
  it.effect("prepares and replays one durable reserved thread, holding every native effect", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        const first = yield* authority.begin(request, current);
        const replay = yield* authority.begin(request, current);
        expect(replay).toEqual(first);
        expect(first).toMatchObject({
          state: "prepared",
          nativeTurnHeld: true,
          binding: { humanVerified: false, buildAuthorised: false },
        });
        expect(yield* authority.revalidate(first.binding.runId, 1, current)).toEqual(first.binding);
        expect(
          yield* authority.start(
            { runId: first.binding.runId, revision: 1, operationId: "start-1" },
            current,
          ),
        ).toEqual(first);
        expect(yield* sql`SELECT run_id FROM forge_local_planning_runs`).toHaveLength(1);
        expect(yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`).toHaveLength(
          0,
        );
        expect(yield* sql`SELECT command_id FROM orchestration_v2_command_receipts`).toHaveLength(
          0,
        );
        expect(blocked).toEqual([]);
      }),
    ),
  );
  it.effect("same operation with changed provider conflicts before creating another run", () =>
    run(
      Effect.gen(function* () {
        const { current, authority } = yield* fixture;
        yield* authority.begin(request, current);
        const result = yield* authority
          .begin({ ...request, providerInstanceId: ProviderInstanceId.make("other") }, current)
          .pipe(Effect.result);
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { code: "idempotency_conflict" },
        });
      }),
    ),
  );
  it.effect("revalidates live revocation and scopes rather than the transport snapshot", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        const prepared = yield* authority.begin(request, current);
        yield* sql`UPDATE auth_sessions SET scopes = '["orchestration:read"]' WHERE session_id = ${current.sessionId}`;
        expect(
          yield* authority.revalidate(prepared.binding.runId, 1, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "forbidden" } });
        yield* sql`UPDATE auth_sessions SET revoked_at = '1970-01-01T00:00:00.000Z' WHERE session_id = ${current.sessionId}`;
        expect(
          yield* authority
            .start({ runId: prepared.binding.runId, revision: 1, operationId: "start" }, current)
            .pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "revoked" } });
      }),
    ),
  );
  it.effect("rejects stale revisions and deleted native project", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        const prepared = yield* authority.begin(request, current);
        expect(
          yield* authority.revalidate(prepared.binding.runId, 2, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "stale_revision" } });
        yield* sql`UPDATE projection_projects SET deleted_at = '2026-01-01T00:00:00.000Z' WHERE project_id = ${projectId}`;
        expect(
          yield* authority.revalidate(prepared.binding.runId, 1, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "wrong_binding" } });
      }),
    ),
  );
  it.effect("concurrent retries reserve one native run and one server thread", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        const results = yield* Effect.all(
          [authority.begin(request, current), authority.begin(request, current)],
          { concurrency: "unbounded" },
        );
        expect(results[0]).toEqual(results[1]);
        expect(yield* sql`SELECT run_id FROM forge_local_planning_runs`).toHaveLength(1);
      }),
    ),
  );
  it.effect("rejects another genuine native session without reading content", () =>
    run(
      Effect.gen(function* () {
        const { current, authority, serverAuth, sessions } = yield* fixture;
        const first = yield* authority.begin(request, current);
        const pairing = yield* serverAuth.issuePairingCredential({
          scopes: ["orchestration:operate"],
        });
        const issued = yield* serverAuth.createBrowserSession(pairing.credential, {
          deviceType: "desktop",
        });
        const other = yield* serverAuth.authenticateHttpRequest({
          cookies: { [sessions.cookieName]: issued.sessionToken },
          headers: {},
        } as Parameters<typeof serverAuth.authenticateHttpRequest>[0]);
        expect(
          yield* authority.revalidate(first.binding.runId, 1, other).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "wrong_binding" } });
        expect(yield* authority.begin(request, other).pipe(Effect.result)).toMatchObject({
          _tag: "Failure",
          failure: { code: "idempotency_conflict" },
        });
      }),
    ),
  );
  it.effect("invalidates changed provider account metadata and explicit disable", () =>
    run(
      Effect.gen(function* () {
        const { current, authority, mutator } = yield* fixture;
        const prepared = yield* authority.begin(request, current);
        yield* mutator.reconcile({
          [id]: {
            driver: ProviderDriverKind.make("codex"),
            enabled: true,
            config: { account: "fixture-account-b" },
          },
        });
        expect(
          yield* authority.revalidate(prepared.binding.runId, 1, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "wrong_binding" } });
        yield* mutator.reconcile(configs(false));
        expect(
          yield* authority
            .start({ runId: prepared.binding.runId, revision: 1, operationId: "start" }, current)
            .pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "wrong_binding" } });
      }),
    ),
  );
  it.effect.each([
    "source_revision",
    "manifest_sha256",
    "task_sha256",
    "native_policy_id",
  ] as const)("invalidates changed compiled %s binding", (column) =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        const prepared = yield* authority.begin(request, current);
        yield* sql`UPDATE forge_local_planning_runs SET ${sql(column)} = 'changed' WHERE run_id = ${prepared.binding.runId}`;
        expect(
          yield* authority.revalidate(prepared.binding.runId, 1, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "trust_mismatch" } });
      }),
    ),
  );
  it.effect("denies invalid dates and missing SQLite capability with redacted errors", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        yield* sql`UPDATE auth_sessions SET issued_at = 'invalid-date' WHERE session_id = ${current.sessionId}`;
        const malformed = yield* authority.begin(request, current).pipe(Effect.result);
        expect(malformed).toMatchObject({
          _tag: "Failure",
          failure: { code: "capability_unavailable" },
        });
        expect(JSON.stringify(malformed)).not.toContain(process.cwd());
        yield* sql`DROP TABLE forge_local_planning_runs`;
        expect(
          yield* authority.revalidate("missing", 1, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "capability_unavailable" } });
      }),
    ),
  );
  it.effect("keeps wire JSON unbranded and rejects malformed begin before writes", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        const prepared = yield* authority.begin(request, current);
        expect(Authority.isLocalPlanningBinding(prepared.binding)).toBe(true);
        expect(Object.isFrozen(prepared.binding)).toBe(true);
        expect(Object.isFrozen(prepared.binding.allowedEffects)).toBe(true);
        expect(Authority.isLocalPlanningBinding(JSON.parse(JSON.stringify(prepared.binding)))).toBe(
          false,
        );
        expect(
          yield* authority.begin({ ...request, operationId: "" }, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "invalid_request" } });
        expect(yield* sql`SELECT run_id FROM forge_local_planning_runs`).toHaveLength(1);
      }),
    ),
  );

  it.effect("reconciles a lost post-commit acknowledgement using durable storage", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority, registry } = yield* fixture;
        const lost = yield* authority
          .begin(request, current)
          .pipe(Effect.andThen(Effect.fail("response_lost")), Effect.result);
        expect(lost).toMatchObject({ _tag: "Failure", failure: "response_lost" });
        const before = yield* sql<{
          run_id: string;
          thread_id: string;
        }>`SELECT run_id, thread_id FROM forge_local_planning_runs`;
        const restoredService = yield* Authority.make.pipe(
          Effect.provideService(Registry.ProviderInstanceRegistry, registry),
        );
        const retried = yield* restoredService.begin(request, current);
        expect(retried.binding.runId).toBe(before[0]?.run_id);
        expect(retried.binding.threadId).toBe(before[0]?.thread_id);
        const start = { runId: retried.binding.runId, revision: 1, operationId: "start-ack" };
        expect(yield* restoredService.start(start, current)).toEqual(
          yield* restoredService.start(start, current),
        );
        expect(
          yield* restoredService
            .start({ ...start, operationId: "changed-start" }, current)
            .pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "idempotency_conflict" } });
      }),
    ),
  );
  it.effect.each([
    ["expires_at", "1969-12-31T23:59:59.000Z", "expired"],
    ["issued_at", "2099-01-01T00:00:00.000Z", "unauthenticated"],
    ["method", "unsupported", "capability_unavailable"],
  ] as const)("denies native session %s", ([column, value, code]) =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        if (code === "expired")
          yield* sql`UPDATE auth_sessions SET issued_at = '1960-01-01T00:00:00.000Z' WHERE session_id = ${current.sessionId}`;
        yield* sql`UPDATE auth_sessions SET ${sql(column)} = ${value} WHERE session_id = ${current.sessionId}`;
        expect(yield* authority.begin(request, current).pipe(Effect.result)).toMatchObject({
          _tag: "Failure",
          failure: { code },
        });
        expect(yield* sql`SELECT run_id FROM forge_local_planning_runs`).toHaveLength(0);
      }),
    ),
  );
  it.effect.each(["mcp-client", "reusable-dev-token", "reusable-dev-token-child"])(
    "denies %s metadata even with operate scope",
    (subject) =>
      run(
        Effect.gen(function* () {
          const { sql, current, authority } = yield* fixture;
          yield* sql`UPDATE auth_sessions SET subject = ${subject} WHERE session_id = ${current.sessionId}`;
          expect(
            yield* authority.begin(request, { ...current, subject }).pipe(Effect.result),
          ).toMatchObject({ _tag: "Failure", failure: { code: "forbidden" } });
          expect(blocked).toEqual([]);
        }),
      ),
  );

  it.effect("rejects a reserved thread claimed by another native operation", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        const prepared = yield* authority.begin(request, current);
        yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES (${prepared.binding.threadId},${projectId},'Other native operation','codex','approval-required','plan','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','{}')`;
        expect(
          yield* authority.revalidate(prepared.binding.runId, 1, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "wrong_binding" } });
      }),
    ),
  );
  it.effect(
    "invalidates reconfigured native provider even when account metadata is unchanged",
    () =>
      run(
        Effect.gen(function* () {
          const { current, authority, mutator } = yield* fixture;
          const prepared = yield* authority.begin(request, current);
          yield* mutator.reconcile({
            [id]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              config: { launchMarker: "changed" },
            },
          });
          expect(
            yield* authority.revalidate(prepared.binding.runId, 1, current).pipe(Effect.result),
          ).toMatchObject({ _tag: "Failure", failure: { code: "wrong_binding" } });
        }),
      ),
  );

  it.effect("does not promote a persisted self-approved native qualification", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        const prepared = yield* authority.begin(request, current);
        yield* sql`UPDATE forge_local_planning_runs SET native_qualification_digest = 'self-approved' WHERE run_id = ${prepared.binding.runId}`;
        expect(
          yield* authority
            .start(
              { runId: prepared.binding.runId, revision: 1, operationId: "self-admit" },
              current,
            )
            .pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "wrong_binding" } });
        expect(blocked).toEqual([]);
      }),
    ),
  );
  it.effect("revalidates live run revocation and compiled trust revision", () =>
    run(
      Effect.gen(function* () {
        const { sql, current, authority } = yield* fixture;
        const prepared = yield* authority.begin(request, current);
        yield* sql`UPDATE forge_local_planning_runs SET trust_revision = 2 WHERE run_id = ${prepared.binding.runId}`;
        expect(
          yield* authority.revalidate(prepared.binding.runId, 1, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "trust_mismatch" } });
        yield* sql`UPDATE forge_local_planning_runs SET revoked_at = '1970-01-01T00:00:00.000Z' WHERE run_id = ${prepared.binding.runId}`;
        expect(
          yield* authority.revalidate(prepared.binding.runId, 1, current).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "revoked" } });
      }),
    ),
  );
  it.effect("persists held run and reservation across closing and reopening native SQLite", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "invrt-forge-l0-sqlite-" });
      const db = path.join(directory, "planning.sqlite");
      const fileAuth = () =>
        EnvironmentAuth.layer.pipe(
          Layer.provideMerge(SqlitePersistence.layerFromPath(db)),
          Layer.provide(ServerSecretStore.layer),
        );
      const saved = yield* Effect.gen(function* () {
        const { current, authority } = yield* fixture;
        const prepared = yield* authority.begin(request, current);
        return { prepared, current };
      }).pipe(Effect.provide(fileAuth()), Effect.scoped);
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          run_id: string;
          thread_id: string;
          native_turn_held: number;
        }>`SELECT run_id,thread_id,native_turn_held FROM forge_local_planning_runs`;
        expect(rows).toEqual([
          {
            run_id: saved.prepared.binding.runId,
            thread_id: saved.prepared.binding.threadId,
            native_turn_held: 1,
          },
        ]);
        const { registry } = yield* Registry.makeProviderInstanceRegistry({
          drivers: [driver],
          configMap: configs(),
        });
        const restored = yield* Authority.make.pipe(
          Effect.provideService(Registry.ProviderInstanceRegistry, registry),
        );
        expect(
          yield* restored
            .revalidate(saved.prepared.binding.runId, 1, saved.current)
            .pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "wrong_binding" } });
        expect(blocked).toEqual([]);
      }).pipe(Effect.provide(fileAuth()), Effect.scoped);
    }).pipe(Effect.provide(Layer.mergeAll(env, config))),
  );
});
