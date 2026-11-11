// @effect-diagnostics nodeBuiltinImport:off - the sqlite path is created before the layer exists
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Data from "effect/Data";
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
import { projectRaceLayer, type ProcessRaceConfig } from "./projectProcessRaceChild.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

const createdWorkspaceRoots: Array<string> = [];
const createGate: {
  holding: Deferred.Deferred<void> | undefined;
  release: Deferred.Deferred<void> | undefined;
  failCreate: boolean;
} = { holding: undefined, release: undefined, failCreate: false };

const layerWorkspacePaths = Layer.succeed(WorkspacePaths.WorkspacePaths, {
  normalizeWorkspaceRoot: (workspaceRoot, options) =>
    Effect.gen(function* () {
      const normalized = workspaceRoot.replace(/\/$/, "");
      if (options?.createIfMissing === true) {
        if (!createGate.failCreate) {
          createdWorkspaceRoots.push(normalized);
        }
        if (createGate.holding !== undefined && createGate.release !== undefined) {
          yield* Deferred.succeed(createGate.holding, undefined);
          yield* Deferred.await(createGate.release);
        }
        if (createGate.failCreate) {
          return yield* new WorkspacePaths.WorkspaceRootCreateFailedError({
            workspaceRoot,
            normalizedWorkspaceRoot: normalized,
            cause: "mkdir failed",
          });
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

const layerFor = (dbPath: string, workspacePaths = layerWorkspacePaths) =>
  RuntimeLayer.layerProjectService.pipe(
    Layer.provideMerge(ProjectEnrichmentService.layer),
    Layer.provideMerge(workspacePaths),
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
      const winner = yield* Layer.build(layer);
      const other = yield* Layer.build(layer);
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
        }).pipe(Effect.provide(winner)),
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
      }).pipe(Effect.provide(other));
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

it.effect("two connections commit one directory for the same create command", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-same-conn-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const layer = layerFor(dbPath);
  const projectId = ProjectId.make("project:two-conn-same");
  const commandId = CommandId.make("command:two-conn-same");
  const root = "/work/two-conn-same";
  const create = Effect.gen(function* () {
    const service = yield* ProjectService.ProjectService;
    return yield* service.create({
      commandId,
      projectId,
      title: "Same",
      workspaceRoot: root,
      createWorkspaceRootIfMissing: true,
    });
  }).pipe(Effect.provide(layer));
  return Effect.gen(function* () {
    createdWorkspaceRoots.length = 0;
    createGate.holding = undefined;
    createGate.release = undefined;
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`SELECT 1`;
    }).pipe(Effect.provide(layer));
    const [first, second] = yield* Effect.all([create, create], { concurrency: 2 });
    assert.equal(first.workspaceRoot, root);
    assert.equal(second.workspaceRoot, root);
    assert.deepEqual(createdWorkspaceRoots, [root]);
    const events = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM orchestration_events WHERE command_id = ${commandId}
      `;
    }).pipe(Effect.provide(layer));
    assert.equal(events[0]?.n, 1);
  }).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect(
  "a same-payload create commits no event while the directory is still being created",
  () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-same-held-"));
    const dbPath = NodePath.join(tempDir, "state.sqlite");
    const layer = layerFor(dbPath);
    const projectId = ProjectId.make("project:same-held");
    const commandId = CommandId.make("command:same-held");
    const root = "/work/same-held";
    const create = Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      return yield* service.create({
        commandId,
        projectId,
        title: "Same",
        workspaceRoot: root,
        createWorkspaceRootIfMissing: true,
      });
    });
    const observed = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [receipt] = yield* sql<{
        readonly resultSequence: number;
        readonly error: string | null;
      }>`
        SELECT result_sequence AS "resultSequence", error
        FROM orchestration_command_receipts
        WHERE command_id = ${commandId}
      `;
      const [events] = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM orchestration_events WHERE command_id = ${commandId}
      `;
      return { receipt, events: events?.n };
    });
    return Effect.gen(function* () {
      createdWorkspaceRoots.length = 0;
      createGate.failCreate = false;
      const winner = yield* Layer.build(layer);
      const loser = yield* Layer.build(layer);
      const reader = yield* Layer.build(layer);
      const holding = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      createGate.holding = holding;
      createGate.release = release;
      const first = yield* Effect.forkChild(create.pipe(Effect.provide(winner)));
      yield* Deferred.await(holding);
      const during = yield* observed.pipe(Effect.provide(reader));
      assert.ok(during.receipt);
      assert.strictEqual(during.receipt.resultSequence, 0);
      assert.strictEqual(during.receipt.error, null);
      assert.strictEqual(during.events, 0);
      const second = yield* Effect.forkChild(create.pipe(Effect.provide(loser)));
      yield* Deferred.succeed(release, undefined);
      const created = yield* Fiber.join(first);
      const replayed = yield* Fiber.join(second);
      assert.equal(created.workspaceRoot, root);
      assert.equal(replayed.workspaceRoot, root);
      assert.deepEqual(createdWorkspaceRoots, [root]);
      const after = yield* observed.pipe(Effect.provide(reader));
      assert.strictEqual(after.events, 1);
      assert.ok(after.receipt);
      assert.strictEqual(after.receipt.error, null);
      assert.notStrictEqual(after.receipt.resultSequence, 0);
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (createGate.release !== undefined) {
            yield* Deferred.succeed(createGate.release, undefined).pipe(Effect.ignore);
          }
          createGate.holding = undefined;
          createGate.release = undefined;
          createGate.failCreate = false;
          NodeFS.rmSync(tempDir, { recursive: true, force: true });
        }),
      ),
    );
  },
);

