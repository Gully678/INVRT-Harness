/**
 * ZCode provider adapter for T3 orchestration V2.
 *
 * Speaks the ZCode Protocol (ZCode CLI app-server) directly; the generic ACP path does
 * not fit because the app-server is not ACP (see oneday-evidence/ZCODE-PROTOCOL-NOTES.md).
 * Capabilities are declared honestly: operations the protocol does not support are
 * declared false and their adapter methods fail closed with explicit errors.
 *
 * Turn event mapping note (honest limitation): the live session/event stream could not be
 * captured on the build machine because no model provider config exists there (blocked on
 * Mark). The stream mapping reuses the part schema family verified in session/read
 * transcripts and is marked UNAUDITED in oneday-evidence/ZCODE-ADAPTER-EVIDENCE.md.
 */
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ThreadId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2ProviderRef,
  type ProviderInstanceId,
  type ProviderSessionId,
} from "@t3tools/contracts";
import { ZCodeSettings } from "../settings.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import { derive as deriveId } from "@t3tools/provider-core/server/IdAllocator";
import { turnScopedSelectionTransition } from "@t3tools/provider-core/server/selectionTransition";
import type { ProviderAdapterV2SessionRuntime } from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import {
  appServerCommand,
  startZcodeProtocolClient,
  ZcodeProtocolError,
  ZcodeProtocolClosedError,
  type ZcodeProtocolClient,
} from "./protocol.ts";
import {
  ZCODE_ERROR_SESSION_NOT_ACTIVE,
  parseTranscriptPart,
  type ZcodeSessionEventNotification,
  type ZcodeSessionReadResult,
  type ZcodeSessionStateUsage,
} from "./protocolTypes.ts";
import { mapSessionEventToTurnUpdates, type SessionTurnTargets } from "./eventMapping.ts";
import { sessionStateUsageToSnapshot } from "./mapping.ts";
import {
  ZCODE_DEFAULT_MODEL_SLUG,
  resolveZcodeExecutable,
  zcodeRuntimeModeToCliMode,
} from "./status.ts";

export const ZCODE_PROVIDER = ProviderDriverKind.make("zcode");
export const ZCODE_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(ZCODE_PROVIDER);

/**
 * Snapshot messages must not share one constant app thread id when the orchestrator has
 * not assigned appThreadId yet: that would group messages across provider threads. Fall
 * back to the same per-provider-thread derivation the id mapping uses elsewhere, unique
 * per native session id.
 */
export const snapshotAppThreadId = (
  appThreadId: ThreadId | null,
  nativeThreadId: string,
): ThreadId =>
  appThreadId ?? deriveId.threadFromProviderThread({ driver: ZCODE_PROVIDER, nativeThreadId });

const DEFAULT_ZCODE_SETTINGS: ZCodeSettings = Schema.decodeSync(ZCodeSettings)({});

/**
 * Honest capability declaration. Everything not proven against the ZCode Protocol is
 * false; see the capability matrix in oneday-evidence/ZCODE-ADAPTER-EVIDENCE.md.
 */
