import { describe, expect, it } from "@effect/vitest";

import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { ZCodeSettings } from "../settings.ts";
import { ZcodeDriver } from "./driver.ts";
import {
  ZcodeProviderCapabilitiesV2,
  ZCODE_DEFAULT_INSTANCE_ID,
  ZCODE_PROVIDER,
} from "./adapter.ts";
import {
  resolveZcodeCommandCandidates,
  zcodeRuntimeModeToCliMode,
  ZCODE_APP_BUNDLE_CLI,
  ZCODE_SUPPORTED_RUNTIME_MODES,
} from "./status.ts";

const decodeSettings = Schema.decodeSync(ZCodeSettings);

describe("ZCodeSettings", () => {
  it("decodes empty settings with the documented defaults", () => {
    const settings = decodeSettings({});
    expect(settings.enabled).toBe(false);
    // Empty binary path decodes to the PATH fallback per makeBinaryPathSetting.
    expect(settings.binaryPath).toBe("zcode");
    expect(settings.customModels).toEqual([]);
  });

  it("keeps an explicit binary path override", () => {
    const settings = decodeSettings({ binaryPath: "/opt/zcode/zcode.cjs", enabled: true });
    expect(settings.binaryPath).toBe("/opt/zcode/zcode.cjs");
    expect(settings.enabled).toBe(true);
  });
});

describe("ZcodeDriver registration", () => {
  it("registers under the zcode driver kind with usage reader attached", () => {
    expect(ZcodeDriver.driverKind).toBe(ZCODE_PROVIDER);
    expect(ZcodeProviderCapabilitiesV2).toBeDefined();
    expect(ZcodeDriver.usage?.kind).toBe("scan");
    expect(ZcodeDriver.metadata.displayName).toBe("ZCode");
    expect(ZCODE_DEFAULT_INSTANCE_ID).toBe(ProviderInstanceId.make(ZCODE_PROVIDER));
  });

  it("declares unsupported capabilities honestly", () => {
    // The ZCode Protocol exposes none of these; declaring them true would let the
    // orchestrator call operations the adapter cannot honour.
    expect(ZcodeProviderCapabilitiesV2.approvals.supportsCommandApproval).toBe(false);
    expect(ZcodeProviderCapabilitiesV2.approvals.supportsFileChangeApproval).toBe(false);
    expect(ZcodeProviderCapabilitiesV2.threads.canForkThread).toBe(false);
    expect(ZcodeProviderCapabilitiesV2.threads.canRollbackThread).toBe(false);
    expect(ZcodeProviderCapabilitiesV2.turns.supportsActiveSteering).toBe(false);
    expect(ZcodeProviderCapabilitiesV2.turns.supportsQueuedMessages).toBe(false);
    expect(ZcodeProviderCapabilitiesV2.subagents.supportsSubagents).toBe(false);
    expect(ZcodeProviderCapabilitiesV2.sessions.supportsModelSwitchInSession).toBe(false);
    expect(ZcodeProviderCapabilitiesV2.identity.nativeTurnIds).toBe("none");
    // Proven capabilities stay true.
    expect(ZcodeProviderCapabilitiesV2.threads.canReadThreadSnapshot).toBe(true);
    expect(ZcodeProviderCapabilitiesV2.threads.exposesNativeThreadId).toBe(true);
    expect(ZcodeProviderCapabilitiesV2.turns.supportsInterrupt).toBe(true);
    expect(ZcodeProviderCapabilitiesV2.streaming.streamsAssistantText).toBe(true);
  });
});

describe("zcodeRuntimeModeToCliMode", () => {
  it("maps supported T3 runtime modes to explicit ZCode CLI modes", () => {
    expect(zcodeRuntimeModeToCliMode("approval-required")).toBe("build");
    expect(zcodeRuntimeModeToCliMode("auto-accept-edits")).toBe("edit");
    expect(zcodeRuntimeModeToCliMode("full-access")).toBe("yolo");
  });

  it("refuses to map 'auto' because ZCode has no distinct auto mode and yolo must stay explicit", () => {
    expect(() => zcodeRuntimeModeToCliMode("auto")).toThrow(/auto/);
  });

  it("advertises only the supported runtime modes", () => {
    expect(ZCODE_SUPPORTED_RUNTIME_MODES).not.toContain("auto");
    expect(ZCODE_SUPPORTED_RUNTIME_MODES).toEqual([
      "approval-required",
      "auto-accept-edits",
      "full-access",
    ]);
  });
});

describe("resolveZcodeCommandCandidates", () => {
  it("prefers the explicit override when set", () => {
    expect(resolveZcodeCommandCandidates("/custom/zcode.cjs", "/home/u")).toEqual([
      "/custom/zcode.cjs",
    ]);
  });

  it("falls back to PATH then the macOS app bundle when empty", () => {
    expect(resolveZcodeCommandCandidates("", "/home/u")).toEqual(["zcode", ZCODE_APP_BUNDLE_CLI]);
    expect(ZCODE_APP_BUNDLE_CLI).toBe("/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs");
  });

  it("expands a tilde home prefix", () => {
    expect(resolveZcodeCommandCandidates("~/bin/zcode", "/home/u")).toEqual(["/home/u/bin/zcode"]);
  });
});
