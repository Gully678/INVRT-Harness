// Adapted from INVRT Blueprint a71c17b:contract.mjs. MIT Jason Ku notice and provenance in upstream/.
// Pure decisions only. Native G2 must authenticate callers, bind storage and verify exported files.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Deterministic synchronous hashing keeps this contract pure.
import * as NodeCrypto from "node:crypto";
import {
  BLUEPRINT_CONTRACT_VERSION,
  BLUEPRINT_LIMITS,
  BlueprintOperation,
  BlueprintSessionInput,
  BlueprintState,
  type BlueprintDecision,
  type BlueprintApplyResult,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

type Failure = { readonly ok: false; readonly code: string; readonly currentRevision?: number };
type Success = { readonly ok: true; readonly state: BlueprintState };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

function canonical(value: unknown, depth: number): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (!(Array.isArray(value) || isObject(value))) throw new Error("wrong_type");
  if (depth >= BLUEPRINT_LIMITS.contentDepth) throw new Error("content_too_deep");
  if (Object.getOwnPropertySymbols(value).length) throw new Error("wrong_type");
  if (Array.isArray(value)) {
    if (![Array.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new Error("wrong_type");
    const fields = Object.getOwnPropertyDescriptors(value);
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0 || Object.keys(fields).length !== length + 1)
      throw new Error("wrong_type");
    const items: string[] = [];
    // Iterators and indexed reads can invoke caller code; only own data descriptors are JSON data.
    for (let index = 0; index < length; index++) {
      const field = Object.hasOwn(fields, index) ? fields[index] : undefined;
      if (!field || !("value" in field)) throw new Error("wrong_type");
      items.push(canonical(field.value, depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  return `{${Object.keys(fields)
    .sort()
    .map((key) => {
      const field = fields[key];
      if (!field || !("value" in field) || !field.enumerable) throw new Error("wrong_type");
      return `${JSON.stringify(key)}:${canonical(field.value, depth + 1)}`;
    })
    .join(",")}}`;
}

export const canonicalJson = (value: unknown): string => canonical(value, 0);
const sha256Hex = (value: string) =>
  NodeCrypto.createHash("sha256").update(value, "utf8").digest("hex");
export const digest = (value: unknown): string => sha256Hex(canonicalJson(value));
export const serialise = (state: BlueprintState): string => JSON.stringify(state);
const strict = { onExcessProperty: "error" } as const;
const decodeInput = Schema.decodeUnknownOption(BlueprintSessionInput, strict);
const decodeOperation = Schema.decodeUnknownOption(BlueprintOperation, strict);
const decodeState = Schema.decodeUnknownOption(BlueprintState, strict);
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;
const reject = (
  state: BlueprintState,
  code: string,
): Extract<BlueprintApplyResult, { ok: false }> => ({
  ok: false,
  code,
  currentRevision: state.revision,
});
const decisionDigest = (state: BlueprintState) =>
  digest({ questions: state.questions, answers: state.answers, terms: state.terms });
export const specStatus = (state: BlueprintState): "none" | "current" | "stale" =>
  state.spec === null
    ? "none"
    : state.spec.decisionDigest === decisionDigest(state)
      ? "current"
      : "stale";
const boundToSpec = (
  state: BlueprintState,
  record: { readonly specRevision: number; readonly specDigest: string },
) =>
  state.spec !== null &&
  specStatus(state) === "current" &&
  record.specRevision === state.spec.revision &&
  record.specDigest === state.spec.digest;
export const visualStatus = (state: BlueprintState): "none" | "current" | "stale" =>
  state.visual === null ? "none" : boundToSpec(state, state.visual) ? "current" : "stale";
export const reviewStatus = (state: BlueprintState): "none" | "current" | "stale" =>
  state.review === null ? "none" : boundToSpec(state, state.review) ? "current" : "stale";
export function exportStatus(
  state: BlueprintState,
): "none" | "pending" | "succeeded" | "cancelled" | "stale" {
  if (state.export === null) return "none";
  return state.export.status === "succeeded" && !boundToSpec(state, state.export)
    ? "stale"
    : state.export.status;
}

export function createSession(input: unknown): Success | Failure {
  try {
    input = JSON.parse(canonicalJson(input));
  } catch {
    return { ok: false, code: "invalid_session" };
  }
  const parsed = decodeInput(input);
  if (Option.isNone(parsed)) return { ok: false, code: "invalid_session" };
  return {
    ok: true,
    state: {
      contractVersion: BLUEPRINT_CONTRACT_VERSION,
      ...parsed.value,
      status: "open",
      revision: 0,
      questions: {},
      answers: {},
      answerHistory: [],
      notes: [],
      terms: [],
      spec: null,
      visual: null,
      export: null,
      review: null,
      operations: {},
    },
  };
}

type Outcome =
  | {
      readonly patch: Partial<BlueprintState>;
      readonly identity?: { readonly questionId?: string; readonly noteId?: number };
    }
  | string;
const prerequisitesSettled = (state: BlueprintState, dependencies: readonly string[]) =>
  dependencies.every((id) => own(state.questions, id)?.status === "answered");

function handle(state: BlueprintState, op: BlueprintOperation): Outcome {
  switch (op.type) {
    case "ask_questions": {
      if (
        Object.keys(state.questions).length + op.payload.questions.length >
        BLUEPRINT_LIMITS.questions
      )
        return "questions_full";
      const ids = op.payload.questions.map((q) => q.id);
      if (new Set(ids).size !== ids.length || ids.some((id) => own(state.questions, id)))
        return "duplicate_question";
      for (const q of op.payload.questions) {
        if (new Set(q.dependencies).size !== q.dependencies.length || q.dependencies.includes(q.id))
          return "invalid_dependencies";
        if (!prerequisitesSettled(state, q.dependencies)) return "prerequisites_unsettled";
        const options = q.options.map((option) => option.id);
        if (new Set(options).size !== options.length) return "duplicate_option";
        if (q.recommendation !== null && !options.includes(q.recommendation))
          return "unknown_option";
      }
      if (Object.values(state.questions).some((q) => q.status === "open")) return "question_open";
      return {
        patch: {
          questions: {
            ...state.questions,
            ...Object.fromEntries(
              op.payload.questions.map((q) => [
                q.id,
                { ...q, status: "open" as const, reason: null },
              ]),
            ),
          },
        },
      };
    }
    case "record_answer": {
      const { questionId, ...answer } = op.payload;
      const q = own(state.questions, questionId);
      if (!q) return "unknown_question";
      if (q.status !== "open") return "question_settled";
      if (!prerequisitesSettled(state, q.dependencies)) return "prerequisites_unsettled";
      if (answer.kind === "option") {
        if (!q.multiple && answer.options.length !== 1) return "single_answer_required";
        if (new Set(answer.options).size !== answer.options.length) return "duplicate_option";
        if (answer.options.some((id) => !q.options.some((option) => option.id === id)))
          return "unknown_option";
      }
      if (answer.kind === "accept" && q.recommendation === null) return "recommendation_missing";
      const previous = state.answerHistory.filter(
        (record) => record.questionId === questionId,
      ).length;
      const record: BlueprintDecision = {
        ...answer,
        questionId,
        revision: previous + 1,
        operationId: op.operationId,
        supersededBy: null,
      };
      return {
        patch: {
          answers: { ...state.answers, [questionId]: record },
          answerHistory: [...state.answerHistory, record],
          questions: {
            ...state.questions,
            [questionId]: { ...q, status: "answered", reason: null },
          },
        },
        identity: { questionId },
      };
    }
    case "add_note": {
      if (state.notes.length >= BLUEPRINT_LIMITS.notes) return "notes_full";
      if (op.payload.questionId !== undefined && !own(state.questions, op.payload.questionId))
        return "unknown_question";
      const id = state.notes.length + 1;
      return {
        patch: { notes: [...state.notes, { id, ...op.payload, operationId: op.operationId }] },
        identity: { noteId: id },
      };
    }
    case "defer_question": {
      const q = own(state.questions, op.payload.questionId);
      if (!q) return "unknown_question";
      if (q.status !== "open") return "question_settled";
      return {
        patch: {
          questions: {
            ...state.questions,
            [q.id]: { ...q, status: "deferred", reason: op.payload.reason },
          },
        },
        identity: { questionId: q.id },
      };
    }
    case "reopen_question": {
      const q = own(state.questions, op.payload.questionId);
      if (!q) return "unknown_question";
      if (q.status === "open") return "question_open";
      const reopened = new Set([q.id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const candidate of Object.values(state.questions)) {
          if (
            !reopened.has(candidate.id) &&
            candidate.dependencies.some((id) => reopened.has(id))
          ) {
            reopened.add(candidate.id);
            changed = true;
          }
        }
      }
      return {
        patch: {
          questions: Object.fromEntries(
            Object.entries(state.questions).map(([id, value]) => [
              id,
              reopened.has(id)
                ? { ...value, status: "open" as const, reason: op.payload.reason }
                : value,
            ]),
          ),
          answers: Object.fromEntries(
            Object.entries(state.answers).filter(([id]) => !reopened.has(id)),
          ),
          answerHistory: state.answerHistory.map((record) =>
            reopened.has(record.questionId) && record.supersededBy === null
              ? { ...record, supersededBy: op.operationId }
              : record,
          ),
        },
        identity: { questionId: q.id },
      };
    }
    case "set_terms": {
      if (new Set(op.payload.terms.map((term) => term.term)).size !== op.payload.terms.length)
        return "duplicate_term";
      return { patch: { terms: op.payload.terms } };
    }
    case "set_spec": {
      const decisions = decisionDigest(state);
      const { content } = op.payload;
      return {
        patch: {
          spec: {
            revision: (state.spec?.revision ?? 0) + 1,
            content,
            decisionDigest: decisions,
            digest: sha256Hex(
              canonical(
                { content, decisionDigest: decisions, sourceEvidence: state.sourceEvidence },
                -1,
              ),
            ),
          },
        },
      };
    }
    case "record_visual": {
      if (!boundToSpec(state, op.payload)) return "spec_mismatch";
      return {
        patch: {
          visual: {
            revision: (state.visual?.revision ?? 0) + 1,
            kind: op.payload.kind,
            digest: op.payload.visualDigest,
            specRevision: op.payload.specRevision,
            specDigest: op.payload.specDigest,
          },
        },
      };
    }
    case "review_spec": {
      if (!boundToSpec(state, op.payload)) return "spec_mismatch";
      return { patch: { review: { revision: (state.review?.revision ?? 0) + 1, ...op.payload } } };
    }
    case "start_export": {
      if (state.export?.status === "pending") return "export_in_progress";
      if (
        Object.values(state.operations).some(
          ({ operation }) =>
            operation.type === "start_export" && operation.payload.exportId === op.payload.exportId,
        )
      )
        return "export_conflict";
      if (!boundToSpec(state, op.payload)) return "spec_mismatch";
      return {
        patch: {
          export: {
            revision: (state.export?.revision ?? 0) + 1,
            ...op.payload,
            status: "pending",
            manifestDigest: null,
          },
        },
      };
    }
    case "complete_export": {
      if (state.export?.status !== "pending" || state.export.exportId !== op.payload.exportId)
        return "export_not_pending";
      if (!boundToSpec(state, state.export)) return "spec_mismatch";
      return {
        patch: {
          export: {
            ...state.export,
            revision: state.export.revision + 1,
            status: "succeeded",
            manifestDigest: op.payload.manifestDigest,
          },
        },
      };
    }
    case "cancel_export": {
      if (state.export?.status !== "pending" || state.export.exportId !== op.payload.exportId)
        return "export_not_pending";
      return {
        patch: {
          export: { ...state.export, revision: state.export.revision + 1, status: "cancelled" },
        },
      };
    }
    case "finish": {
      if (Object.values(state.questions).some((q) => q.status !== "answered"))
        return "questions_unsettled";
      if (exportStatus(state) !== "succeeded") return "export_required";
      return { patch: { status: "finished" } };
    }
    case "cancel_session":
      return {
        patch: {
          status: "cancelled",
          ...(state.export?.status === "pending"
            ? {
                export: {
                  ...state.export,
                  revision: state.export.revision + 1,
                  status: "cancelled",
                },
              }
            : {}),
        },
      };
  }
}

export function apply(state: BlueprintState, input: unknown): BlueprintApplyResult {
  let encoded: string;
  try {
    encoded = canonical(input, -3);
  } catch {
    return reject(state, "invalid_operation");
  }
  if (encoded.length > BLUEPRINT_LIMITS.contentLength) return reject(state, "operation_too_large");
  const decoded = decodeOperation(JSON.parse(encoded));
  if (Option.isNone(decoded)) return reject(state, "invalid_operation");
  const op = decoded.value;
  if (op.type === "set_spec") {
    try {
      canonicalJson(op.payload.content);
    } catch {
      return reject(state, "invalid_operation");
    }
  }
  if (op.sessionId !== state.sessionId || op.projectId !== state.projectId)
    return reject(state, "scope_mismatch");
  const fingerprint = sha256Hex(encoded);
  const prior = own(state.operations, op.operationId);
  if (prior)
    return prior.fingerprint === fingerprint
      ? { ok: true, replayed: true, result: prior.result, state }
      : reject(state, "operation_conflict");
  if (state.status !== "open") return reject(state, `session_${state.status}`);
  if (op.baseRevision !== state.revision) return reject(state, "stale_revision");
  if (state.revision + (op.type === "cancel_session" ? 0 : 1) >= BLUEPRINT_LIMITS.operations)
    return reject(state, "operations_full");
  const outcome = handle(state, op);
  if (typeof outcome === "string") return reject(state, outcome);
  const result = {
    operationId: op.operationId,
    type: op.type,
    revision: state.revision + 1,
    ...outcome.identity,
  };
  const next: BlueprintState = {
    ...state,
    ...outcome.patch,
    revision: result.revision,
    operations: { ...state.operations, [op.operationId]: { operation: op, fingerprint, result } },
  };
  // Reserve bounded space for the final cancel receipt, including maximum-length identifiers.
  if (
    serialise(next).length >
    BLUEPRINT_LIMITS.savedLength - (op.type === "cancel_session" ? 0 : 4096)
  )
    return reject(state, "state_full");
  return { ok: true, replayed: false, result, state: next };
}

export function restore(saved: unknown): Success | Failure {
  if (typeof saved !== "string" || saved.length > BLUEPRINT_LIMITS.savedLength)
    return { ok: false, code: "invalid_state" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
    canonical(parsed, -8);
  } catch {
    return { ok: false, code: "invalid_state" };
  }
  if (isObject(parsed) && parsed.contractVersion !== BLUEPRINT_CONTRACT_VERSION)
    return { ok: false, code: "unsupported_contract_version" };
  const decoded = decodeState(parsed);
  if (Option.isNone(decoded)) return { ok: false, code: "invalid_state" };
  const state = decoded.value;
  const initial = createSession({
    sessionId: state.sessionId,
    projectId: state.projectId,
    domain: state.domain,
    sourceEvidence: state.sourceEvidence,
  });
  if (!initial.ok || Object.keys(state.operations).length > BLUEPRINT_LIMITS.operations)
    return { ok: false, code: "invalid_state" };
  let replayed = initial.state;
  // Rebuild every record from its exact scoped operation, not merely an existing ledger ID.
  for (const entry of Object.values(state.operations).sort(
    (a, b) => a.result.revision - b.result.revision,
  )) {
    const applied = apply(replayed, entry.operation);
    if (
      !applied.ok ||
      applied.replayed ||
      entry.fingerprint !== sha256Hex(canonical(entry.operation, -3)) ||
      canonicalJson(entry.result) !== canonicalJson(applied.result)
    )
      return { ok: false, code: "invalid_state" };
    replayed = applied.state;
  }
  if (canonical(state, -8) !== canonical(replayed, -8)) return { ok: false, code: "invalid_state" };
  return { ok: true, state: replayed };
}
