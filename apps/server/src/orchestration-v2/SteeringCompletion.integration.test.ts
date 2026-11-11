import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  EventId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
  type ModelSelection,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Stream from "effect/Stream";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import { ManagedRouteConstraint } from "./ManagedRouteConstraint.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };

it.effect.each(
  (
    [
      [false, "during delivery"],
      [false, "before dispatch"],
      [true, "after delivery"],
      [true, "without native steering"],
      [true, "with interrupting native steering"],
      [true, "settled only"],
    ] as const
  ).map(([mailbox, timing]) => ({
    mailbox,
    timing,
    label: mailbox ? "mailbox notification" : "steering",
  })),
)("delivers $label when completion wins $timing", ({ mailbox, timing }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace(`steering-completion-${timing.replaceAll(" ", "-")}`);
      const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
      const started: ProviderAdapter.ProviderAdapterV2TurnInput[] = [];
      const steerEntered = yield* Deferred.make<void>();
      const rejectSteer = yield* Deferred.make<void>();
      let steerCalls = 0;
      const capabilities = {
        ...CodexProviderCapabilitiesV2,
        turns: {
          ...CodexProviderCapabilitiesV2.turns,
          supportsActiveSteering: timing !== "without native steering",
          activeSteeringInterruptsTools: timing === "with interrupting native steering",
        },
      };
      const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
        instanceId,
        driver,
        getCapabilities: () => Effect.succeed(capabilities),
        planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
        openSession: (input) =>
          Effect.gen(function* () {
            const now = yield* DateTime.now;
            return {
              instanceId,
              driver,
              providerSessionId: input.providerSessionId,
              providerSession: {
                id: input.providerSessionId,
                driver,
                providerInstanceId: instanceId,
                status: "ready",
                cwd,
                model: modelSelection.model,
                capabilities,
                createdAt: now,
                updatedAt: now,
                lastError: null,
              },
              events: Stream.fromQueue(events),
              ensureThread: ({ threadId }) =>
                Effect.succeed({
                  id: ProviderThreadId.make(`provider-thread:${threadId}`),
                  driver,
                  providerInstanceId: instanceId,
                  providerSessionId: input.providerSessionId,
                  appThreadId: threadId,
                  ownerNodeId: null,
                  nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
                  nativeConversationHeadRef: null,
                  status: "idle",
                  firstRunOrdinal: null,
                  lastRunOrdinal: null,
                  handoffIds: [],
                  forkedFrom: null,
                  createdAt: now,
                  updatedAt: now,
                }),
              resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
              startTurn: (turn) =>
                Effect.gen(function* () {
                  started.push(turn);
                  yield* Queue.offer(events, {
                    type: "provider_turn.updated",
                    driver,
                    providerTurn: {
                      id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                      providerThreadId: turn.providerThread.id,
                      nodeId: turn.rootNodeId,
                      runAttemptId: turn.attemptId,
                      nativeTurnRef: {
                        driver,
                        nativeId: `native:${turn.attemptId}`,
                        strength: "strong",
                      },
                      ordinal: turn.providerTurnOrdinal,
                      status: "running",
                      startedAt: now,
                      completedAt: null,
                    },
                  });
                }),
              steerTurn: (turn) =>
                Effect.gen(function* () {
                  steerCalls += 1;
                  if (timing === "after delivery") return;
                  yield* Deferred.succeed(steerEntered, undefined);
                  yield* Deferred.await(rejectSteer);
                  return yield* new ProviderAdapter.ProviderAdapterSteerRunError({
                    driver,
                    providerThreadId: turn.providerThread.id,
                    providerTurnId: turn.providerTurnId,
                    cause: "turn already completed",
                  });
                }),
              interruptTurn: () => Effect.void,
              respondToRuntimeRequest: () => Effect.void,
              readThreadSnapshot: () => Effect.die("unused"),
              rollbackThread: () => Effect.die("unused"),
              forkThread: () => Effect.die("unused"),
            };
          }),
      };
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = ThreadId.make("thread:steering-completion");
        const watch = (predicate: (event: OrchestrationV2DomainEvent) => boolean) =>
          orchestrator.streamDomainEvents.pipe(
            Stream.filter(predicate),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkScoped,
          );
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create"),
          threadId,
          projectId: ProjectId.make("project:steering-completion"),
          title: "Steering race",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: cwd,
          createdBy: "user",
          creationSource: "web",
        });
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("first"),
          threadId,
          messageId: MessageId.make("message:first"),
          text: "first",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        const running = yield* watch(
          (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
        );
        yield* worker.drain();
        yield* Fiber.join(running);
        const first = started[0]!;
        const messageId = MessageId.make("message:steering");
        const taskId = NodeId.make("task:mailbox");
        if (mailbox) {
          const sink = yield* EventSink.EventSinkV2;
          const current = yield* orchestrator.getThreadProjection(threadId);
          const parentRun = current.runs.find((run) => run.id === first.runId)!;
          const now = yield* DateTime.now;
          yield* sink.write({
            events: [
              {
                id: EventId.make("mailbox:cohort"),
                type: "run.updated",
                threadId,
                runId: first.runId,
                occurredAt: now,
                payload: {
                  ...parentRun,
                  delegatedCompletion: {
                    disposition: "open",
                    nextGeneration: 2,
                    delivery: { generation: 1, messageId, taskIds: [taskId] },
                  },
                },
              },
              {
                id: EventId.make("mailbox:task"),
                type: "subagent.updated",
                threadId,
                runId: first.runId,
                nodeId: taskId,
                occurredAt: now,
                payload: {
                  id: taskId,
                  threadId,
                  runId: first.runId,
                  parentNodeId: first.rootNodeId,
                  origin: "app_owned",
                  createdBy: "agent",
                  driver,
                  providerInstanceId: instanceId,
                  providerThreadId: null,
                  childThreadId: null,
                  nativeTaskRef: null,
                  prompt: "Do background work",
                  title: "Background test",
                  model: null,
                  completionWake: timing === "settled only" ? "settled_only" : "always",
                  completionDelivery: { state: "claimed", observedByRunId: null },
                  status: "completed",
                  result: "done",
                  startedAt: now,
                  completedAt: now,
                  updatedAt: now,
                },
              },
            ],
          });
        }
        const dispatchSteer = orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("steer"),
          threadId,
          messageId,
          text: "fix the popover",
          attachments: [
            {
              type: "image",
              id: "steering-screenshot",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 10,
            },
          ],
          dispatchMode: mailbox
            ? { type: "queue_after_active" }
            : { type: "steer_active", targetRunId: first.runId },
          createdBy: mailbox ? "agent" : "user",
          creationSource: mailbox ? "server" : "web",
          ...(mailbox
            ? {
                delegatedCompletion: {
                  parentRunId: first.runId,
                  generation: 1,
                  taskIds: [taskId],
                },
              }
            : {}),
        });
        if (timing !== "before dispatch") yield* dispatchSteer;
        if (timing === "after delivery") yield* worker.drain();
        const delivery =
          timing === "during delivery" ? yield* worker.runOnce.pipe(Effect.forkScoped) : null;
        if (delivery !== null) yield* Deferred.await(steerEntered);
        const completed = yield* watch(
          (event) =>
            event.type === "run.updated" &&
            event.payload.id === first.runId &&
            event.payload.status === "waiting",
        );
        const projection = yield* orchestrator.getThreadProjection(threadId);
        const turn = projection.providerTurns[0]!;
        yield* Queue.offer(events, {
          type: "provider_turn.updated",
          driver,
          providerTurn: { ...turn, status: "completed", completedAt: yield* DateTime.now },
        });
        yield* Queue.offer(events, {
          type: "turn.terminal",
          driver,
          providerThreadId: turn.providerThreadId,
          providerTurnId: turn.id,
          runOrdinal: first.runOrdinal,
          status: "completed",
          failure: null,
          threadDisposition: "reusable",
        });
        yield* Fiber.join(completed);
        if (delivery !== null) {
          yield* Deferred.succeed(rejectSteer, undefined);
          yield* Fiber.join(delivery);
        }
        if (timing === "before dispatch") yield* dispatchSteer;
        yield* worker.drain();
        yield* orchestrator.resumeQueuedRuns;
        yield* worker.drain();
        if (timing === "after delivery") {
          assert.equal(steerCalls, 1);
          assert.equal(started.length, 1);
          if (mailbox) {
            const delivered = yield* orchestrator.getThreadProjection(threadId);
            assert.equal(delivered.subagents[0]?.completionDelivery?.state, "delivered");
            assert.equal(delivered.subagents[0]?.completionDelivery?.observedByRunId, null);
            assert.equal(delivered.runs[0]?.delegatedCompletion?.delivery, null);
            assert.equal(
              delivered.turnItems.filter((item) => item.type === "notification").length,
              1,
            );
            yield* orchestrator.dispatch({
              type: "notification.delivery.accept",
              commandId: CommandId.make("duplicate-acceptance"),
              threadId,
              messageId,
            });
            yield* worker.drain();
            assert.equal(steerCalls, 1);
            yield* orchestrator.dispatch({
              type: "delegated_task.completion-delivery.acknowledge",
              commandId: CommandId.make("read-result"),
              parentThreadId: threadId,
              taskId,
              observedByRunId: first.runId,
            });
            const acknowledged = yield* orchestrator.getThreadProjection(threadId);
            assert.equal(acknowledged.subagents[0]?.completionDelivery?.state, "acknowledged");
          }
          return;
        }
        assert.equal(started.length, 2);
        assert.equal(started[1]?.message.messageId, messageId);
        if (mailbox) assert.include(started[1]?.message.text ?? "", String(taskId));
        else assert.equal(started[1]?.message.text, "fix the popover");
        assert.deepEqual(started[1]?.message.attachments, [
          {
            type: "image",
            id: "steering-screenshot",
            name: "image.png",
            mimeType: "image/png",
            sizeBytes: 10,
          },
        ]);
        assert.equal(steerCalls, timing === "during delivery" ? 1 : 0);
        const final = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(final.messages.filter((message) => message.id === messageId).length, 1);
        assert.equal(
          final.messages.find((message) => message.id === messageId)?.runId,
          started[1]?.runId,
        );
        assert.equal(
          final.turnItems.filter((item) =>
            mailbox
              ? item.type === "notification"
              : item.type === "user_message" && item.messageId === messageId,
          ).length,
          1,
        );
        yield* worker.drain();
        assert.equal(started.length, 2);
      }).pipe(
        Effect.provide(
          ProviderReplayHarness.layerWithRegistry(
            { name: `steering-completion-${timing}` },
            ProviderAdapterRegistry.layerSingle(adapter),
            { runEffectWorker: false },
          ),
        ),
      );
    }),
  ),
);

