import {
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ProviderInstanceConfigMap,
} from "@t3tools/contracts";
import type { ProviderDriver, ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpServerRequest } from "effect/http";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as Registry from "./ProviderInstanceRegistry.ts";
import * as Authority from "./ForgeLocalPlanningAuthority.ts";

export const config = ServerConfig.layerTest(process.cwd(), { prefix: "invrt-forge-l0-" });
const storage = SqlitePersistence.layerMemory;
export const env = ServerEnvironment.layerIdentity.pipe(Layer.provide(config));
const auth = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(storage),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(env),
  Layer.provide(config),
);
export const id = ProviderInstanceId.make("codex");
export const projectId = ProjectId.make("forge-project");
export const request = { projectId, providerInstanceId: id, operationId: "prepare-1" };
export const blocked: string[] = [];
const denyEffect = (name: string) => {
  blocked.push(name);
  throw new Error(`unexpected provider effect: ${name}`);
};
// The fixture exposes metadata only. Every provider effect fails the test if accessed.
const instance = (enabled: boolean, account = "fixture-account-a"): ProviderInstance => ({
  instanceId: id,
  driverKind: ProviderDriverKind.make("codex"),
  enabled,
  displayName: undefined,
  continuationIdentity: {
    driverKind: ProviderDriverKind.make("codex"),
    continuationKey: "codex:instance:codex",
  },
  snapshot: {
    getSnapshot: Effect.succeed({
      instanceId: id,
      driver: ProviderDriverKind.make("codex"),
      enabled,
      installed: false,
      version: null,
      status: "ready",
      auth: { status: "unknown", profileId: account },
      checkedAt: "1970-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    }),
    resolveMaintenance: () => denyEffect("resolveMaintenance"),
    refresh: Effect.sync(() => denyEffect("snapshot.refresh")),
    streamChanges: Stream.empty,
    applyUsageLimits: () => denyEffect("applyUsageLimits"),
  },
  get orchestrationAdapter(): never {
    return denyEffect("orchestrationAdapter");
  },
  get textGeneration(): never {
    return denyEffect("textGeneration");
  },
  get auth(): never {
    return denyEffect("auth.access");
  },
  snapshotForCwd: () => denyEffect("snapshotForCwd"),
  refreshModels: () => denyEffect("refreshModels"),
});

export const driver: ProviderDriver<{ readonly account?: string }> = {
  driverKind: ProviderDriverKind.make("codex"),
  metadata: { displayName: "Metadata fixture" },
  configSchema: Schema.Struct({ account: Schema.optionalKey(Schema.String) }),
  defaultConfig: () => ({}),
  create: ({ enabled, config }: { enabled: boolean; config: { account?: string } }) =>
    Effect.succeed(instance(enabled, config.account)),
};
export const configs = (enabled = true): ProviderInstanceConfigMap => ({
  [id]: { driver: ProviderDriverKind.make("codex"), enabled, config: {} },
});
export const fixture = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projection_projects (project_id,title,workspace_root,scripts_json,created_at,updated_at) VALUES (${projectId},'FORGE',${"/Users/mac/Repos/.worktrees/invrt-code-20261030-donor"},'[]','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`;
  const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
  const pairing = yield* serverAuth.issuePairingCredential({
    scopes: ["orchestration:read", "orchestration:operate"],
  });
  const session = yield* serverAuth.createBrowserSession(pairing.credential, {
    deviceType: "desktop",
  });
  const sessions = yield* SessionStore.SessionStore;
  const current = yield* serverAuth.authenticateHttpRequest(
    HttpServerRequest.fromWeb(
      new Request("http://native-fixture.invalid/rpc", {
        headers: { cookie: `${sessions.cookieName}=${session.sessionToken}` },
      }),
    ),
  );
  const { registry, mutator } = yield* Registry.makeProviderInstanceRegistry({
    drivers: [driver],
    configMap: configs(),
  });
  const authority = yield* Authority.make.pipe(
    Effect.provideService(Registry.ProviderInstanceRegistry, registry),
  );
  return { sql, current, authority, mutator, registry, serverAuth, sessions };
});
export const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(Layer.mergeAll(auth, env, config)));