it.effect("a failed create-if-missing leaves no finished receipt without a directory", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-mkdir-fail-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const layer = layerFor(dbPath);
  const projectId = ProjectId.make("project:mkdir-fail");
  const commandId = CommandId.make("command:mkdir-fail");
  const root = "/work/mkdir-fail";
  return Effect.gen(function* () {
    createdWorkspaceRoots.length = 0;
    createGate.failCreate = true;
    const winner = yield* Layer.build(layer);
    const reader = yield* Layer.build(layer);
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
          title: "Missing",
          workspaceRoot: root,
          createWorkspaceRootIfMissing: true,
        });
      }).pipe(Effect.provide(winner)),
    );
    yield* Deferred.await(holding);
    const during = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM orchestration_events WHERE command_id = ${commandId}
      `;
    }).pipe(Effect.provide(reader));
    assert.equal(during[0]?.n, 0);
    yield* Deferred.succeed(release, undefined);
    const failed = yield* Fiber.join(first).pipe(Effect.flip);
    assert.instanceOf(failed, ProjectService.ProjectOperationError);
    assert.deepEqual(createdWorkspaceRoots, []);
    const after = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const events = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM orchestration_events WHERE command_id = ${commandId}
      `;
      const finished = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n
        FROM orchestration_command_receipts
        WHERE command_id = ${commandId}
          AND status = 'accepted'
          AND result_sequence != 0
      `;
      return { events: events[0]?.n, finished: finished[0]?.n };
    }).pipe(Effect.provide(reader));
    assert.equal(after.events, 0);
    assert.equal(after.finished, 0);
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        if (createGate.release !== undefined) {
          yield* Deferred.succeed(createGate.release, undefined).pipe(Effect.ignore);
        }
        createGate.holding = undefined;
        createGate.release = undefined;
        createGate.failCreate = false;
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
    ),
  );
});

const deadPidCandidates = [
  2_000_001, 2_000_002, 2_000_003, 2_000_004, 2_000_005, 2_000_006, 2_000_007, 2_000_008,
] as const;

const killErrorCode = (pid: number): string | undefined => {
  try {
    process.kill(pid, 0);
    return undefined;
  } catch (cause) {
    return typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      typeof cause.code === "string"
      ? cause.code
      : undefined;
  }
};

const insertAcceptedSequenceZero = (
  command: {
    readonly type: "project.create";
    readonly commandId: CommandId;
    readonly projectId: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
  },
  error: string,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
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
        ${command.commandId},
        'project',
        ${command.projectId},
        ${command.type},
        '2026-11-11T12:00:00.000Z',
        0,
        'accepted',
        ${error},
        ${commandPayloadDigest(command)}
      )
    `;
  });

