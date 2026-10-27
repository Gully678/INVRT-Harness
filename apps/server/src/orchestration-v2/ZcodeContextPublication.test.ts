// @effect-diagnostics nodeBuiltinImport:off -- This integration fixture spawns an owned fake CLI script by executable path.
import { expect, it } from "@effect/vitest";
import {
  EventId,
  NodeId,
  ProviderSessionId,
  ThreadId,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeFSP from "node:fs/promises";
import {
  makeZcodeAdapterV2,
  ZCODE_DEFAULT_INSTANCE_ID,
} from "../../../../packages/provider-zcode/src/server/adapter.ts";
import { startFakeZcodeAppServer } from "../../../../packages/provider-zcode/src/server/fakeServer.ts";
import { ZCodeSettings } from "../../../../packages/provider-zcode/src/settings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

const decodeSettings = Schema.decodeSync(ZCodeSettings);

it.live.each(["completed", "aborted", "error"])(
  "ZCode usage events preserve authoritative thread metadata through SQL across %s",
  (finish) =>
    Effect.gen(function* () {
      const fake = yield* Effect.acquireRelease(
        Effect.promise(() =>
          startFakeZcodeAppServer({
            sessionCreateSessionId: "sess_lineage",
            turnEvents: [
              {
                sessionId: "sess_lineage",
                payload: { usage: { contextWindow: { usedTokens: 400, maxTokens: 1000 } } },
              },
              { sessionId: "sess_lineage", payload: { message: { info: { finish } } } },
              {
                sessionId: "sess_lineage",
                payload: { usage: { contextWindow: { usedTokens: 500, maxTokens: 1000 } } },
              },
            ],
          }),
        ),
        (fake) => Effect.promise(() => fake.dispose()),
      );
      const settings = decodeSettings({ enabled: true, binaryPath: fake.command[1] });
      yield* Effect.promise(() => NodeFSP.chmod(fake.command[1]!, 0o755));
      yield* Effect.scoped(
        Effect.gen(function* () {
          const adapter = yield* makeZcodeAdapterV2({
            instanceId: ZCODE_DEFAULT_INSTANCE_ID,
            settings,
            environment: { ...process.env },
          });
          const threadId = ThreadId.make("thread:lineage");
          const runtimePolicy = {
            runtimeMode: "approval-required",
            interactionMode: "default",
            cwd: null,
          } as const;
          const modelSelection = {
            instanceId: ZCODE_DEFAULT_INSTANCE_ID,
            model: "zcode-default",
          };
          const runtime = yield* adapter.openSession({
            threadId,
            providerSessionId: ProviderSessionId.make("session:lineage"),
            modelSelection,
            runtimePolicy,
          });
          const created = yield* runtime.ensureThread({
            threadId,
            modelSelection,
            runtimePolicy,
          });
          const authoritative: OrchestrationV2ProviderThread = {
            ...created,
            firstRunOrdinal: 1,
            lastRunOrdinal: 7,
            status: "active",
            ownerNodeId: NodeId.make("node:owner"),
            nativeConversationHeadRef: {
              driver: created.driver,
              nativeId: "head:previous",
              strength: "strong",
            },
            createdAt: DateTime.makeUnsafe(1),
          };
          const ensured = yield* runtime.ensureThread({
            threadId,
            existingProviderThread: authoritative,
            modelSelection,
            runtimePolicy,
          });
          const resumed = yield* runtime.resumeThread({
            threadId,
            providerThread: authoritative,
            modelSelection,
            runtimePolicy,
          });
          const collect = yield* Stream.runCollect(
            runtime.events.pipe(
              Stream.filter(
                (e) =>
                  e.type === "provider_thread.updated" &&
                  e.providerThread.contextUsage !== null &&
                  e.providerThread.contextUsage !== undefined,
              ),
              Stream.take(2),
            ),
          ).pipe(Effect.forkScoped);
          yield* runtime.startTurn({
            threadId,
            runId: "run:lineage",
            runOrdinal: 7,
            providerTurnOrdinal: 7,
            attemptId: "attempt:lineage",
            rootNodeId: "node:lineage",
            providerThread: authoritative,
            message: { messageId: "message:lineage", text: "hi" },
            modelSelection,
            runtimePolicy,
            appThread: {},
          } as never);
          const events = [...(yield* Fiber.join(collect))];
          const store = yield* ProjectionStore.ProjectionStoreV2;
          const sql = yield* SqlClient.SqlClient;
          const snapshots = [
            authoritative,
            ...events.flatMap((e) =>
              e.type === "provider_thread.updated" ? [e.providerThread] : [],
            ),
          ];
          for (const [index, snapshot] of snapshots.entries()) {
            yield* store.apply({
              id: EventId.make(`event:lineage:${index}`),
              type: "provider-thread.updated",
              threadId,
              occurredAt: yield* DateTime.now,
              payload: snapshot,
            } as never);
            const rows = yield* sql.unsafe<{
              first_run_ordinal: number;
              last_run_ordinal: number;
              status: string;
              payload_json: string;
            }>(
              "SELECT first_run_ordinal,last_run_ordinal,status,payload_json FROM orchestration_v2_projection_provider_threads",
            );
            expect(rows[0]).toMatchObject({
              first_run_ordinal: 1,
              last_run_ordinal: 7,
              status: index === 2 ? "idle" : "active",
            });
            const payload = JSON.parse(rows[0]!.payload_json);
            expect(payload).toMatchObject({
              id: authoritative.id,
              providerSessionId: authoritative.providerSessionId,
              appThreadId: threadId,
              ownerNodeId: authoritative.ownerNodeId,
              nativeConversationHeadRef: authoritative.nativeConversationHeadRef,
              createdAt: DateTime.formatIso(authoritative.createdAt),
              handoffIds: authoritative.handoffIds,
              forkedFrom: authoritative.forkedFrom,
            });
            if (index > 0)
              expect(payload.contextUsage).toEqual({
                usedTokens: index === 1 ? 400 : 500,
                maxTokens: 1000,
              });
          }
          expect(ensured).toMatchObject({
            firstRunOrdinal: 1,
            lastRunOrdinal: 7,
            status: "active",
            ownerNodeId: authoritative.ownerNodeId,
            createdAt: authoritative.createdAt,
          });
          expect(resumed).toMatchObject({
            firstRunOrdinal: 1,
            lastRunOrdinal: 7,
            status: "active",
            ownerNodeId: authoritative.ownerNodeId,
            createdAt: authoritative.createdAt,
          });
          const replacement = yield* runtime.ensureThread({
            threadId,
            existingProviderThread: { ...authoritative, nativeThreadRef: null },
            modelSelection,
            runtimePolicy,
          });
          expect(replacement.id).toBe(authoritative.id);
          expect(replacement.nativeThreadRef?.nativeId).toBe("sess_lineage");
        }),
      ).pipe(Effect.provide(ProjectionStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory))));
    }).pipe(Effect.scoped),
);

