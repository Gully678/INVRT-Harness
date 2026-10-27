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
});