it.effect("a dead mkdir pid is claimed and commits one directory", () => {
  const deadPid = deadPidCandidates.find((pid) => killErrorCode(pid) === "ESRCH");
  if (deadPid === undefined) {
    throw new Error("no dead pid in the candidate list");
  }
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-dead-pid-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const layer = layerFor(dbPath);
  const command = {
    type: "project.create" as const,
    commandId: CommandId.make("command:dead-pid"),
    projectId: ProjectId.make("project:dead-pid"),
    title: "Dead pid",
    workspaceRoot: "/work/dead-pid",
  };
  return Effect.gen(function* () {
    createdWorkspaceRoots.length = 0;
    createGate.holding = undefined;
    createGate.release = undefined;
    createGate.failCreate = false;
    yield* insertAcceptedSequenceZero(command, `mkdir:${deadPid}`).pipe(Effect.provide(layer));
    const created = yield* Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      return yield* service.create({
        ...command,
        createWorkspaceRootIfMissing: true,
      });
    }).pipe(Effect.provide(layer));
    assert.equal(created.workspaceRoot, command.workspaceRoot);
    assert.deepEqual(createdWorkspaceRoots, [command.workspaceRoot]);
    const after = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [events] = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM orchestration_events WHERE command_id = ${command.commandId}
      `;
      const [receipt] = yield* sql<{
        readonly error: string | null;
        readonly resultSequence: number;
      }>`
        SELECT error, result_sequence AS "resultSequence"
        FROM orchestration_command_receipts
        WHERE command_id = ${command.commandId}
      `;
      return { events: events?.n, receipt };
    }).pipe(Effect.provide(layer));
    assert.strictEqual(after.events, 1);
    assert.ok(after.receipt);
    assert.strictEqual(after.receipt.error, null);
    assert.notStrictEqual(after.receipt.resultSequence, 0);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        createGate.holding = undefined;
        createGate.release = undefined;
        createGate.failCreate = false;
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
    ),
  );
});

it.effect("a live other mkdir pid does not create a directory", () => {
  let liveOtherPid: number | undefined;
  try {
    process.kill(process.ppid, 0);
    liveOtherPid = process.ppid;
  } catch (cause) {
    throw new Error(`process.ppid ${process.ppid} is not signalable`, { cause });
  }
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-live-pid-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const layer = layerFor(dbPath);
  const command = {
    type: "project.create" as const,
    commandId: CommandId.make("command:live-pid"),
    projectId: ProjectId.make("project:live-pid"),
    title: "Live pid",
    workspaceRoot: "/work/live-pid",
  };
  return Effect.gen(function* () {
    createdWorkspaceRoots.length = 0;
    createGate.holding = undefined;
    createGate.release = undefined;
    createGate.failCreate = false;
    yield* insertAcceptedSequenceZero(command, `mkdir:${liveOtherPid}`).pipe(Effect.provide(layer));
    const failed = yield* Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      return yield* service.create({
        ...command,
        createWorkspaceRootIfMissing: true,
      });
    }).pipe(Effect.provide(layer), Effect.flip);
    assert.instanceOf(failed, ProjectService.ProjectOperationError);
    assert.deepEqual(createdWorkspaceRoots, []);
    const finished = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n
        FROM orchestration_command_receipts
        WHERE command_id = ${command.commandId}
          AND result_sequence != 0
      `;
      return row?.n;
    }).pipe(Effect.provide(layer));
    assert.strictEqual(finished, 0);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        createGate.holding = undefined;
        createGate.release = undefined;
        createGate.failCreate = false;
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
    ),
  );
});

const realWorkspacePaths = (roots: string[]) =>
  Layer.succeed(WorkspacePaths.WorkspacePaths, {
    normalizeWorkspaceRoot: (root, options) =>
      Effect.sync(() => {
        if (options?.createIfMissing) {
          roots.push(root);
          NodeFS.mkdirSync(root, { recursive: true });
        }
        return root;
      }),
    resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
      Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
  });

