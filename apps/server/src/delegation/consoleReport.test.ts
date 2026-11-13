// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { reportToConsole, toObservations, type ConsoleObservationV1 } from "./consoleReport.ts";
import { makeFileResultStore } from "./resultStore.ts";
import {
  decodeWorkOrder,
  runWorkOrder,
  type CodeResultV1,
  type WorkOrderDeps,
  type WorkOrderExecutor,
} from "./workOrder.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(NodeFS.readFileSync(new URL(name, FIXTURES), "utf8")) as Record<string, unknown>;

const ORDER_ID = "wo:b750f6a2e80a344419371904b87d9b5a";
const ORDER_2_ID = "wo:6918cf3b25ed06d09da16ad304f1a145";
const HEAD = "2222222222222222222222222222222222222222";
const CANARY = "SLICE-CANARY-7";
const SECRET = "ecs_test_0123456789abcdef";

// B: the built result; F: the refused result for the second order.
const B = {
  ...readJson("invrt.code.result.v1.example.json"),
  work_order_id: ORDER_ID,
} as CodeResultV1;
const F = {
  ...B,
  state: "refused",
  refusal: "code_knowledge:packet_empty",
  head: null,
  base: null,
  knowledge: null,
  work_order_id: ORDER_2_ID,
  correlation_id: "slice-run-2",
} as CodeResultV1;

const BUILT_OBSERVATION: ConsoleObservationV1 = {
  projectId: "invrt-slice",
  workItemId: "SLICE-1",
  kind: "status",
  state: "built",
  commit: HEAD,
  builderModel: "slice-fixture-executor",
  sourceRef: `invrt-code:${ORDER_ID}`,
  text: `Built by INVRT CODE for MONTI work order ${ORDER_ID}`,
};

// The stub stands in for `ec-send`. The sender only ever receives the three EC_* variables, so the
// stub finds its instructions and its record in EC_STATE_DIR: it appends its stdin, argv, environment
// and pid to record.jsonl, sleeps, then prints the line and exit code the case wrote to control.json.
// It never touches the network or the credential.
const STUB_SOURCE = `
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const state = process.env.EC_STATE_DIR;
const control = JSON.parse(readFileSync(join(state, "control.json"), "utf8"));
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
appendFileSync(join(state, "record.jsonl"), JSON.stringify({ stdin, argv: process.argv.slice(2), env: process.env, pid: process.pid }) + "\\n");
await new Promise((resolve) => setTimeout(resolve, control.sleepMs ?? 0));
if (control.stdout !== undefined) process.stdout.write(control.stdout + "\\n");
process.exitCode = control.exit;
`;

interface StubCase {
  readonly exit: number;
  readonly stdout?: string;
  readonly sleepMs?: number;
}
interface StubCall {
  readonly stdin: string;
  readonly argv: ReadonlyArray<string>;
  readonly env: Record<string, string>;
  readonly pid: number;
}

const withStub = <A, E, R>(
  use: (stub: {
    readonly dir: string;
    readonly senderBin: string;
    readonly credentialFile: string;
    readonly stateDir: string;
    readonly script: (c: StubCase) => void;
    readonly config: (
      c: StubCase,
      timeoutMs?: number,
    ) => NonNullable<Parameters<typeof reportToConsole>[1]>;
    readonly calls: () => ReadonlyArray<StubCall>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sl05-"));
      const senderBin = NodePath.join(dir, "stub-sender.mjs");
      NodeFS.writeFileSync(senderBin, STUB_SOURCE);
      const credentialFile = NodePath.join(dir, "credential");
      NodeFS.writeFileSync(credentialFile, SECRET, { mode: 0o600 });
      const stateDir = NodePath.join(dir, "state");
      NodeFS.mkdirSync(stateDir);
      return { dir, senderBin, credentialFile, stateDir };
    }),
    ({ dir, senderBin, credentialFile, stateDir }) => {
      const script = (c: StubCase): void =>
        NodeFS.writeFileSync(NodePath.join(stateDir, "control.json"), JSON.stringify(c));
      return use({
        dir,
        senderBin,
        credentialFile,
        stateDir,
        script,
        config: (c, timeoutMs = 10_000) => {
          script(c);
          return {
            node: process.execPath,
            senderBin,
            timeoutMs,
            env: {
              EC_BASE_URL: "http://127.0.0.1:1",
              EC_CREDENTIAL_FILE: credentialFile,
              EC_STATE_DIR: stateDir,
            },
          };
        },
        calls: () => {
          const record = NodePath.join(stateDir, "record.jsonl");
          return NodeFS.existsSync(record)
            ? NodeFS.readFileSync(record, "utf8")
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line) as StubCall)
            : [];
        },
      });
    },
    ({ dir }) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
  );

