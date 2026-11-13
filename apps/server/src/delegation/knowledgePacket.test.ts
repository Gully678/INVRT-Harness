// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";

import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import {
  BRAIN_ENV_NAMES,
  CodePacketV1,
  decodeKnowledgePacket,
  makeBrainKnowledgePort,
  parseBrainEnv,
} from "./knowledgePacket.ts";
import { makeFileResultStore } from "./resultStore.ts";
import { decodeWorkOrder, runWorkOrder, type CodeResultV1, type WorkOrderV1 } from "./workOrder.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const readFixtureText = (name: string): string =>
  NodeFS.readFileSync(new URL(name, FIXTURES), "utf8");
const sha256 = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value).digest("hex");

const MEMBER = "8d3f2b1e-6a4c-4e2f-9b7a-1c5d3e9f0a42";
const CANARY = "SLICE-CANARY-7";
const ORDER_2_ID = "wo:6918cf3b25ed06d09da16ad304f1a145";
const exampleOrder = JSON.parse(readFixtureText("monti.code.work_order.v1.example.json")) as Record<
  string,
  unknown
>;
const asOrder = (input: Record<string, unknown>): WorkOrderV1 => {
  const decoded = decodeWorkOrder(input);
  if (!decoded.ok) throw new Error("fixture order failed to decode");
  return decoded.order;
};
const O = asOrder(exampleOrder);
const O_NOT_REQUIRED = asOrder({
  ...exampleOrder,
  knowledge: { ...(exampleOrder.knowledge as object), required: false },
});

// Brain's real shape: integer revision, 16 hex digest, omitted {count, reason "none"} for zero.
const P1 = {
  spec: "monti.code_knowledge_packet.v1",
  destination: "code_local_device",
  requested_by: MEMBER,
  budget_chars: 4000,
  included: [
    {
      path_id: "path:slice-1",
      revision: 1,
      revision_digest: "f15b104483d22a96",
      text: `Timeout constants end in _SECONDS (slice canary ${CANARY})`,
    },
  ],
  omitted: { count: 0, reason: "none" },
  result_revision: "rev:slice-1",
} as const;
const EMPTY = { ...P1, included: [] };

interface Script {
  readonly exit: number;
  readonly stdout?: string;
  readonly sleepMs?: number;
}

// The stub stands in for `python tools/kb_code_packet_cli.py`: it records what it was given and
// answers from script.json. `process.execPath` is the "python", so no Python runs in these tests.
const STUB = `import fs from "node:fs";
const dir = import.meta.dirname;
fs.writeFileSync(dir + "/stdin.json", fs.readFileSync(0, "utf8"));
fs.writeFileSync(dir + "/env.json", JSON.stringify(process.env));
fs.appendFileSync(dir + "/calls.log", process.pid + "\\n");
process.stderr.write("[kbread] receipt member=8d3f2b1e-6a4c-4e2f-9b7a-1c5d3e9f0a42 path=path:slice-1 STDERR-CANARY-9\\n");
// Brain's own switch (agent/kb_code_packet.py): exactly "off" in the child's environment refuses.
const c = process.env.MONTI_KB_CODE_ADAPTER === "off"
  ? { exit: 3, stdout: '{"refusal": "kb_code_packet:adapter_disabled"}\\n' }
  : JSON.parse(fs.readFileSync(dir + "/script.json", "utf8"));
const finish = () => process.stdout.write(c.stdout ?? "", () => process.exit(c.exit));
if (c.sleepMs) setTimeout(finish, c.sleepMs); else finish();
`;