const runSelection = {
  instanceId,
  model: "test-model",
  options: [{ id: "effort", value: "xhigh" }],
};
const composerSelection = {
  ...runSelection,
  options: [...runSelection.options, { id: "fastMode", value: false }],
};

const nextTurnSelectionHarness = Effect.fn("nextTurnSelectionHarness")(function* (
  name: string,
  canRestart = false,
) {
  const cwd = yield* checkpointWorkspace(name);
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const started: ProviderAdapter.ProviderAdapterV2TurnInput[] = [];
  const steered: string[] = [];
  const capabilities = {
    ...CodexProviderCapabilitiesV2,
    turns: {
      ...CodexProviderCapabilitiesV2.turns,
      supportsActiveSteering: true,
      supportsSteeringByInterruptRestart: canRestart,
    },
  };
  const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const startTurn = (turn: ProviderAdapter.ProviderAdapterV2TurnInput) =>
          Effect.gen(function* () {
            started.push(turn);
            yield* Queue.offer(events, {
              type: "provider_turn.updated",
              driver,
              providerTurn: {
                id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                providerThreadId: turn.providerThread.id,
                nodeId: turn.rootNodeId,
                runAttemptId: turn.attemptId,
                nativeTurnRef: {
                  driver,
                  nativeId: `native:${turn.attemptId}`,
                  strength: "strong",
                },
                ordinal: turn.providerTurnOrdinal,
                status: "running",
                startedAt: now,
                completedAt: null,
              },
            });
          });
        return {
          instanceId,
          driver,
          providerSessionId: input.providerSessionId,
          providerSession: {
            id: input.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd,
            model: runSelection.model,
            capabilities,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: ({ threadId }) =>
            Effect.succeed({
              id: ProviderThreadId.make(`provider-thread:${threadId}`),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: input.providerSessionId,
              appThreadId: threadId,
              ownerNodeId: null,
              nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn,
          compactThread: startTurn,
          steerTurn: (turn) =>
            Effect.sync(() => {
              steered.push(turn.message.text);
            }),
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: () => Effect.void,
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
  const database = SqlitePersistence.layerMemory;
  const layer = Layer.merge(
    ProviderReplayHarness.layerWithRegistry(
      { name },
      ProviderAdapterRegistry.layerSingle(adapter),
      { databaseLayer: database, runEffectWorker: false },
    ),
    database,
  );
  const startFirstTurn = Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    const threadId = ThreadId.make(`thread:${name}`);
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create"),
      threadId,
      projectId: ProjectId.make(`project:${name}`),
      title: "Steer with changed options",
      modelSelection: runSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: cwd,
      createdBy: "user",
      creationSource: "web",
    });
    const running = yield* orchestrator.streamDomainEvents.pipe(
      Stream.filter(
        (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
      ),
      Stream.take(1),
      Stream.runDrain,
      Effect.forkScoped,
    );
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("first"),
      threadId,
      messageId: MessageId.make("message:first"),
      text: "first",
      attachments: [],
      modelSelection: runSelection,
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* worker.drain();
    yield* Fiber.join(running);
    return threadId;
  });
  return { cwd, events, started, steered, layer, startFirstTurn };
});

it.effect("sends a selected held message once and preserves the remaining queue order", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { started, steered, layer, startFirstTurn } =
        yield* nextTurnSelectionHarness("send-held-message");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        yield* Effect.forEach(["queued-first", "selected", "queued-last"], (text) =>
          orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(text),
            threadId,
            messageId: MessageId.make(`message:${text}`),
            text,
            attachments: [],
            modelSelection: runSelection,
            dispatchMode: { type: "queue_after_active" },
            createdBy: "user",
            creationSource: "web",
          }),
        );
        const before = yield* orchestrator.getThreadProjection(threadId);
        const selected = before.runs.find(
          (run) => run.userMessageId === MessageId.make("message:selected"),
        )!;
        const sink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        // Restart recovery cancels the active run and holds every queued message.
        yield* sink.write({
          events: [
            ...before.runs.map((run) => ({
              id: EventId.make(`restart:${run.id}`),
              type: "run.updated" as const,
              threadId,
              runId: run.id,
              occurredAt: now,
              payload:
                run.status === "queued"
                  ? { ...run, queueHeld: true }
                  : { ...run, status: "cancelled" as const, completedAt: now },
            })),
            ...before.providerTurns.map((turn) => ({
              id: EventId.make(`restart:${turn.id}`),
              type: "provider-turn.updated" as const,
              threadId,
              occurredAt: now,
              payload: { ...turn, status: "cancelled" as const, completedAt: now },
            })),
          ],
        });
        const command = {
          type: "queued-run.start" as const,
          commandId: CommandId.make("send-selected"),
          threadId,
          runId: selected.id,
        };
        yield* orchestrator.dispatch(command);
        yield* worker.drain();
        yield* orchestrator.dispatch(command);
        yield* worker.drain();
        const after = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(after.runs.find((run) => run.id === selected.id)?.status, "running");
        assert.deepEqual(
          started.map((input) => input.message.text),
          ["first", "selected"],
        );
        assert.equal(started[1]?.runId, selected.id);
        assert.equal(started[1]?.message.messageId, selected.userMessageId);
        assert.deepEqual(started[1]?.modelSelection, runSelection);
        assert.deepEqual(steered, []);
        assert.lengthOf(
          after.messages.filter((message) => message.id === selected.userMessageId),
          1,
        );
        assert.deepEqual(
          after.runs.filter((run) => run.status === "queued").map((run) => run.userMessageId),
          [MessageId.make("message:queued-first"), MessageId.make("message:queued-last")],
        );
        assert.isFalse(after.runs.some((run) => run.status === "queued" && run.queueHeld));
        const duplicate = yield* orchestrator
          .dispatch({
            ...command,
            commandId: CommandId.make("send-selected-again"),
          })
          .pipe(Effect.flip);
        assert.equal(duplicate._tag, "OrchestratorDispatchError");
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("keeps a message queued when send now races with a running turn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { started, layer, startFirstTurn } =
        yield* nextTurnSelectionHarness("send-queued-race");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("queue"),
          threadId,
          messageId: MessageId.make("message:queued"),
          text: "queued",
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
          createdBy: "user",
          creationSource: "web",
        });
        const before = yield* orchestrator.getThreadProjection(threadId);
        const queued = before.runs.find((run) => run.status === "queued")!;
        const error = yield* orchestrator
          .dispatch({
            type: "queued-run.start",
            commandId: CommandId.make("send-now"),
            threadId,
            runId: queued.id,
          })
          .pipe(Effect.flip);
        yield* worker.drain();
        assert.equal(error._tag, "OrchestratorDispatchError");
        assert.equal(started.length, 1);
        const after = yield* orchestrator.getThreadProjection(threadId);
        assert.deepEqual(after.runs, before.runs);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