it.effect("rejects a duplicate project id before creating another real root", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-refusal-"));
  const existingRoot = NodePath.join(tempDir, "existing");
  const refusedRoot = NodePath.join(tempDir, "refused");
  NodeFS.mkdirSync(existingRoot);
  const roots: string[] = [];
  const realPaths = realWorkspacePaths(roots);
  const projectId = ProjectId.make("project:duplicate-root");
  const layer = layerFor(NodePath.join(tempDir, "state.sqlite"), realPaths);
  return Effect.gen(function* () {
    const service = yield* ProjectService.ProjectService;
    const sql = yield* SqlClient.SqlClient;
    const lawful = {
      commandId: CommandId.make("command:duplicate-root:lawful"),
      projectId,
      title: "Existing",
      workspaceRoot: existingRoot,
      createWorkspaceRootIfMissing: true,
    };
    yield* service.create(lawful);
    const before = yield* sql`SELECT sequence FROM orchestration_events`;
    const refused = {
      ...lawful,
      commandId: CommandId.make("command:duplicate-root:refused"),
      workspaceRoot: refusedRoot,
    };
    assert.instanceOf(
      yield* service.create(refused).pipe(Effect.flip),
      ProjectService.ProjectOperationError,
    );
    assert.equal(NodeFS.existsSync(refusedRoot), false);
    assert.deepEqual(roots, [existingRoot]);
    assert.deepEqual(yield* sql`SELECT sequence FROM orchestration_events`, before);
    assert.equal(Option.getOrThrow(yield* service.getById(projectId)).workspaceRoot, existingRoot);
    yield* service.create(lawful);
    assert.deepEqual(roots, [existingRoot]);
    assert.deepEqual(yield* sql`SELECT sequence FROM orchestration_events`, before);
  }).pipe(
    Effect.provide(layer),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

it.effect("two connections with different keys create only one real root for a project", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-root-race-"));
  const roots: string[] = [];
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const layer = layerFor(dbPath, realWorkspacePaths(roots));
  const projectId = ProjectId.make("project:root-race");
  return Effect.gen(function* () {
    // Migrate before opening the competing connections.
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`SELECT 1`;
    }).pipe(Effect.provide(layer));
    const create = (key: string) =>
      Effect.gen(function* () {
        const service = yield* ProjectService.ProjectService;
        return yield* service
          .create({
            commandId: CommandId.make(key),
            projectId,
            title: key,
            workspaceRoot: NodePath.join(tempDir, key),
            createWorkspaceRootIfMissing: true,
          })
          .pipe(Effect.result);
      }).pipe(Effect.provide(layer));
    const results = yield* Effect.all([create("first"), create("second")], { concurrency: 2 });
    assert.lengthOf(
      results.filter((result) => result._tag === "Success"),
      1,
    );
    assert.lengthOf(
      results.filter((result) => result._tag === "Failure"),
      1,
    );
    assert.lengthOf(roots, 1);
    assert.equal(
      Number(NodeFS.existsSync(NodePath.join(tempDir, "first"))) +
        Number(NodeFS.existsSync(NodePath.join(tempDir, "second"))),
      1,
    );
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* ProjectService.ProjectService;
      assert.lengthOf(yield* sql`SELECT sequence FROM orchestration_events`, 1);
      assert.equal(Option.getOrThrow(yield* service.getById(projectId)).workspaceRoot, roots[0]);
    }).pipe(Effect.provide(layer));
  }).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

const eventSequences = (commandId: CommandId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql<{ readonly sequence: number }>`
      SELECT sequence FROM orchestration_events WHERE command_id = ${commandId} ORDER BY sequence
    `;
  });

