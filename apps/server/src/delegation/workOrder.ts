import { CommandId, PositiveInt, ProjectId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  CommandReceiptStoreV2,
  commandPayloadDigest,
} from "../orchestration-v2/CommandReceiptStore.ts";
import type { ResultStore } from "./resultStore.ts";

/**
 * CODE side of the MONTI work-order seam (PRD-ADDENDUM S2b). One order is admitted once
 * through the existing command receipt store, run, and recorded as one result; a repeat
 * returns that result, and every failure refuses by name with no effect.
 */

export const WORK_ORDER_COMMAND_TYPE = "monti.code.work_order.v1";
const RESULT_SPEC = "invrt.code.result.v1";

export const REFUSALS = {
  invalid: "code_work_order:invalid",
  payloadConflict: "code_work_order:payload_conflict",
  resultUnbound: "code_work_order:result_unbound",
  inProgress: "code_work_order:in_progress",
  storeUnavailable: "code_work_order:store_unavailable",
  executorNotConfigured: "code_executor:not_configured",
  executorFailed: "code_executor:failed",
  knowledgeNotConfigured: "code_knowledge:not_configured",
  // Transient: Brain could not answer, nothing ran. A stored result with this refusal is not
  // final; a re-submission of the same order asks Brain again. Every other refusal is final.
  knowledgeUnavailable: "code_knowledge:brain_unavailable",
} as const;

// work_order_id and project become the receipt's command id and project id, which the
// store trims; refusing padded values keeps the id the order carries the id that is stored.
const TrimmedId = Schema.NonEmptyString.check(
  Schema.makeFilter((value: string) => value === value.trim(), { expected: "a trimmed string" }),
);
// Canonical form `YYYY-MM-DDTHH:MM:SS[.f]Z` on a real calendar date: Date rolls 2026-02-30 and
// hour 24 over into the next day, so a value is real only when it round-trips. The shared case
// table (fixtures/work_order_type_cases.json) is the executable statement of this rule.
const UtcTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/),
  Schema.makeFilter(
    (value: string) =>
      Option.exists(
        DateTime.make(value),
        (parsed) => DateTime.formatIso(parsed).slice(0, 19) === value.slice(0, 19),
      ),
    { expected: "a real UTC ISO-8601 timestamp" },
  ),
);
const NonBlank = Schema.NonEmptyString.check(
  Schema.makeFilter((value: string) => value.trim().length > 0, { expected: "a non-blank string" }),
);
const Hex = (length: number) =>
  Schema.String.check(Schema.isPattern(new RegExp(`^[0-9a-f]{${length}}$`)));
const Commit = Hex(40);

// Field order is the digest order: the receipt digest is taken over the decoded value, so
// the order a sender wrote its keys in never changes it.
export const WorkOrderV1 = Schema.Struct({
  spec: Schema.Literal(WORK_ORDER_COMMAND_TYPE),
  work_order_id: TrimmedId,
  correlation_id: NonBlank,
  organization: NonBlank,
  member: NonBlank,
  project: TrimmedId,
  story_id: NonBlank,
  request_text: NonBlank,
  knowledge: Schema.Struct({
    required: Schema.Boolean,
    brief_text: NonBlank,
    budget_chars: PositiveInt,
    destination: Schema.Literals(["code_local_device", "code_vm"]),
  }),
  allowed_effects: Schema.Tuple([Schema.Literal("local_commit")]),
  deadline: UtcTimestamp,
});
export type WorkOrderV1 = typeof WorkOrderV1.Type;

export const KnowledgeRef = Schema.Struct({
  path_id: Schema.String,
  revision: Schema.String,
  revision_digest: Schema.String,
});
export type KnowledgeRef = typeof KnowledgeRef.Type;