// regression: #19210 a provider that can restart the turn must still steer, since restarting ends its native subagents
it.effect(
  "steers a changed turn-scoped selection into a running turn the provider could restart",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { started, steered, layer, startFirstTurn } = yield* nextTurnSelectionHarness(
          "steering-selection-change",
          true,
        );
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
          const threadId = yield* startFirstTurn;
          const steer = (id: string, selection: ModelSelection) =>
            orchestrator
              .dispatch({
                type: "message.dispatch",
                commandId: CommandId.make(id),
                threadId,
                messageId: MessageId.make(`message:${id}`),
                text: id,
                attachments: [],
                modelSelection: selection,
                dispatchMode: { type: "steer_active", targetRunId: started[0]!.runId },
                createdBy: "user",
                creationSource: "web",
              })
              .pipe(Effect.andThen(worker.drain()));

          yield* steer("steer-changed", composerSelection);
          const changed = yield* orchestrator.getThreadProjection(threadId);
          assert.deepEqual(steered, ["steer-changed"]);
          assert.equal(started.length, 1);
          assert.lengthOf(changed.attempts, 1);
          assert.equal(changed.runs[0]?.status, "running");
          assert.deepEqual(changed.runs[0]?.modelSelection, runSelection);
          assert.deepEqual(changed.thread.modelSelection, composerSelection);

          yield* steer("steer-reverted", runSelection);
          const reverted = yield* orchestrator.getThreadProjection(threadId);
          assert.deepEqual(steered, ["steer-changed", "steer-reverted"]);
          assert.lengthOf(reverted.attempts, 1);
          assert.deepEqual(reverted.thread.modelSelection, runSelection);

          const otherSelection = {
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "other",
          };
          const sink = yield* EventSink.EventSinkV2;
          yield* sink.write({
            events: [
              {
                id: EventId.make("switched-away"),
                type: "thread.provider-switched",
                threadId,
                providerInstanceId: otherSelection.instanceId,
                occurredAt: yield* DateTime.now,
                payload: {
                  ...reverted.thread,
                  providerInstanceId: otherSelection.instanceId,
                  modelSelection: otherSelection,
                },
              },
            ],
          });
          yield* steer("steer-back", runSelection);
          const back = yield* orchestrator.getThreadProjection(threadId);
          assert.deepEqual(steered, ["steer-changed", "steer-reverted", "steer-back"]);
          assert.equal(back.thread.providerInstanceId, instanceId);
          assert.deepEqual(back.thread.modelSelection, runSelection);
        }).pipe(Effect.provide(layer));
      }),
    ),
);

it.effect("starts a steer that missed the turn on the saved next-turn selection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { events, started, steered, layer, startFirstTurn } = yield* nextTurnSelectionHarness(
        "steering-selection-follow-up",
      );
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        const first = started[0]!;
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("steer"),
          threadId,
          messageId: MessageId.make("message:steer"),
          text: "late steer",
          attachments: [],
          modelSelection: composerSelection,
          dispatchMode: { type: "steer_active", targetRunId: first.runId },
          createdBy: "user",
          creationSource: "web",
        });
        const settled = yield* orchestrator.streamDomainEvents.pipe(
          Stream.filter(
            (event) =>
              event.type === "run.updated" &&
              event.payload.id === first.runId &&
              event.payload.status === "waiting",
          ),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkScoped,
        );
        const turn = (yield* orchestrator.getThreadProjection(threadId)).providerTurns[0]!;
        yield* Queue.offer(events, {
          type: "provider_turn.updated",
          driver,
          providerTurn: { ...turn, status: "completed", completedAt: yield* DateTime.now },
        });
        yield* Queue.offer(events, {
          type: "turn.terminal",
          driver,
          providerThreadId: turn.providerThreadId,
          providerTurnId: turn.id,
          runOrdinal: first.runOrdinal,
          status: "completed",
          failure: null,
          threadDisposition: "reusable",
        });
        yield* Fiber.join(settled);
        yield* worker.drain();
        yield* orchestrator.resumeQueuedRuns;
        yield* worker.drain();

        const projection = yield* orchestrator.getThreadProjection(threadId);
        assert.deepEqual(steered, []);
        assert.equal(started.length, 2);
        assert.equal(started[1]?.message.messageId, MessageId.make("message:steer"));
        assert.deepEqual(started[1]?.modelSelection, composerSelection);
        assert.deepEqual(projection.thread.modelSelection, composerSelection);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