it.live.each([false, true])(
  "ZCode fresh native budget reset preserves same-native context and failed replacement (%s)",
  (failReplacement) =>
    Effect.gen(function* () {
      const fake = yield* Effect.acquireRelease(
        Effect.promise(() =>
          startFakeZcodeAppServer({
            ...(failReplacement
              ? {
                  sessionCreateError: { code: -32603, message: "synthetic create failure" },
                  sessionCreateErrorAfter: 1,
                }
              : {}),
            turnEvents: [
              {
                sessionId: "sess_fake_1",
                payload: { usage: { contextWindow: { usedTokens: 400, maxTokens: 1000 } } },
              },
            ],
          }),
        ),
        (fake) => Effect.promise(() => fake.dispose()),
      );
      yield* Effect.promise(() => NodeFSP.chmod(fake.command[1]!, 0o755));
      const settings = decodeSettings({ enabled: true, binaryPath: fake.command[1] });
      const adapter = yield* makeZcodeAdapterV2({
        instanceId: ZCODE_DEFAULT_INSTANCE_ID,
        settings,
        environment: { ...process.env },
      });
      const threadId = ThreadId.make("thread:budget");
      const runtimePolicy = {
        runtimeMode: "approval-required",
        interactionMode: "default",
        cwd: null,
      } as const;
      const modelSelection = { instanceId: ZCODE_DEFAULT_INSTANCE_ID, model: "zcode-default" };
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("session:budget"),
        modelSelection,
        runtimePolicy,
      });
      const thread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
      const collect = yield* Stream.runCollect(
        runtime.events.pipe(
          Stream.filter(
            (e) =>
              e.type === "provider_thread.updated" &&
              e.providerThread.contextUsage?.usedTokens === 400,
          ),
          Stream.take(1),
        ),
      ).pipe(Effect.forkScoped);
      yield* runtime.startTurn({
        threadId,
        runId: "run:budget",
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId: "attempt:budget",
        rootNodeId: "node:budget",
        providerThread: thread,
        message: { messageId: "message:budget", text: "hi" },
        modelSelection,
        runtimePolicy,
        appThread: {},
      } as never);
      yield* Fiber.join(collect);
      expect(runtime.getModelContextWindow?.(modelSelection)).toBe(1000);
      yield* runtime.ensureThread({
        threadId,
        existingProviderThread: thread,
        modelSelection,
        runtimePolicy,
      });
      expect(runtime.getModelContextWindow?.(modelSelection)).toBe(1000);
      yield* runtime.resumeThread({
        threadId,
        providerThread: thread,
        modelSelection,
        runtimePolicy,
      });
      expect(runtime.getModelContextWindow?.(modelSelection)).toBe(1000);
      const replacement = yield* runtime
        .ensureThread({
          threadId,
          existingProviderThread: { ...thread, nativeThreadRef: null },
          modelSelection,
          runtimePolicy,
        })
        .pipe(Effect.result);
      if (failReplacement) {
        expect(replacement._tag).toBe("Failure");
        expect(runtime.getModelContextWindow?.(modelSelection)).toBe(1000);
      } else {
        expect(replacement._tag).toBe("Success");
        if (replacement._tag === "Success") {
          expect(replacement.success.nativeThreadRef?.nativeId).toBe("sess_fake_2");
          expect(replacement.success.contextUsage).toBeNull();
        }
        expect(runtime.getModelContextWindow?.(modelSelection)).toBeUndefined();
      }
    }).pipe(Effect.scoped),
);
