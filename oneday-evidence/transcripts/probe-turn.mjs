// One bounded authenticated probe: create session, subscribe, send one trivial turn,
// capture the streaming event shapes, then close. Evidence for the ZCode adapter.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const ZCODE = "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";
const WS = "/tmp/zcode-probe-ws";
const out = process.argv[2] || "t6-live-turn.json";
mkdirSync(WS, { recursive: true });

const child = spawn(process.execPath, [ZCODE, "app-server"], { stdio: ["pipe", "pipe", "pipe"] });
const lines = [];
let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      lines.push({ unparsable: line.slice(0, 500) });
      continue;
    }
    lines.push({ t: Date.now(), dir: "in", msg });
    if (msg.id !== undefined && msg.method && !msg.result && !msg.error) {
      // server-initiated request to the client: answer the ones we understand
      if (msg.method === "session/requestRuntimePreferences") {
        child.stdin.write(
          JSON.stringify({
            id: msg.id,
            result: {
              nativeSearchEnhancementsEnabled: false,
              memoryEnabled: false,
              askUserQuestionAutoResolutionEnabled: true,
              modelContextBudgetStrategy: "preflight-v1",
            },
          }) + "\n",
        );
        lines.push({
          t: Date.now(),
          dir: "out-reply",
          msg: { id: msg.id, result: "runtime-preferences-defaults" },
        });
        continue;
      }
      child.stdin.write(
        JSON.stringify({
          id: msg.id,
          error: { code: -32601, message: "Method not found: probe" },
        }) + "\n",
      );
      lines.push({
        t: Date.now(),
        dir: "out-reply",
        msg: { id: msg.id, error: "method-not-found" },
      });
      continue;
    }
    if (msg.id !== undefined && pending.has(String(msg.id))) {
      const p = pending.get(String(msg.id));
      pending.delete(String(msg.id));
      p.resolve(msg);
    }
  }
});
child.stderr.on("data", (d) => {
  const s = d.toString();
  if (s.trim()) lines.push({ dir: "err", text: s.slice(0, 300) });
});

function send(method, params) {
  const id = nextId++;
  const frame = { id, method };
  if (params !== undefined) frame.params = params;
  child.stdin.write(JSON.stringify(frame) + "\n");
  lines.push({ t: Date.now(), dir: "out", msg: frame });
  return new Promise((resolve) => {
    pending.set(String(id), { resolve });
    setTimeout(
      () => {
        if (pending.has(String(id))) {
          pending.delete(String(id));
          resolve({ timeout: true });
        }
      },
      Number(process.env.PROBE_TIMEOUT_MS || 20000),
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(800);
  const created = await send("session/create", {
    workspace: { workspaceKey: WS, workspacePath: WS },
  });
  console.log("create:", JSON.stringify(created).slice(0, 600));
  const sessionId = created?.result?.session?.sessionId ?? created?.result?.sessionId;
  if (!sessionId) {
    writeFileSync(out, JSON.stringify(lines, null, 1));
    process.exit(1);
  }

  const sub = await send("session/subscribe", { sessionId });
  console.log("subscribe:", JSON.stringify(sub).slice(0, 400));

  const sendResult = await send("session/send", { sessionId, content: "Reply with exactly: ok" });
  console.log("send accepted:", JSON.stringify(sendResult).slice(0, 400));

  // Wait for the turn to stream and finish (events arrive unprompted on stdout).
  await sleep(process.env.PROBE_TURN_WAIT_MS ? Number(process.env.PROBE_TURN_WAIT_MS) : 45000);

  const events = await send("session/events", { sessionId });
  console.log("events:", JSON.stringify(events).slice(0, 1200));

  const close = await send("session/close", { sessionId });
  console.log("close:", JSON.stringify(close).slice(0, 300));

  child.kill("SIGTERM");
  await sleep(300);
  try {
    child.kill("SIGKILL");
  } catch {}
  writeFileSync(out, JSON.stringify(lines, null, 1));
  console.log("transcript written:", out);
  process.exit(0);
})();
