// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- Test fake speaks raw stdio like the real CLI process.
/**
 * In-process fake ZCode app-server for tests. Speaks the captured protocol: NDJSON
 * frames, request replies, the session/requestRuntimePreferences handshake, and
 * session/event notifications. Shapes mirror the transcripts under
 * oneday-evidence/transcripts/ (t1, t5, t11, t3).
 */
import { spawn, type ChildProcess } from "node:child_process";

export interface FakeServerScript {
  /** Reply to usage/stats. */
  usageStats?: Record<string, unknown>;
  /** Reply to session/usage. */
  sessionUsage?: Record<string, unknown>;
  /** Reply to session/list. */
  sessionList?: Record<string, unknown>;
  /** Reply to session/read. */
  sessionRead?: Record<string, unknown>;
  /** Error to reply for session/create. */
  sessionCreateError?: { code: number; message: string; data?: unknown };
  /** sessionId returned by session/create. */
  sessionCreateSessionId?: string;
  /** session/event notifications emitted after session/send, one per line of delayMs. */
  turnEvents?: ReadonlyArray<Record<string, unknown>>;
  /** An unknown server-to-client request to verify the -32601 reply path. */
  probeUnknownServerRequest?: string;
}

export function fakeServerScriptSource(script: FakeServerScript): string {
  return `#!/usr/bin/env node
const script = ${JSON.stringify(JSON.stringify(script))};
const S = JSON.parse(script);
const replies = {
  "usage/stats": { result: S.usageStats ?? { range: "all", generatedAt: 0 } },
  "session/usage": { result: S.sessionUsage ?? { sessionId: "sess_test" } },
  "session/list": { result: S.sessionList ?? { sessions: [] } },
  "session/read": { result: S.sessionRead ?? { messages: [] } },
};
let nativeSessionCounter = 0;
let acc = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  acc += chunk;
  let newline;
  while ((newline = acc.indexOf("\\n")) >= 0) {
    const line = acc.slice(0, newline);
    acc = acc.slice(newline + 1);
    if (!line.trim()) continue;
    let frame;
    try { frame = JSON.parse(line); } catch { continue; }
    handle(frame);
  }
});
function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }
function handle(frame) {
  if (typeof frame.id !== "number" || typeof frame.method !== "string") return;
  if (frame.method === "session/requestRuntimePreferences") {
    send({ id: frame.id, result: {
      nativeSearchEnhancementsEnabled: false,
      memoryEnabled: false,
      askUserQuestionAutoResolutionEnabled: true,
      modelContextBudgetStrategy: "preflight-v1",
    }});
    return;
  }
  if (S.probeUnknownServerRequest) {
    // Server-to-client probe: the client must answer or we would hang; reply -32601 like
    // the real server treats unhandled client methods.
    send({ id: "server-1", method: S.probeUnknownServerRequest, params: {} });
  }
  if (frame.method === "session/create") {
    if (S.sessionCreateError) {
      send({ id: frame.id, error: S.sessionCreateError });
      return;
    }
    const sessionId = S.sessionCreateSessionId ?? ("sess_fake_" + (++nativeSessionCounter));
    send({ id: frame.id, result: { sessionId } });
    return;
  }
  if (frame.method === "session/send") {
    send({ id: frame.id, result: {} });
    for (const event of S.turnEvents ?? []) {
      send({ method: "session/event", params: event });
    }
    return;
  }
  const reply = replies[frame.method];
  if (reply) send({ id: frame.id, ...reply });
  else send({ id: frame.id, error: { code: -32601, message: "Method not found: " + frame.method } });
}
`;
}

export interface FakeZcodeAppServer {
  /** Command array to pass as the adapter's binaryPath command head. */
  readonly command: readonly string[];
  dispose(): Promise<void>;
}

/**
 * Spawns `node <temp script>`; the script is written to a temp file and executed through
 * the ambient node binary. Returns the command to use.
 */
export async function startFakeZcodeAppServer(
  script: FakeServerScript,
): Promise<FakeZcodeAppServer> {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "zcode-fake-"));
  const scriptPath = join(dir, "zcode-fake.cjs");
  await writeFile(scriptPath, fakeServerScriptSource(script), "utf8");
  const child: ChildProcess = spawn(process.execPath, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    command: [process.execPath, scriptPath],
    dispose: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
          resolve();
        }, 1_500);
      });
      await rm(dir, { recursive: true, force: true });
    },
  };
}