const withStub = <A, E, R>(
  use: (stub: {
    readonly dir: string;
    readonly cli: string;
    readonly script: (s: Script) => void;
    readonly calls: () => ReadonlyArray<number>;
    readonly stdin: () => unknown;
    readonly env: () => Record<string, string>;
    readonly config: (timeoutMs?: number) => Parameters<typeof makeBrainKnowledgePort>[0];
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sl04-"))),
    (dir) => {
      const cli = NodePath.join(dir, "stub-brain.mjs");
      NodeFS.writeFileSync(cli, STUB);
      const read = (name: string) => NodeFS.readFileSync(NodePath.join(dir, name), "utf8");
      return use({
        dir,
        cli,
        script: (s) => NodeFS.writeFileSync(NodePath.join(dir, "script.json"), JSON.stringify(s)),
        calls: () =>
          NodeFS.existsSync(NodePath.join(dir, "calls.log"))
            ? read("calls.log").trim().split("\n").map(Number)
            : [],
        stdin: () => JSON.parse(read("stdin.json")),
        env: () => JSON.parse(read("env.json")),
        config: (timeoutMs = 10_000) => ({
          python: process.execPath,
          cli,
          brainEnv: {
            HERMES_HOME: "/vm/hermes",
            MONTI_TEAM_STATE_PATH: "/vm/team.json",
            MONTI_VM_ID: "vm-1",
            MONTI_ORG_ID: "org-1",
          },
          timeoutMs,
        }),
      });
    },
    (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
  );

const TEST_TIMEOUT = 60_000;

const fetchWith = (script: Script, order: WorkOrderV1 = O) =>
  withStub((stub) => {
    stub.script(script);
    return makeBrainKnowledgePort(stub.config()).fetch(order);
  });
const say = (value: unknown): Script => ({ exit: 0, stdout: `${JSON.stringify(value)}\n` });
const refusal = (name: string) => ({ ok: false, refusal: name }) as const;

it.effect(
  "1 a packet becomes ids: revision is a string, omitted.count is carried, text never is",
  () =>
    Effect.gen(function* () {
      const one = yield* fetchWith(say(P1));
      assert.deepStrictEqual(one, {
        ok: true,
        summary: {
          result_revision: "rev:slice-1",
          included: [
            { path_id: "path:slice-1", revision: "1", revision_digest: "f15b104483d22a96" },
          ],
          omitted_count: 0,
        },
      });
      assert.equal(JSON.stringify(one).includes(CANARY), false);
      const omitted = yield* fetchWith(say({ ...P1, omitted: { count: 3, reason: "truncated" } }));
      assert.equal(omitted.ok && omitted.summary.omitted_count, 3);
    }),
  TEST_TIMEOUT,
);

it.effect(
  "2 an empty packet refuses when knowledge is required",
  () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* fetchWith(say(EMPTY)), refusal("code_knowledge:packet_empty"));
    }),
  TEST_TIMEOUT,
);

it.effect(
  "3 an empty packet proceeds when knowledge is not required",
  () =>
    Effect.gen(function* () {
      const result = yield* fetchWith(say(EMPTY), O_NOT_REQUIRED);
      assert.equal(result.ok && result.summary.included.length, 0);
    }),
  TEST_TIMEOUT,
);

it.effect(
  "4 a named Brain refusal passes through; any other exit 3 text does not",
  () =>
    Effect.gen(function* () {
      for (const name of [
        "kb_code_packet:destination_unqualified",
        "kb_code_packet:adapter_disabled",
      ]) {
        assert.deepStrictEqual(
          yield* fetchWith({ exit: 3, stdout: `${JSON.stringify({ refusal: name })}\n` }),
          refusal(name),
        );
      }
      for (const stdout of [
        `${JSON.stringify({ refusal: "kb_code_packet:something_new" })}\n`,
        `${JSON.stringify({ refusal: "anything\nat all" })}\n`,
        "not json\n",
      ]) {
        assert.deepStrictEqual(
          yield* fetchWith({ exit: 3, stdout }),
          refusal("code_knowledge:brain_unavailable"),
        );
      }
    }),
  TEST_TIMEOUT,
);

it.effect(
  "4b exit 2 is a contract mismatch and exit 1 is unavailable, never relayed and never an empty success",
  () =>
    Effect.gen(function* () {
      const unavailable = refusal("code_knowledge:brain_unavailable");
      assert.deepStrictEqual(
        yield* fetchWith({
          exit: 2,
          stdout: `${JSON.stringify({ refusal: "kb_code_packet_cli:invalid_request" })}\n`,
        }),
        // Deterministic for the same request: final, never the transient unavailable.
        refusal("code_knowledge:contract_mismatch"),
      );
      assert.deepStrictEqual(yield* fetchWith({ exit: 1 }), unavailable);
      // A non-zero exit that still prints a valid packet is not a packet.
      assert.deepStrictEqual(yield* fetchWith({ ...say(P1), exit: 4 }), unavailable);
      assert.deepStrictEqual(
        yield* withStub((stub) =>
          makeBrainKnowledgePort({ ...stub.config(), cli: "/nonexistent/cli" }).fetch(O),
        ),
        unavailable,
      );
    }),
  TEST_TIMEOUT,
);