// Codex flushes held drafts after the final answer; reserve their pre-steer position before turn end.
it.effect("keeps a held commentary draft before the steer when turn end flushes it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { events, started, layer, startFirstTurn } =
        yield* nextTurnSelectionHarness("steering-held-draft");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        const first = started[0]!;
        const turn = (yield* orchestrator.getThreadProjection(threadId)).providerTurns[0]!;
        const now = yield* DateTime.now;
        const assistantItem = (id: string, text: string, streaming: boolean) =>
          ({
            type: "turn_item.updated",
            driver,
            turnItem: {
              id: TurnItemId.make(id),
              threadId,
              runId: first.runId,
              nodeId: first.rootNodeId,
              providerThreadId: turn.providerThreadId,
              providerTurnId: turn.id,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 0,
              status: streaming ? "running" : "completed",
              title: null,
              startedAt: now,
              completedAt: streaming ? null : now,
              updatedAt: now,
              type: "assistant_message",
              messageId: MessageId.make(`message:${id}`),
              text,
              streaming,
            },
          }) satisfies ProviderAdapter.ProviderAdapterV2Event;
        const watch = (predicate: (event: OrchestrationV2DomainEvent) => boolean) =>
          orchestrator.streamDomainEvents.pipe(
            Stream.filter(predicate),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkScoped,
          );

        yield* Queue.offer(events, assistantItem("draft", "Let me look at the", true));
        const commentaryWritten = yield* watch(
          (event) => event.type === "turn-item.updated" && event.payload.id === "commentary",
        );
        yield* Queue.offer(events, assistantItem("commentary", "Checking the popover.", false));
        yield* Fiber.join(commentaryWritten);

        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("steer"),
          threadId,
          messageId: MessageId.make("message:steer"),
          text: "fix the popover",
          attachments: [],
          dispatchMode: { type: "steer_active", targetRunId: first.runId },
          createdBy: "user",
          creationSource: "web",
        });
        yield* worker.drain();

        const settled = yield* watch(
          (event) =>
            event.type === "run.updated" &&
            event.payload.id === first.runId &&
            event.payload.status === "waiting",
        );
        yield* Queue.offer(events, assistantItem("answer", "All fixed.", false));
        yield* Queue.offer(events, assistantItem("draft", "Let me look at the", false));
        yield* Queue.offer(events, {
          type: "provider_turn.updated",
          driver,
          providerTurn: { ...turn, status: "completed", completedAt: yield* DateTime.now },
        });
        yield* Queue.offer(events, {
          type: "turn.terminal",
          driver,
          providerThreadId: turn.providerThreadId,
          providerTurnId: turn.id,
          runOrdinal: first.runOrdinal,
          status: "completed",
          failure: null,
          threadDisposition: "reusable",
        });
        yield* Fiber.join(settled);
        yield* worker.drain();

        const items = (yield* orchestrator.getThreadProjection(threadId)).turnItems
          .toSorted((left, right) => left.ordinal - right.ordinal)
          .flatMap((item) =>
            item.type === "user_message"
              ? [String(item.messageId)]
              : item.type === "assistant_message"
                ? [String(item.id)]
                : [],
          );
        assert.deepEqual(items, [
          "message:first",
          "draft",
          "commentary",
          "message:steer",
          "answer",
        ]);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("keeps a queued message queued when promoted into a run that Stop reached", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { started, steered, layer, startFirstTurn } =
        yield* nextTurnSelectionHarness("steering-after-stop");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        const first = started[0]!;
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("queued"),
          threadId,
          messageId: MessageId.make("message:queued"),
          text: "queued",
          attachments: [],
          modelSelection: runSelection,
          dispatchMode: { type: "queue_after_active" },
          createdBy: "user",
          creationSource: "web",
        });
        const queuedRun = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
          (run) => run.status === "queued",
        )!;
        // The worker has not delivered the interrupt yet, so the run still reads as running.
        yield* orchestrator.dispatch({
          type: "run.interrupt",
          commandId: CommandId.make("stop"),
          threadId,
          runId: first.runId,
          holdQueue: true,
        });

        const promoteError = yield* orchestrator
          .dispatch({
            type: "queued-message.promote-to-steer",
            commandId: CommandId.make("promote"),
            threadId,
            queuedRunId: queuedRun.id,
            targetRunId: first.runId,
          })
          .pipe(Effect.flip);
        yield* worker.drain();

        const projection = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(promoteError._tag, "OrchestratorDispatchError");
        assert.deepEqual(steered, []);
        const queued = projection.runs.find((run) => run.id === queuedRun.id);
        assert.equal(queued?.status, "queued");
        assert.isTrue(queued?.queueHeld);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("queues a plain send behind the stopped queue and releases its hold", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { started, steered, layer, startFirstTurn } =
        yield* nextTurnSelectionHarness("plain-send-after-stop");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        const send = (id: string, delivery: "queue" | "auto") =>
          orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(id),
            threadId,
            messageId: MessageId.make(`message:${id}`),
            text: id,
            attachments: [],
            modelSelection: runSelection,
            ...(delivery === "queue"
              ? { dispatchMode: { type: "queue_after_active" } }
              : { dispatchMode: { type: "start_immediately" }, deliveryIntent: "auto" }),
            createdBy: "user",
            creationSource: "web",
          });
        yield* send("queued", "queue");
        yield* orchestrator.dispatch({
          type: "run.interrupt",
          commandId: CommandId.make("stop"),
          threadId,
          runId: started[0]!.runId,
          holdQueue: true,
        });
        // The provider has not stopped yet, so a plain send still resolves to a steer.
        yield* send("sent", "auto");
        yield* worker.drain();

        const projection = yield* orchestrator.getThreadProjection(threadId);
        assert.deepEqual(steered, []);
        assert.equal(started.length, 1);
        const queued = projection.runs
          .filter((run) => run.status === "queued")
          .sort((left, right) => (left.queuePosition ?? 0) - (right.queuePosition ?? 0));
        assert.deepEqual(
          queued.map(
            (run) => projection.messages.find((message) => message.id === run.userMessageId)?.text,
          ),
          ["queued", "sent"],
        );
        // The user sent it, so the queue they stopped runs again once the provider stops.
        assert.isFalse(queued.some((run) => run.queueHeld === true));
      }).pipe(Effect.provide(layer));
    }),
  ),
);