export const ZcodeProviderCapabilitiesV2: OrchestrationV2ProviderCapabilities = {
  sessions: {
    supportsMultipleProviderThreadsPerSession: false,
    supportsModelSwitchInSession: false,
    supportsProviderSwitchingViaHandoff: true,
    supportsRuntimeModeSwitchInSession: false,
    pendingRequestsSurviveRestart: false,
  },
  threads: {
    canCreateEmptyThread: true,
    canReadThreadSnapshot: true,
    canRollbackThread: false,
    canForkThread: false,
    canForkFromTurn: false,
    canForkFromSubagentThread: false,
    exposesNativeThreadId: true,
  },
  turns: {
    exposesNativeTurnId: false,
    emitsTurnStarted: true,
    emitsTurnCompleted: true,
    supportsInterrupt: true,
    supportsActiveSteering: false,
    supportsSteeringByInterruptRestart: false,
    supportsQueuedMessages: false,
    terminalStatusQuality: "weak",
  },
  streaming: {
    streamsAssistantText: true,
    streamsReasoning: true,
    streamsToolOutput: true,
    streamsPlanText: false,
    emitsMessageCompleted: true,
  },
  tools: {
    exposesToolItemIds: true,
    emitsToolStarted: true,
    emitsToolCompleted: true,
    emitsToolOutput: true,
    supportsMcpTools: false,
    supportsDynamicToolCallbacks: false,
  },
  approvals: {
    supportsCommandApproval: false,
    supportsFileReadApproval: false,
    supportsFileChangeApproval: false,
    supportsApplyPatchApproval: false,
    approvalsHaveNativeRequestIds: false,
    approvalCallbacksAreLiveOnly: true,
    approvalsCanOriginateFromSubagents: false,
  },
  planning: {
    emitsPlanUpdated: false,
    emitsTodoList: false,
    emitsProposedPlan: false,
    supportsStructuredQuestions: false,
    planDeltasHaveItemIds: false,
  },
  subagents: {
    supportsSubagents: false,
    exposesSubagentThreadIds: false,
    emitsSubagentLifecycle: false,
    canWaitForSubagents: false,
    canCloseSubagents: false,
    canForkSubagentThread: false,
  },
  context: {
    acceptsSystemContext: false,
    acceptsDeveloperContext: false,
    acceptsSyntheticUserContext: true,
    canGenerateSummaries: true,
    canConsumeHandoffSummaries: true,
    supportsDeltaHandoff: true,
    supportsFullThreadHandoff: true,
    maxRecommendedHandoffChars: null,
  },
  checkpointing: {
    appCanCheckpointFilesystem: true,
    supportsNestedCheckpointScopes: false,
    providerCanRollbackConversation: false,
    providerRollbackReturnsSnapshot: false,
    providerCanReadConversationSnapshot: true,
  },
  identity: {
    nativeThreadIds: "strong",
    nativeTurnIds: "none",
    nativeItemIds: "strong",
    nativeRequestIds: "none",
  },
  runtimePolicy: { enforcement: "client-boundary" },
};

const providerRef = (nativeId: string | null): OrchestrationV2ProviderRef => ({
  driver: ZCODE_PROVIDER,
  nativeId,
  strength: nativeId === null ? "none" : "strong",
});

const protocolErrorToFailure = (cause: unknown): OrchestrationV2ProviderFailure => {
  if (cause instanceof ZcodeProtocolError) {
    const data = cause.data as { message?: string } | undefined;
    const detail = typeof data?.message === "string" ? data.message : cause.message;
    const isModelConfig = cause.code === -32603 && detail.includes("Model config is missing");
    return makeProviderFailure({
      cause,
      message: isModelConfig
        ? "ZCode has no model provider config. Configure a model provider for the ZCode CLI, or point the binary path setting at a configured settings file."
        : detail,
      code: String(cause.code),
      class: isModelConfig ? "validation_error" : "provider_error",
      retryable: !isModelConfig,
    });
  }
  if (cause instanceof ZcodeProtocolClosedError) {
    return makeProviderFailure({
      cause,
      message: cause.message,
      class: "transport_error",
      retryable: true,
    });
  }
  return makeProviderFailure({ cause, class: "provider_error" });
};

export interface ZcodeAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly settings: ZCodeSettings;
  readonly environment: NodeJS.ProcessEnv;
}