const memoryReceipts = () =>
  CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory));

const TEST_TIMEOUT = 120_000;

it.effect("1 built maps to one status row", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(toObservations(B), [BUILT_OBSERVATION]);
  }),
);

it.effect("2 refused maps to one hold row", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(toObservations(F), [
      {
        projectId: "invrt-slice",
        workItemId: "SLICE-1",
        kind: "hold",
        sourceState: "refused",
        sourceRef: `invrt-code:${ORDER_2_ID}`,
        text: "INVRT CODE refused: code_knowledge:packet_empty",
      },
    ]);
  }),
);

it.effect(
  "3 delivered: exit 0 with outcome delivered, one call, stdin is the status row",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        assert.equal(
          yield* reportToConsole(B, stub.config({ exit: 0, stdout: '{"outcome":"delivered"}' })),
          "delivered",
        );
        const calls = stub.calls();
        assert.equal(calls.length, 1);
        assert.deepStrictEqual(JSON.parse(calls[0]?.stdin ?? ""), BUILT_OBSERVATION);
      }),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "4 blocked keeps the result: exit 2 is held, state and head are unchanged through runWorkOrder",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        const config = stub.config({ exit: 2, stdout: '{"outcome":"blocked"}' });
        assert.equal(yield* reportToConsole(B, config), "held");
        const decoded = decodeWorkOrder(readJson("monti.code.work_order.v1.example.json"));
        if (!decoded.ok) throw new Error("fixture order failed to decode");
        const executor: WorkOrderExecutor = {
          model: "slice-fixture-executor",
          run: () => Effect.succeed({ base: "1".repeat(40), head: HEAD }),
        };
        const deps: WorkOrderDeps = {
          executor,
          knowledge: null,
          report: { report: (result) => reportToConsole(result, config) },
          resultStore: makeFileResultStore(NodePath.join(stub.dir, "results")),
        };
        const order = {
          ...decoded.order,
          knowledge: { ...decoded.order.knowledge, required: false },
        };
        const result = yield* runWorkOrder(order, deps).pipe(Effect.provide(memoryReceipts()));
        assert.equal(result.state, "built");
        assert.equal(result.head, HEAD);
        assert.equal(result.console_report, "held");
      }),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "5 spooled: exit 0 with outcome spooled",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        assert.equal(
          yield* reportToConsole(B, stub.config({ exit: 0, stdout: '{"outcome":"spooled"}' })),
          "spooled",
        );
      }),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "6 inactive is held",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        assert.equal(
          yield* reportToConsole(B, stub.config({ exit: 0, stdout: '{"outcome":"inactive"}' })),
          "held",
        );
      }),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "6b everything else is held",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        const cases: ReadonlyArray<StubCase> = [
          { exit: 0, stdout: '{"outcome":"suppressed"}' },
          { exit: 2, stdout: '{"outcome":"dead-lettered"}' },
          { exit: 0, stdout: '{"outcome":"surprise"}' },
          { exit: 0, stdout: "not json" },
          { exit: 0, stdout: '{"result":"delivered"}' },
          { exit: 1 },
          // A delivered line does not outvote a non-zero exit.
          { exit: 1, stdout: '{"outcome":"delivered"}' },
        ];
        for (const c of cases) {
          assert.equal(yield* reportToConsole(B, stub.config(c)), "held", JSON.stringify(c));
        }
      }),
    ),
  TEST_TIMEOUT,
);

it.effect("7 not configured: config null runs no sender", () =>
  withStub((stub) =>
    Effect.gen(function* () {
      assert.equal(yield* reportToConsole(B, null), "not_configured");
      assert.equal(stub.calls().length, 0);
    }),
  ),
);