it.effect(
  "4c a refusal or a fault is asked once and never retried into success",
  () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [string, Script]> = [
        [
          "invalid request",
          { exit: 2, stdout: '{"refusal": "kb_code_packet_cli:invalid_request"}\n' },
        ],
        ["fault", { exit: 1 }],
        ["named refusal", { exit: 3, stdout: '{"refusal": "kb_code_packet:adapter_disabled"}\n' }],
        ["other exit with a packet", { ...say(P1), exit: 4 }],
        ["malformed", say({ ...P1, extra: 1 })],
        ["empty", say(EMPTY)],
      ];
      for (const [label, script] of cases) {
        const calls = yield* withStub((stub) =>
          Effect.gen(function* () {
            stub.script(script);
            const first = yield* makeBrainKnowledgePort(stub.config()).fetch(O);
            assert.equal(first.ok, false, label);
            return stub.calls().length;
          }),
        );
        assert.equal(calls, 1, `${label}: Brain was asked more than once`);
      }
    }),
  TEST_TIMEOUT,
);

it.effect(
  "5 a slow Brain is unavailable and its child is killed",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        stub.script({ exit: 0, stdout: "{}", sleepMs: 20_000 });
        // The timeout outlasts node's start-up so the stub has recorded its pid before the kill.
        const result = yield* makeBrainKnowledgePort(stub.config(1500)).fetch(O);
        assert.deepStrictEqual(result, refusal("code_knowledge:brain_unavailable"));
        const pid = stub.calls()[0];
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
        assert.equal(alive(), false, "the Brain child is still running after the timeout");
        assert.equal(stub.calls().length, 1, "a timed-out Brain call was repeated");
      }),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "6 a malformed packet is a contract mismatch",
  () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [string, unknown]> = [
        ["extra key", { ...P1, extra: 1 }],
        ["other spec", { ...P1, spec: "other" }],
        ["missing key", (({ omitted: _omitted, ...rest }) => rest)(P1)],
        ["string revision", { ...P1, included: [{ ...P1.included[0], revision: "r1" }] }],
        ["fractional revision", { ...P1, included: [{ ...P1.included[0], revision: 1.5 }] }],
        [
          "long digest",
          { ...P1, included: [{ ...P1.included[0], revision_digest: "a".repeat(64) }] },
        ],
        [
          "upper digest",
          { ...P1, included: [{ ...P1.included[0], revision_digest: "F15B104483D22A96" }] },
        ],
        ["item extra key", { ...P1, included: [{ ...P1.included[0], extra: 1 }] }],
        ["omitted without reason", { ...P1, omitted: { count: 0 } }],
        ["negative omitted", { ...P1, omitted: { count: -1, reason: "x" } }],
        ["other destination", { ...P1, destination: "code_vm" }],
        ["unqualified destination", { ...P1, destination: "elsewhere" }],
        ["other member", { ...P1, requested_by: "someone-else" }],
        ["other budget", { ...P1, budget_chars: 4001 }],
        ["array", [P1]],
      ];
      for (const [label, packet] of cases) {
        assert.deepStrictEqual(
          yield* fetchWith(say(packet)),
          refusal("code_knowledge:contract_mismatch"),
          label,
        );
      }
      assert.deepStrictEqual(
        yield* fetchWith({ exit: 0, stdout: "not json\n" }),
        refusal("code_knowledge:contract_mismatch"),
      );
    }),
  TEST_TIMEOUT,
);

