// @effect-diagnostics nodeBuiltinImport:off - the Console's own sender `ec-send` is called as a process.
import * as NodeChildProcess from "node:child_process";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { CodeResultV1 } from "./workOrder.ts";

/**
 * CODE side of seam S4 (PRD-ADDENDUM S4): a result becomes one Estate Console observation and is
 * handed to the Console's sender. Delivery, retry, spool, secret screening and dead-letter are the
 * sender's; the tenant, principal and project come from its credential. Nothing here re-implements
 * them. The observation carries ids, state, head and the refusal name only: never knowledge text.
 */
export type ConsoleObservationV1 =
  | {
      readonly projectId: string;
      readonly workItemId: string;
      readonly kind: "status";
      readonly state: "built";
      readonly commit: string | null;
      readonly builderModel: string;
      readonly sourceRef: string;
      readonly text: string;
    }
  | {
      readonly projectId: string;
      readonly workItemId: string;
      readonly kind: "hold";
      readonly sourceState: "refused";
      readonly sourceRef: string;
      readonly text: string;
    };

export type ConsoleReportOutcome = "delivered" | "spooled" | "held" | "not_configured";

export interface ConsoleReportConfig {
  readonly node: string;
  readonly senderBin: string;
  /** Exactly what the sender receives: `EC_BASE_URL`, `EC_CREDENTIAL_FILE` (a path), `EC_STATE_DIR`. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export const toObservations = (result: CodeResultV1): ReadonlyArray<ConsoleObservationV1> => {
  const sourceRef = `invrt-code:${result.work_order_id}`;
  return result.state === "built"
    ? [
        {
          projectId: result.project,
          workItemId: result.story_id,
          kind: "status",
          state: "built",
          commit: result.head,
          builderModel: result.builder_model,
          sourceRef,
          text: `Built by INVRT CODE for MONTI work order ${result.work_order_id}`,
        },
      ]
    : [
        {
          projectId: result.project,
          workItemId: result.story_id,
          kind: "hold",
          sourceState: "refused",
          sourceRef,
          text: `INVRT CODE refused: ${result.refusal}`,
        },
      ];
};

const SenderLine = Schema.Struct({ outcome: Schema.String });
const decodeSenderLine = Schema.decodeUnknownOption(Schema.fromJsonString(SenderLine));

// Only an exit 0 whose outcome the sender names `delivered` or `spooled` is reported as such.
// A non-zero exit, a signal, a timeout, unparseable output or any other outcome (blocked,
// inactive, suppressed, dead-lettered, an unknown string) is `held`: never a delivery claimed
// without the sender's say-so (rule 4, H-S2).
const sendOne = (
  observation: ConsoleObservationV1,
  config: ConsoleReportConfig,
): Promise<"delivered" | "spooled" | "held"> =>
  new Promise((resolve) => {
    const child = NodeChildProcess.execFile(
      config.node,
      [config.senderBin],
      {
        env: { ...config.env },
        timeout: config.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 65_536,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error !== null) return resolve("held");
        const outcome = Option.map(decodeSenderLine(stdout.trim()), (line) => line.outcome);
        resolve(
          Option.isSome(outcome) && (outcome.value === "delivered" || outcome.value === "spooled")
            ? outcome.value
            : "held",
        );
      },
    );
    // A sender that exits without reading stdin raises EPIPE here; the exit status decides the outcome.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(JSON.stringify(observation));
  });

export function reportToConsole(
  result: CodeResultV1,
  config: ConsoleReportConfig,
): Effect.Effect<"delivered" | "spooled" | "held">;
export function reportToConsole(
  result: CodeResultV1,
  config: ConsoleReportConfig | null,
): Effect.Effect<ConsoleReportOutcome>;
export function reportToConsole(
  result: CodeResultV1,
  config: ConsoleReportConfig | null,
): Effect.Effect<ConsoleReportOutcome> {
  if (config === null) return Effect.succeed("not_configured");
  return Effect.promise(async () => {
    // toObservations yields one row per result; the loop keeps the worst outcome if that grows.
    let worst: "delivered" | "spooled" | "held" = "delivered";
    for (const observation of toObservations(result)) {
      const outcome = await sendOne(observation, config);
      if (outcome === "held" || (outcome === "spooled" && worst === "delivered")) worst = outcome;
      if (worst === "held") break;
    }
    return worst;
  });
}
