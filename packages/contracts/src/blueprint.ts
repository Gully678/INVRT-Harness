import * as Schema from "effect/Schema";

export const BLUEPRINT_CONTRACT_VERSION = 2;
export const BLUEPRINT_LIMITS = Object.freeze({
  idLength: 128,
  textLength: 20_000,
  contentLength: 200_000,
  contentDepth: 32,
  questions: 500,
  notes: 2_000,
  operations: 5_000,
  savedLength: 8_000_000,
});

const id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/));
const text = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(BLUEPRINT_LIMITS.textLength),
  Schema.makeFilter((value) => value.trim().length > 0),
);
const revision = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const positive = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const evidence = Schema.Array(text).check(Schema.isMaxLength(20));
const ids = Schema.Array(id).check(Schema.isMaxLength(BLUEPRINT_LIMITS.questions));
const binding = { specRevision: positive, specDigest: sha256 };

export const BlueprintSessionInput = Schema.Struct({
  sessionId: id,
  projectId: id,
  domain: Schema.Literals(["software", "marketing"]),
  sourceEvidence: evidence,
});
export type BlueprintSessionInput = typeof BlueprintSessionInput.Type;

export const BlueprintQuestion = Schema.Struct({
  id,
  prompt: text,
  dependencies: ids,
  multiple: Schema.Boolean,
  options: Schema.Array(Schema.Struct({ id, label: text, tradeoff: text })).check(
    Schema.isMaxLength(20),
  ),
  recommendation: Schema.NullOr(id),
  sourceEvidence: evidence,
});
export type BlueprintQuestion = typeof BlueprintQuestion.Type;

const answer = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("accept"), rawAnswer: text }),
  Schema.Struct({
    kind: Schema.Literal("option"),
    options: Schema.Array(id).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
    rawAnswer: text,
  }),
  Schema.Struct({ kind: Schema.Literal("text"), text, rawAnswer: text }),
]);
export type BlueprintAnswer = typeof answer.Type;

const note = {
  questionId: Schema.optionalKey(id),
  author: Schema.Literals(["user", "agent"]),
  text,
};
const terms = Schema.Array(
  Schema.Struct({ term: text, definition: text, sourceEvidence: evidence }),
).check(Schema.isMaxLength(100));
const envelope = {
  contractVersion: Schema.Literal(BLUEPRINT_CONTRACT_VERSION),
  sessionId: id,
  projectId: id,
  operationId: id,
  baseRevision: revision,
};
const operation = <const Type extends string, Payload extends Schema.Top>(
  type: Type,
  payload: Payload,
) => Schema.Struct({ ...envelope, type: Schema.Literal(type), payload });

export const BlueprintOperation = Schema.Union([
  operation(
    "ask_questions",
    Schema.Struct({
      questions: Schema.Array(BlueprintQuestion).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(3),
      ),
    }),
  ),
  operation(
    "record_answer",
    Schema.Union(
      answer.members.map((member) => Schema.Struct({ questionId: id, ...member.fields })),
    ),
  ),
  operation("add_note", Schema.Struct(note)),
  operation("defer_question", Schema.Struct({ questionId: id, reason: text })),
  operation("reopen_question", Schema.Struct({ questionId: id, reason: text })),
  operation("set_terms", Schema.Struct({ terms })),
  operation("set_spec", Schema.Struct({ content: Schema.Record(Schema.String, Schema.Json) })),
  operation(
    "record_visual",
    Schema.Struct({
      kind: Schema.Literals(["prototype", "diagram"]),
      visualDigest: sha256,
      ...binding,
    }),
  ),
  operation("review_spec", Schema.Struct(binding)),
  operation("start_export", Schema.Struct({ exportId: id, ...binding })),
  operation("complete_export", Schema.Struct({ exportId: id, manifestDigest: sha256 })),
  operation("cancel_export", Schema.Struct({ exportId: id })),
  operation("finish", Schema.Struct({})),
  operation("cancel_session", Schema.Struct({})),
]);
export type BlueprintOperation = typeof BlueprintOperation.Type;

const decisionFields = {
  questionId: id,
  revision: positive,
  operationId: id,
  supersededBy: Schema.NullOr(id),
};
export const BlueprintDecision = Schema.Union(
  answer.members.map((member) => Schema.Struct({ ...decisionFields, ...member.fields })),
);
export type BlueprintDecision = typeof BlueprintDecision.Type;

const questionRecord = Schema.Struct({
  ...BlueprintQuestion.fields,
  status: Schema.Literals(["open", "answered", "deferred"]),
  reason: Schema.NullOr(text),
});
export const BlueprintOperationResult = Schema.Struct({
  operationId: id,
  type: Schema.String,
  revision: positive,
  questionId: Schema.optionalKey(id),
  noteId: Schema.optionalKey(positive),
});
export type BlueprintOperationResult = typeof BlueprintOperationResult.Type;

export const BlueprintState = Schema.Struct({
  contractVersion: Schema.Literal(BLUEPRINT_CONTRACT_VERSION),
  ...BlueprintSessionInput.fields,
  status: Schema.Literals(["open", "finished", "cancelled"]),
  revision,
  questions: Schema.Record(id, questionRecord),
  answers: Schema.Record(id, BlueprintDecision),
  answerHistory: Schema.Array(BlueprintDecision),
  notes: Schema.Array(Schema.Struct({ id: positive, ...note, operationId: id })).check(
    Schema.isMaxLength(BLUEPRINT_LIMITS.notes),
  ),
  terms,
  spec: Schema.NullOr(
    Schema.Struct({
      revision: positive,
      digest: sha256,
      decisionDigest: sha256,
      content: Schema.Record(Schema.String, Schema.Json),
    }),
  ),
  visual: Schema.NullOr(
    Schema.Struct({
      revision: positive,
      kind: Schema.Literals(["prototype", "diagram"]),
      digest: sha256,
      ...binding,
    }),
  ),
  review: Schema.NullOr(Schema.Struct({ revision: positive, ...binding })),
  export: Schema.NullOr(
    Schema.Struct({
      revision: positive,
      exportId: id,
      status: Schema.Literals(["pending", "succeeded", "cancelled"]),
      manifestDigest: Schema.NullOr(sha256),
      ...binding,
    }),
  ),
  operations: Schema.Record(
    id,
    Schema.Struct({
      operation: BlueprintOperation,
      fingerprint: sha256,
      result: BlueprintOperationResult,
    }),
  ),
});
export type BlueprintState = typeof BlueprintState.Type;

export const BlueprintApplyResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    replayed: Schema.Boolean,
    result: BlueprintOperationResult,
    state: BlueprintState,
  }),
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, currentRevision: revision }),
]);
export type BlueprintApplyResult = typeof BlueprintApplyResult.Type;