it.effect(
  "8 a sender that outlives the timeout is held and its child is killed",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        const outcome = yield* reportToConsole(
          B,
          // The timeout must outlast node's start-up so the stub has recorded its pid before it is killed.
          stub.config({ exit: 0, stdout: '{"outcome":"delivered"}', sleepMs: 8000 }, 1500),
        );
        assert.equal(outcome, "held");
        const pid = stub.calls()[0]?.pid;
        assert.equal(typeof pid, "number");
        const alive = (): boolean => {
          try {
            process.kill(pid as number, 0);
            return true;
          } catch {
            return false;
          }
        };
        // execFile settles after the killed child has closed, so no waiting is needed here.
        assert.equal(alive(), false, "the sender child is still running after the timeout");
      }),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "9 the report carries no knowledge text, no path ids and no credential secret",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        // The canary rides on the result as extra keys a careless mapper might copy through.
        const leaky = {
          ...B,
          knowledge: {
            ...(B.knowledge as object),
            included: [
              {
                path_id: "path:fixture-1",
                revision: "r1",
                revision_digest: "0".repeat(64),
                text: CANARY,
              },
            ],
          },
        } as unknown as CodeResultV1;
        assert.equal(
          yield* reportToConsole(
            leaky,
            stub.config({ exit: 0, stdout: '{"outcome":"delivered"}' }),
          ),
          "delivered",
        );
        const call = stub.calls()[0];
        assert.notEqual(call, undefined);
        const stdin = call?.stdin ?? "";
        for (const forbidden of ["included", "path_id", "revision_digest", CANARY, SECRET]) {
          assert.equal(stdin.includes(forbidden), false, `stdin leaks ${forbidden}`);
        }
        assert.equal(JSON.stringify(call?.argv).includes(SECRET), false);
        assert.equal(call?.env.EC_CREDENTIAL_FILE, stub.credentialFile);
        assert.equal(Object.values(call?.env ?? {}).includes(SECRET), false);
      }),
    ),
  TEST_TIMEOUT,
);

const runBin = (home: string, env: Record<string, string | undefined>) => {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of [
    "INVRT_CODE_EXECUTOR",
    "INVRT_CODE_EC_SENDER_BIN",
    "EC_BASE_URL",
    "EC_CREDENTIAL_FILE",
    "EC_STATE_DIR",
  ]) {
    delete base[key];
  }
  const order = { ...readJson("monti.code.work_order.v1.example.json"), work_order_id: ORDER_ID };
  const orderWithoutKnowledge = {
    ...order,
    knowledge: {
      ...(readJson("monti.code.work_order.v1.example.json").knowledge as object),
      required: false,
    },
  };
  const run = NodeChildProcess.spawnSync(
    process.execPath,
    [NodeURL.fileURLToPath(new URL("./bin.ts", import.meta.url))],
    {
      input: JSON.stringify(orderWithoutKnowledge),
      encoding: "utf8",
      env: { ...base, INVRT_CODE_HOME: home, INVRT_CODE_EXECUTOR: "slice-fixture", ...env },
      timeout: 60_000,
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `stdout must be exactly one JSON value, got: ${run.stdout}`);
  return JSON.parse(lines[0] ?? "") as CodeResultV1;
};

it.effect(
  "10 bin wiring: one sender call across a replay; unset sender means not_configured",
  () =>
    withStub((stub) =>
      Effect.sync(() => {
        const home = NodePath.join(stub.dir, "home");
        const env = {
          INVRT_CODE_EC_SENDER_BIN: stub.senderBin,
          EC_BASE_URL: "http://127.0.0.1:1",
          EC_CREDENTIAL_FILE: stub.credentialFile,
          EC_STATE_DIR: stub.stateDir,
        };
        stub.script({ exit: 0, stdout: '{"outcome":"delivered"}' });
        const first = runBin(home, env);
        assert.equal(first.state, "built");
        assert.equal(first.console_report, "delivered");
        const second = runBin(home, env);
        assert.equal(second.receipt.replayed, true);
        assert.equal(second.console_report, "delivered");
        assert.equal(stub.calls().length, 1);

        const unset = runBin(NodePath.join(stub.dir, "home-unset"), {});
        assert.equal(unset.state, "built");
        assert.equal(unset.console_report, "not_configured");
        assert.equal(stub.calls().length, 1);
      }),
    ),
  TEST_TIMEOUT,
);
