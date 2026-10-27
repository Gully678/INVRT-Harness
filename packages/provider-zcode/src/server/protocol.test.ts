// @effect-diagnostics globalTimers:off -- Waits for real subprocess output in protocol integration checks.
import { describe, expect, it } from "@effect/vitest";

import {
  appServerCommand,
  startZcodeProtocolClient,
  ZcodeProtocolClosedError,
  ZcodeProtocolError,
} from "./protocol.ts";
import { startFakeZcodeAppServer } from "./fakeServer.ts";

// Fixtures mirror live transcripts: t1 (session/list, usage/stats error shape),
// t5 (session/usage), t3 (usage/stats), t6/t11 (runtime preferences handshake).
const USAGE_STATS_FIXTURE = {
  range: "all",
  generatedAt: 1793065588724,
  timeZone: "UTC",
  source: "agent-db",
  summary: {
    totalTokens: 37794271227,
    inputTokens: 37708756099,
    outputTokens: 85515128,
    favoriteModel: { modelId: "GLM-5.3-Flash", totalTokens: 37767981071 },
  },
  dailyModelUsage: [
    {
      date: "2026-10-26",
      totalTokens: 1000,
      inputTokens: 800,
      outputTokens: 200,
      cacheReadTokens: 700,
      models: [{ modelId: "GLM-5.3-Flash", totalTokens: 1000 }],
    },
  ],
};

const SESSION_USAGE_FIXTURE = {
  sessionId: "sess_4b52709b-72ce-4246-ba8e-c64ccfd321ee",
  totalTokens: 933556,
  inputTokens: 895758,
  outputTokens: 37798,
  reasoningTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  modelRequestCount: 54,
  modelErrorCount: 0,
  inputBaselineBySource: { main_turn: 320944 },
};

const SESSION_LIST_FIXTURE = {
  sessions: [
    {
      sessionId: "sess_4b52709b-72ce-4246-ba8e-c64ccfd321ee",
      status: "idle",
      mode: "build",
      title: "One-day INVRT CODE Mac build",
      workspace: { workspaceKey: "/tmp/ws", workspacePath: "/tmp/ws" },
    },
  ],
};

const TURN_EVENTS_FIXTURE = [
  {
    eventId: "e1",
    sessionId: "sess_fake_1",
    deliveryKind: "main",
    payload: {
      kind: "message",
      parts: [
        { type: "step-start", partId: "p1" },
        { type: "text", partId: "p2", text: "ok" },
        {
          type: "step-finish",
          partId: "p3",
          reason: "stop",
          tokens: { total: 10, input: 8, output: 2 },
        },
      ],
      message: { info: { finish: "completed" } },
    },
  },
];

