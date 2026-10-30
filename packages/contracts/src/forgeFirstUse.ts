import * as Schema from "effect/Schema";
import { ProjectId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/));
const BeginPlanningFields = Schema.Struct({
  projectId: ProjectId,
  providerInstanceId: ProviderInstanceId,
  operationId: Id,
});
export const ForgeBeginPlanningInput = Schema.Unknown.check(
  Schema.makeFilter<unknown>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).every((key) =>
        ["projectId", "providerInstanceId", "operationId"].includes(key),
      ),
  ),
).pipe(Schema.decodeTo(BeginPlanningFields));
export type ForgeBeginPlanningInput = typeof ForgeBeginPlanningInput.Type;
const StartPlanningFields = Schema.Struct({
  runId: Id,
  revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  operationId: Id,
});
export const ForgeStartPlanningInput = Schema.Unknown.check(
  Schema.makeFilter<unknown>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).every((key) => ["runId", "revision", "operationId"].includes(key)),
  ),
).pipe(Schema.decodeTo(StartPlanningFields));
export type ForgeStartPlanningInput = typeof ForgeStartPlanningInput.Type;
export const ForgePlanningDeniedCode = Schema.Literals([
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "expired",
  "revoked",
  "stale_revision",
  "idempotency_conflict",
  "wrong_binding",
  "plan_mode_unavailable",
  "trust_mismatch",
  "capability_unavailable",
]);
export type ForgePlanningDeniedCode = typeof ForgePlanningDeniedCode.Type;
export class ForgePlanningError extends Schema.TaggedError<ForgePlanningError>()(
  "ForgePlanningError",
  { code: ForgePlanningDeniedCode },
) {
  override get message(): string {
    return `Local planning unavailable: ${this.code}.`;
  }
}
// Wire data is descriptive. Only the server module can construct its private binding.
export const ForgePlanningBinding = Schema.Struct({
  purpose: Schema.Literal("local-native-planning-v1"),
  runId: Schema.String,
  revision: Schema.Number,
  nativeSessionId: Schema.String,
  subject: Schema.String,
  sessionMethod: Schema.String,
  environmentId: Schema.String,
  projectId: Schema.String,
  threadId: Schema.String,
  providerInstanceId: Schema.String,
  taskSha256: Schema.String,
  manifestSha256: Schema.String,
  trustRevision: Schema.Literal(1),
  sourceRevision: Schema.String,
  humanVerified: Schema.Literal(false),
  buildAuthorised: Schema.Literal(false),
  allowedEffects: Schema.Tuple([Schema.Literal("native-provider-plan-turn")]),
  nativeTurnHeld: Schema.Literal(true),
});
export type ForgePlanningBinding = typeof ForgePlanningBinding.Type;
export const ForgePlanningPrepared = Schema.Struct({
  binding: ForgePlanningBinding,
  state: Schema.Literal("prepared"),
  nativeTurnHeld: Schema.Literal(true),
  hold: Schema.Struct({
    code: Schema.Literal("plan_mode_unavailable"),
    reason: Schema.Literal("native_policy_unqualified"),
  }),
});
export type ForgePlanningPrepared = typeof ForgePlanningPrepared.Type;
