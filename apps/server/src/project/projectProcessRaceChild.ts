// Second OS process for project command races. The vitest parent spawns this file.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- This child coordinates real filesystem signals across processes.
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Watch the real parent directory for a cross-process signal.
import * as NodePath from "node:path";

import { CommandId, ProjectId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { commandPayloadDigest } from "../orchestration-v2/CommandReceiptStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { isEntrypoint } from "../entrypoint.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import * as ProjectService from "./ProjectService.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

export interface ProcessRaceConfig {
  readonly role: "race-create" | "hold-live" | "hold-create" | "lock-then-create";
  readonly blockedPath?: string;
  readonly dbPath: string;
  readonly resultPath: string;
  readonly readyPath: string;
  readonly releasePath: string;
  readonly commandId: string;
  readonly projectId: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

const waitForRelease = (releasePath: string) =>
  Effect.callback<void>((resume) => {
    const watcher = NodeFS.watch(NodePath.dirname(releasePath), () => {
      if (NodeFS.existsSync(releasePath)) {
        watcher.close();
        resume(Effect.void);
      }
    });
    watcher.once("error", (error) => {
      watcher.close();
      resume(Effect.die(error));
    });
    if (NodeFS.existsSync(releasePath)) {
      watcher.close();
      resume(Effect.void);
    }
    return Effect.sync(() => watcher.close());
  });

const encodeResult = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      ok: Schema.Boolean,
      workspaceRoot: Schema.String,
      pid: Schema.Number,
    }),
  ),
);

const layerMetadata = Layer.merge(
  Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
    resolve: Effect.fn("ProjectRace.resolveIdentity")(() => Effect.succeed(null)),
  }),
  Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
    invalidate: Effect.fn("ProjectRace.invalidateFavicon")(() => Effect.void),
    resolvePath: Effect.fn("ProjectRace.resolveFavicon")(() => Effect.succeed(null)),
  }),
);

const holdingPaths = (readyPath: string, releasePath: string) =>
  Layer.succeed(WorkspacePaths.WorkspacePaths, {
    normalizeWorkspaceRoot: Effect.fn("ProjectRace.normalizeWorkspaceRoot")(
      function* (workspaceRoot, options) {
        if (options?.createIfMissing === true) {
          NodeFS.writeFileSync(readyPath, `${process.pid}`);
          yield* waitForRelease(releasePath);
          NodeFS.mkdirSync(workspaceRoot, { recursive: true });
        }
        return workspaceRoot;
      },
    ),
    resolveRelativePathWithinRoot: Effect.fn("ProjectRace.resolveRelativePath")(
      ({ workspaceRoot, relativePath }) =>
        Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
    ),
  });

export const projectRaceLayer = (dbPath: string, workspacePaths = WorkspacePaths.layer) =>
  RuntimeLayer.layerProjectService.pipe(
    Layer.provideMerge(ProjectEnrichmentService.layer),
    Layer.provideMerge(workspacePaths),
    Layer.provideMerge(layerMetadata),
    Layer.provideMerge(SqlitePersistence.layerFromPath(dbPath)),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "project-process-race-" })),
    Layer.provide(NodeServices.layer),
  );

const createCommand = (config: ProcessRaceConfig) => ({
  type: "project.create" as const,
  commandId: CommandId.make(config.commandId),
  projectId: ProjectId.make(config.projectId),
  title: config.title,
  workspaceRoot: config.workspaceRoot,
});

const sqliteBusy = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const errcode = "errcode" in error ? Number(error.errcode) : Number.NaN;
  if (Number.isInteger(errcode) && (errcode & 0xff) === 5) return true;
  return error instanceof Error && error.message.includes("database is locked");
};

const describeCause = (cause: unknown, depth = 0): string => {
  if (depth > 4 || cause === undefined) return "";
  if (cause instanceof Error) {
    const inner = "cause" in cause ? describeCause(cause.cause, depth + 1) : "";
    return inner.length > 0 ? `${cause.message} ${inner}` : cause.message;
  }
  return String(cause);
};

// The holder is inside its write transaction. This connection must fail at once.
const observeWriteLock = (dbPath: string): boolean => {
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

const run = async (config: ProcessRaceConfig) => {
  if (config.role === "lock-then-create") {
    if (config.blockedPath === undefined) {
      process.stderr.write("missing blocked path\n");
      process.exit(2);
    }
    const busy = observeWriteLock(config.dbPath);
    NodeFS.writeFileSync(config.blockedPath, JSON.stringify({ busy }));
    const released = await Effect.runPromise(
      waitForRelease(config.releasePath).pipe(Effect.timeoutOption("20 seconds")),
    );
    if (Option.isNone(released)) {
      process.stderr.write("timed out waiting for the lock holder to release\n");
      process.exit(2);
    }
  }
  if (config.role === "hold-live") {
    const command = createCommand(config);
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO orchestration_command_receipts (
            command_id, aggregate_kind, aggregate_id, command_type, accepted_at,
            result_sequence, status, error, payload_digest
          ) VALUES (
            ${command.commandId},
            'project',
            ${command.projectId},
            ${command.type},
            '2026-11-11T12:00:00.000Z',
            0,
            'accepted',
            ${`mkdir:${process.pid}`},
            ${commandPayloadDigest(command)}
          )
        `;
      }).pipe(Effect.provide(projectRaceLayer(config.dbPath))),
    ).then(() => {
      NodeFS.writeFileSync(config.readyPath, `${process.pid}`);
      // Keep this process alive until the parent kills it.
      NodeFS.watch(config.readyPath, () => undefined);
      return new Promise<void>(() => undefined);
    });
  }
  const layer = projectRaceLayer(
    config.dbPath,
    config.role === "hold-create"
      ? holdingPaths(config.readyPath, config.releasePath)
      : WorkspacePaths.layer,
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const created = yield* service.create({
        ...createCommand(config),
        createWorkspaceRootIfMissing: true,
      });
      NodeFS.writeFileSync(
        config.resultPath,
        yield* encodeResult({ ok: true, workspaceRoot: created.workspaceRoot, pid: process.pid }),
      );
    }).pipe(Effect.provide(layer)),
  );
};

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  const configPath = process.argv[2];
  if (configPath === undefined) {
    process.stderr.write("missing race config\n");
    process.exit(2);
  }
  const config = JSON.parse(NodeFS.readFileSync(configPath, "utf8")) as ProcessRaceConfig;
  void run(config).catch((cause: unknown) => {
    const message = describeCause(cause);
    NodeFS.writeFileSync(
      config.resultPath,
      JSON.stringify({ ok: false, message, pid: process.pid }),
    );
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
