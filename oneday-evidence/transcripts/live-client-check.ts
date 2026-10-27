// Live acceptance probe: run the real protocol client source against the real ZCode
// app-server for bounded read-only calls (session/list, usage/stats 7d). No session is
// created, no model is called, no credentials are read.
import {
  startZcodeProtocolClient,
  appServerCommand,
} from "../../packages/provider-zcode/src/server/protocol.ts";

const ZCODE = "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";
const client = startZcodeProtocolClient({
  command: appServerCommand(ZCODE),
  requestTimeoutMs: 45_000,
  handlers: {
    requestRuntimePreferences: () => ({
      nativeSearchEnhancementsEnabled: false,
      memoryEnabled: false,
      askUserQuestionAutoResolutionEnabled: true,
      modelContextBudgetStrategy: "preflight-v1",
    }),
  },
});
try {
  const list = (await client.request("session/list")) as { sessions: unknown[] };
  console.log("LIVE session/list: ok, sessions:", list.sessions.length);
  const stats = (await client.request("usage/stats", { range: "7d" })) as {
    range: string;
    summary?: { totalTokens?: number };
    dailyModelUsage?: unknown[];
  };
  console.log(
    "LIVE usage/stats 7d: ok, range:",
    stats.range,
    "days:",
    stats.dailyModelUsage?.length,
  );
  const usage = (await client.request("session/usage", {
    sessionId: list.sessions[0] ? (list.sessions[0] as { sessionId: string }).sessionId : "",
  })) as { sessionId?: string; totalTokens?: number };
  console.log("LIVE session/usage: ok, totalTokens:", usage.totalTokens);
  console.log("LIVE CLIENT ACCEPTANCE: PASS");
} catch (error) {
  console.log("LIVE CLIENT ACCEPTANCE: FAIL", String(error));
} finally {
  await client.dispose();
}
process.exit(0);
