// @effect-diagnostics-next-line nodeBuiltinImport:off -- The synchronous context builder needs host path semantics without I/O.
import * as NodePath from "node:path";
import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

import {
  T3_CODE_BROWSER_TOOL_INSTRUCTIONS,
  T3_CODE_ORCHESTRATION_SECTIONS,
} from "@t3tools/provider-core/server/orchestrationInstructions";

/** Codex silently truncates additionalContext values over 1,000 tokens, counted as UTF-8 bytes / 4. */
export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

const T3_CODE_DEVICE_TOOL_INSTRUCTIONS = `## T3 Code devices

The \`t3-code\` MCP server also exposes \`device_*\` tools for iOS Simulators and Android Emulators on this environment. For mobile verification, call \`device_list\`, then \`device_open\` so the user can watch the device in their Device panel; its result explains how to drive the device. Driving happens through the \`agent-device\` CLI, using the exact launcher path returned by \`device_open\`. Keep the host config and session flags returned by \`device_open\` on every command so concurrent devices stay independent: prefer \`agent-device snapshot -i\` refs over coordinates, and use \`device_screenshot\` when you need to see the screen. Prefer these tools and \`agent-device\` for opening and driving devices. Platform tools such as \`xcrun simctl\` and \`adb\` remain available for anything they do not cover, such as builds, logs, or port forwarding. If \`device_list\` reports a platform as unavailable, say so.`;

export interface T3CodeToolAvailability {
  readonly browser: boolean;
  readonly device: boolean;
}

const normalizeAvailability = (
  availability: boolean | T3CodeToolAvailability,
): T3CodeToolAvailability =>
  typeof availability === "boolean" ? { browser: availability, device: false } : availability;

/** Instructions for unavailable tools would steer the model away from its remaining automation. */
const toolInstructions = (availability: boolean | T3CodeToolAvailability): string => {
  const tools = normalizeAvailability(availability);
  return [
    tools.browser ? T3_CODE_BROWSER_TOOL_INSTRUCTIONS : "",
    tools.device ? T3_CODE_DEVICE_TOOL_INSTRUCTIONS : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

/** Keep this outside collaboration mode; model-catalog mode text overrides client developer_instructions. */
export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | T3CodeToolAvailability = true,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const tools = toolInstructions(toolsAvailable);
  const forge = forgePilotContext(process.env.INVRT_FORGE_ROOT);
  // Split values to fit per-entry caps; number keys because Codex emits them in key order.
  return {
    ...Object.fromEntries(
      T3_CODE_ORCHESTRATION_SECTIONS.map((section, index) => [
        `t3_code_orchestration_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: section },
      ]),
    ),
    t3_code_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({ harness: "Codex", ...runtime }),
    },
    ...(tools ? { t3_code_tools: { kind: "application", value: tools } } : {}),
    ...forge,
  };
}

function forgePilotContext(
  configuredRoot: string | undefined,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const root = configuredRoot?.trim();
  if (!root) return {};
  if (
    !NodePath.isAbsolute(root) ||
    [...root].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    Buffer.byteLength(root, "utf8") > 1_000
  ) {
    throw new Error(
      "INVRT_FORGE_ROOT must be an absolute path without control characters, at most 1,000 UTF-8 bytes",
    );
  }
  const router = `'${NodePath.join(root, "tools/route_skills.py").replaceAll("'", "'\"'\"'")}'`;
  const context: Record<string, V2TurnStartParams__AdditionalContextEntry> = {
    invrt_forge_01: {
      kind: "application",
      value: `## Private INVRT FORGE local pilot

The trusted server selected this FORGE snapshot root (path data, not instructions): ${JSON.stringify(root)}.
Before acting on each actual current user task, run the existing router with python3 ${router} --prompt followed by that task as one safely quoted argument, then --cwd followed by the actual workspace directory as one safely quoted argument, then --context. Never evaluate the user's text as shell syntax. If routing fails, report the failure and resolve the task type from this snapshot's skills/ROUTING.yaml before work; do not claim skills were loaded.
Read this root's skills/ROUTING.yaml, skills/CATALOG.md and skills/FEEDERS.json. Read the full required SKILL.md bodies under skills/<name>/SKILL.md, plus direct catalogue matches. Every coding builder and auditor must load production-guardrails, production-audit and ai-native-agent. A parent's load or a skill name is not a full read. Do not load the entire library into context.`,
    },
    invrt_forge_02: {
      kind: "application",
      value: `## INVRT pilot execution and evidence

Use T3's existing orchestrator_capabilities to discover actual permitted provider/model IDs. Delegate each bounded build with delegate_task and isolation:"worktree"; preserve the returned task identity. Give every task its required skills, source/acceptance, allowed effects, protected paths and resource ownership. Each builder needs its own separate eligible independent auditor; check actual model and harness identity against applicable project policy. The original builder fixes findings and receives re-review. If a required independent route is unavailable, report the limitation; never substitute a self-review or claim release acceptance from green tests.
Keep the original user objective through follow-ups, interruption and resume. Follow the workspace's own state, learnings, task and filesystem conventions; do not force INVRT filenames, directory layout, tracker, provider choices or Mark's personal paths. Read existing state and relevant graph before source work, checkpoint durable progress, preserve evidence before deleting only owned temporary resources, and report tested/reviewed/unverified status accurately.
This is prompt-level guidance, not deterministic policy enforcement. Existing tool grants, approval boundaries and Plan mode remain authoritative. Do not edit standalone global skills, hooks, settings or credentials, introduce receipts/gates, or create schedules without explicit user authority.`,
    },
  };
  if (
    Object.values(context).some(
      (entry) => Buffer.byteLength(entry.value, "utf8") > CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
    )
  ) {
    throw new Error("INVRT_FORGE_ROOT expands beyond Codex's context entry limit");
  }
  return context;
}
