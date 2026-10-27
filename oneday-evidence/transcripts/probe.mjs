// ZCode Protocol probe: spawn the app-server, write NDJSON frames, capture replies.
// Usage: node probe.mjs <transcript-out> <method> [paramsJSON] [...more method+params pairs]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const ZCODE = "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";
const out = process.argv[2];
const steps = [];
for (let i = 3; i < process.argv.length; i += 2) {
  steps.push({
    method: process.argv[i],
    params: process.argv[i + 1] ? JSON.parse(process.argv[i + 1]) : undefined,
  });
}

const child = spawn(process.execPath, [ZCODE, "app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});
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
    } catch (e) {
      lines.push({ unparsable: line.slice(0, 2000) });
      continue;
    }
    lines.push({ t: Date.now(), msg });
    if (msg.id !== undefined && msg.method && !msg.result && !msg.error) {
      // server-initiated client request: answer the runtime preferences handshake
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
        continue;
      }
      child.stdin.write(
        JSON.stringify({
          id: msg.id,
          error: { code: -32601, message: "Method not found: probe" },
        }) + "\n",
      );
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});
let stderrText = "";
child.stderr.on("data", (d) => {
  stderrText += d.toString();
});
child.on("exit", (code) => lines.push({ exit: code }));

function send(method, params) {
  const id = nextId++;
  const frame = { id, method };
  if (params !== undefined) frame.params = params;
  child.stdin.write(JSON.stringify(frame) + "\n");
  lines.push({ t: Date.now(), sent: frame });
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    setTimeout(
      () => {
        if (pending.has(id)) {
          pending.delete(id);
          lines.push({ t: Date.now(), timeout: id });
          resolve({ timeout: true });
        }
      },
      Number(process.env.PROBE_TIMEOUT_MS || 8000),
    );
  });
}

(async () => {
  // Give the server a moment to boot.
  await new Promise((r) => setTimeout(r, 800));
  for (const step of steps) {
    const reply = await send(step.method, step.params);
    console.log("===", step.method, "===");
    console.log(JSON.stringify(reply, null, 2).slice(0, 4000));
  }
  // Also probe server-initiated messages after our calls (already captured).
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  try {
    child.kill("SIGKILL");
  } catch {}
  writeFileSync(out, JSON.stringify({ stderr: stderrText.slice(0, 2000), lines }, null, 1));
  console.log("transcript written to", out);
  process.exit(0);
})();