describe("ZcodeProtocolClient against the fake app-server", () => {
  it("answers the runtime preferences handshake and returns session/create results", async () => {
    const fake = await startFakeZcodeAppServer({ sessionCreateSessionId: "sess_fake_1" });
    try {
      const client = startZcodeProtocolClient({
        command: fake.command,
        requestTimeoutMs: 10_000,
      });
      try {
        const result = (await client.request("session/create", {
          workspace: { workspaceKey: "/tmp/ws", workspacePath: "/tmp/ws" },
        })) as { sessionId?: string };
        expect(result.sessionId).toBe("sess_fake_1");
      } finally {
        await client.dispose();
      }
    } finally {
      await fake.dispose();
    }
  }, 20_000);

  it("returns usage/stats results with the captured payload shape", async () => {
    const fake = await startFakeZcodeAppServer({ usageStats: USAGE_STATS_FIXTURE });
    try {
      const client = startZcodeProtocolClient({ command: fake.command, requestTimeoutMs: 10_000 });
      try {
        const result = (await client.request("usage/stats", {
          range: "all",
        })) as typeof USAGE_STATS_FIXTURE;
        expect(result.range).toBe("all");
        expect(result.summary.favoriteModel.modelId).toBe("GLM-5.3-Flash");
      } finally {
        await client.dispose();
      }
    } finally {
      await fake.dispose();
    }
  }, 20_000);

  it("maps protocol error replies to ZcodeProtocolError with the server code", async () => {
    const fake = await startFakeZcodeAppServer({});
    try {
      const client = startZcodeProtocolClient({ command: fake.command, requestTimeoutMs: 10_000 });
      try {
        await expect(client.request("nosuch/method", {})).rejects.toMatchObject({
          name: "ZcodeProtocolError",
          code: -32601,
        });
      } finally {
        await client.dispose();
      }
    } finally {
      await fake.dispose();
    }
  }, 20_000);

  it("surfaces invalid-params ZodError data from the server", async () => {
    const fake = await startFakeZcodeAppServer({
      sessionCreateError: {
        code: -32602,
        message: "Invalid params — workspace: expected object",
        data: { name: "ZodError" },
      },
    });
    try {
      const client = startZcodeProtocolClient({ command: fake.command, requestTimeoutMs: 10_000 });
      try {
        await expect(client.request("session/create", {})).rejects.toSatisfy(
          (error: unknown) =>
            error instanceof ZcodeProtocolError &&
            error.code === -32602 &&
            (error.data as { name?: string } | undefined)?.name === "ZodError",
        );
      } finally {
        await client.dispose();
      }
    } finally {
      await fake.dispose();
    }
  }, 20_000);

  it("rejects requests after the server process exits", async () => {
    const fake = await startFakeZcodeAppServer({});
    const client = startZcodeProtocolClient({ command: fake.command, requestTimeoutMs: 10_000 });
    await fake.dispose();
    // Give the client a beat to observe the exit.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(client.request("session/list")).rejects.toBeInstanceOf(ZcodeProtocolClosedError);
    await client.dispose();
  }, 20_000);

  it("emits session/event notifications to the onNotification callback", async () => {
    const fake = await startFakeZcodeAppServer({ turnEvents: TURN_EVENTS_FIXTURE });
    const notifications: unknown[] = [];
    const client = startZcodeProtocolClient({
      command: fake.command,
      requestTimeoutMs: 10_000,
      onNotification: (method, params) => {
        if (method === "session/event") notifications.push(params);
      },
    });
    try {
      await client.request("session/create", {
        workspace: { workspaceKey: "/tmp/ws", workspacePath: "/tmp/ws" },
      });
      await client.request("session/send", { sessionId: "sess_fake_1", content: "hi" });
      // The fake emits events synchronously after the send reply.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(notifications.length).toBe(TURN_EVENTS_FIXTURE.length);
    } finally {
      await client.dispose();
      await fake.dispose();
    }
  }, 20_000);

  it("replies -32601 to unknown server-to-client requests", async () => {
    const fake = await startFakeZcodeAppServer({
      probeUnknownServerRequest: "interaction/unknownProbe",
    });
    try {
      const client = startZcodeProtocolClient({ command: fake.command, requestTimeoutMs: 10_000 });
      try {
        // The fake sends the probe after the next request; if the client failed to answer,
        // the fake would still work but a hang would time this test out.
        await client.request("session/list");
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(client.closed).toBe(false);
      } finally {
        await client.dispose();
      }
    } finally {
      await fake.dispose();
    }
  }, 20_000);

  it("builds the standard app-server command", () => {
    expect(appServerCommand("/path/zcode.cjs")).toEqual(["/path/zcode.cjs", "app-server"]);
  });
});

describe("session/usage and session/list fixtures", () => {
  it("returns session/usage and session/list results", async () => {
    const fake = await startFakeZcodeAppServer({
      sessionUsage: SESSION_USAGE_FIXTURE,
      sessionList: SESSION_LIST_FIXTURE,
    });
    try {
      const client = startZcodeProtocolClient({ command: fake.command, requestTimeoutMs: 10_000 });
      try {
        const usage = (await client.request("session/usage", {
          sessionId: SESSION_USAGE_FIXTURE.sessionId,
        })) as typeof SESSION_USAGE_FIXTURE;
        expect(usage.totalTokens).toBe(933556);
        expect(usage.modelRequestCount).toBe(54);
        const list = (await client.request("session/list")) as typeof SESSION_LIST_FIXTURE;
        expect(list.sessions[0]?.sessionId).toBe(SESSION_USAGE_FIXTURE.sessionId);
      } finally {
        await client.dispose();
      }
    } finally {
      await fake.dispose();
    }
  }, 20_000);
});
