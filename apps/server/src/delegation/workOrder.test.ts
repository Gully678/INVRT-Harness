// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CommandId, ProjectId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { makeFileResultStore, type ResultStore } from "./resultStore.ts";
import { makeSliceExecutor } from "./sliceExecutor.ts";
import {
  ExecutorFailed,
  decodeWorkOrder,
  runWorkOrder,
  type CodeResultV1,
  type ConsoleReportPort,
  type KnowledgePort,
  type WorkOrderDeps,
  type WorkOrderExecutor,
  type WorkOrderV1,
} from "./workOrder.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const readFixture = (name: string): Buffer => NodeFS.readFileSync(new URL(name, FIXTURES));
const sha256 = (value: string | Buffer): string =>
  NodeCrypto.createHash("sha256").update(value).digest("hex");

const exampleOrder = JSON.parse(
  readFixture("monti.code.work_order.v1.example.json").toString("utf8"),
) as Record<string, unknown>;
const exampleResult = JSON.parse(
  readFixture("invrt.code.result.v1.example.json").toString("utf8"),
) as Record<string, unknown>;

const ORDER_ID = "wo:b750f6a2e80a344419371904b87d9b5a";
const ORDER_2_ID = "wo:6918cf3b25ed06d09da16ad304f1a145";
const O: Record<string, unknown> = { ...exampleOrder, work_order_id: ORDER_ID };
const O2: Record<string, unknown> = {
  ...exampleOrder,
  work_order_id: ORDER_2_ID,
  correlation_id: "slice-run-2",
};
const O_NO_KNOWLEDGE: Record<string, unknown> = {
  ...O,
  knowledge: { ...(O.knowledge as object), required: false },
};

const BASE = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";
const PASSAGE_TEXT = "SECRET PASSAGE TEXT THAT MUST NEVER LEAVE BRAIN";

const order = (input: Record<string, unknown>): WorkOrderV1 => {
  const decoded = decodeWorkOrder(input);
  if (!decoded.ok) throw new Error("fixture order failed to decode");
  return decoded.order;
};

const memoryReceipts = () =>
  CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory));
const fileReceipts = (dbPath: string) =>
  CommandReceiptStore.layer.pipe(
    Layer.provide(SqlitePersistence.layerFromPath(dbPath)),
    Layer.provide(NodeServices.layer),
  );

const withTempDir = <A, E, R>(use: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sl03-"))),
    use,
    (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
  );

const executorDouble = () => {
  const state = { calls: 0 };
  const executor: WorkOrderExecutor = {
    model: "slice-fixture-executor",
    run: () =>
      Effect.sync(() => {
        state.calls += 1;
        return { base: BASE, head: HEAD };
      }),
  };
  return { state, executor };
};

const gatedExecutorDouble = (started: Deferred.Deferred<void>, gate: Deferred.Deferred<void>) => {
  const state = { calls: 0 };
  const executor: WorkOrderExecutor = {
    model: "slice-fixture-executor",
    run: () =>
      Effect.gen(function* () {
        state.calls += 1;
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(gate);
        return { base: BASE, head: HEAD };
      }),
  };
  return { state, executor };
};

const knowledgeDouble = (): KnowledgePort => {
  // The extra `text` key is what a careless adapter would leak; the result must drop it.
  const leaky = {
    path_id: "path:fixture-1",
    revision: "r1",
    revision_digest: "0".repeat(64),
    text: PASSAGE_TEXT,
  };
  return {
    fetch: () =>
      Effect.succeed({
        ok: true as const,
        summary: { result_revision: "rev:fixture", included: [leaky], omitted_count: 0 },
      }),
  };
};

const reportDouble = () => {
  const state = { calls: 0 };
  const report: ConsoleReportPort = {
    report: () =>
      Effect.sync(() => {
        state.calls += 1;
        return "spooled" as const;
      }),
  };
  return { state, report };
};

const resultFilePath = (dir: string, workOrderId: string) =>
  NodePath.join(dir, `${sha256(workOrderId)}.json`);

const depsFor = (
  dir: string,
  parts: Partial<Omit<WorkOrderDeps, "resultStore">> = {},
): WorkOrderDeps => ({
  executor: null,
  knowledge: null,
  report: null,
  ...parts,
  resultStore: makeFileResultStore(dir),
});

const parseOneJson = (stdout: string): any => {
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1, `stdout must be exactly one JSON value, got: ${stdout}`);
  return JSON.parse(lines[0] ?? "");
};