it.effect(
  "7 the request is exact, the environment is the Brain names plus PATH, and logs carry no identity",
  () =>
    withStub((stub) => {
      const logs: Array<string> = [];
      const logger = Logger.make(({ message }) => {
        logs.push(String(message));
      });
      return Effect.gen(function* () {
        stub.script(say(P1));
        yield* makeBrainKnowledgePort(stub.config()).fetch(O);
        assert.deepStrictEqual(stub.stdin(), {
          profile: { user_id: MEMBER },
          brief_text: "timeout naming convention",
          budget_chars: 4000,
          destination: "code_local_device",
          requested_by: MEMBER,
        });
        // macOS adds __CF_USER_TEXT_ENCODING to every process it starts; it is not passed by the port.
        const received = Object.keys(stub.env()).filter((key) => key !== "__CF_USER_TEXT_ENCODING");
        assert.deepStrictEqual(received.sort(), [
          "HERMES_HOME",
          "MONTI_ORG_ID",
          "MONTI_TEAM_STATE_PATH",
          "MONTI_VM_ID",
          "PATH",
        ]);
        // A different member goes into both fields: nothing is fixed.
        const other = asOrder({ ...exampleOrder, member: "11111111-2222-3333-4444-555555555555" });
        yield* makeBrainKnowledgePort(stub.config()).fetch(other);
        const sent = stub.stdin() as { profile: { user_id: string }; requested_by: string };
        assert.equal(sent.profile.user_id, "11111111-2222-3333-4444-555555555555");
        assert.equal(sent.requested_by, "11111111-2222-3333-4444-555555555555");

        // A refusal or a fault leaves a named cause in the log and no member, passage or request text.
        for (const script of [
          { exit: 2, stdout: '{"refusal":"kb_code_packet_cli:invalid_request"}\n' },
          { exit: 1 },
          { ...say({ ...P1, requested_by: MEMBER, extra: CANARY }) },
        ]) {
          stub.script(script);
          logs.length = 0;
          yield* makeBrainKnowledgePort(stub.config()).fetch(O);
          const joined = logs.join("\n");
          assert.equal(joined.length > 0, true, "a refusal is logged by cause");
          for (const secret of [MEMBER, CANARY, "timeout naming convention", O.work_order_id]) {
            assert.equal(joined.includes(secret), false, `${secret} reached the log`);
          }
        }
      }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
    }),
  TEST_TIMEOUT,
);

it.effect("8 the decoder agrees with Brain's frozen contract", () =>
  Effect.sync(() => {
    const text = readFixtureText("code_packet_contract_v1.json");
    // Brain's tests/br05_consumers/code_packet_contract_v1.json is byte sha256 a9fae10f...aae. This
    // repository's formatter rewraps JSON on commit, so the pin is on the parsed content, which the
    // formatter cannot change: the hash below is of JSON.stringify(JSON.parse(...)) of Brain's file.
    assert.equal(
      sha256(JSON.stringify(JSON.parse(text))),
      "5f51af9afa68cf1550fccca72de8cceb71461358e2a332bb0921364ceb92b888",
    );
    const frozen = JSON.parse(text) as {
      spec: string;
      keys: Array<string>;
      included_item_keys: Array<string>;
      qualified_destinations: Array<string>;
    };
    assert.deepStrictEqual(Object.keys(CodePacketV1.fields), frozen.keys);
    const item = CodePacketV1.fields.included.value.fields;
    assert.deepStrictEqual(Object.keys(item), frozen.included_item_keys);
    assert.equal(decodeKnowledgePacket({ ...P1, spec: frozen.spec })._tag, "Some");
    for (const destination of frozen.qualified_destinations) {
      assert.equal(decodeKnowledgePacket({ ...P1, destination })._tag, "Some", destination);
    }
    assert.equal(decodeKnowledgePacket({ ...P1, destination: "code_other" })._tag, "None");
  }),
);

it.effect("8b the Brain environment file is read by name and only those names", () =>
  Effect.sync(() => {
    const names = [...BRAIN_ENV_NAMES];
    assert.deepStrictEqual(names, [
      "HERMES_HOME",
      "MONTI_TEAM_STATE_PATH",
      "MONTI_VM_ID",
      "MONTI_ORG_ID",
    ]);
    const text = [
      "# written by the VM installer",
      "",
      "HERMES_HOME=/vm/hermes",
      'MONTI_TEAM_STATE_PATH="/vm/team state.json"',
      "export MONTI_VM_ID='vm-1'",
      "MONTI_ORG_ID = org-1",
      "UNRELATED_SECRET=do-not-forward",
    ].join("\n");
    assert.deepStrictEqual(parseBrainEnv(text), {
      HERMES_HOME: "/vm/hermes",
      MONTI_TEAM_STATE_PATH: "/vm/team state.json",
      MONTI_VM_ID: "vm-1",
      MONTI_ORG_ID: "org-1",
    });
    // The Brain's code-adapter switch is read by the Brain, so it is forwarded as written when present
    // (and only then): an off switch is the Brain's to enforce, never silently dropped here.
    assert.deepStrictEqual(parseBrainEnv(`${text}\nMONTI_KB_CODE_ADAPTER=off\n`), {
      HERMES_HOME: "/vm/hermes",
      MONTI_TEAM_STATE_PATH: "/vm/team state.json",
      MONTI_VM_ID: "vm-1",
      MONTI_ORG_ID: "org-1",
      MONTI_KB_CODE_ADAPTER: "off",
    });
    assert.equal(parseBrainEnv(text.replace("MONTI_VM_ID", "MONTI_VM")), null);
    assert.equal(parseBrainEnv(text.replace("MONTI_ORG_ID = org-1", "MONTI_ORG_ID=")), null);
  }),
);

const gitOut = (cwd: string, args: ReadonlyArray<string>): string =>
  NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" }).stdout.trim();

const runBin = (
  home: string,
  order: WorkOrderV1,
  env: Record<string, string | undefined>,
  onStderr?: (stderr: string) => void,
): CodeResultV1 => {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of [
    "INVRT_CODE_EXECUTOR",
    "INVRT_CODE_EC_SENDER_BIN",
    "EC_BASE_URL",
    "EC_CREDENTIAL_FILE",
    "EC_STATE_DIR",
    "INVRT_CODE_BRAIN_PYTHON",
    "INVRT_CODE_BRAIN_CLI",
    "INVRT_CODE_BRAIN_ENV_FILE",
    ...BRAIN_ENV_NAMES,
  ]) {
    delete base[key];
  }
  const run = NodeChildProcess.spawnSync(
    process.execPath,
    [NodeURL.fileURLToPath(new URL("./bin.ts", import.meta.url))],
    {
      input: JSON.stringify(order),
      encoding: "utf8",
      env: { ...base, INVRT_CODE_HOME: home, INVRT_CODE_EXECUTOR: "slice-fixture", ...env },
      timeout: 60_000,
    },
  );
  assert.equal(run.status, 0, run.stderr);
  onStderr?.(run.stderr);
  const lines = run.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `stdout must be exactly one JSON value, got: ${run.stdout}`);
  return JSON.parse(lines[0] ?? "") as CodeResultV1;
};