const goalHarness = Effect.fn("goalHarness")(function* (name: string) {
  const harness = yield* nextTurnSelectionHarness(name);
  const send = (id: string, text: string, delivery: "queue" | "auto") =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(id),
        threadId: ThreadId.make(`thread:${name}`),
        messageId: MessageId.make(`message:${id}`),
        text,
        attachments: [],
        modelSelection: runSelection,
        ...(delivery === "queue"
          ? { dispatchMode: { type: "queue_after_active" } }
          : { dispatchMode: { type: "start_immediately" }, deliveryIntent: "auto" }),
        createdBy: "user",
        creationSource: "web",
      });
    });
  const read = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const projection = yield* (yield* Orchestrator.OrchestratorV2).getThreadProjection(threadId);
      const textOf = (run: (typeof projection.runs)[number]) =>
        projection.messages.find((message) => message.id === run.userMessageId)?.text;
      return {
        queue: projection.runs
          .filter((run) => run.status === "queued")
          .toSorted((left, right) => (left.queuePosition ?? 0) - (right.queuePosition ?? 0))
          .map(textOf),
        started: harness.started.map((turn) => turn.message.text),
        stopRequested: projection.turnItems.some(
          (item) =>
            item.type === "run_interrupt_request" && item.runId === harness.started[0]?.runId,
        ),
      };
    });
  return { ...harness, send, read };
});

it.effect("stops the running turn and starts a goal sent into it next", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { steered, layer, startFirstTurn, send, read } = yield* goalHarness("goal-steer");
      yield* Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        yield* send("queued", "queued", "queue");
        yield* send("goal", "/goal all tests pass", "auto");
        yield* worker.drain();

        assert.deepEqual(steered, []);
        assert.deepEqual(yield* read(threadId), {
          queue: ["queued"],
          started: ["first", "/goal all tests pass"],
          stopRequested: true,
        });
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("queues a goal clear without stopping work when no goal drives it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { steered, layer, startFirstTurn, send, read } = yield* goalHarness("goal-clear");
      yield* Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        yield* send("queued", "queued", "queue");
        yield* send("clear", "/goal clear", "auto");
        yield* worker.drain();

        assert.deepEqual(steered, []);
        assert.deepEqual(yield* read(threadId), {
          queue: ["queued", "/goal clear"],
          started: ["first"],
          stopRequested: false,
        });
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("promotes a queued goal by stopping the running turn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { started, steered, layer, startFirstTurn, send, read } =
        yield* goalHarness("goal-promote");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        yield* send("queued", "queued", "queue");
        yield* send("goal", "/goal ship it", "queue");
        const goalRun = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
          (run) => run.userMessageId === MessageId.make("message:goal"),
        )!;
        yield* orchestrator.dispatch({
          type: "queued-message.promote-to-steer",
          commandId: CommandId.make("promote"),
          threadId,
          queuedRunId: goalRun.id,
          targetRunId: started[0]!.runId,
        });
        yield* worker.drain();

        assert.deepEqual(steered, []);
        assert.deepEqual(yield* read(threadId), {
          queue: ["queued"],
          started: ["first", "/goal ship it"],
          stopRequested: true,
        });
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect.each(["next", "/goal ship it"])(
  "promoting %s into a compaction stops it and sends it next",
  (promoted) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { events, layer, send, read, started, steered, startFirstTurn } = yield* goalHarness(
          `compaction-promote-${promoted.length}`,
        );
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
          const threadId = yield* startFirstTurn;
          yield* send("compact", "/compact", "queue");
          yield* send("queued", "queued", "queue");
          yield* send("next", promoted, "queue");
          const settled = yield* orchestrator.streamDomainEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "run.updated" &&
                event.payload.id === started[0]!.runId &&
                event.payload.status === "waiting",
            ),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkScoped,
          );
          const compacting = yield* orchestrator.streamDomainEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "provider-turn.updated" &&
                event.payload.status === "running" &&
                event.payload.runAttemptId !== started[0]!.attemptId,
            ),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkScoped,
          );
          const turn = (yield* orchestrator.getThreadProjection(threadId)).providerTurns[0]!;
          yield* Queue.offer(events, {
            type: "provider_turn.updated",
            driver,
            providerTurn: { ...turn, status: "completed", completedAt: yield* DateTime.now },
          });
          yield* Queue.offer(events, {
            type: "turn.terminal",
            driver,
            providerThreadId: turn.providerThreadId,
            providerTurnId: turn.id,
            runOrdinal: started[0]!.runOrdinal,
            status: "completed",
            failure: null,
            threadDisposition: "reusable",
          });
          yield* Fiber.join(settled);
          yield* worker.drain();
          yield* orchestrator.resumeQueuedRuns;
          yield* worker.drain();
          yield* Fiber.join(compacting);
          const compactRun = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
            (run) => run.userMessageId === MessageId.make("message:compact"),
          )!;
          const nextRun = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
            (run) => run.userMessageId === MessageId.make("message:next"),
          )!;
          yield* orchestrator.dispatch({
            type: "queued-message.promote-to-steer",
            commandId: CommandId.make("promote"),
            threadId,
            queuedRunId: nextRun.id,
            targetRunId: compactRun.id,
          });
          yield* worker.drain();

          const projection = yield* orchestrator.getThreadProjection(threadId);
          assert.deepEqual(steered, []);
          assert.isTrue(
            projection.turnItems.some(
              (item) => item.type === "run_interrupt_request" && item.runId === compactRun.id,
            ),
          );
          assert.deepEqual((yield* read(threadId)).queue, ["queued"]);
          assert.deepEqual(
            started.map((turn) => turn.message.text),
            ["first", "/compact", promoted],
          );
        }).pipe(Effect.provide(layer));
      }),
    ),
);