it.effect(
  "reopens a file database for an omitted root, a historical no-op, a conflicting root and a real move",
  () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-restore-"));
    const dbPath = NodePath.join(tempDir, "state.sqlite");
    const layer = layerFor(dbPath);
    const projectId = ProjectId.make("project:restore-roots");
    const root = "/work/ic02-restore";
    const omittedId = CommandId.make("command:restore:omitted");
    const explicitId = CommandId.make("command:restore:explicit");
    const historicalId = CommandId.make("command:restore:historical");
    const moveId = CommandId.make("command:restore:move");
    const open = <A, E>(
      effect: Effect.Effect<A, E, ProjectService.ProjectService | SqlClient.SqlClient>,
    ) => effect.pipe(Effect.provide(layer));
    return Effect.gen(function* () {
      createGate.holding = undefined;
      createGate.release = undefined;
      createGate.failCreate = false;
      yield* open(
        Effect.gen(function* () {
          const service = yield* ProjectService.ProjectService;
          const sql = yield* SqlClient.SqlClient;
          yield* service.create({
            commandId: CommandId.make("command:restore:create"),
            projectId,
            title: "Restore",
            workspaceRoot: root,
          });
          yield* service.update({ commandId: omittedId, projectId, title: "Omitted" });
          yield* service.update({ commandId: explicitId, projectId, workspaceRoot: root });
          yield* service.update({ commandId: historicalId, projectId, workspaceRoot: root });
          const historicalDigest = commandPayloadDigest({
            type: "project.meta.update",
            commandId: historicalId,
            projectId,
          });
          yield* sql`
            UPDATE orchestration_command_receipts
            SET payload_digest = ${historicalDigest}
            WHERE command_id = ${historicalId}
          `;
        }),
      );

      yield* open(
        Effect.gen(function* () {
          const service = yield* ProjectService.ProjectService;
          const omitted = yield* service.update({
            commandId: omittedId,
            projectId,
            title: "Omitted",
          });
          assert.equal(omitted.workspaceRoot, root);
          assert.equal(omitted.title, "Omitted");
          assert.lengthOf(yield* eventSequences(omittedId), 1);
          const explicit = yield* service.update({
            commandId: explicitId,
            projectId,
            workspaceRoot: root,
          });
          assert.equal(explicit.workspaceRoot, root);
          assert.lengthOf(yield* eventSequences(explicitId), 1);
          const historical = yield* service.update({
            commandId: historicalId,
            projectId,
            workspaceRoot: root,
          });
          assert.equal(historical.workspaceRoot, root);
          assert.lengthOf(yield* eventSequences(historicalId), 1);
          const beforeConflict = yield* eventSequences(historicalId);
          const allBefore = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql`SELECT sequence FROM orchestration_events ORDER BY sequence`;
          });
          const changed = yield* service
            .update({
              commandId: historicalId,
              projectId,
              workspaceRoot: "/work/ic02-restore-changed",
            })
            .pipe(Effect.flip);
          assert.instanceOf(changed, ProjectService.ProjectOperationError);
          assert.deepEqual(yield* eventSequences(historicalId), beforeConflict);
          assert.deepEqual(
            yield* Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              return yield* sql`SELECT sequence FROM orchestration_events ORDER BY sequence`;
            }),
            allBefore,
          );
          assert.equal(Option.getOrThrow(yield* service.getById(projectId)).workspaceRoot, root);
          const moved = yield* service.update({
            commandId: moveId,
            projectId,
            workspaceRoot: "/work/ic02-restore-moved",
          });
          assert.equal(moved.workspaceRoot, "/work/ic02-restore-moved");
          assert.lengthOf(yield* eventSequences(moveId), 1);
          assert.equal(
            Option.getOrThrow(yield* service.getById(projectId)).workspaceRoot,
            "/work/ic02-restore-moved",
          );
        }),
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          createGate.holding = undefined;
          createGate.release = undefined;
          createGate.failCreate = false;
          NodeFS.rmSync(tempDir, { recursive: true, force: true });
        }),
      ),
    );
  },
);

const raceChildEntry = NodeURL.fileURLToPath(
  new URL("./projectProcessRaceChild.ts", import.meta.url),
);

const raceChildEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST") || key.startsWith("VP_")) delete env[key];
  }
  return env;
};

const pause = (millis: number) =>
  Effect.sync(() => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, millis);
  });

const waitForPath = (path: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (NodeFS.existsSync(path)) return;
      yield* pause(50);
    }
    return yield* Effect.die(`Timed out waiting for ${path}`);
  });

class RaceChildSpawnError extends Data.TaggedError("RaceChildSpawnError")<{
  readonly cause: unknown;
}> {}

