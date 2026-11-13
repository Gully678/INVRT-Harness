// @effect-diagnostics nodeBuiltinImport:off - process entry point: stdin in, one JSON value out.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolveInvrtStateDirectory } from "@t3tools/shared/invrtStateHome";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { reportToConsole, type ConsoleReportConfig } from "./consoleReport.ts";
import {
  makeBrainKnowledgePort,
  parseBrainEnv,
  type BrainKnowledgeConfig,
} from "./knowledgePacket.ts";
import { makeFileResultStore } from "./resultStore.ts";
import { makeSliceExecutor } from "./sliceExecutor.ts";
import {
  REFUSALS,
  decodeWorkOrder,
  refusedResult,
  runWorkOrder,
  type CodeResultV1,
  type WorkOrderDeps,
} from "./workOrder.ts";

/**
 * One `monti.code.work_order.v1` on stdin, one `invrt.code.result.v1` on stdout.
 * Exit 0 for any decoded order (a refusal is a result), exit 2 for an undecodable one.
 * A local subprocess for MONTI's launcher: it trusts the order's organization, member and
 * project and opens no network listener; exposing it beyond the machine needs IC-13.
 */
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

// The Console's own sender (`ec-send`) is called as a process; all four variables must be set.
const consoleReportConfig = (): ConsoleReportConfig | null => {
  const { INVRT_CODE_EC_SENDER_BIN, EC_BASE_URL, EC_CREDENTIAL_FILE, EC_STATE_DIR } = process.env;
  return INVRT_CODE_EC_SENDER_BIN && EC_BASE_URL && EC_CREDENTIAL_FILE && EC_STATE_DIR
    ? {
        node: process.execPath,
        senderBin: INVRT_CODE_EC_SENDER_BIN,
        env: { EC_BASE_URL, EC_CREDENTIAL_FILE, EC_STATE_DIR },
        timeoutMs: 20_000,
      }
    : null;
};

// Company Brain's packet CLI is called as a process. The Brain environment comes only from the
// VM's own env file, by name, never from the order or this process's own environment. A missing
// variable or an unusable file builds no port (the order then refuses `not_configured`), named
// on stderr without any value.
const brainKnowledgeConfig = (): BrainKnowledgeConfig | null => {
  const { INVRT_CODE_BRAIN_PYTHON, INVRT_CODE_BRAIN_CLI, INVRT_CODE_BRAIN_ENV_FILE } = process.env;
  if (!INVRT_CODE_BRAIN_PYTHON || !INVRT_CODE_BRAIN_CLI || !INVRT_CODE_BRAIN_ENV_FILE) return null;
  let brainEnv: Record<string, string> | null = null;
  try {
    brainEnv = parseBrainEnv(NodeFS.readFileSync(INVRT_CODE_BRAIN_ENV_FILE, "utf8"));
  } catch {
    // brainEnv stays null and is reported below.
  }
  if (brainEnv === null) {
    process.stderr.write(
      "INVRT_CODE_BRAIN_ENV_FILE is unreadable or lacks one of the four Brain names: knowledge is not configured\n",
    );
    return null;
  }
  return {
    python: INVRT_CODE_BRAIN_PYTHON,
    cli: INVRT_CODE_BRAIN_CLI,
    brainEnv,
    timeoutMs: 30_000,
  };
};

const readStdin = async (): Promise<string> => {
  const chunks: Array<Buffer> = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

const main = async (): Promise<void> => {
  // Receipts, results and executor repositories are private to the user: 0700 directories, 0600 files.
  process.umask(0o077);
  const decoded = decodeWorkOrder(Option.getOrUndefined(decodeJson(await readStdin())));
  if (!decoded.ok) {
    process.stdout.write(`${JSON.stringify({ refusal: decoded.refusal })}\n`);
    process.exitCode = 2;
    return;
  }
  const { order } = decoded;
  const delegationHome = NodePath.join(
    resolveInvrtStateDirectory({ homeDirectory: NodeOS.homedir(), environment: process.env }),
    "delegation",
  );
  const consoleReport = consoleReportConfig();
  const brainConfig = brainKnowledgeConfig();
  const reportPort =
    consoleReport === null
      ? null
      : { report: (result: CodeResultV1) => reportToConsole(result, consoleReport) };
  const deps: WorkOrderDeps = {
    executor:
      process.env.INVRT_CODE_EXECUTOR === "slice-fixture"
        ? makeSliceExecutor(NodePath.join(delegationHome, "executor"))
        : null,
    knowledge: brainConfig === null ? null : makeBrainKnowledgePort(brainConfig),
    report: reportPort,
    resultStore: makeFileResultStore(NodePath.join(delegationHome, "results")),
  };
  const receipts = CommandReceiptStore.layer.pipe(
    Layer.provide(
      SqlitePersistence.layerFromPath(NodePath.join(delegationHome, "receipts.sqlite")),
    ),
    Layer.provide(NodeServices.layer),
  );
  const result = await Effect.runPromise(
    runWorkOrder(order, deps).pipe(
      Effect.provide(receipts),
      // Only the receipt store failing to open lands here; runWorkOrder has no error channel, so a
      // retry never repeats an order. Two launches creating the same database at once make the
      // loser's schema setup fail with "database is locked" (about 1 race in 15 on this machine).
      Effect.retry({ times: 3, schedule: Schedule.spaced("250 millis") }),
      Effect.tapError((cause) => Effect.logError("receipt store unavailable", cause)),
      Effect.orElseSucceed(() => refusedResult(order, REFUSALS.storeUnavailable)),
      // stdout carries exactly one JSON value; Effect's logs (migrations, warnings) go to stderr.
      Effect.provideService(Logger.LogToStderr, true),
    ),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

await main();
