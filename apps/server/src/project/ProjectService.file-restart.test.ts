import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { commandPayloadDigest } from "../orchestration-v2/CommandReceiptStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import * as ProjectService from "./ProjectService.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

const createdWorkspaceRoots: Array<string> = [];
const createGate: {
  holding: Deferred.Deferred<void> | undefined;
  release: Deferred.Deferred<void> | undefined;
} = { holding: undefined, release: undefined };

const layerWorkspacePaths = Layer.succeed(WorkspacePaths.WorkspacePaths, {
  normalizeWorkspaceRoot: (workspaceRoot, options) =>
    Effect.gen(function* () {
      const normalized = workspaceRoot.replace(/\/$/, "");
      if (options?.createIfMissing === true) {
        createdWorkspaceRoots.push(normalized);
        if (createGate.holding !== undefined && createGate.release !== undefined) {
          yield* Deferred.succeed(createGate.holding, undefined);
          yield* Deferred.await(createGate.release);
        }
      }
      return normalized;
    }),
  resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
    Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
});

const layerMetadata = Layer.merge(
  Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
    resolve: (workspaceRoot) =>
      Effect.succeed({
        canonicalKey: `github.com/t3tools/${workspaceRoot.split("/").at(-1)}`,
        locator: {
          source: "git-remote" as const,
          remoteName: "origin",
          remoteUrl: `git@github.com:t3tools/${workspaceRoot.split("/").at(-1)}.git`,
        },
        rootPath: workspaceRoot,
      }),
  }),
  Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
    invalidate: () => Effect.void,
    resolvePath: (workspaceRoot) => Effect.succeed(`${workspaceRoot}/favicon.svg`),
  }),
);

const layerFor = (dbPath: string) =>
  RuntimeLayer.layerProjectService.pipe(
    Layer.provideMerge(ProjectEnrichmentService.layer),
    Layer.provideMerge(layerWorkspacePaths),
    Layer.provideMerge(layerMetadata),
    Layer.provideMerge(SqlitePersistence.layerFromPath(dbPath)),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "project-file-restart-" })),
    Layer.provide(NodeServices.layer),
  );

