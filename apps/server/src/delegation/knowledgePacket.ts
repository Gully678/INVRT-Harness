// @effect-diagnostics nodeBuiltinImport:off - Company Brain's packet CLI is called as a process.
import * as NodeChildProcess from "node:child_process";

import { PositiveInt } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { KnowledgePort, KnowledgeRef, KnowledgeSummary, WorkOrderV1 } from "./workOrder.ts";

/**
 * CODE side of seam S3 (PRD-ADDENDUM S3): knowledge comes from Company Brain's packet CLI, called
 * as a process. Brain alone decides who may read what; CODE checks the packet against Brain's
 * frozen contract, keeps ids only (never passage text), asks again on every run (no cache) and
 * refuses by name when Brain refuses, cannot answer, answers wrongly or answers empty.
 */

export const KNOWLEDGE_REFUSALS = {
  packetEmpty: "code_knowledge:packet_empty",
  brainUnavailable: "code_knowledge:brain_unavailable",
  contractMismatch: "code_knowledge:contract_mismatch",
} as const;

// Brain's refusals that CODE relays by name (exit 3). Any other text is treated as a fault.
const BRAIN_REFUSALS = [
  "kb_code_packet:destination_unqualified",
  "kb_code_packet:adapter_disabled",
] as const;

/** The Brain environment the CLI needs; read from the VM's own env file by name, never the order. */
export const BRAIN_ENV_NAMES = [
  "HERMES_HOME",
  "MONTI_TEAM_STATE_PATH",
  "MONTI_VM_ID",
  "MONTI_ORG_ID",
] as const;

/**
 * Names the Brain reads that may be absent. MONTI_KB_CODE_ADAPTER set to exactly "off" makes the
 * Brain refuse (agent/kb_code_packet.py); CODE forwards it as written and never decides it.
 */
export const BRAIN_OPTIONAL_ENV_NAMES = ["MONTI_KB_CODE_ADAPTER"] as const;

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

// Mirrors tests/br05_consumers/code_packet_contract_v1.json (a byte copy sits in fixtures/).
// Brain's `revision` is an integer and its digest is 16 hex; CODE's result carries revision as a string.
export const CodePacketV1 = Schema.Struct({
  spec: Schema.Literal("monti.code_knowledge_packet.v1"),
  destination: Schema.Literals(["code_local_device", "code_vm"]),
  requested_by: Schema.NonEmptyString,
  budget_chars: PositiveInt,
  included: Schema.Array(
    Schema.Struct({
      path_id: Schema.NonEmptyString,
      revision: NonNegativeInt,
      revision_digest: Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/)),
      text: Schema.String,
    }),
  ),
  omitted: Schema.Struct({ count: NonNegativeInt, reason: Schema.String }),
  result_revision: Schema.NonEmptyString,
});
export type CodePacketV1 = typeof CodePacketV1.Type;

export const decodeKnowledgePacket = Schema.decodeUnknownOption(CodePacketV1, {
  onExcessProperty: "error",
});

const decodePacketJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const BrainRefusalLine = Schema.Struct({ refusal: Schema.Literals(BRAIN_REFUSALS) });
const decodeRefusalLine = Schema.decodeUnknownOption(Schema.fromJsonString(BrainRefusalLine), {
  onExcessProperty: "error",
});

export interface BrainKnowledgeConfig {
  readonly python: string;
  readonly cli: string;
  /** Exactly the Brain environment names, plus PATH, reach the child. */
  readonly brainEnv: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

type BrainAnswer =
  | { readonly kind: "exit"; readonly code: number; readonly stdout: string }
  | { readonly kind: "failed"; readonly cause: string };

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

// Resolves with the child's exit and stdout, or a cause by name: never stderr, which carries ids.
const callBrain = (config: BrainKnowledgeConfig, request: unknown): Promise<BrainAnswer> =>
  new Promise((resolve) => {
    const child = NodeChildProcess.execFile(
      config.python,
      [config.cli],
      {
        env: { PATH: process.env.PATH, ...config.brainEnv },
        timeout: config.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error === null) return resolve({ kind: "exit", code: 0, stdout });
        if (error.killed === true) {
          return resolve({ kind: "failed", cause: "timed out or output too large" });
        }
        return resolve(
          typeof error.code === "number"
            ? { kind: "exit", code: error.code, stdout }
            : { kind: "failed", cause: `could not run (${String(error.code ?? error.signal)})` },
        );
      },
    );
    // A CLI that exits without reading stdin raises EPIPE here; its exit status decides the outcome.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(JSON.stringify(request));
  });