export const makeZcodeAdapterV2 = Effect.fn("makeZcodeAdapterV2")(function* (
  options: ZcodeAdapterV2Options,
) {
  const getCapabilities: Effect.Effect<
    OrchestrationV2ProviderCapabilities,
    ProviderAdapter.ProviderAdapterV2Error
  > = Effect.succeed(ZcodeProviderCapabilitiesV2);

  const openSession = Effect.fn("ZcodeAdapter.openSession")(function* (
    input: ProviderAdapter.ProviderAdapterV2OpenSessionInput,
  ) {
    const providerSessionId = deriveId.providerSession({
      providerInstanceId: options.instanceId,
    });
    // ZA-02: the turn path uses the same shared resolver as status and usage, so decoded
    // defaults and cleared settings compose PATH then the app bundle, tilde overrides
    // expand before execution, and an explicit override that cannot resolve fails here
    // instead of spawning a broken command.
    const resolved = yield* resolveZcodeExecutable(
      options.settings.binaryPath,
      options.environment,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapter.ProviderAdapterOpenSessionError({
            driver: ZCODE_PROVIDER,
            providerSessionId,
            cause,
          }),
      ),
    );
    const command = appServerCommand(resolved.commandPath);
    type AdapterEvent = ProviderAdapter.ProviderAdapterV2Event;
    const eventQueue = yield* Queue.bounded<AdapterEvent>(512);
    const cwd = input.runtimePolicy.cwd ?? options.environment.HOME ?? process.cwd();
    const contextUsageRef = yield* Ref.make<ZcodeSessionStateUsage | undefined>(undefined);
    const publishedUsageRef = yield* Ref.make<string | null>(null);
    let nativeSessionId: string | null = null;
    let currentThread: OrchestrationV2ProviderThread | null = null;
    let activeTurn: SessionTurnTargets | null = null;

    const offer = (event: AdapterEvent) => Effect.runSync(Queue.offer(eventQueue, event));

    const onNotification = (method: string, params: unknown) => {
      if (method !== "session/event") return;
      const notification = params as ZcodeSessionEventNotification | undefined;
      const payload = notification?.payload;
      if (payload === undefined) return;
      const usage = payload.usage as ZcodeSessionStateUsage | undefined;
      if (usage !== undefined) {
        // ZA-03: a usage change is not only stored in the private ref. Once the thread is
        // live, a changed context usage is published as provider_thread.updated on the
        // session event stream, which is the projection caller's actual input.
        Effect.runSync(
          Effect.gen(function* () {
            yield* Ref.set(contextUsageRef, usage);
            if (currentThread === null) return;
            const snapshot = sessionStateUsageToSnapshot(usage);
            const key =
              snapshot === null
                ? null
                : `${snapshot.usedTokens}:${snapshot.maxTokens ?? ""}:${
                    snapshot.autoCompactThreshold ?? ""
                  }`;
            if (key === null || (yield* Ref.get(publishedUsageRef)) === key) return;
            yield* Ref.set(publishedUsageRef, key);
            const now = yield* DateTime.now;
            currentThread = { ...currentThread, contextUsage: snapshot, updatedAt: now };
            offer({
              type: "provider_thread.updated",
              driver: ZCODE_PROVIDER,
              providerThread: currentThread,
            });
          }),
        );
      }
      if (nativeSessionId === null) return;
      const updates = mapSessionEventToTurnUpdates({
        payload,
        nativeSessionId,
        targets: activeTurn,
        threadId: activeTurn?.threadId ?? null,
        now: Effect.runSync(DateTime.now),
      });
      for (const update of updates) {
        if (update.type === "turn.terminal" && currentThread !== null) {
          currentThread = {
            ...currentThread,
            status: update.threadDisposition === "broken" ? "error" : "idle",
          };
          activeTurn = null;
        }
        offer(update);
      }
    };

    const client: ZcodeProtocolClient = yield* Effect.acquireRelease(
      Effect.sync(() =>
        startZcodeProtocolClient({
          command,
          cwd,
          env: options.environment,
          requestTimeoutMs: 45_000,
          handlers: {
            requestRuntimePreferences: () => ({
              nativeSearchEnhancementsEnabled: false,
              memoryEnabled: false,
              askUserQuestionAutoResolutionEnabled: true,
              modelContextBudgetStrategy: "preflight-v1",
            }),
          },
          onNotification,
        }),
      ),
      (started) =>
        Effect.gen(function* () {
          if (nativeSessionId !== null && !started.closed) {
            // Best-effort native close; process exit also closes the session.
            yield* Effect.tryPromise({
              try: () => started.request("session/close", { sessionId: nativeSessionId ?? "" }),
              catch: () => undefined,
            }).pipe(Effect.ignore);
          }
          yield* Effect.promise(() => started.dispose());
        }),
    );

    const sessionNow = yield* DateTime.now;

    const providerThreadFor = (
      nativeId: string,
      now: DateTime.Utc,
      appThreadId: ThreadId | null,
    ): OrchestrationV2ProviderThread => ({
      id: deriveId.providerThread({
        driver: ZCODE_PROVIDER,
        providerInstanceId: options.instanceId,
        nativeThreadId: nativeId,
      }),
      driver: ZCODE_PROVIDER,
      providerInstanceId: options.instanceId,
      providerSessionId,
      appThreadId,
      ownerNodeId: null,
      nativeThreadRef: providerRef(nativeId),
      nativeConversationHeadRef: null,
      status: "idle",
      firstRunOrdinal: null,
      lastRunOrdinal: null,
      handoffIds: [],
      forkedFrom: null,
      contextUsage: sessionStateUsageToSnapshot(Effect.runSync(Ref.get(contextUsageRef))),
      createdAt: now,
      updatedAt: now,
    });

    /** Comparison key for publishing only changed context usage (ZA-03). */
    const usageKey = (thread: OrchestrationV2ProviderThread): string | null => {
      const usage = thread.contextUsage;
      if (usage === null || usage === undefined) return null;
      return `${usage.usedTokens}:${usage.maxTokens ?? ""}:${usage.autoCompactThreshold ?? ""}`;
    };

    const providerSessionFor = (now: DateTime.Utc): OrchestrationV2ProviderSession => ({
      id: providerSessionId,
      driver: ZCODE_PROVIDER,
      providerInstanceId: options.instanceId,
      status: "ready",
      cwd,
      model: ZCODE_DEFAULT_MODEL_SLUG,
      capabilities: ZcodeProviderCapabilitiesV2,
      createdAt: now,
      updatedAt: now,
      lastError: null,
    });

    const ensureNativeSession = (
      resumeNativeId: string | null,
    ): Effect.Effect<string, ProviderAdapter.ProviderAdapterOpenSessionError> =>
      Effect.tryPromise({
        try: async () => {
          if (resumeNativeId !== null) {
            await client.request("session/resume", { sessionId: resumeNativeId });
            return resumeNativeId;
          }
          const created = (await client.request("session/create", {
            workspace: { workspaceKey: cwd, workspacePath: cwd },
          })) as { sessionId?: string; session?: { sessionId?: string } };
          const sessionId = created.sessionId ?? created.session?.sessionId;
          if (sessionId === undefined) {
            throw new ZcodeProtocolError({
              code: -32603,
              message: "session/create returned no sessionId.",
            });
          }
          return sessionId;
        },
        catch: (cause) =>
          new ProviderAdapter.ProviderAdapterOpenSessionError({
            driver: ZCODE_PROVIDER,
            providerSessionId,
            cause,
          }),
      });

    const readSessionTranscript = (
      providerThreadId: import("@t3tools/contracts").ProviderThreadId,
      sessionId: string,
    ): Effect.Effect<
      ZcodeSessionReadResult,
      ProviderAdapter.ProviderAdapterReadThreadSnapshotError
    > =>
      Effect.tryPromise({
        try: async () => {
          try {
            return (await client.request("session/read", { sessionId })) as ZcodeSessionReadResult;
          } catch (cause) {
            // A persisted session that is not active in this process must be resumed first.
            if (
              cause instanceof ZcodeProtocolError &&
              cause.code === ZCODE_ERROR_SESSION_NOT_ACTIVE
            ) {
              await client.request("session/resume", { sessionId });
              return (await client.request("session/read", {
                sessionId,
              })) as ZcodeSessionReadResult;
            }
            throw cause;
          }
        },
        catch: (cause) =>
          new ProviderAdapter.ProviderAdapterReadThreadSnapshotError({
            driver: ZCODE_PROVIDER,
            providerThreadId,
            cause,
          }),
      });

    const runtime: ProviderAdapterV2SessionRuntime = {
      instanceId: options.instanceId,
      driver: ZCODE_PROVIDER,
      providerSessionId,
      providerSession: providerSessionFor(sessionNow),
      events: Stream.fromQueue(eventQueue),
      getModelContextWindow: () => {
        const usage = sessionStateUsageToSnapshot(Effect.runSync(Ref.get(contextUsageRef)));
        return usage?.maxTokens;
      },
      canReuseContextUsage: () => true,

      ensureThread: (ensureInput) =>
        Effect.gen(function* () {
          const resumeNativeId =
            ensureInput.existingProviderThread?.nativeThreadRef?.nativeId ?? null;
          const sessionId = yield* ensureNativeSession(resumeNativeId);
          nativeSessionId = sessionId;
          const now = yield* DateTime.now;
          const thread = ensureInput.existingProviderThread
            ? {
                ...ensureInput.existingProviderThread,
                appThreadId: ensureInput.threadId,
                nativeThreadRef: providerRef(sessionId),
                ...(resumeNativeId === null
                  ? { nativeConversationHeadRef: null, contextUsage: null }
                  : {}),
                updatedAt: now,
              }
            : providerThreadFor(sessionId, now, ensureInput.threadId);
          currentThread = thread;
          yield* Ref.set(publishedUsageRef, usageKey(thread));
          offer({
            type: "provider_session.updated",
            driver: ZCODE_PROVIDER,
            providerSession: { ...providerSessionFor(now), updatedAt: now },
          });
          offer({
            type: "provider_thread.updated",
            driver: ZCODE_PROVIDER,
            providerThread: thread,
          });
          return thread;
        }),

      resumeThread: (resumeInput) =>
        Effect.gen(function* () {
          const resumeNativeId = resumeInput.providerThread.nativeThreadRef?.nativeId ?? null;
          const sessionId = yield* ensureNativeSession(resumeNativeId);
          nativeSessionId = sessionId;
          const now = yield* DateTime.now;
          const thread = {
            ...resumeInput.providerThread,
            appThreadId: resumeInput.providerThread.appThreadId ?? resumeInput.threadId ?? null,
            nativeThreadRef: providerRef(sessionId),
            ...(resumeNativeId === null
              ? { nativeConversationHeadRef: null, contextUsage: null }
              : {}),
            updatedAt: now,
          };
          currentThread = thread;
          yield* Ref.set(publishedUsageRef, usageKey(thread));
          offer({
            type: "provider_thread.updated",
            driver: ZCODE_PROVIDER,
            providerThread: thread,
          });
          return thread;
        }),

      startTurn: (turnInput) =>
        Effect.gen(function* () {
          // ZA-01: the interaction policy is enforced here, at the adapter boundary and
          // before any effect. A plan interaction always sends the native plan mode, so a
          // plan thread can never acquire a build/edit/yolo execution mode, for every
          // runtime mode. Hiding the interaction-mode toggle in the UI is not enforcement.
          const mode =
            turnInput.runtimePolicy.interactionMode === "plan"
              ? "plan"
              : zcodeRuntimeModeToCliMode(turnInput.runtimePolicy.runtimeMode);
          currentThread = turnInput.providerThread;
          const sessionId = yield* ensureNativeSession(
            nativeSessionId ?? turnInput.providerThread.nativeThreadRef?.nativeId ?? null,
          );
          nativeSessionId = sessionId;
          const now = yield* DateTime.now;
          const providerThreadId = deriveId.providerThread({
            driver: ZCODE_PROVIDER,
            providerInstanceId: options.instanceId,
            nativeThreadId: sessionId,
          });
          const providerTurnId = deriveId.providerTurn({
            driver: ZCODE_PROVIDER,
            nativeTurnId: `turn:${turnInput.runId}`,
          });
          const turn: OrchestrationV2ProviderTurn = {
            id: providerTurnId,
            providerThreadId,
            nodeId: turnInput.rootNodeId,
            runAttemptId: turnInput.attemptId,
            nativeTurnRef: null,
            ordinal: turnInput.providerTurnOrdinal,
            status: "running",
            startedAt: now,
            completedAt: null,
          };
          activeTurn = {
            providerThreadId,
            providerTurnId,
            threadId: turnInput.threadId,
            runId: turnInput.runId,
            runOrdinal: turnInput.runOrdinal,
            nodeId: turnInput.rootNodeId,
            attemptId: turnInput.attemptId,
          };
          offer({
            type: "provider_turn.updated",
            driver: ZCODE_PROVIDER,
            threadId: turnInput.threadId,
            providerTurn: turn,
          });
          yield* Effect.tryPromise({
            try: () =>
              client.request("session/send", {
                sessionId,
                content: turnInput.message.text,
                mode,
              }),
            catch: (cause) =>
              new ProviderAdapter.ProviderAdapterTurnStartError({
                driver: ZCODE_PROVIDER,
                threadId: turnInput.threadId,
                providerThreadId,
                runId: turnInput.runId,
                cause,
              }),
          });
        }),

      steerTurn: (steerInput) =>
        Effect.fail(
          new ProviderAdapter.ProviderAdapterSteerRunUnsupportedError({
            driver: ZCODE_PROVIDER,
            providerThreadId: steerInput.providerThread.id,
          }),
        ),

      interruptTurn: (interruptInput) =>
        Effect.gen(function* () {
          const sessionId = interruptInput.providerThread.nativeThreadRef?.nativeId;
          if (sessionId === null || sessionId === undefined) return;
          yield* Effect.tryPromise({
            try: () => client.request("session/stop", { sessionId }),
            catch: (cause) =>
              new ProviderAdapter.ProviderAdapterInterruptError({
                driver: ZCODE_PROVIDER,
                providerThreadId: interruptInput.providerThread.id,
                providerTurnId: interruptInput.providerTurnId,
                cause,
              }),
          });
          currentThread = { ...interruptInput.providerThread, status: "idle" };
          activeTurn = null;
          offer({
            type: "turn.terminal",
            driver: ZCODE_PROVIDER,
            providerThreadId: interruptInput.providerThread.id,
            providerTurnId: interruptInput.providerTurnId,
            runOrdinal: interruptInput.providerThread.lastRunOrdinal ?? 1,
            status: "interrupted",
            failure: null,
            threadDisposition: "reusable",
          });
        }),

      respondToRuntimeRequest: (responseInput) =>
        Effect.fail(
          new ProviderAdapter.ProviderAdapterRuntimeRequestResponseError({
            driver: ZCODE_PROVIDER,
            requestId: responseInput.requestId,
            cause: new Error(
              "The ZCode adapter handles no interactive approval requests; approvals are declared unsupported.",
            ),
          }),
        ),

      readThreadSnapshot: (snapshotInput) =>
        Effect.gen(function* () {
          const sessionId = snapshotInput.providerThread.nativeThreadRef?.nativeId;
          if (sessionId === null || sessionId === undefined) {
            return {
              providerThread: snapshotInput.providerThread,
              providerTurns: [],
              messages: [],
              runtimeRequests: [],
            };
          }
          const read = yield* readSessionTranscript(snapshotInput.providerThread.id, sessionId);
          const appThreadId: ThreadId = snapshotAppThreadId(
            snapshotInput.providerThread.appThreadId,
            sessionId,
          );
          const now = yield* DateTime.now;
          const messages: OrchestrationV2ConversationMessage[] = [];
          for (const message of read.messages ?? []) {
            const role = message.info?.role;
            const nativeMessageId = message.info?.messageId;
            if ((role !== "user" && role !== "assistant") || nativeMessageId === undefined)
              continue;
            const text = (message.parts ?? [])
              .map((part) => parseTranscriptPart(part))
              .filter(
                (part): part is Extract<ReturnType<typeof parseTranscriptPart>, { type: "text" }> =>
                  part.type === "text",
              )
              .map((part) => part.text ?? "")
              .join("");
            messages.push({
              createdBy: role === "user" ? "user" : "agent",
              creationSource: "provider",
              id: deriveId.messageFromProviderItem({
                driver: ZCODE_PROVIDER,
                nativeItemId: nativeMessageId,
              }),
              threadId: appThreadId,
              runId: null,
              nodeId: null,
              role,
              text,
              attachments: [],
              streaming: false,
              createdAt: now,
              updatedAt: now,
            });
          }
          return {
            providerThread: snapshotInput.providerThread,
            providerTurns: [],
            messages,
            runtimeRequests: [],
            providerPayload: read,
          };
        }),

      rollbackThread: () =>
        Effect.fail(
          new ProviderAdapter.ProviderAdapterProtocolError({
            driver: ZCODE_PROVIDER,
            detail: "Thread rollback is not supported by the ZCode Protocol.",
          }),
        ),

      forkThread: (forkInput) =>
        Effect.fail(
          new ProviderAdapter.ProviderAdapterForkThreadError({
            driver: ZCODE_PROVIDER,
            providerThreadId: forkInput.sourceProviderThread.id,
            cause: new Error("Thread fork is not supported by the ZCode Protocol."),
          }),
        ),
    };

    return runtime;
  });

  return {
    instanceId: options.instanceId,
    driver: ZCODE_PROVIDER,
    getCapabilities: () => getCapabilities,
    planSelectionTransition: () => Effect.succeed(turnScopedSelectionTransition()),
    openSession,
  } satisfies ProviderAdapter.ProviderAdapterV2["Service"];
});

export type ZcodeAdapterV2DriverEnv = never;

export const ZcodeAdapterV2Driver: ProviderAdapterDriver<ZCodeSettings, ZcodeAdapterV2DriverEnv> = {
  driverKind: ZCODE_PROVIDER,
  configSchema: ZCodeSettings,
  defaultConfig: (): ZCodeSettings => DEFAULT_ZCODE_SETTINGS,
  create: Effect.fn("ZcodeAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<ZCodeSettings>) {
      const environment = yield* mergeProviderInstanceEnvironment(input.environment);
      return yield* makeZcodeAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: ZCODE_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create ZCode adapter.",
              cause,
            }),
        ),
      ),
  ),
};

export const ZcodeAdapterV2Layer: Layer.Layer<ProviderAdapter.ProviderAdapterV2> = Layer.effect(
  ProviderAdapter.ProviderAdapterV2,
  Effect.gen(function* () {
    const environment = yield* HostProcess.Environment;
    return yield* makeZcodeAdapterV2({
      instanceId: ZCODE_DEFAULT_INSTANCE_ID,
      settings: DEFAULT_ZCODE_SETTINGS,
      environment,
    });
  }),
);

export type { ProviderSessionId };
export { protocolErrorToFailure };