it.effect(
  "9 bin wiring: built with the packet ids, Brain env from the file only; unset means not_configured",
  () =>
    withStub((stub) =>
      Effect.sync(() => {
        const envFile = NodePath.join(stub.dir, "brain.env");
        NodeFS.writeFileSync(
          envFile,
          "HERMES_HOME=/file/hermes\nMONTI_TEAM_STATE_PATH=/file/team.json\nMONTI_VM_ID=file-vm\nMONTI_ORG_ID=file-org\n",
        );
        const brain = {
          INVRT_CODE_BRAIN_PYTHON: process.execPath,
          INVRT_CODE_BRAIN_CLI: stub.cli,
          INVRT_CODE_BRAIN_ENV_FILE: envFile,
        };
        stub.script(say(P1));
        // The launching process's own value must not reach Brain: only the file supplies it.
        const built = runBin(NodePath.join(stub.dir, "home"), O, {
          ...brain,
          HERMES_HOME: "/parent/hermes",
        });
        assert.equal(built.state, "built");
        assert.equal(built.knowledge?.included[0]?.path_id, "path:slice-1");
        assert.equal(built.knowledge?.included[0]?.revision, "1");
        assert.equal(JSON.stringify(built).includes(CANARY), false);
        assert.equal(stub.calls().length, 1);
        assert.equal(stub.env().HERMES_HOME, "/file/hermes");
        assert.equal(stub.env().MONTI_ORG_ID, "file-org");

        // Any one of the three variables missing: no port, so the required knowledge refuses by name.
        for (const omitted of Object.keys(brain)) {
          const partial = Object.fromEntries(Object.entries(brain).filter(([k]) => k !== omitted));
          const result = runBin(NodePath.join(stub.dir, `home-without-${omitted}`), O, partial);
          assert.equal(result.refusal, "code_knowledge:not_configured", `without ${omitted}`);
        }
        // An env file that cannot be used also leaves no port, named on stderr and never forwarded.
        const unreadable = runBin(NodePath.join(stub.dir, "home-bad-file"), O, {
          ...brain,
          INVRT_CODE_BRAIN_ENV_FILE: NodePath.join(stub.dir, "missing.env"),
        });
        assert.equal(unreadable.refusal, "code_knowledge:not_configured");
        assert.equal(stub.calls().length, 1);
      }),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "10 run then refuse: an empty packet for a second order refuses and commits nothing",
  () =>
    withStub((stub) =>
      Effect.sync(() => {
        const envFile = NodePath.join(stub.dir, "brain.env");
        NodeFS.writeFileSync(
          envFile,
          "HERMES_HOME=/h\nMONTI_TEAM_STATE_PATH=/t\nMONTI_VM_ID=v\nMONTI_ORG_ID=o\n",
        );
        const brain = {
          INVRT_CODE_BRAIN_PYTHON: process.execPath,
          INVRT_CODE_BRAIN_CLI: stub.cli,
          INVRT_CODE_BRAIN_ENV_FILE: envFile,
        };
        const home = NodePath.join(stub.dir, "home");
        stub.script(say(P1));
        assert.equal(runBin(home, O, brain).state, "built");
        const executorDir = NodePath.join(home, "delegation", "executor");
        const repos = NodeFS.readdirSync(executorDir);
        assert.equal(repos.length, 1);
        const repo = NodePath.join(executorDir, repos[0] ?? "");
        const before = gitOut(repo, ["rev-list", "--count", "HEAD"]);

        stub.script(say(EMPTY));
        const second = runBin(
          home,
          asOrder({ ...exampleOrder, work_order_id: ORDER_2_ID, correlation_id: "slice-run-2" }),
          brain,
        );
        assert.equal(second.state, "refused");
        assert.equal(second.refusal, "code_knowledge:packet_empty");
        assert.equal(second.head, null);
        assert.deepStrictEqual(NodeFS.readdirSync(executorDir), repos);
        assert.equal(gitOut(repo, ["rev-list", "--count", "HEAD"]), before);
      }),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "9b a Brain code-adapter switch set off in the VM env file reaches Brain and no knowledge is used",
  () =>
    withStub((stub) =>
      Effect.sync(() => {
        const envFile = NodePath.join(stub.dir, "brain.env");
        NodeFS.writeFileSync(
          envFile,
          "HERMES_HOME=/h\nMONTI_TEAM_STATE_PATH=/t\nMONTI_VM_ID=v\nMONTI_ORG_ID=o\nMONTI_KB_CODE_ADAPTER=off\n",
        );
        stub.script(say(P1));
        const home = NodePath.join(stub.dir, "home");
        const result = runBin(home, O, {
          INVRT_CODE_BRAIN_PYTHON: process.execPath,
          INVRT_CODE_BRAIN_CLI: stub.cli,
          INVRT_CODE_BRAIN_ENV_FILE: envFile,
        });
        // The refusal is Brain's own answer relayed by name; CODE never decided it.
        assert.equal(result.state, "refused");
        assert.equal(result.refusal, "kb_code_packet:adapter_disabled");
        assert.equal(result.knowledge, null);
        assert.equal(result.head, null);
        assert.equal(stub.env().MONTI_KB_CODE_ADAPTER, "off");
        assert.equal(NodeFS.existsSync(NodePath.join(home, "delegation", "executor")), false);
      }),
    ),
  TEST_TIMEOUT,
);

// Re-submits the same order id against one home, changing only what the Brain stub answers.
const resubmission = (
  stub: { readonly dir: string; readonly cli: string; readonly script: (s: Script) => void },
  name: string,
) => {
  const envFile = NodePath.join(stub.dir, "brain.env");
  NodeFS.writeFileSync(
    envFile,
    "HERMES_HOME=/h\nMONTI_TEAM_STATE_PATH=/t\nMONTI_VM_ID=v\nMONTI_ORG_ID=o\n",
  );
  const home = NodePath.join(stub.dir, `home-${name}`);
  return (script: Script) => {
    stub.script(script);
    return runBin(home, O, {
      INVRT_CODE_BRAIN_PYTHON: process.execPath,
      INVRT_CODE_BRAIN_CLI: stub.cli,
      INVRT_CODE_BRAIN_ENV_FILE: envFile,
    });
  };
};

it.effect(
  "11 an unavailable Brain is not a final result: the same order asks Brain again; built work and every other refusal stay final",
  () =>
    withStub((stub) =>
      Effect.sync(() => {
        const submit = resubmission(stub, "recover");
        const first = submit({ exit: 1 });
        assert.equal(first.refusal, "code_knowledge:brain_unavailable");
        assert.equal(first.head, null);
        assert.equal(stub.calls().length, 1);
        // Brain recovers: the same work_order_id now builds, and the receipt says it was seen before.
        const second = submit(say(P1));
        assert.equal(second.state, "built");
        assert.equal(second.receipt.replayed, true);
        assert.equal(second.knowledge?.included[0]?.path_id, "path:slice-1");
        assert.equal(stub.calls().length, 2);
        // Built work is final: a later outage neither refuses it nor asks Brain again.
        const third = submit({ exit: 1 });
        assert.deepStrictEqual(third, second);
        assert.equal(stub.calls().length, 2);

        // Every other knowledge refusal is final: the stored result is replayed, Brain is not asked.
        const finals: ReadonlyArray<readonly [string, Script, string]> = [
          [
            "named",
            { exit: 3, stdout: '{"refusal": "kb_code_packet:destination_unqualified"}\n' },
            "kb_code_packet:destination_unqualified",
          ],
          [
            "rejected",
            { exit: 2, stdout: '{"refusal": "kb_code_packet_cli:invalid_request"}\n' },
            "code_knowledge:contract_mismatch",
          ],
          ["empty", say(EMPTY), "code_knowledge:packet_empty"],
          ["mismatch", say({ ...P1, extra: 1 }), "code_knowledge:contract_mismatch"],
        ];
        for (const [label, script, refusal] of finals) {
          const again = resubmission(stub, label);
          const before = stub.calls().length;
          assert.equal(again(script).refusal, refusal, label);
          const replay = again(say(P1));
          assert.equal(replay.refusal, refusal, label);
          assert.equal(replay.receipt.replayed, true, label);
          assert.equal(stub.calls().length, before + 1, `${label}: Brain was asked again`);
        }
      }),
    ),
  TEST_TIMEOUT,
);

const STDERR_CANARY = "STDERR-CANARY-9";

it.effect(
  "12 the Brain child's stderr (ids, paths, receipts) never reaches CODE's stderr or logs",
  () =>
    withStub((stub) => {
      const logs: Array<string> = [];
      const logger = Logger.make(({ message }) => {
        logs.push(String(message));
      });
      const written: Array<string> = [];
      const realWrite = process.stderr.write;
      return Effect.gen(function* () {
        const scripts: ReadonlyArray<Script> = [say(P1), { exit: 1 }, { exit: 2 }, say(EMPTY)];
        process.stderr.write = ((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        }) as typeof process.stderr.write;
        try {
          for (const script of scripts) {
            stub.script(script);
            yield* makeBrainKnowledgePort(stub.config()).fetch(O);
          }
        } finally {
          process.stderr.write = realWrite;
        }
        assert.equal(stub.calls().length, scripts.length);
        assert.equal(written.join("").includes(STDERR_CANARY), false);
        assert.equal(logs.join("\n").includes(STDERR_CANARY), false);

        // Through the process entry point too: its own stderr carries nothing the Brain printed.
        const envFile = NodePath.join(stub.dir, "brain.env");
        NodeFS.writeFileSync(
          envFile,
          "HERMES_HOME=/h\nMONTI_TEAM_STATE_PATH=/t\nMONTI_VM_ID=v\nMONTI_ORG_ID=o\n",
        );
        stub.script(say(P1));
        let binStderr: string | null = null;
        runBin(
          NodePath.join(stub.dir, "home"),
          O,
          {
            INVRT_CODE_BRAIN_PYTHON: process.execPath,
            INVRT_CODE_BRAIN_CLI: stub.cli,
            INVRT_CODE_BRAIN_ENV_FILE: envFile,
          },
          (stderr) => {
            binStderr = stderr;
          },
        );
        assert.equal(binStderr === null, false, "bin stderr was not captured");
        assert.equal(String(binStderr).includes(STDERR_CANARY), false);
        assert.equal(String(binStderr).includes(MEMBER), false);
      }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
    }),
  TEST_TIMEOUT,
);

const launchBin = (
  home: string,
  order: WorkOrderV1,
  env: Record<string, string | undefined>,
): Promise<CodeResultV1> =>
  new Promise((resolve, reject) => {
    const base: Record<string, string | undefined> = { ...process.env };
    for (const key of ["INVRT_CODE_EXECUTOR", "INVRT_CODE_EC_SENDER_BIN", "EC_BASE_URL"]) {
      delete base[key];
    }
    const child = NodeChildProcess.spawn(
      process.execPath,
      [NodeURL.fileURLToPath(new URL("./bin.ts", import.meta.url))],
      { env: { ...base, INVRT_CODE_HOME: home, INVRT_CODE_EXECUTOR: "slice-fixture", ...env } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(JSON.parse(stdout.trim()) as CodeResultV1)
        : reject(new Error(`exit ${code}: ${stderr}`)),
    );
    child.stdin.end(JSON.stringify(order));
  });

it.effect(
  "13 many simultaneous resends after an outage run Brain's re-ask and the executor once",
  () =>
    withStub((stub) =>
      Effect.promise(async () => {
        const submit = resubmission(stub, "concurrent");
        const home = NodePath.join(stub.dir, "home-concurrent");
        const env = {
          INVRT_CODE_BRAIN_PYTHON: process.execPath,
          INVRT_CODE_BRAIN_CLI: stub.cli,
          INVRT_CODE_BRAIN_ENV_FILE: NodePath.join(stub.dir, "brain.env"),
        };
        assert.equal(submit({ exit: 1 }).refusal, "code_knowledge:brain_unavailable");
        // Brain recovers, slowly enough that every resend arrives while the first is still running.
        stub.script({ ...say(P1), sleepMs: 1500 });
        const results = await Promise.all(Array.from({ length: 8 }, () => launchBin(home, O, env)));
        const serialised = JSON.stringify(results);
        for (const r of results) {
          assert.equal(
            r.state === "built" || r.refusal === "code_work_order:in_progress",
            true,
            serialised,
          );
        }
        const built = results.filter((r) => r.state === "built");
        assert.equal(built.length >= 1, true, serialised);
        assert.equal(new Set(built.map((r) => r.head)).size, 1, serialised);
        // The outage call plus exactly one re-ask, and one executor run (seed plus rename commit).
        assert.equal(stub.calls().length, 2, serialised);
        const executorDir = NodePath.join(home, "delegation", "executor");
        const repos = NodeFS.readdirSync(executorDir);
        assert.equal(repos.length, 1);
        assert.equal(
          gitOut(NodePath.join(executorDir, repos[0] ?? ""), ["rev-list", "--count", "HEAD"]),
          "2",
        );
      }),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "13b claiming a stored result is atomic and leaves a result it was not asked to take",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        const store = makeFileResultStore(NodePath.join(stub.dir, "results"));
        // A refusal that is final (no executor): stored by the ordinary path.
        const stored = yield* runWorkOrder(O, {
          executor: null,
          knowledge: null,
          report: null,
          resultStore: store,
        });
        assert.equal(stored.refusal, "code_executor:not_configured");
        const unavailable = (r: CodeResultV1) => r.refusal === "code_knowledge:brain_unavailable";
        // Not claimable: it stays, readable, for the next caller.
        assert.equal(yield* store.claim(O, unavailable), false);
        assert.deepStrictEqual(yield* store.read(O), stored);
        // Claimable: exactly one of many simultaneous claims wins, and the result is gone.
        const wins = yield* Effect.all(
          Array.from({ length: 8 }, () => store.claim(O, () => true)),
          { concurrency: "unbounded" },
        );
        assert.equal(wins.filter(Boolean).length, 1);
        assert.equal(yield* store.read(O), null);
        assert.deepStrictEqual(
          NodeFS.readdirSync(NodePath.join(stub.dir, "results")),
          [],
          "no claimed file is left behind",
        );
      }).pipe(
        Effect.provide(
          CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
        ),
      ),
    ),
  TEST_TIMEOUT,
);

it.effect(
  "13c a resend that loses the claim answers in_progress and neither asks Brain nor runs the executor",
  () =>
    withStub((stub) =>
      Effect.gen(function* () {
        let brainUp = false;
        let asked = 0;
        let ran = 0;
        const real = makeFileResultStore(NodePath.join(stub.dir, "results"));
        const deps = {
          executor: {
            model: "double",
            run: () =>
              Effect.sync(() => {
                ran += 1;
                return { base: "1".repeat(40), head: "2".repeat(40) };
              }),
          },
          knowledge: {
            fetch: () =>
              Effect.sync(() => {
                asked += 1;
                return brainUp
                  ? ({
                      ok: true,
                      summary: { result_revision: "rev", included: [], omitted_count: 0 },
                    } as const)
                  : ({ ok: false, refusal: "code_knowledge:brain_unavailable" } as const);
              }),
          },
          report: null,
          resultStore: real,
        };
        const first = yield* runWorkOrder(O, deps);
        assert.equal(first.refusal, "code_knowledge:brain_unavailable");
        brainUp = true;
        // Another caller took the claim between this caller's read and its own claim.
        const lost = yield* runWorkOrder(O, {
          ...deps,
          resultStore: { ...real, claim: () => Effect.succeed(false) },
        });
        assert.equal(lost.refusal, "code_work_order:in_progress");
        assert.equal(lost.receipt.replayed, true);
        assert.equal(asked, 1);
        assert.equal(ran, 0);
        // The stored outage result is untouched, so the winner's retry is still possible.
        assert.equal((yield* real.read(O))?.refusal, "code_knowledge:brain_unavailable");
        assert.equal((yield* runWorkOrder(O, deps)).state, "built");
        assert.equal(ran, 1);
      }).pipe(
        Effect.provide(
          CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
        ),
      ),
    ),
  TEST_TIMEOUT,
);