it.effect("stops a turn that is still starting when a goal is sent into it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { cwd, layer, send, started } = yield* goalHarness("goal-during-start");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = ThreadId.make("thread:goal-during-start");
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create"),
          threadId,
          projectId: ProjectId.make("project:goal-during-start"),
          title: "Goal during start",
          modelSelection: runSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: cwd,
          createdBy: "user",
          creationSource: "web",
        });
        // The stopped run's end starts the queue, which then needs one more drain.
        const goalStarting = yield* orchestrator.streamDomainEvents.pipe(
          Stream.filter(
            (event) => event.type === "run.updated" && event.payload.status === "starting",
          ),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkScoped({ startImmediately: true }),
        );
        yield* send("first", "first", "auto");
        yield* send("goal", "/goal all tests pass", "auto");
        yield* worker.drain();
        yield* Fiber.join(goalStarting);
        yield* worker.drain();

        const projection = yield* orchestrator.getThreadProjection(threadId);
        const statusOf = (text: string) =>
          projection.runs.find(
            (run) =>
              projection.messages.find((message) => message.id === run.userMessageId)?.text ===
              text,
          )?.status;
        assert.equal(statusOf("first"), "interrupted");
        assert.deepEqual(
          started.map((turn) => turn.message.text),
          ["/goal all tests pass"],
        );
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("stops the running turn when a goal clear ends the goal driving it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { events, layer, startFirstTurn, send, read, steered } =
        yield* goalHarness("goal-clear-active");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        const providerThread = (yield* orchestrator.getThreadProjection(threadId))
          .providerThreads[0]!;
        const goalSeen = yield* orchestrator.streamDomainEvents.pipe(
          Stream.filter(
            (event) =>
              event.type === "provider-thread.updated" && event.payload.goal?.status === "active",
          ),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkScoped({ startImmediately: true }),
        );
        yield* Queue.offer(events, {
          type: "provider_thread.updated",
          driver,
          providerThread: {
            ...providerThread,
            goal: { objective: "all tests pass", status: "active" },
          },
        });
        yield* Fiber.join(goalSeen);
        yield* send("clear", "/goal clear", "auto");
        yield* worker.drain();

        assert.deepEqual(steered, []);
        assert.deepEqual(yield* read(threadId), {
          queue: [],
          started: ["first", "/goal clear"],
          stopRequested: true,
        });
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect.each(["steer_active", "restart_active"] as const)(
  "binds an accepted %s receipt to its selected run and message payload",
  (type) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { layer, startFirstTurn } = yield* nextTurnSelectionHarness(
          `receipt-target-${type}`,
          true,
        );
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const threadId = yield* startFirstTurn;
          const otherThreadId = ThreadId.make("thread:another-target");
          yield* orchestrator.dispatch({
            type: "thread.create",
            commandId: CommandId.make("create:another-target"),
            threadId: otherThreadId,
            projectId: ProjectId.make("project:another-target"),
            title: "Another thread",
            modelSelection: runSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdBy: "user",
            creationSource: "web",
          });
          const before = yield* orchestrator.getThreadProjection(threadId);
          const command = {
            type: "message.dispatch" as const,
            commandId: CommandId.make(`accepted-target:${type}`),
            threadId,
            messageId: MessageId.make("message:accepted-target"),
            text: "Steer the selected run",
            modelSelection: runSelection,
            attachments: [
              {
                type: "image" as const,
                id: "claimed-image",
                name: "image.png",
                mimeType: "image/png",
                sizeBytes: 10,
              },
            ],
            dispatchMode: { type, targetRunId: before.runs[0]!.id },
            createdBy: "user" as const,
            creationSource: "web" as const,
          };
          const accepted = yield* orchestrator.dispatch(command);
          assert.isNotEmpty(accepted.storedEvents);
          const projection = yield* orchestrator.getThreadProjection(threadId);
          const replay = yield* orchestrator.dispatch(command);
          assert.deepEqual(replay, { ...accepted, replayed: true });
          const reallocated = yield* orchestrator.dispatch({
            ...command,
            messageId: MessageId.make("message:reallocated"),
            attachments: [{ ...command.attachments[0]!, id: "reclaimed-image" }],
          });
          assert.deepEqual(reallocated, replay);
          const changes = [
            { ...command, dispatchMode: { type, targetRunId: RunId.make("run:another-target") } },
            { ...command, text: "A different request" },
            { ...command, threadId: otherThreadId },
            { ...command, modelSelection: { ...runSelection, model: "another-model" } },
            ...[{ name: "another.png" }, { mimeType: "image/jpeg" }, { sizeBytes: 20 }].map(
              (change) => ({
                ...command,
                attachments: [{ ...command.attachments[0]!, ...change }],
              }),
            ),
          ];
          for (const changed of changes) {
            const result = yield* orchestrator.dispatch(changed).pipe(Effect.result);
            assert.equal(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.equal(result.failure._tag, "OrchestratorCommandIdConflictError");
              assert.notInclude(JSON.stringify(result.failure), command.dispatchMode.targetRunId);
            }
          }
          assert.deepEqual(yield* orchestrator.getThreadProjection(threadId), projection);
          assert.equal(yield* orchestrator.getThreadEventSequence(threadId), accepted.sequence);
        }).pipe(Effect.provide(layer));
      }),
    ),
);

