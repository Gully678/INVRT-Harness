/**
 * Maps ZCode session/event payloads into ProviderAdapterV2Event updates.
 *
 * UNAUDITED against a live stream: the build machine has no ZCode model provider config,
 * so no live model turn could be captured (oneday-evidence/ZCODE-ADAPTER-EVIDENCE.md,
 * BLOCKED). The payload part shapes below reuse the part family verified in
 * session/read transcripts (text, reasoning, tool, step-start, step-finish, timeline).
 * Unknown payload kinds produce no updates rather than errors.
 */
import type { OrchestrationV2TurnItem, MessageId, ThreadId } from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { derive as deriveId } from "@t3tools/provider-core/server/IdAllocator";

import { ZCODE_PROVIDER } from "./adapter.ts";
import { parseTranscriptPart } from "./protocolTypes.ts";

export interface SessionTurnTargets {
  readonly providerThreadId: import("@t3tools/contracts").ProviderThreadId;
  readonly providerTurnId: import("@t3tools/contracts").ProviderTurnId;
  readonly threadId: ThreadId;
  readonly runId: import("@t3tools/contracts").RunId;
  readonly runOrdinal: number;
  readonly nodeId: import("@t3tools/contracts").NodeId;
  readonly attemptId: import("@t3tools/contracts").RunAttemptId;
}

interface TurnUpdateContext {
  readonly payload: Record<string, unknown>;
  readonly nativeSessionId: string;
  readonly targets: SessionTurnTargets | null;
  readonly threadId: ThreadId | null;
  /** Observed-at timestamp; the adapter passes the Effect Clock time. */
  readonly now: DateTime.Utc;
}

type TurnEvent = ProviderAdapter.ProviderAdapterV2Event;

function baseItemFields(
  context: TurnUpdateContext,
  nativeItemId: string,
  ordinal: number,
): Pick<
  OrchestrationV2TurnItem,
  | "id"
  | "threadId"
  | "runId"
  | "nodeId"
  | "providerThreadId"
  | "providerTurnId"
  | "nativeItemRef"
  | "parentItemId"
  | "ordinal"
  | "status"
  | "title"
  | "startedAt"
  | "completedAt"
  | "updatedAt"
> {
  const targets = context.targets;
  return {
    id: deriveId.turnItemFromProviderItem({
      driver: ZCODE_PROVIDER,
      nativeItemId,
    }),
    threadId: targets?.threadId ?? (context.threadId as ThreadId),
    runId: targets?.runId ?? null,
    nodeId: targets?.nodeId ?? null,
    providerThreadId: targets?.providerThreadId ?? null,
    providerTurnId: targets?.providerTurnId ?? null,
    nativeItemRef: { driver: ZCODE_PROVIDER, nativeId: nativeItemId, strength: "strong" },
    parentItemId: null,
    ordinal,
    status: "running",
    title: null,
    startedAt: context.now,
    completedAt: null,
    updatedAt: context.now,
  };
}

/**
 * Recognised payload shapes (documented in ZCODE-PROTOCOL-NOTES.md section 6):
 * - message payloads with a `parts` array (part family matches session/read), and an
 *   `info.finish` value marking completion ("completed" observed in transcripts).
 * - state payloads with a `usage` block are consumed by the adapter for context usage.
 * Everything else returns no updates. This mapping is UNAUDITED against the live stream.
 */
export function mapSessionEventToTurnUpdates(context: TurnUpdateContext): TurnEvent[] {
  if (context.targets === null) return [];
  const events: TurnEvent[] = [];
  const message = context.payload.message as Record<string, unknown> | undefined;
  const parts = (message?.parts ?? context.payload.parts) as
    | ReadonlyArray<Record<string, unknown>>
    | undefined;
  if (parts !== undefined) {
    let ordinal = 0;
    for (const raw of parts) {
      const part = parseTranscriptPart(raw);
      ordinal += 1;
      const nativeItemId = part.partId ?? `${context.nativeSessionId}:part:${ordinal}`;
      const base = baseItemFields(context, nativeItemId, ordinal);
      if (part.type === "text") {
        const item = {
          ...base,
          type: "assistant_message",
          messageId: deriveId.messageFromProviderItem({
            driver: ZCODE_PROVIDER,
            nativeItemId: nativeItemId,
          }) as MessageId,
          text: part.text ?? "",
          streaming: true,
        } as Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>;
        events.push({
          type: "turn_item.updated",
          driver: ZCODE_PROVIDER,
          turnItem: item,
        });
        continue;
      }
      if (part.type === "reasoning") {
        const item = {
          ...base,
          type: "reasoning",
          text: part.text ?? "",
          streaming: true,
        } as Extract<OrchestrationV2TurnItem, { type: "reasoning" }>;
        events.push({
          type: "turn_item.updated",
          driver: ZCODE_PROVIDER,
          turnItem: item,
        });
        continue;
      }
      if (part.type === "tool") {
        const failed = part.state?.error !== undefined;
        const item = {
          ...base,
          type: "command_execution",
          input: typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? ""),
          ...(part.state?.completedAt !== undefined ? { completedAt: context.now } : {}),
          ...(failed ? { outputIndicatesFailure: true } : {}),
          status: part.state?.completedAt !== undefined ? "completed" : "running",
        } as Extract<OrchestrationV2TurnItem, { type: "command_execution" }>;
        events.push({
          type: "turn_item.updated",
          driver: ZCODE_PROVIDER,
          turnItem: item,
        });
      }
    }
  }
  // Terminal detection: info.finish on a message payload, or a step-finish part whose
  // reason is not "tool-calls". Heuristic flagged UNAUDITED in the evidence file.
  const info = message?.info as Record<string, unknown> | undefined;
  const finish = typeof info?.finish === "string" ? info.finish : null;
  const stepFinish = Array.isArray(parts)
    ? parts.find((part) => part.type === "step-finish")
    : undefined;
  const stepReason =
    stepFinish !== undefined && typeof stepFinish.reason === "string" ? stepFinish.reason : null;
  const targets = context.targets;
  const completed = finish === "completed" || (stepReason !== null && stepReason !== "tool-calls");
  if (completed) {
    events.push({
      type: "turn.terminal",
      driver: ZCODE_PROVIDER,
      providerThreadId: targets.providerThreadId,
      providerTurnId: targets.providerTurnId,
      runOrdinal: targets.runOrdinal,
      status: "completed",
      failure: null,
      threadDisposition: "reusable",
    });
    return events;
  }
  if (finish !== null) {
    // Non-completed finish values (error, aborted) surface as a failed terminal.
    events.push({
      type: "turn.terminal",
      driver: ZCODE_PROVIDER,
      providerThreadId: targets.providerThreadId,
      providerTurnId: targets.providerTurnId,
      runOrdinal: targets.runOrdinal,
      failureItemOrdinal: 0,
      status: "failed",
      failure: {
        class: "provider_error",
        message: `ZCode turn finished with status: ${finish}.`,
        code: finish,
        retryable: true,
      },
      threadDisposition: "reusable",
    });
  }
  return events;
}

export type { OrchestrationV2TurnItem };