type Fetched =
  | { readonly ok: true; readonly summary: KnowledgeSummary }
  | { readonly ok: false; readonly refusal: string };
const refuse = (refusal: string): Fetched => ({ ok: false, refusal });

// Names the cause only: never the member, the brief, the order id or anything Brain printed.
const unavailable = (cause: string) =>
  Effect.logWarning(`Company Brain unavailable: ${cause}`).pipe(
    Effect.as(refuse(KNOWLEDGE_REFUSALS.brainUnavailable)),
  );
const mismatch = (cause: string) =>
  Effect.logWarning(`Company Brain packet rejected: ${cause}`).pipe(
    Effect.as(refuse(KNOWLEDGE_REFUSALS.contractMismatch)),
  );

const toSummary = (packet: CodePacketV1): Fetched => ({
  ok: true,
  summary: {
    result_revision: packet.result_revision,
    included: packet.included.map(({ path_id, revision, revision_digest }): KnowledgeRef => ({
      path_id,
      revision: String(revision),
      revision_digest,
    })),
    omitted_count: packet.omitted.count,
  },
});

export const makeBrainKnowledgePort = (config: BrainKnowledgeConfig): KnowledgePort => ({
  fetch: Effect.fn("fetchBrainKnowledge")(function* (order: WorkOrderV1) {
    const { knowledge, member } = order;
    const answer = yield* Effect.promise(() =>
      callBrain(config, {
        profile: { user_id: member },
        brief_text: knowledge.brief_text,
        budget_chars: knowledge.budget_chars,
        destination: knowledge.destination,
        requested_by: member,
      }),
    );
    if (answer.kind === "failed") return yield* unavailable(answer.cause);
    // Exit 0 is the only packet. Exit 3 is a named Brain refusal; exits 1 and 2 (a fault, or
    // an invalid request such as a requested_by mismatch) and every other status are unavailable.
    if (answer.code === 3) {
      const line = decodeRefusalLine(answer.stdout.trim());
      return Option.isSome(line)
        ? refuse(line.value.refusal)
        : yield* unavailable("exit 3 without a named refusal");
    }
    if (answer.code !== 0) return yield* unavailable(`exit ${answer.code}`);

    const packet = Option.flatMap(decodePacketJson(answer.stdout.trim()), decodeKnowledgePacket);
    if (Option.isNone(packet)) return yield* mismatch("not the frozen contract");
    // The packet must answer this order's request, not another member's or destination's.
    if (
      packet.value.requested_by !== member ||
      packet.value.destination !== knowledge.destination ||
      packet.value.budget_chars !== knowledge.budget_chars
    ) {
      return yield* mismatch("answers a different request");
    }
    // Empty means Brain withheld everything (no grant, revoked, or nothing relevant): H-S1.
    if (packet.value.included.length === 0 && knowledge.required) {
      return refuse(KNOWLEDGE_REFUSALS.packetEmpty);
    }
    return toSummary(packet.value);
  }),
});

const FORWARDED_ENV_NAMES: ReadonlyArray<string> = [
  ...BRAIN_ENV_NAMES,
  ...BRAIN_OPTIONAL_ENV_NAMES,
];

/**
 * Reads the four required Brain names, and the optional switch when present, from a `NAME=value`
 * env file (comments, `export`, single or double quotes allowed). Other names are ignored, so
 * nothing else in the file is forwarded. Returns null when a required name is missing or empty.
 */
export const parseBrainEnv = (text: string): Record<string, string> | null => {
  const found: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    const name = match?.[1];
    if (name === undefined || !FORWARDED_ENV_NAMES.includes(name)) continue;
    found[name] = (match?.[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
  }
  return BRAIN_ENV_NAMES.every((name) => (found[name] ?? "") !== "") ? found : null;
};
