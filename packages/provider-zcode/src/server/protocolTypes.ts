/**
 * Shapes of the ZCode Protocol (ZCode CLI app-server) payloads this adapter relies on.
 * Every shape is grounded in live transcripts under oneday-evidence/transcripts/ of the
 * one-day INVRT Code build (2026-10-27, ZCode CLI 0.16.5). Parsing is tolerant: unknown
 * extra fields are kept, unknown unions degrade to "unknown" instead of failing.
 */

export interface ZcodeProtocolErrorShape {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** Error codes observed in the protocol (oneday-evidence/ZCODE-PROTOCOL-NOTES.md section 2). */
export const ZCODE_ERROR_METHOD_NOT_FOUND = -32601;
export const ZCODE_ERROR_INVALID_PARAMS = -32602;
export const ZCODE_ERROR_SESSION_NOT_ACTIVE = -32004;
export const ZCODE_ERROR_MODEL_CONFIG_MISSING = "ModelConfigMissing";

export interface ZcodeSessionSummary {
  readonly sessionId: string;
  readonly status: string;
  readonly mode: string;
  readonly title?: string;
  readonly sessionKind?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly workspace?: { readonly workspaceKey?: string; readonly workspacePath?: string };
}

export interface ZcodeUsageWindowTotals {
  readonly totalTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheCreationTokens?: number;
  readonly cacheReadTokens?: number;
}

export interface ZcodeUsageStatsResult {
  readonly range: string;
  readonly generatedAt: number;
  readonly timeZone?: string;
  readonly source?: string;
  readonly summary?: ZcodeUsageWindowTotals & {
    readonly totalSessions?: number;
    readonly totalTurns?: number;
    readonly toolCallCount?: number;
    readonly activeDays?: number;
    readonly favoriteModel?: { readonly modelId?: string; readonly totalTokens?: number };
  };
  readonly dailyModelUsage?: ReadonlyArray<{
    readonly date?: string;
    readonly totalTokens?: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly reasoningTokens?: number;
    readonly cacheCreationTokens?: number;
    readonly cacheReadTokens?: number;
    readonly turnCount?: number;
    readonly models?: ReadonlyArray<{ readonly modelId?: string; readonly totalTokens?: number }>;
  }>;
}

export interface ZcodeSessionUsageResult extends ZcodeUsageWindowTotals {
  readonly sessionId: string;
  readonly modelRequestCount?: number;
  readonly modelErrorCount?: number;
  readonly inputBaselineBySource?: Readonly<Record<string, number>>;
}

/** Live session state usage block (bundle schema `ije`; see protocol notes section 6). */
export interface ZcodeSessionStateUsage {
  readonly contextWindow?: {
    readonly usedTokens?: number;
    readonly maxTokens?: number;
    readonly autoCompactThresholdTokens?: number | null;
  } | null;
  readonly cumulative?: {
    readonly totalTokens?: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
}

/** Transcript part types seen in session/read (t11) and session/event payloads. */
export type ZcodeTranscriptPart =
  | { readonly type: "text"; readonly partId?: string; readonly text?: string }
  | { readonly type: "reasoning"; readonly partId?: string; readonly text?: string }
  | {
      readonly type: "tool";
      readonly partId?: string;
      readonly callId?: string;
      readonly tool?: string;
      readonly state?: {
        readonly status?: string;
        readonly error?: string | { readonly message?: string };
        readonly completedAt?: number;
      };
      readonly input?: unknown;
      readonly output?: unknown;
    }
  | { readonly type: "step-start"; readonly partId?: string }
  | {
      readonly type: "step-finish";
      readonly partId?: string;
      readonly reason?: string;
      readonly tokens?: {
        readonly total?: number;
        readonly input?: number;
        readonly output?: number;
        readonly reasoning?: number;
        readonly cache?: { readonly read?: number; readonly write?: number };
      };
    }
  | { readonly type: "timeline"; readonly partId?: string; readonly timelineType?: string }
  | { readonly type: "unknown"; readonly partId?: string; readonly kind: string };

export interface ZcodeTranscriptMessage {
  readonly info?: {
    readonly role?: string;
    readonly messageId?: string;
    readonly finish?: string | null;
    readonly model?: { readonly modelId?: string; readonly providerId?: string };
    readonly tokens?: {
      readonly input?: number;
      readonly output?: number;
      readonly reasoning?: number;
      readonly cache?: { readonly read?: number; readonly write?: number };
    };
    readonly time?: { readonly created?: number; readonly completed?: number };
  };
  readonly parts?: ReadonlyArray<Record<string, unknown>>;
}

export interface ZcodeSessionReadResult {
  readonly messages?: ReadonlyArray<ZcodeTranscriptMessage>;
}

/** session/event notification params (bundle TLi; payload.kind is an open string). */
export interface ZcodeSessionEventNotification {
  readonly eventId?: string;
  readonly sessionId?: string;
  readonly deliveryKind?: string;
  readonly seq?: number;
  readonly payload?: Record<string, unknown>;
}

export function parseTranscriptPart(raw: Record<string, unknown>): ZcodeTranscriptPart {
  const type = typeof raw.type === "string" ? raw.type : "unknown";
  const partId = typeof raw.partId === "string" ? raw.partId : undefined;
  switch (type) {
    case "text":
    case "reasoning":
      return {
        type,
        ...(partId === undefined ? {} : { partId }),
        ...(typeof raw.text === "string" ? { text: raw.text } : {}),
      };
    case "step-start":
      return { type: "step-start", ...(partId === undefined ? {} : { partId }) };
    case "step-finish": {
      const tokens = raw.tokens;
      return {
        type: "step-finish",
        ...(partId === undefined ? {} : { partId }),
        ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
        ...(tokens !== null && typeof tokens === "object"
          ? { tokens: tokens as ZcodeStepTokens }
          : {}),
      };
    }
    case "tool": {
      const state = raw.state;
      return {
        type: "tool",
        ...(partId === undefined ? {} : { partId }),
        ...(typeof raw.callId === "string" ? { callId: raw.callId } : {}),
        ...(typeof raw.tool === "string" ? { tool: raw.tool } : {}),
        ...(state !== null && typeof state === "object" ? { state: state as ZcodeToolState } : {}),
        ...("input" in raw ? { input: raw.input } : {}),
        ...("output" in raw ? { output: raw.output } : {}),
      };
    }
    case "timeline":
      return {
        type: "timeline",
        ...(partId === undefined ? {} : { partId }),
        ...(typeof raw.timelineType === "string" ? { timelineType: raw.timelineType } : {}),
      };
    default:
      return { type: "unknown", ...(partId === undefined ? {} : { partId }), kind: type };
  }
}

export interface ZcodeStepTokens {
  readonly total?: number;
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cache?: { readonly read?: number; readonly write?: number };
}

export interface ZcodeToolState {
  readonly status?: string;
  readonly error?: string | { readonly message?: string };
  readonly completedAt?: number;
}