const runBin = (home: string, stdin: string, env: Record<string, string | undefined> = {}) => {
  const base: Record<string, string | undefined> = { ...process.env };
  delete base.INVRT_CODE_EXECUTOR;
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    [NodeURL.fileURLToPath(new URL("./bin.ts", import.meta.url))],
    {
      input: stdin,
      encoding: "utf8",
      env: { ...base, INVRT_CODE_HOME: home, ...env },
      timeout: 60_000,
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const TEST_TIMEOUT = 120_000;

it.effect("1 decodes the contract example and the fixtures are byte copies", () =>
  Effect.sync(() => {
    assert.equal(decodeWorkOrder(exampleOrder).ok, true);
    assert.equal(decodeWorkOrder(O).ok, true);
    assert.equal(
      sha256(readFixture("monti.code.work_order.v1.example.json")),
      "e8150be9ad893bf131b755c0b517ed986b8c4c5f4d82963d30685cd957fc47b8",
    );
    assert.equal(
      sha256(readFixture("invrt.code.result.v1.example.json")),
      "e96af020fbe96d775c29154efe8d916774773a802c96ff34ed7245b584015f7b",
    );
  }),
);

it.effect("2 refuses an invalid order", () =>
  Effect.sync(() => {
    const { story_id: _storyId, ...withoutStory } = O;
    const invalid = [
      { ...O, push: true },
      withoutStory,
      { ...O, spec: "monti.code.work_order.v2" },
      { ...O, allowed_effects: ["push"] },
      { ...O, knowledge: { ...(O.knowledge as object), extra: 1 } },
      { ...O, deadline: "2026-11-20T12:00:00+00:00" },
      { ...O, work_order_id: " wo:padded " },
      "not an object",
      null,
    ];
    for (const input of invalid) {
      assert.deepEqual(decodeWorkOrder(input), {
        ok: false,
        refusal: "code_work_order:invalid",
      });
    }
  }),
);

it.effect("3 first run builds and records one accepted project receipt", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const decoded = order(O);
      const result = yield* runWorkOrder(
        decoded,
        depsFor(dir, { executor: e.executor, knowledge: knowledgeDouble() }),
      );
      assert.equal(result.state, "built");
      assert.equal(result.head, HEAD);
      assert.equal(result.base, BASE);
      assert.equal(result.refusal, null);
      assert.equal(result.builder_model, "slice-fixture-executor");
      assert.equal(result.receipt.replayed, false);
      assert.equal(
        result.receipt.payload_digest,
        CommandReceiptStore.commandPayloadDigest(decoded),
      );
      assert.equal(result.console_report, "not_configured");
      const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
      const stored = yield* receipts.getProjectByCommandId(CommandId.make(ORDER_ID));
      assert.equal(Option.isSome(stored), true);
      if (Option.isSome(stored)) {
        assert.equal(stored.value.commandId, ORDER_ID);
        assert.equal(stored.value.projectId, "invrt-slice");
        assert.equal(stored.value.commandType, "monti.code.work_order.v1");
        assert.equal(stored.value.status, "accepted");
      }
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("4 a repeat returns the stored result without running the executor", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const deps = depsFor(dir, { executor: e.executor, knowledge: knowledgeDouble() });
      const first = yield* runWorkOrder(order(O), deps);
      const second = yield* runWorkOrder(order(O), deps);
      assert.deepEqual(second, { ...first, receipt: { ...first.receipt, replayed: true } });
      assert.equal(second.receipt.replayed, true);
      assert.equal(e.state.calls, 1);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("5 changed content under the same id conflicts", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const deps = depsFor(dir, { executor: e.executor, knowledge: knowledgeDouble() });
      yield* runWorkOrder(order(O), deps);
      const changed = yield* runWorkOrder(order({ ...O, request_text: "something else" }), deps);
      assert.equal(changed.state, "refused");
      assert.equal(changed.refusal, "code_work_order:payload_conflict");
      assert.equal(changed.head, null);
      assert.equal(e.state.calls, 1);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("6 input key order does not change the digest", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const deps = depsFor(dir, { executor: e.executor, knowledge: knowledgeDouble() });
      yield* runWorkOrder(order(O), deps);
      const reversed = Object.fromEntries(
        Object.entries({
          ...O,
          knowledge: Object.fromEntries(Object.entries(O.knowledge as object).reverse()),
        }).reverse(),
      );
      assert.notDeepEqual(Object.keys(reversed), Object.keys(O));
      const again = yield* runWorkOrder(order(reversed), deps);
      assert.equal(again.state, "built");
      assert.equal(again.receipt.replayed, true);
      assert.equal(e.state.calls, 1);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("7 knowledge required but no port refuses and the refusal is stored", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const deps = depsFor(dir, { executor: e.executor });
      const first = yield* runWorkOrder(order(O), deps);
      assert.equal(first.state, "refused");
      assert.equal(first.refusal, "code_knowledge:not_configured");
      assert.equal(first.head, null);
      assert.equal(e.state.calls, 0);
      const repeat = yield* runWorkOrder(order(O), deps);
      assert.equal(repeat.refusal, "code_knowledge:not_configured");
      assert.equal(repeat.receipt.replayed, true);
      assert.equal(e.state.calls, 0);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("8 no executor refuses", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const result = yield* runWorkOrder(
        order(O),
        depsFor(dir, { executor: null, knowledge: knowledgeDouble() }),
      );
      assert.equal(result.state, "refused");
      assert.equal(result.refusal, "code_executor:not_configured");
      assert.equal(result.head, null);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("9 a knowledge refusal stops the executor", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const refusing: KnowledgePort = {
        fetch: () => Effect.succeed({ ok: false as const, refusal: "code_knowledge:packet_empty" }),
      };
      const result = yield* runWorkOrder(
        order(O),
        depsFor(dir, { executor: e.executor, knowledge: refusing }),
      );
      assert.equal(result.refusal, "code_knowledge:packet_empty");
      assert.equal(result.state, "refused");
      assert.equal(e.state.calls, 0);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("10 the result carries ids only, never passage text", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const result = yield* runWorkOrder(
        order(O),
        depsFor(dir, { executor: e.executor, knowledge: knowledgeDouble() }),
      );
      assert.equal(result.state, "built");
      assert.deepEqual(Object.keys(result), Object.keys(exampleResult));
      assert.equal(result.knowledge?.result_revision, "rev:fixture");
      assert.equal(result.knowledge?.omitted_count, 0);
      assert.equal(result.knowledge?.included.length, 1);
      for (const item of result.knowledge?.included ?? []) {
        assert.deepEqual(Object.keys(item).sort(), ["path_id", "revision", "revision_digest"]);
      }
      const onDisk = NodeFS.readFileSync(resultFilePath(dir, ORDER_ID), "utf8");
      assert.equal(JSON.stringify(result).includes(PASSAGE_TEXT), false);
      assert.equal(onDisk.includes(PASSAGE_TEXT), false);
      assert.equal(onDisk.includes('"text"'), false);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect(
  "11 a receipt without a result is in progress, never re-run",
  () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        const g = gatedExecutorDouble(started, gate);
        const deps = depsFor(dir, { executor: g.executor, knowledge: knowledgeDouble() });
        const runA = yield* runWorkOrder(order(O), deps).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        const b = yield* runWorkOrder(order(O), deps);
        assert.equal(b.state, "refused");
        assert.equal(b.refusal, "code_work_order:in_progress");
        assert.equal(g.state.calls, 1);
        yield* Deferred.succeed(gate, undefined);
        const a = yield* Fiber.join(runA);
        assert.equal(a.state, "built");
        const c = yield* runWorkOrder(order(O), deps);
        assert.equal(c.state, "built");
        assert.equal(c.receipt.replayed, true);
        assert.equal(g.state.calls, 1);

        // Crash window: a receipt exists, the result file does not.
        const e = executorDouble();
        const crashed = order(O2);
        const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
        const inserted = yield* receipts.insertIfAbsent({
          commandId: CommandId.make(ORDER_2_ID),
          projectId: ProjectId.make("invrt-slice"),
          commandType: "monti.code.work_order.v1",
          acceptedAt: yield* DateTime.now,
          resultSequence: 0,
          status: "accepted",
          error: null,
          payloadDigest: CommandReceiptStore.commandPayloadDigest(crashed),
        });
        assert.equal(inserted, true);
        const stuck = yield* runWorkOrder(
          crashed,
          depsFor(dir, { executor: e.executor, knowledge: knowledgeDouble() }),
        );
        assert.equal(stuck.refusal, "code_work_order:in_progress");
        assert.equal(e.state.calls, 0);
        assert.equal(NodeFS.existsSync(resultFilePath(dir, ORDER_2_ID)), false);
      }).pipe(Effect.provide(fileReceipts(NodePath.join(dir, "receipts.sqlite")))),
    ),
  TEST_TIMEOUT,
);

it.effect("12 a receipt store error fails closed and runs nothing", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const commandId = CommandId.make(ORDER_ID);
      const writeFails = Layer.mock(CommandReceiptStore.CommandReceiptStoreV2)({
        insertIfAbsent: () =>
          Effect.fail(new CommandReceiptStore.CommandReceiptStoreWriteError({ commandId })),
      });
      const readFails = Layer.mock(CommandReceiptStore.CommandReceiptStoreV2)({
        insertIfAbsent: () => Effect.succeed(true),
        getProjectByCommandId: () =>
          Effect.fail(new CommandReceiptStore.CommandReceiptStoreReadError({ commandId })),
      });
      for (const store of [writeFails, readFails]) {
        const e = executorDouble();
        const result = yield* runWorkOrder(
          order(O_NO_KNOWLEDGE),
          depsFor(dir, { executor: e.executor }),
        ).pipe(Effect.provide(store));
        assert.equal(result.state, "refused");
        assert.equal(result.refusal, "code_work_order:store_unavailable");
        assert.equal(result.head, null);
        assert.equal(e.state.calls, 0);
      }
      assert.deepEqual(NodeFS.readdirSync(dir), []);
    }),
  ),
);

it.effect("13 the report port is called once and its outcome is saved", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const r = reportDouble();
      const deps = depsFor(dir, {
        executor: e.executor,
        knowledge: knowledgeDouble(),
        report: r.report,
      });
      const first = yield* runWorkOrder(order(O), deps);
      assert.equal(first.state, "built");
      assert.equal(first.console_report, "spooled");
      const onDisk = JSON.parse(NodeFS.readFileSync(resultFilePath(dir, ORDER_ID), "utf8"));
      assert.equal(onDisk.console_report, "spooled");
      const repeat = yield* runWorkOrder(order(O), deps);
      assert.equal(repeat.console_report, "spooled");
      assert.equal(repeat.receipt.replayed, true);
      assert.equal(r.state.calls, 1);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect(
  "14 bin end to end on a durable store",
  () =>
    Effect.sync(() => {
      const homeA = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sl03-bin-a-"));
      const homeB = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sl03-bin-b-"));
      try {
        const stdin = JSON.stringify(O_NO_KNOWLEDGE);
        const env = { INVRT_CODE_EXECUTOR: "slice-fixture" };
        const first = runBin(homeA, stdin, env);
        assert.equal(first.status, 0, first.stderr);
        const firstResult = parseOneJson(first.stdout) as CodeResultV1;
        assert.equal(firstResult.state, "built");
        assert.match(firstResult.head ?? "", /^[0-9a-f]{40}$/);
        assert.equal(firstResult.builder_model, "slice-fixture-executor");
        assert.equal(firstResult.receipt.replayed, false);

        const other = parseOneJson(runBin(homeB, stdin, env).stdout) as CodeResultV1;
        assert.equal(other.head, firstResult.head);
        assert.equal(other.base, firstResult.base);

        const second = runBin(homeA, stdin, env);
        assert.equal(second.status, 0, second.stderr);
        const secondResult = parseOneJson(second.stdout) as CodeResultV1;
        assert.equal(secondResult.receipt.replayed, true);
        assert.equal(secondResult.head, firstResult.head);

        const noExecutor = runBin(NodeFS.mkdtempSync(NodePath.join(homeB, "x-")), stdin);
        assert.equal(noExecutor.status, 0, noExecutor.stderr);
        assert.equal(parseOneJson(noExecutor.stdout).refusal, "code_executor:not_configured");

        const invalid = runBin(homeA, "{not json", env);
        assert.equal(invalid.status, 2);
        assert.deepEqual(parseOneJson(invalid.stdout), { refusal: "code_work_order:invalid" });
      } finally {
        NodeFS.rmSync(homeA, { recursive: true, force: true });
        NodeFS.rmSync(homeB, { recursive: true, force: true });
      }
    }),
  TEST_TIMEOUT,
);

it.live(
  "15 bin opens no network listener",
  () =>
    withTempDir((home) =>
      Effect.acquireUseRelease(
        Effect.sync(() =>
          NodeChildProcess.spawn(
            process.execPath,
            [NodeURL.fileURLToPath(new URL("./bin.ts", import.meta.url))],
            {
              env: { ...process.env, INVRT_CODE_HOME: home, INVRT_CODE_EXECUTOR: "slice-fixture" },
              stdio: ["pipe", "pipe", "pipe"],
            },
          ),
        ),
        (child) =>
          Effect.gen(function* () {
            const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
            // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- the story holds an idle subprocess for 500 ms; no event marks the absence of a listener.
            yield* Effect.sleep("500 millis");
            assert.equal(child.exitCode, null, "bin must still be waiting on stdin");
            const probe = NodeChildProcess.spawnSync(
              "lsof",
              ["-nP", "-a", "-p", String(child.pid), "-iTCP", "-sTCP:LISTEN"],
              { encoding: "utf8" },
            );
            assert.equal(probe.error, undefined);
            assert.equal(probe.stdout, "");
            child.stdin.end(JSON.stringify(O_NO_KNOWLEDGE));
            assert.equal(yield* Effect.promise(() => exited), 0);
          }),
        (child) => Effect.sync(() => child.kill()),
      ),
    ),
  TEST_TIMEOUT,
);

const goodResultFor = (decoded: WorkOrderV1): CodeResultV1 => ({
  spec: "invrt.code.result.v1",
  work_order_id: decoded.work_order_id,
  correlation_id: decoded.correlation_id,
  project: decoded.project,
  story_id: decoded.story_id,
  state: "built",
  refusal: null,
  base: BASE,
  head: HEAD,
  builder_model: "slice-fixture-executor",
  knowledge: null,
  receipt: {
    command_id: decoded.work_order_id,
    payload_digest: CommandReceiptStore.commandPayloadDigest(decoded),
    replayed: false,
  },
  console_report: "not_configured",
});

const acceptReceipt = (decoded: WorkOrderV1) =>
  Effect.gen(function* () {
    const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
    return yield* receipts.insertIfAbsent({
      commandId: CommandId.make(decoded.work_order_id),
      projectId: ProjectId.make(decoded.project),
      commandType: "monti.code.work_order.v1",
      acceptedAt: yield* DateTime.now,
      resultSequence: 0,
      status: "accepted",
      error: null,
      payloadDigest: CommandReceiptStore.commandPayloadDigest(decoded),
    });
  });

it.effect("16 a result is bound to the order CODE accepted", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const decoded = order(O);
      const good = goodResultFor(decoded);
      const mismatched: ReadonlyArray<CodeResultV1> = [
        { ...good, work_order_id: ORDER_2_ID },
        { ...good, project: "other-project" },
        { ...good, story_id: "OTHER-1" },
        { ...good, correlation_id: "slice-run-9" },
      ];

      // No accepted receipt: nothing can be written, even a perfectly matching result.
      const emptyDir = NodePath.join(dir, "none");
      const noReceipt = yield* Effect.flip(makeFileResultStore(emptyDir).write(decoded, good));
      assert.equal(noReceipt, "code_work_order:result_unbound");
      assert.equal(NodeFS.existsSync(emptyDir), false);

      yield* acceptReceipt(decoded);
      const boundDir = NodePath.join(dir, "bound");
      const store = makeFileResultStore(boundDir);
      for (const result of mismatched) {
        const refusal = yield* Effect.flip(store.write(decoded, result));
        assert.equal(refusal, "code_work_order:result_unbound");
      }
      assert.deepEqual(NodeFS.existsSync(boundDir) ? NodeFS.readdirSync(boundDir) : [], []);

      // Control: the matching result is written (mode 0600) and read back.
      yield* store.write(decoded, good);
      assert.deepEqual(yield* store.read(decoded), good);
      assert.equal(NodeFS.statSync(resultFilePath(boundDir, ORDER_ID)).mode & 0o777, 0o600);
      assert.deepEqual(
        NodeFS.readdirSync(boundDir),
        [`${sha256(ORDER_ID)}.json`],
        "no temp file is left behind",
      );

      // A result file planted for an order with a foreign id never replays.
      const plantedOrder = order({
        ...O2,
        knowledge: { ...(O2.knowledge as object), required: false },
      });
      const e = executorDouble();
      const deps = depsFor(NodePath.join(dir, "planted"), { executor: e.executor });
      yield* runWorkOrder(plantedOrder, deps);
      NodeFS.writeFileSync(
        resultFilePath(NodePath.join(dir, "planted"), ORDER_2_ID),
        JSON.stringify({ ...goodResultFor(plantedOrder), work_order_id: ORDER_ID }),
      );
      const repeat = yield* runWorkOrder(plantedOrder, deps);
      assert.equal(repeat.state, "refused");
      assert.equal(repeat.refusal, "code_work_order:result_unbound");
      assert.equal(repeat.head, null);
      assert.equal(e.state.calls, 1);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("17 an executor failure refuses by name, is stored and never reports built", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const state = { calls: 0 };
      const failing: WorkOrderExecutor = {
        model: "slice-fixture-executor",
        run: () =>
          Effect.suspend(() => {
            state.calls += 1;
            return Effect.fail(new ExecutorFailed({ reason: "git exploded" }));
          }),
      };
      const deps = depsFor(dir, { executor: failing });
      const first = yield* runWorkOrder(order(O_NO_KNOWLEDGE), deps);
      assert.equal(first.state, "refused");
      assert.equal(first.refusal, "code_executor:failed");
      assert.equal(first.head, null);
      assert.equal(first.builder_model, "slice-fixture-executor");
      const repeat = yield* runWorkOrder(order(O_NO_KNOWLEDGE), deps);
      assert.equal(repeat.refusal, "code_executor:failed");
      assert.equal(repeat.receipt.replayed, true);
      assert.equal(state.calls, 1);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("19 a result file beside a brand-new receipt is not replayed", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const deps = depsFor(dir, { executor: e.executor, knowledge: knowledgeDouble() });
      // Two runs against two empty receipt stores, one shared results directory.
      const first = yield* runWorkOrder(order(O), deps).pipe(Effect.provide(memoryReceipts()));
      const second = yield* runWorkOrder(order(O), deps).pipe(Effect.provide(memoryReceipts()));
      assert.equal(first.receipt.replayed, false);
      assert.equal(second.receipt.replayed, false);
      assert.equal(e.state.calls, 2);
    }),
  ),
);

it.effect(
  "18 bin refuses by name when the state home cannot hold a receipt store",
  () =>
    Effect.sync(() => {
      const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sl03-blocked-"));
      try {
        const blocker = NodePath.join(home, "not-a-directory");
        NodeFS.writeFileSync(blocker, "file");
        const run = runBin(blocker, JSON.stringify(O_NO_KNOWLEDGE), {
          INVRT_CODE_EXECUTOR: "slice-fixture",
        });
        assert.equal(run.status, 0, run.stderr);
        const result = parseOneJson(run.stdout) as CodeResultV1;
        assert.equal(result.state, "refused");
        assert.equal(result.refusal, "code_work_order:store_unavailable");
        assert.equal(result.head, null);
      } finally {
        NodeFS.rmSync(home, { recursive: true, force: true });
      }
    }),
  TEST_TIMEOUT,
);

const TYPE_CASES_FILE = "work_order_type_cases.json";
// The same file is run through MONTI's `_order_ok` (SL-01b): one table, both validators.
const typeCases = JSON.parse(readFixture(TYPE_CASES_FILE).toString("utf8")) as {
  readonly refusal_on_reject: string;
  readonly cases: ReadonlyArray<{
    readonly name: string;
    readonly expect: string;
    readonly contract: string;
    readonly order: unknown;
  }>;
};

it.effect("20 the work-order type table is one shared case table", () =>
  Effect.sync(() => {
    assert.equal(
      sha256(readFixture(TYPE_CASES_FILE)),
      "811f7991e53adf429a39aa0348f1b2a4f49a34c7ec9c2816a9f5a89a94f52862",
      "the shared case table changed: update the MONTI-side pin too",
    );
    assert.isAtLeast(typeCases.cases.length, 20);
    assert.equal(typeCases.refusal_on_reject, "code_work_order:invalid");
    for (const { name, expect, order: input } of typeCases.cases) {
      const decoded = decodeWorkOrder(input);
      assert.equal(decoded.ok ? "accept" : decoded.refusal, expect, name);
    }
  }),
);

it.effect("21 an executor that returns a malformed commit refuses, stored, never built", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const state = { calls: 0 };
      const malformed: WorkOrderExecutor = {
        model: "slice-fixture-executor",
        run: () =>
          Effect.sync(() => {
            state.calls += 1;
            return { base: "abc", head: "def" };
          }),
      };
      const deps = depsFor(dir, { executor: malformed });
      const first = yield* runWorkOrder(order(O_NO_KNOWLEDGE), deps);
      assert.equal(first.state, "refused");
      assert.equal(first.refusal, "code_executor:failed");
      assert.equal(first.head, null);
      const repeat = yield* runWorkOrder(order(O_NO_KNOWLEDGE), deps);
      assert.equal(repeat.refusal, "code_executor:failed");
      assert.equal(repeat.receipt.replayed, true);
      assert.equal(state.calls, 1);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

const insertReceipt = (
  decoded: WorkOrderV1,
  overrides: {
    readonly projectId?: string;
    readonly commandType?: string;
    readonly status?: "accepted" | "rejected";
  },
) =>
  Effect.gen(function* () {
    const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
    return yield* receipts.insertIfAbsent({
      commandId: CommandId.make(decoded.work_order_id),
      projectId: ProjectId.make(overrides.projectId ?? decoded.project),
      commandType: overrides.commandType ?? "monti.code.work_order.v1",
      acceptedAt: yield* DateTime.now,
      resultSequence: 0,
      status: overrides.status ?? "accepted",
      error: null,
      payloadDigest: CommandReceiptStore.commandPayloadDigest(decoded),
    });
  });

it.effect("22 ResultStore needs an accepted receipt of this order's project and command type", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const decoded = order(O);
      const good = goodResultFor(decoded);
      const wrongReceipts = [
        { projectId: "other-project" },
        { commandType: "project.meta.update" },
        { status: "rejected" as const },
      ];
      for (const [index, wrong] of wrongReceipts.entries()) {
        const target = NodePath.join(dir, `wrong-${index}`);
        const store = makeFileResultStore(target);
        yield* Effect.gen(function* () {
          yield* insertReceipt(decoded, wrong);
          assert.equal(
            yield* Effect.flip(store.write(decoded, good)),
            "code_work_order:result_unbound",
          );
          assert.equal(yield* Effect.flip(store.read(decoded)), "code_work_order:result_unbound");
        }).pipe(Effect.provide(memoryReceipts()));
        assert.equal(NodeFS.existsSync(target), false);
      }
    }),
  ),
);

it.effect("23 a result write is atomic: a failed replacement leaves the old file whole", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const decoded = order(O);
      const good = goodResultFor(decoded);
      const target = NodePath.join(dir, "res");
      const store = makeFileResultStore(target);
      yield* insertReceipt(decoded, {});
      yield* store.write(decoded, good);
      // A read-only directory refuses the temp file; a direct overwrite of the 0600 file would succeed.
      NodeFS.chmodSync(target, 0o500);
      try {
        const refusal = yield* Effect.flip(
          store.write(decoded, { ...good, console_report: "held" }),
        );
        assert.equal(refusal, "code_work_order:store_unavailable");
      } finally {
        NodeFS.chmodSync(target, 0o700);
      }
      assert.deepEqual(yield* store.read(decoded), good);
      assert.deepEqual(NodeFS.readdirSync(target), [`${sha256(ORDER_ID)}.json`]);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("24 an unreadable result file is store_unavailable, not in progress", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const e = executorDouble();
      const deps = depsFor(dir, { executor: e.executor });
      yield* runWorkOrder(order(O_NO_KNOWLEDGE), deps);
      const file = resultFilePath(dir, ORDER_ID);
      NodeFS.chmodSync(file, 0o000);
      try {
        const repeat = yield* runWorkOrder(order(O_NO_KNOWLEDGE), deps);
        assert.equal(repeat.state, "refused");
        assert.equal(repeat.refusal, "code_work_order:store_unavailable");
        assert.equal(e.state.calls, 1);
      } finally {
        NodeFS.chmodSync(file, 0o600);
      }
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect("25 the fixture executor refuses any request but the slice request", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const other = order({ ...O_NO_KNOWLEDGE, request_text: "Delete everything." });
      const failure = yield* Effect.flip(makeSliceExecutor(dir).run(other, []));
      assert.equal(failure._tag, "ExecutorFailed");
      assert.deepEqual(NodeFS.readdirSync(dir), []);
    }),
  ),
);

it.effect("26 a results directory that is a symbolic link is refused", () =>
  withTempDir((dir) =>
    Effect.gen(function* () {
      const decoded = order(O);
      const outside = NodePath.join(dir, "outside");
      const link = NodePath.join(dir, "results");
      NodeFS.mkdirSync(outside);
      NodeFS.symlinkSync(outside, link);
      yield* insertReceipt(decoded, {});
      const store = makeFileResultStore(link);
      assert.equal(
        yield* Effect.flip(store.write(decoded, goodResultFor(decoded))),
        "code_work_order:store_unavailable",
      );
      assert.equal(yield* Effect.flip(store.read(decoded)), "code_work_order:store_unavailable");
      assert.deepEqual(NodeFS.readdirSync(outside), []);
    }).pipe(Effect.provide(memoryReceipts())),
  ),
);

it.effect(
  "27 bin creates its state private to the user",
  () =>
    Effect.sync(() => {
      const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sl03-modes-"));
      try {
        const run = runBin(home, JSON.stringify(O_NO_KNOWLEDGE), {
          INVRT_CODE_EXECUTOR: "slice-fixture",
        });
        assert.equal(run.status, 0, run.stderr);
        const delegation = NodePath.join(home, "delegation");
        const mode = (path: string) => NodeFS.statSync(path).mode & 0o777;
        assert.equal(mode(delegation), 0o700);
        assert.equal(mode(NodePath.join(delegation, "receipts.sqlite")), 0o600);
        assert.equal(mode(NodePath.join(delegation, "results")), 0o700);
        assert.equal(mode(resultFilePath(NodePath.join(delegation, "results"), ORDER_ID)), 0o600);
        assert.equal(mode(NodePath.join(delegation, "executor")), 0o700);
      } finally {
        NodeFS.rmSync(home, { recursive: true, force: true });
      }
    }),
  TEST_TIMEOUT,
);

it.effect(
  "28 two launches racing on one durable store execute the order once",
  () =>
    Effect.promise(async () => {
      const launch = (home: string) =>
        new Promise<CodeResultV1>((resolve, reject) => {
          const child = NodeChildProcess.spawn(
            process.execPath,
            [NodeURL.fileURLToPath(new URL("./bin.ts", import.meta.url))],
            {
              env: { ...process.env, INVRT_CODE_HOME: home, INVRT_CODE_EXECUTOR: "slice-fixture" },
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
          child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
          child.once("error", reject);
          child.once("exit", (code) =>
            code === 0
              ? resolve(parseOneJson(stdout) as CodeResultV1)
              : reject(new Error(`exit ${code}: ${stderr}`)),
          );
          child.stdin.end(JSON.stringify(O_NO_KNOWLEDGE));
        });
      for (let round = 0; round < 3; round += 1) {
        const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sl03-race-"));
        try {
          const results = await Promise.all([launch(home), launch(home)]);
          const fresh = results.filter((r) => r.state === "built" && !r.receipt.replayed);
          assert.equal(fresh.length, 1, JSON.stringify(results));
          for (const r of results) {
            assert.equal(
              r.state === "built" || r.refusal === "code_work_order:in_progress",
              true,
              JSON.stringify(r),
            );
          }
          // One executor repository, seed commit plus rename commit: the executor ran once.
          const repos = NodeFS.readdirSync(NodePath.join(home, "delegation", "executor"));
          assert.equal(repos.length, 1);
          const commits = NodeChildProcess.spawnSync(
            "git",
            [
              "-C",
              NodePath.join(home, "delegation", "executor", repos[0] ?? ""),
              "rev-list",
              "--count",
              "HEAD",
            ],
            { encoding: "utf8" },
          );
          assert.equal(commits.stdout.trim(), "2");
        } finally {
          NodeFS.rmSync(home, { recursive: true, force: true });
        }
      }
    }),
  TEST_TIMEOUT,
);

it.effect("27 a failed re-save after a delivered report still returns the built result", () =>
  withTempDir((dir) => {
    const logs: Array<string> = [];
    const logger = Logger.make(({ message }) => {
      logs.push(String(message));
    });
    return Effect.gen(function* () {
      const inner = makeFileResultStore(dir);
      let writes = 0;
      // The first save (`held`, before the report) succeeds; the re-save after the report fails.
      const flaky: ResultStore = {
        read: inner.read,
        write: (o, r) => {
          writes += 1;
          return writes === 2
            ? Effect.fail("code_work_order:store_unavailable" as const)
            : inner.write(o, r);
        },
      };
      const e = executorDouble();
      const reports = { calls: 0 };
      const report: ConsoleReportPort = {
        report: () =>
          Effect.sync(() => {
            reports.calls += 1;
            return "delivered" as const;
          }),
      };
      const deps: WorkOrderDeps = {
        executor: e.executor,
        knowledge: null,
        report,
        resultStore: flaky,
      };
      const first = yield* runWorkOrder(order(O_NO_KNOWLEDGE), deps);
      // CODE never tells MONTI built work is refused: the answer is the copy already on disk.
      assert.equal(first.state, "built");
      assert.equal(first.refusal, null);
      assert.equal(first.head, HEAD);
      assert.equal(first.console_report, "held");
      const second = yield* runWorkOrder(order(O_NO_KNOWLEDGE), deps);
      assert.deepStrictEqual(second, { ...first, receipt: { ...first.receipt, replayed: true } });
      assert.equal(reports.calls, 1);
      assert.equal(e.state.calls, 1);
      const named = logs.filter((line) => line.includes("code_work_order:store_unavailable"));
      assert.equal(named.length, 1, JSON.stringify(logs));
    }).pipe(
      Effect.provide(
        Layer.mergeAll(memoryReceipts(), Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
  }),
);
