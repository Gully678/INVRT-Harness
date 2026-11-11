// Second OS process for project command races. The vitest parent spawns this file.
import * as NodeFS from "node:fs";

import { CommandId, ProjectId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  readonly role: "race-create" | "hold-live" | "hold-create";
  readonly dbPath: string;
  readonly resultPath: string;
  readonly readyPath: string;
  readonly releasePath: string;
  readonly commandId: string;
  readonly projectId: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

const layerMetadata = Layer.merge(
  Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
    resolve: () => Effect.succeed(null),
  }),
  Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
    invalidate: () => Effect.void,
    resolvePath: () => Effect.succeed(null),
  }),
);

const holdingPaths = (readyPath: string, releasePath: string) =>
  Layer.succeed(WorkspacePaths.WorkspacePaths, {
    normalizeWorkspaceRoot: (workspaceRoot, options) =>
      Effect.gen(function* () {
        if (options?.createIfMissing === true) {
          NodeFS.writeFileSync(readyPath, `${process.pid}`);
          yield* Effect.callback<void>((resume) => {
            const timer = setInterval(() => {
              if (NodeFS.existsSync(releasePath)) {
                clearInterval(timer);
                resume(Effect.void);
              }
            }, 15);
            return Effect.sync(() => clearInterval(timer));
          });
          NodeFS.mkdirSync(workspaceRoot, { recursive: true });
        }
        return workspaceRoot;
      }),
    resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
      Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
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

const run = (config: ProcessRaceConfig) => {
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
      // A pending promise does not keep Node alive. This timer does, until the parent kills us.
      setInterval(() => undefined, 1_000_000);
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
        JSON.stringify({ ok: true, workspaceRoot: created.workspaceRoot, pid: process.pid }),
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
    const message = cause instanceof Error ? cause.message : String(cause);
    NodeFS.writeFileSync(
      config.resultPath,
      JSON.stringify({ ok: false, message, pid: process.pid }),
    );
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
