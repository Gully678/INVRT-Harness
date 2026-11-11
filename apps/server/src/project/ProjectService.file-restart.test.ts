// @effect-diagnostics nodeBuiltinImport:off - the sqlite path is created before the layer exists
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