it.effect("FRESH refuses admitted A steering into current B with next-turn transition", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { started, steered, layer, startFirstTurn } =
        yield* nextTurnSelectionHarness("fresh-managed-steer");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        const before = yield* orchestrator.getThreadProjection(threadId);
        const target = before.runs.find((run) => run.status === "running")!;
        assert.equal(target.modelSelection.model, "test-model");
        const selectionA = { ...runSelection, model: "admitted-A" };
        const result = yield* orchestrator
          .dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("fresh-managed-steer"),
            threadId,
            messageId: MessageId.make("fresh-managed-steer"),
            text: "managed content only for A",
            attachments: [],
            modelSelection: selectionA,
            dispatchMode: { type: "steer_active", targetRunId: target.id },
            createdBy: "user",
            creationSource: "web",
          })
          .pipe(
            Effect.provideService(ManagedRouteConstraint, {
              routeId: "A",
              providerInstanceRef: instanceId,
              model: "admitted-A",
              effort: "xhigh",
            }),
            Effect.result,
          );
        yield* worker.drain();
        const after = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          result._tag,
          "Failure",
          JSON.stringify({
            result,
            started: started.map((input) => input.modelSelection),
            steered,
            runSelection: after.runs.find((run) => run.id === target.id)?.modelSelection,
            threadSelection: after.thread.modelSelection,
          }),
        );
        assert.deepEqual(steered, []);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("FRESH preserves queued managed A when promotion would steer current B", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { started, steered, layer, startFirstTurn } =
        yield* nextTurnSelectionHarness("fresh-managed-queue");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        const sql = yield* SqlClient.SqlClient;
        // Model the durable admission row created before managed intake dispatch.
        yield* sql`INSERT INTO orchestration_command_policy_receipts
        (command_id, policy_id, policy_revision, policy_digest, route_id, payload_digest, decision)
        VALUES ('fresh-managed-queued-A', 'policy-A', 1, 'digest-A', 'A', 'payload-A', 'admitted')`;
        const first = yield* orchestrator.getThreadProjection(threadId);
        const target = first.runs.find((run) => run.status === "running")!;
        yield* orchestrator
          .dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("fresh-managed-queued-A"),
            threadId,
            messageId: MessageId.make("fresh-managed-queued-A"),
            text: "queued content only for A",
            attachments: [],
            modelSelection: { ...runSelection, model: "admitted-A" },
            dispatchMode: { type: "queue_after_active" },
            createdBy: "user",
            creationSource: "web",
          })
          .pipe(
            Effect.provideService(ManagedRouteConstraint, {
              routeId: "A",
              providerInstanceRef: instanceId,
              model: "admitted-A",
              effort: "xhigh",
            }),
          );
        const queued = yield* orchestrator.getThreadProjection(threadId);
        const queuedRun = queued.runs.find((run) => run.status === "queued")!;
        assert.equal(queuedRun.modelSelection.model, "admitted-A");
        assert.equal(queued.thread.modelSelection.model, "test-model");
        const result = yield* orchestrator
          .dispatch({
            type: "queued-message.promote-to-steer",
            commandId: CommandId.make("fresh-managed-promotion"),
            threadId,
            queuedRunId: queuedRun.id,
            targetRunId: target.id,
          })
          .pipe(Effect.result);
        yield* worker.drain();
        const after = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          result._tag,
          "Failure",
          JSON.stringify({
            result,
            originalQueuedSelection: queuedRun.modelSelection,
            originalThreadSelection: queued.thread.modelSelection,
            started: started.map((input) => input.modelSelection),
            steered,
            queuedAfter: after.runs.find((run) => run.id === queuedRun.id)?.status,
            targetAfter: after.runs.find((run) => run.id === target.id)?.modelSelection,
          }),
        );
        assert.deepEqual(steered, []);
        assert.equal(after.runs.find((run) => run.id === queuedRun.id)?.status, "queued");
        const edit = yield* orchestrator
          .dispatch({
            type: "queued-run.edit",
            commandId: CommandId.make("fresh-managed-edit"),
            threadId,
            runId: queuedRun.id,
            text: "changed without admission",
          })
          .pipe(Effect.result);
        assert.equal(edit._tag, "Failure");
        const afterEdit = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          afterEdit.messages.find((message) => message.id === queuedRun.userMessageId)?.text,
          "queued content only for A",
        );
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("PF02 duplicate ordinary message ID keeps managed queued route", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { started, steered, layer, startFirstTurn } =
        yield* nextTurnSelectionHarness("duplicate-managed-queue");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const threadId = yield* startFirstTurn;
        const sql = yield* SqlClient.SqlClient;
        // Model the durable admission row created before managed intake dispatch.
        yield* sql`INSERT INTO orchestration_command_policy_receipts
        (command_id, policy_id, policy_revision, policy_digest, route_id, payload_digest, decision)
        VALUES ('duplicate-managed-queued-A', 'policy-A', 1, 'digest-A', 'A', 'payload-A', 'admitted')`;
        const first = yield* orchestrator.getThreadProjection(threadId);
        const target = first.runs.find((run) => run.status === "running")!;
        yield* orchestrator
          .dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("duplicate-managed-queued-A"),
            threadId,
            messageId: target.userMessageId,
            text: "queued content only for A",
            attachments: [],
            modelSelection: { ...runSelection, model: "admitted-A" },
            dispatchMode: { type: "queue_after_active" },
            createdBy: "user",
            creationSource: "web",
          })
          .pipe(
            Effect.provideService(ManagedRouteConstraint, {
              routeId: "A",
              providerInstanceRef: instanceId,
              model: "admitted-A",
              effort: "xhigh",
            }),
          );
        const queued = yield* orchestrator.getThreadProjection(threadId);
        const queuedRun = queued.runs.find((run) => run.status === "queued")!;
        assert.equal(queuedRun.modelSelection.model, "admitted-A");
        assert.equal(queued.thread.modelSelection.model, "test-model");
        const result = yield* orchestrator
          .dispatch({
            type: "queued-message.promote-to-steer",
            commandId: CommandId.make("fresh-managed-promotion"),
            threadId,
            queuedRunId: queuedRun.id,
            targetRunId: target.id,
          })
          .pipe(Effect.result);
        yield* worker.drain();
        const after = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          result._tag,
          "Failure",
          JSON.stringify({
            result,
            originalQueuedSelection: queuedRun.modelSelection,
            originalThreadSelection: queued.thread.modelSelection,
            started: started.map((input) => input.modelSelection),
            steered,
            queuedAfter: after.runs.find((run) => run.id === queuedRun.id)?.status,
            targetAfter: after.runs.find((run) => run.id === target.id)?.modelSelection,
          }),
        );
        assert.deepEqual(steered, []);
        assert.equal(after.runs.find((run) => run.id === queuedRun.id)?.status, "queued");
        const edit = yield* orchestrator
          .dispatch({
            type: "queued-run.edit",
            commandId: CommandId.make("fresh-managed-edit"),
            threadId,
            runId: queuedRun.id,
            text: "changed without admission",
          })
          .pipe(Effect.result);
        assert.equal(edit._tag, "Failure");
        const afterEdit = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          afterEdit.messages.find((message) => message.id === queuedRun.userMessageId)?.text,
          "queued content only for A",
        );
        const sink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        yield* sink.write({
          events: [
            ...afterEdit.runs.map((run) => ({
              id: EventId.make(`origin-restart:${run.id}`),
              type: "run.updated" as const,
              threadId,
              runId: run.id,
              occurredAt: now,
              payload: run.status === "queued"
                ? { ...run, queueHeld: true }
                : { ...run, status: "cancelled" as const, completedAt: now },
            })),
            ...afterEdit.providerTurns.map((turn) => ({
              id: EventId.make(`origin-restart:${turn.id}`),
              type: "provider-turn.updated" as const,
              threadId,
              occurredAt: now,
              payload: { ...turn, status: "cancelled" as const, completedAt: now },
            })),
          ],
        });
        yield* orchestrator.dispatch({
          type: "queued-run.start",
          commandId: CommandId.make("origin-start"),
          threadId,
          runId: queuedRun.id,
        });
        yield* worker.drain();
        assert.equal(started[1]?.runId, queuedRun.id);
        assert.equal(started[1]?.modelSelection.model, "admitted-A");
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("FRESH prevents ordinary dispatch from consuming a failed managed reservation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { layer, startFirstTurn } = yield* nextTurnSelectionHarness(
        "fresh-managed-reservation",
      );
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const threadId = yield* startFirstTurn;
        const sql = yield* SqlClient.SqlClient;
        const commandId = CommandId.make("fresh-managed-reservation");
        yield* sql`INSERT INTO orchestration_command_policy_receipts
        (command_id, policy_id, policy_revision, policy_digest, route_id, payload_digest, decision)
        VALUES (${commandId}, 'policy-A', 1, 'digest-A', 'A', 'payload-A', 'failed')`;
        const before = yield* orchestrator.getThreadEventSequence(threadId);
        const result = yield* orchestrator
          .dispatch({
            type: "message.dispatch",
            commandId,
            threadId,
            messageId: MessageId.make("fresh-managed-reservation"),
            text: "same semantic request",
            attachments: [],
            dispatchMode: { type: "start_immediately" },
            createdBy: "user",
            creationSource: "web",
          })
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure", JSON.stringify(result));
        assert.equal(yield* orchestrator.getThreadEventSequence(threadId), before);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("rolls back the native binding when its receipt transaction fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { layer, startFirstTurn } = yield* nextTurnSelectionHarness("binding-rollback");
      yield* Effect.gen(function* () {
        const threadId = yield* startFirstTurn;
        const sql = yield* SqlClient.SqlClient;
        const sink = yield* EventSink.EventSinkV2;
        const commandId = CommandId.make("binding-rollback");
        yield* sql`INSERT INTO orchestration_command_policy_receipts
        (command_id, policy_id, policy_revision, policy_digest, route_id, payload_digest, decision)
        VALUES (${commandId}, 'policy-A', 1, 'digest-A', 'A', 'payload-A', 'admitted')`;
        const failed = yield* Effect.exit(
          sink
            .commitCommand({
              commandId,
              threadId,
              commandType: "message.dispatch",
              acceptedAt: yield* DateTime.now,
              events: [],
              effects: [],
              payloadDigest: "payload-A",
            })
            .pipe(
              Effect.provideService(ManagedRouteConstraint, {
                routeId: "A",
                providerInstanceRef: instanceId,
                model: runSelection.model,
                effort: "xhigh",
              }),
            ),
        );
        assert.equal(failed._tag, "Failure");
        const policy = yield* sql<{ readonly native_bound: number }>`
        SELECT native_bound FROM orchestration_command_policy_receipts WHERE command_id = ${commandId}`;
        const receipt = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM orchestration_command_receipts WHERE command_id = ${commandId}`;
        assert.deepEqual(policy, [{ native_bound: 0 }]);
        assert.deepEqual(receipt, [{ n: 0 }]);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("rejects an ordinary native commit while a managed reservation exists", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { layer, startFirstTurn } = yield* nextTurnSelectionHarness("ordinary-commit-guard");
      yield* Effect.gen(function* () {
        const threadId = yield* startFirstTurn;
        const sql = yield* SqlClient.SqlClient;
        const sink = yield* EventSink.EventSinkV2;
        const commandId = CommandId.make("ordinary-commit-guard");
        yield* sql`INSERT INTO orchestration_command_policy_receipts
        (command_id, policy_id, policy_revision, policy_digest, route_id, payload_digest, decision)
        VALUES (${commandId}, 'policy-A', 1, 'digest-A', 'A', 'payload-A', 'failed')`;
        const result = yield* sink
          .commitCommand({
            commandId,
            threadId,
            commandType: "message.dispatch",
            acceptedAt: yield* DateTime.now,
            events: [],
            effects: [],
            payloadDigest: "payload-A",
          })
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        if (result._tag === "Failure")
          assert.equal(result.failure._tag, "EventSinkManagedCommandConflictError");
        const receipt = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM orchestration_command_receipts WHERE command_id = ${commandId}`;
        assert.deepEqual(receipt, [{ n: 0 }]);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("allows an active steer when its executing turn matches the managed route", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { layer, startFirstTurn, steered } =
        yield* nextTurnSelectionHarness("managed-matching-steer");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const sql = yield* SqlClient.SqlClient;
        const threadId = yield* startFirstTurn;
        const target = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
          (run) => run.status === "running",
        )!;
        const commandId = CommandId.make("managed-matching-steer");
        yield* sql`INSERT INTO orchestration_command_policy_receipts
        (command_id, policy_id, policy_revision, policy_digest, route_id, payload_digest, decision)
        VALUES (${commandId}, 'policy-B', 1, 'digest-B', 'B', 'payload-B', 'admitted')`;
        yield* orchestrator
          .dispatch({
            type: "message.dispatch",
            commandId,
            threadId,
            messageId: MessageId.make("managed-matching-steer"),
            text: "allowed steer",
            attachments: [],
            modelSelection: runSelection,
            dispatchMode: { type: "steer_active", targetRunId: target.id },
            createdBy: "user",
            creationSource: "web",
          })
          .pipe(
            Effect.provideService(ManagedRouteConstraint, {
              routeId: "B",
              providerInstanceRef: instanceId,
              model: runSelection.model,
              effort: "xhigh",
            }),
          );
        yield* worker.drain();
        assert.deepEqual(steered, ["allowed steer"]);
        const policy = yield* sql<{ readonly native_bound: number }>`
        SELECT native_bound FROM orchestration_command_policy_receipts WHERE command_id = ${commandId}`;
        assert.deepEqual(policy, [{ native_bound: 1 }]);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("keeps ordinary queued messages editable", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { layer, startFirstTurn } = yield* nextTurnSelectionHarness("ordinary-queued-edit");
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const threadId = yield* startFirstTurn;
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("ordinary-queued-edit-create"),
          threadId,
          messageId: MessageId.make("ordinary-queued-edit-message"),
          text: "before",
          attachments: [],
          modelSelection: runSelection,
          dispatchMode: { type: "queue_after_active" },
          createdBy: "user",
          creationSource: "web",
        });
        const projection = yield* orchestrator.getThreadProjection(threadId);
        const run = projection.runs.find((candidate) => candidate.status === "queued")!;
        yield* orchestrator.dispatch({
          type: "queued-run.edit",
          commandId: CommandId.make("ordinary-queued-edit-update"),
          threadId,
          runId: run.id,
          text: "after",
        });
        const after = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(
          after.messages.find((message) => message.id === run.userMessageId)?.text,
          "after",
        );
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect(
  "refuses promotion of an unverified legacy managed queue even when selections match",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { layer, startFirstTurn, steered } =
          yield* nextTurnSelectionHarness("unverified-queued-route");
        yield* Effect.gen(function* () {
          const orchestrator = yield* Orchestrator.OrchestratorV2;
          const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
          const sql = yield* SqlClient.SqlClient;
          const threadId = yield* startFirstTurn;
          const active = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
            (run) => run.status === "running",
          )!;
          const commandId = CommandId.make("unverified-queued-route");
          yield* sql`INSERT INTO orchestration_command_policy_receipts
        (command_id, policy_id, policy_revision, policy_digest, route_id, payload_digest, decision)
        VALUES (${commandId}, 'policy', 1, 'digest', 'route', 'payload', 'admitted')`;
          yield* orchestrator
            .dispatch({
              type: "message.dispatch",
              commandId,
              threadId,
              messageId: MessageId.make("unverified-queued-route"),
              text: "managed queue",
              attachments: [],
              modelSelection: runSelection,
              dispatchMode: { type: "queue_after_active" },
              createdBy: "user",
              creationSource: "web",
            })
            .pipe(
              Effect.provideService(ManagedRouteConstraint, {
                routeId: "route",
                providerInstanceRef: instanceId,
                model: runSelection.model,
                effort: "xhigh",
              }),
            );
          const queued = (yield* orchestrator.getThreadProjection(threadId)).runs.find(
            (run) => run.status === "queued",
          )!;
          yield* sql`UPDATE orchestration_command_policy_receipts SET native_bound = 0 WHERE command_id = ${commandId}`;
          const result = yield* orchestrator
            .dispatch({
              type: "queued-message.promote-to-steer",
              commandId: CommandId.make("unverified-queue-promotion"),
              threadId,
              queuedRunId: queued.id,
              targetRunId: active.id,
            })
            .pipe(Effect.result);
          yield* worker.drain();
          assert.equal(result._tag, "Failure");
          assert.deepEqual(steered, []);
          assert.equal(
            (yield* orchestrator.getThreadProjection(threadId)).runs.find(
              (run) => run.id === queued.id,
            )?.status,
            "queued",
          );
        }).pipe(Effect.provide(layer));
      }),
    ),
);