it.effect("reopens a file database and keeps both receipt generations and a killed claim", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-restart-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const layer = layerFor(dbPath);
  const projectId = ProjectId.make("project:file-restart");
  const historicalCommandId = CommandId.make("command:file-restart:historical");
  const explicitCommandId = CommandId.make("command:file-restart:explicit");
  const reservedCommandId = CommandId.make("command:file-restart:reserved");
  const reservedProjectId = ProjectId.make("project:file-restart-reserved");
  const reservedRoot = "/work/file-restart-reserved";
  const reservedCommand = {
    type: "project.create" as const,
    commandId: reservedCommandId,
    projectId: reservedProjectId,
    title: "Reserved",
    workspaceRoot: reservedRoot,
  };

  const open = <A, E>(
    effect: Effect.Effect<A, E, ProjectService.ProjectService | SqlClient.SqlClient>,
  ) => effect.pipe(Effect.provide(layer));

  return Effect.gen(function* () {
    createdWorkspaceRoots.length = 0;
    yield* open(
      Effect.gen(function* () {
        const service = yield* ProjectService.ProjectService;
        const sql = yield* SqlClient.SqlClient;
        yield* service.create({
          commandId: CommandId.make("command:file-restart:create"),
          projectId,
          title: "File restart",
          workspaceRoot: "/work/file-restart",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "alpha",
          },
        });
        const historical = {
          commandId: historicalCommandId,
          projectId,
          workspaceRoot: "/work/file-restart",
        };
        yield* service.update(historical);
        const oldDigest = commandPayloadDigest({
          type: "project.meta.update",
          commandId: historicalCommandId,
          projectId,
        });
        yield* sql`UPDATE orchestration_command_receipts SET payload_digest = ${oldDigest} WHERE command_id = ${historicalCommandId}`;
        yield* sql`
            INSERT INTO orchestration_command_receipts (
              command_id,
              aggregate_kind,
              aggregate_id,
              command_type,
              accepted_at,
              result_sequence,
              status,
              error,
              payload_digest
            )
            VALUES (
              ${reservedCommandId},
              'project',
              ${reservedProjectId},
              ${reservedCommand.type},
              '2026-11-11T12:00:00.000Z',
              0,
              'accepted',
              NULL,
              ${commandPayloadDigest(reservedCommand)}
            )
          `;
      }),
    );

    yield* open(
      Effect.gen(function* () {
        const service = yield* ProjectService.ProjectService;
        const historicalReplay = yield* service.update({
          commandId: historicalCommandId,
          projectId,
          workspaceRoot: "/work/file-restart",
        });
        assert.equal(historicalReplay.workspaceRoot, "/work/file-restart");
        yield* service.update({
          commandId: explicitCommandId,
          projectId,
          workspaceRoot: "/work/file-restart-explicit",
        });
      }),
    );

    yield* open(
      Effect.gen(function* () {
        const service = yield* ProjectService.ProjectService;
        const sql = yield* SqlClient.SqlClient;
        const explicitReplay = yield* service.update({
          commandId: explicitCommandId,
          projectId,
          workspaceRoot: "/work/file-restart-explicit",
        });
        assert.equal(explicitReplay.workspaceRoot, "/work/file-restart-explicit");
        assert.deepEqual(
          Option.getOrThrow(yield* service.getById(projectId)).defaultModelSelection,
          { instanceId: ProviderInstanceId.make("codex"), model: "alpha" },
        );
        const resumed = yield* service.create({
          ...reservedCommand,
          createWorkspaceRootIfMissing: true,
        });
        assert.equal(resumed.workspaceRoot, reservedRoot);
        assert.deepEqual(createdWorkspaceRoots, [reservedRoot]);
        assert.lengthOf(
          yield* sql`SELECT sequence FROM orchestration_events WHERE command_id = ${reservedCommandId}`,
          1,
        );
        const changed = yield* service
          .create({
            ...reservedCommand,
            title: "Different",
            createWorkspaceRootIfMissing: true,
          })
          .pipe(Effect.flip);
        assert.instanceOf(changed, ProjectService.ProjectOperationError);
        assert.deepEqual(createdWorkspaceRoots, [reservedRoot]);
        const moved = yield* service
          .update({
            commandId: historicalCommandId,
            projectId,
            workspaceRoot: "/work/file-restart-moved",
          })
          .pipe(Effect.flip);
        assert.instanceOf(moved, ProjectService.ProjectOperationError);
        assert.equal(
          Option.getOrThrow(yield* service.getById(projectId)).workspaceRoot,
          "/work/file-restart-explicit",
        );
      }),
    );
  }).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect(
  "a second database connection does not create a directory for an in-flight command",
  () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-two-conn-"));
    const dbPath = NodePath.join(tempDir, "state.sqlite");
    const layer = layerFor(dbPath);
    const projectId = ProjectId.make("project:two-conn");
    const commandId = CommandId.make("command:two-conn");
    const root = "/work/two-conn";
    return Effect.gen(function* () {
      createdWorkspaceRoots.length = 0;
      const holding = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      createGate.holding = holding;
      createGate.release = release;
      const first = yield* Effect.forkChild(
        Effect.gen(function* () {
          const service = yield* ProjectService.ProjectService;
          return yield* service.create({
            commandId,
            projectId,
            title: "First",
            workspaceRoot: root,
            createWorkspaceRootIfMissing: true,
          });
        }).pipe(Effect.provide(layer)),
      );
      yield* Deferred.await(holding);
      const second = yield* Effect.gen(function* () {
        const service = yield* ProjectService.ProjectService;
        return yield* service
          .create({
            commandId,
            projectId,
            title: "Second",
            workspaceRoot: "/work/two-conn-other",
            createWorkspaceRootIfMissing: true,
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(layer));
      assert.instanceOf(second, ProjectService.ProjectOperationError);
      assert.deepEqual(createdWorkspaceRoots, [root]);
      yield* Deferred.succeed(release, undefined);
      const created = yield* Fiber.join(first);
      assert.equal(created.workspaceRoot, root);
      assert.deepEqual(createdWorkspaceRoots, [root]);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          createGate.holding = undefined;
          createGate.release = undefined;
          NodeFS.rmSync(tempDir, { recursive: true, force: true });
        }),
      ),
    );
  },
);
