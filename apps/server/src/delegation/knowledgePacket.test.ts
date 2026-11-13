// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";

import {
  BRAIN_ENV_NAMES,
  CodePacketV1,
  decodeKnowledgePacket,
  makeBrainKnowledgePort,
  parseBrainEnv,
} from "./knowledgePacket.ts";
import { decodeWorkOrder, type CodeResultV1, type WorkOrderV1 } from "./workOrder.ts";

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
const c = JSON.parse(fs.readFileSync(dir + "/script.json", "utf8"));
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
  "4b exit 2 and exit 1 are unavailable, never relayed and never an empty success",
  () =>
    Effect.gen(function* () {
      const unavailable = refusal("code_knowledge:brain_unavailable");
      assert.deepStrictEqual(
        yield* fetchWith({
          exit: 2,
          stdout: `${JSON.stringify({ refusal: "kb_code_packet_cli:invalid_request" })}\n`,
        }),
        unavailable,
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