const spawnRaceChild = (config: ProcessRaceConfig) => {
  const configPath = NodePath.join(NodePath.dirname(config.dbPath), `${config.role}.json`);
  NodeFS.writeFileSync(configPath, JSON.stringify(config));
  const child = NodeChildProcess.spawn(process.execPath, [raceChildEntry, configPath], {
    env: raceChildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const completion = new Promise<
    | {
        readonly _tag: "exit";
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
        readonly stderr: string;
      }
    | { readonly _tag: "error"; readonly error: Error }
  >((resolve) => {
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      resolve(
        spawnError === undefined
          ? { _tag: "exit", code, signal, stderr }
          : { _tag: "error", error: spawnError },
      );
    });
  });
  const exited = Effect.tryPromise({
    try: () =>
      completion.then((result) => {
        if (result._tag === "error") throw result.error;
        return result;
      }),
    catch: (cause) => new RaceChildSpawnError({ cause }),
  });
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const stop = Effect.sync(kill).pipe(
    Effect.andThen(Effect.promise(() => completion)),
    Effect.asVoid,
  );

  return {
    child,
    exited,
    alive: () => child.exitCode === null && child.signalCode === null,
    kill,
    stop,
  };
};

it.effect("observes a child exit even when awaited after close", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-child-exit-"));
  return Effect.scoped(
    Effect.gen(function* () {
      const dbPath = NodePath.join(tempDir, "state.sqlite");
      NodeFS.mkdirSync(dbPath);
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawnRaceChild({
            role: "race-create",
            dbPath,
            resultPath: NodePath.join(tempDir, "result.json"),
            readyPath: NodePath.join(tempDir, "ready"),
            releasePath: NodePath.join(tempDir, "release"),
            commandId: "command:child-exit",
            projectId: "project:child-exit",
            title: "Child exit",
            workspaceRoot: NodePath.join(tempDir, "root"),
          }),
        ),
        (child) => child.stop,
      );
      yield* Effect.promise(
        () => new Promise<void>((resolve) => child.child.once("close", () => resolve())),
      );
      const result = yield* Effect.raceFirst(
        child.exited,
        Effect.yieldNow.pipe(Effect.as("missed" as const)),
      );
      if (result === "missed") return assert.fail("Child exit was not observed");
      assert.equal(result.code, 1);
    }),
  ).pipe(
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempDir, { recursive: true, force: true }))),
  );
});

const sqliteBusy = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const errcode = "errcode" in error ? Number(error.errcode) : Number.NaN;
  if (Number.isInteger(errcode) && (errcode & 0xff) === 5) return true;
  return error instanceof Error && error.message.includes("database is locked");
};

const writeLockIsBusy = (dbPath: string): boolean => {
  const db = new NodeSqlite.DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("BEGIN IMMEDIATE");
    db.exec("ROLLBACK");
    return false;
  } catch (error) {
    return sqliteBusy(error);
  } finally {
    db.close();
  }
};

