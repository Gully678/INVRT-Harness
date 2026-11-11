// No organisation column exists on sessions or command receipts. This test pins
// session revocation at the websocket upgrade, then the RPC scope gate, then
// ProjectService. It does not invent a multi-organisation tenancy model.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ProjectId,
  WS_METHODS,
  WsRpcGroup,
  type ProjectMutation,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as ServerConfig from "../config.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import { projectMutationOperation } from "./ProjectMutation.ts";
import * as ProjectService from "./ProjectService.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

const group = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter((tag) => tag !== WS_METHODS.projectsMutate),
);

const createdRoots: string[] = [];

const workspacePaths = Layer.succeed(WorkspacePaths.WorkspacePaths, {
  normalizeWorkspaceRoot: (workspaceRoot, options) =>
    Effect.sync(() => {
      if (options?.createIfMissing === true) {
        createdRoots.push(workspaceRoot);
        NodeFS.mkdirSync(workspaceRoot, { recursive: true });
      }
      return workspaceRoot;
    }),
  resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
    Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
});

const layerMetadata = Layer.merge(
  Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
    resolve: () => Effect.succeed(null),
  }),
  Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
    invalidate: () => Effect.void,
    resolvePath: () => Effect.succeed(null),
  }),
);

const layerFor = (dbPath: string) =>
  Layer.mergeAll(
    RuntimeLayer.layerProjectService.pipe(
      Layer.provideMerge(ProjectEnrichmentService.layer),
      Layer.provideMerge(workspacePaths),
      Layer.provideMerge(layerMetadata),
    ),
    EnvironmentAuth.layer,
  ).pipe(
    Layer.provideMerge(SqlitePersistence.layerFromPath(dbPath)),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(ServerEnvironment.layerIdentity),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "project-session-revoke-" })),
    Layer.provide(NodeServices.layer),
  );

const upgradeRequest = (token: string) =>
  ({
    method: "GET",
    url: "/ws?orchestrationProtocol=2",
    cookies: {},
    headers: {
      host: "127.0.0.1:3773",
      authorization: `Bearer ${token}`,
    },
  }) as unknown as Parameters<
    EnvironmentAuth.EnvironmentAuth["Service"]["authenticateWebSocketUpgrade"]
  >[0];

const errorText = (cause: unknown): string => {
  const seen = new Set<unknown>();
  return JSON.stringify(cause, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
};

it.effect(
  "denies a revoked session retry before project effects and keeps the other session",
  () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-sessions-"));
    const dbPath = NodePath.join(tempDir, "state.sqlite");
    const rootA = NodePath.join(tempDir, "session-a");
    const rootB = NodePath.join(tempDir, "session-b");
    const refusedRoot = NodePath.join(tempDir, "session-a-retry");
    const layer = layerFor(dbPath);
    return Effect.gen(function* () {
      createdRoots.length = 0;
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const projects = yield* ProjectService.ProjectService;
      const handled: string[] = [];
      const sessionA = yield* serverAuth.issueSession({
        subject: "principal-alpha",
        label: "alpha-desk",
      });
      const sessionB = yield* serverAuth.issueSession({
        subject: "principal-bravo",
        label: "bravo-desk",
      });
      const mutate = (token: string, mutation: ProjectMutation) =>
        Effect.gen(function* () {
          const session = yield* serverAuth.authenticateWebSocketUpgrade(
            upgradeRequest(token),
            "rpc",
          );
          return yield* Effect.scoped(
            RpcTest.makeClient(group).pipe(
              Effect.provide(
                Layer.mergeAll(
                  group.toLayerHandler(WS_METHODS.projectsMutate, (input) =>
                    Effect.sync(() => {
                      handled.push(input.commandId);
                    }).pipe(Effect.andThen(projectMutationOperation(projects, input))),
                  ),
                  RpcAuthorization.layer(session.scopes),
                ),
              ),
              Effect.flatMap((client) => client[WS_METHODS.projectsMutate](mutation)),
            ),
          );
        });
      const mutationA: ProjectMutation = {
        type: "project.create",
        commandId: CommandId.make("command:session-a"),
        projectId: ProjectId.make("project:session-a"),
        title: "Session A",
        workspaceRoot: rootA,
        createWorkspaceRootIfMissing: true,
      };
      const mutationB: ProjectMutation = {
        type: "project.create",
        commandId: CommandId.make("command:session-b"),
        projectId: ProjectId.make("project:session-b"),
        title: "Session B",
        workspaceRoot: rootB,
        createWorkspaceRootIfMissing: true,
      };
      const createdA = yield* mutate(sessionA.token, mutationA);
      assert.equal(createdA.workspaceRoot, rootA);
      assert.equal(NodeFS.existsSync(rootA), true);
      assert.deepEqual(handled, [mutationA.commandId]);
      assert.equal(yield* serverAuth.revokeSession(sessionA.sessionId), true);

      const retryA: ProjectMutation = {
        type: "project.create",
        commandId: CommandId.make("command:session-a-retry"),
        projectId: ProjectId.make("project:session-a-retry"),
        title: "Session A retry",
        workspaceRoot: refusedRoot,
        createWorkspaceRootIfMissing: true,
      };
      const denied = yield* mutate(sessionA.token, retryA).pipe(Effect.flip);
      const deniedText = errorText(denied);
      assert.equal(denied._tag, "ServerAuthInvalidCredentialError");
      assert.notInclude(deniedText, sessionB.token);
      assert.notInclude(deniedText, sessionB.sessionId);
      assert.notInclude(deniedText, "principal-bravo");
      assert.notInclude(deniedText, "bravo-desk");
      assert.notInclude(deniedText, rootB);
      assert.equal(NodeFS.existsSync(refusedRoot), false);
      assert.deepEqual(createdRoots, [rootA]);
      assert.deepEqual(handled, [mutationA.commandId]);

      const replayDenied = yield* mutate(sessionA.token, mutationB).pipe(Effect.flip);
      const replayText = errorText(replayDenied);
      assert.equal(replayDenied._tag, "ServerAuthInvalidCredentialError");
      assert.notInclude(replayText, sessionB.token);
      assert.notInclude(replayText, sessionB.sessionId);
      assert.notInclude(replayText, rootB);
      assert.deepEqual(handled, [mutationA.commandId]);

      const createdB = yield* mutate(sessionB.token, mutationB);
      assert.equal(createdB.workspaceRoot, rootB);
      const replayedB = yield* mutate(sessionB.token, mutationB);
      assert.equal(replayedB.workspaceRoot, rootB);
      assert.equal(NodeFS.existsSync(rootB), true);
      assert.deepEqual(createdRoots, [rootA, rootB]);
      assert.deepEqual(handled, [mutationA.commandId, mutationB.commandId, mutationB.commandId]);
    }).pipe(
      Effect.provide(layer),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
    );
  },
);