export const CodeResultV1 = Schema.Struct({
  spec: Schema.Literal(RESULT_SPEC),
  work_order_id: Schema.NonEmptyString,
  correlation_id: NonBlank,
  project: Schema.NonEmptyString,
  story_id: NonBlank,
  state: Schema.Literals(["built", "refused"]),
  refusal: Schema.NullOr(Schema.NonEmptyString),
  base: Schema.NullOr(Commit),
  head: Schema.NullOr(Commit),
  builder_model: Schema.NonEmptyString,
  knowledge: Schema.NullOr(
    Schema.Struct({
      result_revision: Schema.String,
      included: Schema.Array(KnowledgeRef),
      omitted_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  receipt: Schema.Struct({
    command_id: Schema.NonEmptyString,
    payload_digest: Hex(64),
    replayed: Schema.Boolean,
  }),
  console_report: Schema.Literals(["delivered", "spooled", "held", "not_configured"]),
});
export type CodeResultV1 = typeof CodeResultV1.Type;

export class ExecutorFailed extends Schema.TaggedError<ExecutorFailed>()("ExecutorFailed", {
  reason: Schema.String,
}) {}

export interface KnowledgeSummary {
  readonly result_revision: string;
  readonly included: ReadonlyArray<KnowledgeRef>;
  readonly omitted_count: number;
}

export interface WorkOrderExecutor {
  readonly model: string;
  readonly run: (
    order: WorkOrderV1,
    knowledge: ReadonlyArray<KnowledgeRef>,
  ) => Effect.Effect<{ readonly base: string; readonly head: string }, ExecutorFailed>;
}

export interface KnowledgePort {
  readonly fetch: (
    order: WorkOrderV1,
  ) => Effect.Effect<
    | { readonly ok: true; readonly summary: KnowledgeSummary }
    | { readonly ok: false; readonly refusal: string }
  >;
}

export interface ConsoleReportPort {
  readonly report: (result: CodeResultV1) => Effect.Effect<"delivered" | "spooled" | "held">;
}

export interface WorkOrderDeps {
  readonly executor: WorkOrderExecutor | null;
  readonly knowledge: KnowledgePort | null;
  readonly report: ConsoleReportPort | null;
  readonly resultStore: ResultStore;
}

const decodeOrder = Schema.decodeUnknownOption(WorkOrderV1, { onExcessProperty: "error" });
const isCommit = Schema.is(Commit);

export const decodeWorkOrder = (
  input: unknown,
):
  | { readonly ok: true; readonly order: WorkOrderV1 }
  | { readonly ok: false; readonly refusal: typeof REFUSALS.invalid } =>
  Option.match(decodeOrder(input), {
    onNone: () => ({ ok: false, refusal: REFUSALS.invalid }) as const,
    onSome: (order) => ({ ok: true, order }) as const,
  });

type Outcome = Pick<
  CodeResultV1,
  "state" | "refusal" | "base" | "head" | "builder_model" | "knowledge"
>;

const resultFor = (order: WorkOrderV1, outcome: Outcome, replayed = false): CodeResultV1 => ({
  spec: RESULT_SPEC,
  work_order_id: order.work_order_id,
  correlation_id: order.correlation_id,
  project: order.project,
  story_id: order.story_id,
  ...outcome,
  receipt: {
    command_id: order.work_order_id,
    payload_digest: commandPayloadDigest(order),
    replayed,
  },
  console_report: "not_configured",
});

/** A refusal record. `replayed` says whether a receipt for this order already existed. */
export const refusedResult = (
  order: WorkOrderV1,
  refusal: string,
  options: { readonly replayed?: boolean; readonly builderModel?: string } = {},
): CodeResultV1 =>
  resultFor(
    order,
    {
      state: "refused",
      refusal,
      base: null,
      head: null,
      builder_model: options.builderModel ?? "none",
      knowledge: null,
    },
    options.replayed,
  );

/** A refusal raised before or while persisting: it is returned, never stored as the result. */
interface NotStored {
  readonly refusal: string;
  readonly replayed: boolean;
}
const notStored = (refusal: string, replayed = false): NotStored => ({ refusal, replayed });

const fetchKnowledge = Effect.fn("fetchKnowledge")(function* (
  order: WorkOrderV1,
  port: KnowledgePort | null,
) {
  if (!order.knowledge.required) return { ok: true, summary: null } as const;
  if (port === null) return { ok: false, refusal: REFUSALS.knowledgeNotConfigured } as const;
  const fetched = yield* port.fetch(order);
  return fetched.ok ? ({ ok: true, summary: fetched.summary } as const) : fetched;
});

/** Knowledge, then executor. Every outcome, including a refusal, is a result to store. */
const attempt = (order: WorkOrderV1, deps: WorkOrderDeps): Effect.Effect<CodeResultV1> => {
  const { executor } = deps;
  if (executor === null) {
    return Effect.succeed(refusedResult(order, REFUSALS.executorNotConfigured));
  }
  return Effect.gen(function* () {
    const fetched = yield* fetchKnowledge(order, deps.knowledge);
    if (!fetched.ok) return refusedResult(order, fetched.refusal);
    const { summary } = fetched;
    const built = yield* executor.run(order, summary?.included ?? []).pipe(
      Effect.map((commits) => (isCommit(commits.base) && isCommit(commits.head) ? commits : null)),
      Effect.catchTags({ ExecutorFailed: () => Effect.succeed(null) }),
    );
    if (built === null) {
      return refusedResult(order, REFUSALS.executorFailed, { builderModel: executor.model });
    }
    return resultFor(order, {
      state: "built",
      refusal: null,
      base: built.base,
      head: built.head,
      builder_model: executor.model,
      // Ids only: a port that hands back passage text never reaches the result.
      knowledge:
        summary === null
          ? null
          : {
              result_revision: summary.result_revision,
              included: summary.included.map(({ path_id, revision, revision_digest }) => ({
                path_id,
                revision,
                revision_digest,
              })),
              omitted_count: summary.omitted_count,
            },
    });
  });
};

/**
 * Store the result, report it once, and re-save with the report outcome. While a report
 * port is configured the first save says `held`: a crash before the report leaves a
 * result a person must look at, never one that claims delivery.
 */
const record = Effect.fn("record")(function* (
  order: WorkOrderV1,
  deps: WorkOrderDeps,
  outcome: CodeResultV1,
) {
  const saved = (result: CodeResultV1) =>
    deps.resultStore.write(order, result).pipe(Effect.mapError((refusal) => notStored(refusal)));
  const { report } = deps;
  if (report === null) {
    yield* saved(outcome);
    return outcome;
  }
  const pending: CodeResultV1 = { ...outcome, console_report: "held" };
  yield* saved(pending);
  const reported: CodeResultV1 = { ...pending, console_report: yield* report.report(pending) };
  // A failed re-save must not turn built work into a refusal: the Console already holds the
  // result. Answer with the copy on disk (`held`: a person must look) and name the cause.
  return yield* saved(reported).pipe(
    Effect.as(reported),
    Effect.catch((failed: NotStored) =>
      Effect.logWarning(
        `result re-save failed after the Console report, keeping the saved held result: ${failed.refusal}`,
      ).pipe(Effect.as(pending)),
    ),
  );
});

export const runWorkOrder = Effect.fn("runWorkOrder")(
  function* (order: WorkOrderV1, deps: WorkOrderDeps) {
    const receipts = yield* CommandReceiptStoreV2;
    const acceptedAt = yield* DateTime.now;
    const inserted = yield* receipts
      .insertIfAbsent({
        commandId: CommandId.make(order.work_order_id),
        projectId: ProjectId.make(order.project),
        commandType: WORK_ORDER_COMMAND_TYPE,
        acceptedAt,
        resultSequence: 0,
        status: "accepted",
        error: null,
        payloadDigest: commandPayloadDigest(order),
      })
      .pipe(
        Effect.mapError((error) =>
          notStored(
            error._tag === "CommandReceiptPayloadConflictError"
              ? REFUSALS.payloadConflict
              : REFUSALS.storeUnavailable,
          ),
        ),
      );
    // Read before anything runs: this also proves the receipt store is readable. A result
    // file beside a brand-new receipt predates it (the receipt store was lost), so it is
    // not replayed; this run overwrites it.
    const stored = yield* deps.resultStore
      .read(order)
      .pipe(Effect.mapError((refusal) => notStored(refusal, !inserted)));
    if (!inserted) {
      if (stored === null) return yield* Effect.fail(notStored(REFUSALS.inProgress, true));
      if (stored.refusal !== REFUSALS.knowledgeUnavailable) {
        return { ...stored, receipt: { ...stored.receipt, replayed: true } };
      }
      // Brain was unavailable and nothing ran (knowledge precedes the executor): ask again.
    }
    const outcome = yield* attempt(order, deps);
    return yield* record(
      order,
      deps,
      inserted ? outcome : { ...outcome, receipt: { ...outcome.receipt, replayed: true } },
    );
  },
  (self, order) =>
    Effect.catch(self, (failed: NotStored) =>
      Effect.succeed(refusedResult(order, failed.refusal, { replayed: failed.replayed })),
    ),
);
