import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { mapSessionEventToTurnUpdates, type SessionTurnTargets } from "./eventMapping.ts";
import { parseTranscriptPart } from "./protocolTypes.ts";

// Test ids only: the mapping never validates brand shapes, so casts keep the fixture brief.
const targets = {
  providerThreadId: "provider-thread:test",
  providerTurnId: "provider-turn:test",
  threadId: "thread:test",
  runId: "run:test",
  runOrdinal: 1,
  nodeId: "node:test",
  attemptId: "run-attempt:test",
  startedAtMs: 0,
} as unknown as SessionTurnTargets;

const context = {
  payload: {} as Record<string, unknown>,
  nativeSessionId: "sess_fake_1",
  targets,
  threadId: "thread:test" as never,
  now: DateTime.makeUnsafe(0) as never,
};

describe("mapSessionEventToTurnUpdates", () => {
  it("maps text and reasoning parts into turn item updates", () => {
    const events = mapSessionEventToTurnUpdates({
      ...context,
      payload: {
        parts: [
          { type: "reasoning", partId: "p1", text: "thinking" },
          { type: "text", partId: "p2", text: "ok" },
        ],
      },
    });
    const items = events.filter((event) => event.type === "turn_item.updated");
    expect(items).toHaveLength(2);
    const kinds = items.map((event) =>
      event.type === "turn_item.updated" ? event.turnItem.type : "",
    );
    expect(kinds).toEqual(["reasoning", "assistant_message"]);
    const assistant = items[1]!;
    expect(
      assistant.type === "turn_item.updated" && assistant.turnItem.type === "assistant_message"
        ? assistant.turnItem.text
        : "",
    ).toBe("ok");
  });

  it("maps tool parts into command execution items", () => {
    const events = mapSessionEventToTurnUpdates({
      ...context,
      payload: {
        parts: [
          {
            type: "tool",
            partId: "p3",
            callId: "call_1",
            state: { completedAt: 123 },
            input: "ls",
          },
        ],
      },
    });
    expect(events).toHaveLength(1);
    const item = events[0]!;
    expect(
      item!.type === "turn_item.updated" && item!.turnItem.type === "command_execution"
        ? item!.turnItem.input
        : "",
    ).toBe("ls");
  });

  it("emits a completed turn.terminal on info.finish completed", () => {
    const events = mapSessionEventToTurnUpdates({
      ...context,
      payload: {
        message: { info: { finish: "completed" } },
        parts: [{ type: "text", partId: "p1", text: "done" }],
      },
    });
    const terminals = events.filter((event) => event.type === "turn.terminal");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.status).toBe("completed");
  });

  it("emits a completed turn.terminal on a non-tool-calls step-finish reason", () => {
    const events = mapSessionEventToTurnUpdates({
      ...context,
      payload: {
        parts: [{ type: "step-finish", partId: "p1", reason: "stop", tokens: { total: 5 } }],
      },
    });
    expect(
      events.some((event) => event.type === "turn.terminal" && event.status === "completed"),
    ).toBe(true);
  });

  it("does not terminate on tool-calls step reasons", () => {
    const events = mapSessionEventToTurnUpdates({
      ...context,
      payload: {
        parts: [{ type: "step-finish", partId: "p1", reason: "tool-calls" }],
      },
    });
    expect(events.filter((event) => event.type === "turn.terminal")).toHaveLength(0);
  });

  it("emits a failed terminal for non-completed finish values", () => {
    const events = mapSessionEventToTurnUpdates({
      ...context,
      payload: { message: { info: { finish: "aborted" } }, parts: [] },
    });
    const terminal = events.find((event) => event.type === "turn.terminal");
    expect(terminal?.status).toBe("failed");
    expect(terminal?.type === "turn.terminal" && terminal.failure?.code).toBe("aborted");
  });

  it("returns no updates without active turn targets", () => {
    const events = mapSessionEventToTurnUpdates({
      ...context,
      targets: null,
      payload: { parts: [{ type: "text", partId: "p1", text: "x" }] },
    });
    expect(events).toHaveLength(0);
  });

  it("ignores unknown payload kinds without error", () => {
    const events = mapSessionEventToTurnUpdates({
      ...context,
      payload: { kind: "something-new-in-a-future-version" },
    });
    expect(events).toHaveLength(0);
  });
});

describe("parseTranscriptPart", () => {
  it("parses the part family from the live transcripts", () => {
    expect(parseTranscriptPart({ type: "text", partId: "a", text: "hi" })).toEqual({
      type: "text",
      partId: "a",
      text: "hi",
    });
    expect(parseTranscriptPart({ type: "step-start", partId: "b" })).toEqual({
      type: "step-start",
      partId: "b",
    });
    const tool = parseTranscriptPart({
      type: "tool",
      partId: "c",
      callId: "call_1",
      state: { error: "boom", completedAt: 5 },
    });
    expect(tool.type).toBe("tool");
    expect(tool.type === "tool" ? tool.state?.error : "").toBe("boom");
    const stepFinish = parseTranscriptPart({
      type: "step-finish",
      reason: "stop",
      tokens: { total: 472433, input: 472199, output: 234 },
    });
    expect(stepFinish.type === "step-finish" ? stepFinish.tokens?.total : 0).toBe(472433);
  });

  it("degrades unknown part types instead of failing", () => {
    const part = parseTranscriptPart({ type: "hologram", partId: "z" });
    expect(part).toEqual({ type: "unknown", partId: "z", kind: "hologram" });
  });
});
