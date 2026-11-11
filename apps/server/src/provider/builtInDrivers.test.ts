import { describe, expect, it } from "@effect/vitest";

import { BUILT_IN_DRIVERS, BUILT_IN_USAGE_DRIVERS } from "./builtInDrivers.ts";

describe("builtInDrivers registration", () => {
  it("registers the ZCode driver alongside the untouched existing drivers", () => {
    const kinds = BUILT_IN_DRIVERS.map((driver) => driver.driverKind);
    expect(kinds).toContain("zcode");
    // Existing providers keep their positions in the same list.
    for (const expected of [
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "fx",
      "opencode",
      "pi",
      "muse",
      "antigravity",
      "acpRegistry",
    ]) {
      expect(kinds).toContain(expected);
    }
  });

  it("adds the ZCode usage reader to the aggregation list", () => {
    const kinds = BUILT_IN_USAGE_DRIVERS.map((driver) => driver.driverKind);
    expect(kinds).toContain("zcode");
    expect(kinds[0]).toBe("claudeAgent");
  });

  it("registers exactly the 11 built-in drivers, with ZCode appended last", () => {
    // An exact ordered set: a merge that drops a driver or silently adds one fails here.
    expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind)).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "fx",
      "opencode",
      "antigravity",
      "pi",
      "muse",
      "acpRegistry",
      "zcode",
    ]);
  });

  it("aggregates usage from exactly 9 drivers, excluding acpRegistry and fx", () => {
    const kinds = BUILT_IN_USAGE_DRIVERS.map((driver) => driver.driverKind);
    expect(kinds).toHaveLength(9);
    // An exact ordered set: aggregation keeps the first duplicate record, so order is load-bearing.
    expect(kinds).toEqual([
      "claudeAgent",
      "codex",
      "grok",
      "pi",
      "opencode",
      "muse",
      "antigravity",
      "cursor",
      "zcode",
    ]);
  });
});
