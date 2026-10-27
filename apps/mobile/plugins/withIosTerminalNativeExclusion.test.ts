import { describe, expect, it } from "vite-plus/test";

import {
  EXCLUDE_ENV_VAR,
  PODFILE_MARKER,
  TERMINAL_NATIVE_PACKAGE,
  applyTerminalNativeExclusionPatch,
  resolveIosTerminalNativeExclusion,
  terminalNativePodfilePatch,
} from "./terminalNativeExclusion.cjs";

describe("resolveIosTerminalNativeExclusion", () => {
  // regression: the exclusion must not silently apply to supported arm64 targets
  it("keeps the native terminal when no Intel-simulator flag is set", () => {
    expect(resolveIosTerminalNativeExclusion({})).toEqual([]);
    expect(resolveIosTerminalNativeExclusion({ [EXCLUDE_ENV_VAR]: "" })).toEqual([]);
    expect(resolveIosTerminalNativeExclusion({ [EXCLUDE_ENV_VAR]: "0" })).toEqual([]);
  });

  it("excludes only the terminal-native package for the Intel simulator flag", () => {
    expect(resolveIosTerminalNativeExclusion({ [EXCLUDE_ENV_VAR]: "1" })).toEqual([
      TERMINAL_NATIVE_PACKAGE,
    ]);
  });
});

describe("applyTerminalNativeExclusionPatch", () => {
  const podfileSample =
    "target 'INVRTCode' do\n  use_expo_modules!\n\n  use_expo_modules_widgets!\nend\n";

  it("scopes the exclusion decision to pod-install time via the environment", () => {
    const patched = applyTerminalNativeExclusionPatch(podfileSample);
    expect(patched).toContain(`ENV[${JSON.stringify(EXCLUDE_ENV_VAR)}] == '1'`);
    expect(patched).toContain(JSON.stringify(TERMINAL_NATIVE_PACKAGE));
    expect(patched).toContain("use_expo_modules!(exclude: terminal_native_excludes)");
    expect(patched).toContain(PODFILE_MARKER);
  });

  it("replaces only the main target's bare invocation, not the widgets target", () => {
    const patched = applyTerminalNativeExclusionPatch(podfileSample);
    expect(patched).toContain("use_expo_modules_widgets!");
    expect(patched).not.toContain("\n  use_expo_modules!\n");
  });

  it("is idempotent once the marker is present", () => {
    const once = applyTerminalNativeExclusionPatch(podfileSample);
    expect(applyTerminalNativeExclusionPatch(once!)).toBeNull();
  });

  it("fails loudly when the generated bare invocation is missing", () => {
    expect(() => applyTerminalNativeExclusionPatch("target 'X' do\nend\n")).toThrow(
      /use_expo_modules! is missing/,
    );
  });
});
