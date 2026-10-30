import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { WsRpcGroup } from "./rpc.ts";
import { clientRpcRequiredScopes } from "./clientRpcPermissions.ts";

describe("native first-use planning RPC", () => {
  it("registers strict native preparation and held start without caller authority", () => {
    const begin = WsRpcGroup.requests.get("forge.firstUse.beginPlanning");
    const start = WsRpcGroup.requests.get("forge.firstUse.startPlanning");
    expect(begin).toBeDefined();
    expect(start).toBeDefined();
    if (!begin || !start) return;
    const decode = Schema.decodeUnknownSync(begin.payloadSchema);
    const decodeStart = Schema.decodeUnknownSync(start.payloadSchema);
    expect(
      decode({ projectId: "project", providerInstanceId: "codex", operationId: "op" }),
    ).toEqual({ projectId: "project", providerInstanceId: "codex", operationId: "op" });
    for (const field of [
      "actor",
      "threadId",
      "task",
      "prompt",
      "policy",
      "manifest",
      "admission",
      "skillList",
    ]) {
      expect(() =>
        decode({
          projectId: "project",
          providerInstanceId: "codex",
          operationId: "op",
          [field]: {},
        }),
      ).toThrow();
    }
    expect(() =>
      decodeStart({
        runId: "run",
        revision: 1,
        operationId: "op",
        policy: {},
      }),
    ).toThrow();
  });
});

it("declares operate permission for both native first-use commands", () => {
  for (const method of ["forge.firstUse.beginPlanning", "forge.firstUse.startPlanning"]) {
    expect(clientRpcRequiredScopes(method, {})).toEqual(["orchestration:operate"]);
  }
});
