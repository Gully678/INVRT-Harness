import { describe, expect, it } from "@effect/vitest";

import { ThreadId } from "@t3tools/contracts";

import { snapshotAppThreadId, ZCODE_PROVIDER } from "./adapter.ts";

describe("readThreadSnapshot app thread id fallback", () => {
  it("keeps the orchestrator-assigned app thread id when present", () => {
    const assigned = ThreadId.make("thread:app:assigned");
    expect(snapshotAppThreadId(assigned, "sess_native_1")).toBe(assigned);
  });

  it("derives a per-provider-thread id instead of one constant when appThreadId is null", () => {
    // Different provider threads (native session ids) must never share a snapshot
    // thread id; the constant "thread:provider:zcode:snapshot" fallback grouped them.
    const first = snapshotAppThreadId(null, "sess_native_1");
    const second = snapshotAppThreadId(null, "sess_native_2");
    expect(first).not.toEqual(second);
    expect(first).toBe(snapshotAppThreadId(null, "sess_native_1"));
    expect(first).toContain(String(ZCODE_PROVIDER));
    expect(first).toContain("sess_native_1");
  });
});
