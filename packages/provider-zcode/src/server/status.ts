/**
 * ZCode provider status probe.
 *
 * Availability: `<binary> version` (fast, no model call). Auth: honest "unknown" with a
 * message unless the CLI proves otherwise, because the ZCode Protocol exposes no auth
 * query and model access depends on a model provider config the desktop harness supplies.
 * The adapter surfaces ModelConfigMissing as an explicit error instead of guessing auth.
 */
import type { ModelCapabilities, ServerProvider, ServerProviderModel } from "@t3tools/contracts";
import type { ZCodeSettings } from "../settings.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as FileSystem from "effect/FileSystem";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "@t3tools/provider-core/server/snapshotProbe";
import type { RuntimeMode } from "@t3tools/contracts";

export const ZCODE_DEFAULT_MODEL_SLUG = "zcode-default";

/** T3 RuntimeMode to ZCode CLI permission mode. "auto" is excluded: ZCode has no distinct
 * auto mode and mapping it would silently mean "yolo", which must stay an explicit choice. */
export const ZCODE_SUPPORTED_RUNTIME_MODES = [
  "approval-required",
  "auto-accept-edits",
  "full-access",
] as const satisfies ReadonlyArray<RuntimeMode>;

export function zcodeRuntimeModeToCliMode(
  runtimeMode: RuntimeMode,
): "build" | "edit" | "plan" | "yolo" {
  switch (runtimeMode) {
    case "approval-required":
      return "build";
    case "auto-accept-edits":
      return "edit";
    case "full-access":
      return "yolo";
    case "auto":
      // Never silently map to yolo; callers see an unsupported-mode error instead.
      throw new Error("RuntimeMode 'auto' has no safe ZCode permission mode.");
    default: {
      const exhaustive: never = runtimeMode;
      throw new Error(`Unhandled runtime mode: ${String(exhaustive)}`);
    }
  }
}

export const ZCODE_APP_BUNDLE_CLI = "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";

const VERSION_PROBE_TIMEOUT_MS = 8_000;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export const ZCODE_PRESENTATION = {
  displayName: "ZCode",
  supportsConversationRollback: false,
  showInteractionModeToggle: false,
  supportedRuntimeModes: ZCODE_SUPPORTED_RUNTIME_MODES,
  reportsContextWindow: true,
} as const;

function zcodeModelsFromSettings(
  customModels: ZCodeSettings["customModels"],
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(builtInZcodeModels(), customModels ?? [], EMPTY_CAPABILITIES);
}

function builtInZcodeModels(): ReadonlyArray<ServerProviderModel> {
  // The protocol exposes no model catalog without a live configured session, so the
  // snapshot offers the CLI's own configured default model under a stable slug.
  return [
    {
      slug: ZCODE_DEFAULT_MODEL_SLUG,
      name: "ZCode default model",
      isCustom: false,
      isDefault: true,
      capabilities: EMPTY_CAPABILITIES,
    },
  ];
}

export function resolveZcodeCommandCandidates(
  settingsBinaryPath: string,
  homeDir: string,
): readonly string[] {
  const configured = settingsBinaryPath.trim();
  const candidates = configured.length > 0 ? [configured] : ["zcode", ZCODE_APP_BUNDLE_CLI];
  return candidates.map((candidate) =>
    candidate === ZCODE_APP_BUNDLE_CLI ? candidate : expandTilde(candidate, homeDir),
  );
}

function expandTilde(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return `${homeDir}${path.slice(1)}`;
  return path;
}

export interface ZcodeVersionProbe {
  readonly installed: boolean;
  readonly version: string | null;
  readonly commandPath: string | null;
  readonly message?: string;
}

export const probeZcodeVersion = Effect.fn("ZcodeStatus.probeZcodeVersion")(function* (
  settings: ZCodeSettings,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<
  ZcodeVersionProbe,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> {
  const home = environment.HOME ?? process.env.HOME ?? "";
  const candidates = resolveZcodeCommandCandidates(settings.binaryPath, home);
  for (const candidate of candidates) {
    const outcome = yield* runVersionProbe(candidate, environment);
    if (outcome.found) {
      return {
        installed: true,
        version: outcome.version,
        commandPath: candidate,
      };
    }
  }
  return {
    installed: false,
    version: null,
    commandPath: null,
  };
});

interface ZcodeVersionAttempt {
  readonly found: boolean;
  readonly version: string | null;
}

/** Null on command-missing, timeout, or non-zero exit; never fails. */
const runVersionProbe = Effect.fn("ZcodeStatus.runVersionProbe")(function* (
  commandPath: string,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ZcodeVersionAttempt, never, ChildProcessSpawner.ChildProcessSpawner> {
  const spawnCommand = yield* resolveSpawnCommand(commandPath, ["version"], {
    env: environment,
  }).pipe(Effect.option);
  if (Option.isNone(spawnCommand)) {
    return { found: false, version: null };
  }
  const collected = yield* spawnAndCollect(
    commandPath,
    ChildProcess.make(spawnCommand.value.command, spawnCommand.value.args, {
      env: environment,
      shell: spawnCommand.value.shell,
    }),
  ).pipe(
    // Command-missing and platform failures are probe outcomes, not errors.
    Effect.option,
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
  );
  const result = Option.getOrUndefined(Option.flatten(collected));
  if (result === undefined || result.code !== 0) {
    return { found: false, version: null };
  }
  return { found: true, version: parseGenericCliVersion(`${result.stdout}\n${result.stderr}`) };
});

export const buildInitialZcodeProviderSnapshot = Effect.fn(
  "ZcodeStatus.buildInitialZcodeProviderSnapshot",
)(function* (settings: ZCodeSettings): Effect.fn.Return<ServerProviderDraft> {
  const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
  const models = zcodeModelsFromSettings(settings.customModels);
  if (!settings.enabled) {
    return buildServerProvider({
      presentation: ZCODE_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "ZCode is disabled in T3 Code settings.",
      },
    });
  }
  return buildServerProvider({
    presentation: ZCODE_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Checking ZCode CLI availability...",
    },
  });
});

export const checkZcodeProviderStatus = Effect.fn("ZcodeStatus.checkZcodeProviderStatus")(
  function* (
    settings: ZCodeSettings,
    environment: NodeJS.ProcessEnv = process.env,
  ): Effect.fn.Return<
    ServerProviderDraft,
    never,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
  > {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = zcodeModelsFromSettings(settings.customModels);
    if (!settings.enabled) {
      return buildServerProvider({
        presentation: ZCODE_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "ZCode is disabled in T3 Code settings.",
        },
      });
    }
    const probe = yield* probeZcodeVersion(settings, environment);
    if (!probe.installed) {
      return buildServerProvider({
        presentation: ZCODE_PRESENTATION,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message:
            probe.message ??
            "ZCode CLI not found. Install ZCode.app or set the binary path in settings.",
        },
      });
    }
    return buildServerProvider({
      presentation: ZCODE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: probe.version,
        status: "warning",
        auth: { status: "unknown" },
        message:
          probe.message ??
          "ZCode CLI found. Model access requires a ZCode model provider config; model-configured sessions report errors explicitly.",
      },
    });
  },
);