const readRaceReceipt = (dbPath: string, commandId: string) => {
  const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT status, result_sequence AS resultSequence, error, payload_digest AS digest
         FROM orchestration_command_receipts WHERE command_id = ?`,
      )
      .get(commandId) as
      | {
          readonly status: string;
          readonly resultSequence: number;
          readonly error: string | null;
          readonly digest: string | null;
        }
      | undefined;
    const created = db
      .prepare(
        `SELECT COUNT(*) AS n FROM orchestration_events WHERE event_type = 'project.created'`,
      )
      .get() as { readonly n: number };
    const receipts = db
      .prepare(`SELECT COUNT(*) AS n FROM orchestration_command_receipts WHERE command_id = ?`)
      .get(commandId) as { readonly n: number };
    return { row, created: created.n, receipts: receipts.n };
  } finally {
    db.close();
  }
};

const migrateRaceDatabase = (dbPath: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`SELECT 1`;
  }).pipe(Effect.provide(projectRaceLayer(dbPath)));

const createdEventCount = (dbPath: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ readonly n: number }>`
      SELECT COUNT(*) AS n FROM orchestration_events WHERE event_type = 'project.created'
    `;
    return row?.n;
  }).pipe(Effect.provide(projectRaceLayer(dbPath)));

it.effect(
  "a second OS process observes the open write lock, then a different root conflicts",
  () => {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-os-race-"));
    const dbPath = NodePath.join(tempDir, "state.sqlite");
    const rootA = NodePath.join(tempDir, "root-a");
    const rootB = NodePath.join(tempDir, "root-b");
    const projectId = "project:os-race";
    const childConfig: ProcessRaceConfig = {
      role: "hold-create",
      dbPath,
      resultPath: NodePath.join(tempDir, "child-result.json"),
      readyPath: NodePath.join(tempDir, "ready"),
      releasePath: NodePath.join(tempDir, "release"),
      commandId: "command:os-race:a",
      projectId,
      title: "Root A",
      workspaceRoot: rootA,
    };
    const observerConfig: ProcessRaceConfig = {
      role: "lock-then-create",
      dbPath,
      resultPath: NodePath.join(tempDir, "observer-result.json"),
      readyPath: NodePath.join(tempDir, "observer-ready"),
      blockedPath: NodePath.join(tempDir, "blocked.json"),
      releasePath: childConfig.releasePath,
      commandId: "command:os-race:b",
      projectId,
      title: "Root B",
      workspaceRoot: rootB,
    };
    let stop: Effect.Effect<void> = Effect.void;
    return Effect.gen(function* () {
      yield* migrateRaceDatabase(dbPath);
      const child = spawnRaceChild(childConfig);
      stop = child.stop;
      yield* waitForPath(childConfig.readyPath);
      assert.equal(NodeFS.existsSync(rootA), false);
      assert.equal(NodeFS.existsSync(rootB), false);
      assert.equal(writeLockIsBusy(dbPath), true);
      const observer = spawnRaceChild(observerConfig);
      stop = Effect.all([child.stop, observer.stop], { concurrency: "unbounded", discard: true });
      yield* waitForPath(observerConfig.blockedPath ?? "");
      const blocked = JSON.parse(NodeFS.readFileSync(observerConfig.blockedPath ?? "", "utf8")) as {
        readonly busy: boolean;
      };
      assert.equal(blocked.busy, true);
      assert.equal(observer.alive(), true);
      assert.equal(NodeFS.existsSync(rootA), false);
      assert.equal(NodeFS.existsSync(rootB), false);
      NodeFS.writeFileSync(childConfig.releasePath, "go");
      const childExit = yield* child.exited;
      const observerExit = yield* observer.exited;
      const observerResult = JSON.parse(NodeFS.readFileSync(observerConfig.resultPath, "utf8")) as {
        readonly ok: boolean;
        readonly message?: string;
      };
      assert.equal(childExit.code, 0, childExit.stderr);
      assert.equal(observerExit.code, 1, observerExit.stderr);
      assert.equal(observerResult.ok, false);
      assert.include(observerResult.message ?? "", "already exists and cannot be created twice");
      assert.equal(NodeFS.existsSync(rootA), true);
      assert.equal(NodeFS.existsSync(rootB), false);
      assert.equal(yield* createdEventCount(dbPath), 1);
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* stop;
          NodeFS.rmSync(tempDir, { recursive: true, force: true });
        }),
      ),
    );
  },
);

it.effect("a live other process pid does not create a directory and a dead pid can", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-os-pid-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const root = NodePath.join(tempDir, "claimed");
  const layer = projectRaceLayer(dbPath);
  const config: ProcessRaceConfig = {
    role: "hold-live",
    dbPath,
    resultPath: NodePath.join(tempDir, "child-result.json"),
    readyPath: NodePath.join(tempDir, "ready"),
    releasePath: NodePath.join(tempDir, "release"),
    commandId: "command:os-pid",
    projectId: "project:os-pid",
    title: "Claimed",
    workspaceRoot: root,
  };
  const create = Effect.gen(function* () {
    const service = yield* ProjectService.ProjectService;
    return yield* service.create({
      commandId: CommandId.make(config.commandId),
      projectId: ProjectId.make(config.projectId),
      title: config.title,
      workspaceRoot: root,
      createWorkspaceRootIfMissing: true,
    });
  }).pipe(Effect.provide(layer));
  let stop: Effect.Effect<void> = Effect.void;
  return Effect.gen(function* () {
    yield* migrateRaceDatabase(dbPath);
    const child = spawnRaceChild(config);
    stop = child.stop;
    yield* waitForPath(config.readyPath);
    const claim = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<{
        readonly error: string | null;
        readonly resultSequence: number;
        readonly digest: string | null;
      }>`
        SELECT error, result_sequence AS "resultSequence", payload_digest AS digest
        FROM orchestration_command_receipts
        WHERE command_id = ${config.commandId}
      `;
      return row;
    }).pipe(Effect.provide(layer));
    assert.ok(claim, "the live process did not leave a sequence-0 claim");
    assert.match(String(claim.error), /^mkdir:[1-9][0-9]*$/);
    const claimedPid = Number(String(claim.error).slice("mkdir:".length));
    const claimedPidIsLive = yield* Effect.try({
      try: () => process.kill(claimedPid, 0),
      catch: () => false,
    }).pipe(Effect.orElseSucceed(() => false));
    assert.equal(claimedPidIsLive, true);
    assert.equal(claim.resultSequence, 0);
    const blocked = yield* create.pipe(Effect.flip);
    assert.instanceOf(blocked, ProjectService.ProjectOperationError);
    assert.include(String(blocked.cause), "Directory creation is in progress");
    assert.equal(NodeFS.existsSync(root), false);
    child.kill();
    const exited = yield* child.exited;
    assert.equal(exited.signal, "SIGKILL");
    const held = readRaceReceipt(dbPath, config.commandId);
    assert.equal(held.receipts, 1);
    assert.equal(held.row?.status, "accepted");
    assert.equal(held.row?.resultSequence, 0);
    assert.match(String(held.row?.error), /^mkdir:[1-9][0-9]*$/);
    assert.equal(held.created, 0);
    assert.equal(NodeFS.existsSync(root), false);
    const created = yield* create;
    const finished = readRaceReceipt(dbPath, config.commandId);
    assert.equal(created.workspaceRoot, root);
    assert.equal(NodeFS.existsSync(root), true);
    assert.equal(finished.receipts, 1);
    assert.notEqual(finished.row?.resultSequence, 0);
    assert.equal(finished.row?.error, null);
    assert.equal(finished.created, 1);
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* stop;
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
    ),
  );
});

it.effect("a killed reservation is recovered by the parent as one directory", () => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-project-os-kill-"));
  const dbPath = NodePath.join(tempDir, "state.sqlite");
  const root = NodePath.join(tempDir, "recovered");
  const layer = projectRaceLayer(dbPath);
  const config: ProcessRaceConfig = {
    role: "hold-create",
    dbPath,
    resultPath: NodePath.join(tempDir, "child-result.json"),
    readyPath: NodePath.join(tempDir, "ready"),
    releasePath: NodePath.join(tempDir, "release"),
    commandId: "command:os-kill",
    projectId: "project:os-kill",
    title: "Recovered",
    workspaceRoot: root,
  };
  let stop: Effect.Effect<void> = Effect.void;
  return Effect.gen(function* () {
    yield* migrateRaceDatabase(dbPath);
    const child = spawnRaceChild(config);
    stop = child.stop;
    yield* waitForPath(config.readyPath);
    assert.equal(NodeFS.existsSync(root), false);
    child.kill();
    const exited = yield* child.exited;
    assert.equal(exited.signal, "SIGKILL");
    const reserved = readRaceReceipt(dbPath, config.commandId);
    assert.equal(reserved.receipts, 1);
    assert.equal(reserved.row?.status, "accepted");
    assert.equal(reserved.row?.resultSequence, 0);
    assert.equal(reserved.row?.error, null);
    assert.ok(reserved.row?.digest);
    assert.equal(reserved.created, 0);
    assert.equal(NodeFS.existsSync(root), false);
    const created = yield* Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      return yield* service.create({
        commandId: CommandId.make(config.commandId),
        projectId: ProjectId.make(config.projectId),
        title: config.title,
        workspaceRoot: root,
        createWorkspaceRootIfMissing: true,
      });
    }).pipe(Effect.provide(layer));
    const finished = readRaceReceipt(dbPath, config.commandId);
    assert.equal(created.workspaceRoot, root);
    assert.equal(NodeFS.existsSync(root), true);
    assert.equal(finished.receipts, 1);
    assert.equal(finished.row?.digest, reserved.row?.digest);
    assert.notEqual(finished.row?.resultSequence, 0);
    assert.equal(finished.row?.error, null);
    assert.equal(finished.created, 1);
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* stop;
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
    ),
  );
});
