import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

// Only the unavailable native host boundary is doubled; widget functions execute unchanged.
vi.mock("@expo/ui/swift-ui", () => ({
  HStack: "HStack",
  Image: "Image",
  Spacer: "Spacer",
  Text: "Text",
  VStack: "VStack",
  ZStack: "ZStack",
  ProgressView: "ProgressView",
}));
vi.mock("@expo/ui/jetpack-compose", () => ({
  Button: "Button",
  Column: "Column",
  LinearProgressIndicator: "LinearProgressIndicator",
  Text: "Text",
  getMaterialColors: () => ({ surface: "surface", onSurface: "text", onSurfaceVariant: "muted" }),
}));
vi.mock("@expo/ui/swift-ui/modifiers", () => {
  const names = [
    "accessibilityElement",
    "accessibilityLabel",
    "activityBackgroundTint",
    "font",
    "foregroundStyle",
    "frame",
    "layoutPriority",
    "lineLimit",
    "minimumScaleFactor",
    "padding",
    "resizable",
    "widgetURL",
    "containerBackground",
    "environment",
    "fixedSize",
    "progressViewStyle",
    "tint",
  ];
  return Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => ({ name, args })]));
});
vi.mock("@expo/ui/jetpack-compose/modifiers", () =>
  Object.fromEntries(
    ["fillMaxSize", "fillMaxWidth", "height", "padding", "paddingAll"].map((name) => [
      name,
      (...args: unknown[]) => ({ name, args }),
    ]),
  ),
);
vi.mock("expo-widgets", () => ({
  createWidget: (_name: string, component: unknown) => component,
  createLiveActivity: (_name: string, component: unknown) => component,
}));

import {
  AgentActivity,
  type AgentActivityPhase,
  type AgentActivityRowProps,
} from "./AgentActivity";
import iosWidget from "./SubscriptionUsage";
import { SubscriptionUsage as androidWidget } from "./SubscriptionUsage.android";
import {
  subscriptionUsageTimeline,
  type SubscriptionUsageSnapshot,
} from "./subscriptionUsageSnapshot";

type ViewProps = {
  children?: ReactNode;
  modifiers?: Array<{ name: string; args: unknown[] }>;
  systemName?: string;
  assetName?: string;
};
function views(node: ReactNode): Array<{ type: unknown; props: ViewProps }> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<ViewProps>(child)) return [];
    return [{ type: child.type, props: child.props }, ...views(child.props.children)];
  });
}
function texts(node: ReactNode): string[] {
  return views(node)
    .filter((view) => view.type === "Text")
    .map((view) => Children.toArray(view.props.children).join(""));
}
function labels(node: ReactNode): unknown[] {
  return views(node)
    .flatMap((view) => view.props.modifiers ?? [])
    .filter((modifier) => modifier.name === "accessibilityLabel")
    .map((modifier) => modifier.args[0]);
}
const activityEnvironment = {
  colorScheme: "dark",
  widgetRenderingMode: "fullColor",
  isStale: false,
} as Parameters<typeof AgentActivity>[1];
function activity(phase: AgentActivityPhase, status: string, activeCount = 1) {
  const row: AgentActivityRowProps = {
    environmentId: "env",
    threadId: "thread",
    projectTitle: "Project",
    threadTitle: "Task",
    modelTitle: "Codex",
    phase,
    status,
    updatedAt: "2026-10-28T12:00:00Z",
    deepLink: "/threads/thread",
  };
  return AgentActivity(
    {
      title: "Agents",
      subtitle: "Status",
      activeCount,
      updatedAt: row.updatedAt,
      activities: [row],
    },
    activityEnvironment,
  );
}
const now = Date.parse("2026-10-28T12:00:00Z");
const snapshot: SubscriptionUsageSnapshot = {
  checkedAt: now,
  url: "t3code://settings/usage",
  providers: [
    {
      name: "Codex",
      detail: "Subscription remaining",
      expiresAt: now + 60_000,
      totalWindows: 7,
      windows: [{ kind: "session", label: "5 hours", remaining: 40, reset: "Next reset soon" }],
    },
  ],
};
// createWidget registers this exact function; its native wrapper cannot run in Node.
const renderIOS = iosWidget as unknown as (
  props: SubscriptionUsageSnapshot,
  environment: object,
) => ReactNode;
const iosEnvironment = {
  widgetFamily: "systemLarge",
  colorScheme: "dark",
  widgetRenderingMode: "fullColor",
  date: new Date(now),
};
const renderAndroid = (props: SubscriptionUsageSnapshot) =>
  androidWidget(props, { colorScheme: "dark" } as Parameters<typeof androidWidget>[1]);

describe("activity widget brand and status semantics", () => {
  it.each([
    ["failed", "Failed", "xmark.octagon.fill"],
    ["completed", "Done", "checkmark.circle.fill"],
    ["waiting_for_approval", "Needs approval", "exclamationmark.circle.fill"],
    ["waiting_for_input", "Needs input", "questionmark.circle.fill"],
    ["running", "Working", "circle.dashed"],
  ] as const)("names the minimal %s status rather than the product", (phase, status, symbol) => {
    const layout = activity(phase, status);
    expect(labels(layout.minimal)).toEqual([status]);
    expect(views(layout.minimal).find((view) => view.type === "Image")?.props.systemName).toBe(
      symbol,
    );
    expect(labels(layout.compactLeading)).toEqual(["INVRT Code"]);
    expect(
      views(layout.compactLeading).find((view) => view.type === "Image")?.props.assetName,
    ).toBe("T3Mark");
    expect(views(layout.minimal).flatMap((view) => view.props.modifiers ?? [])).toContainEqual({
      name: "widgetURL",
      args: ["t3code://threads/thread"],
    });
  });
  it("keeps the compact working glyph inside its existing count announcement", () => {
    const layout = activity("running", "Working");
    expect(labels(layout.compactTrailing)).toEqual(["1 active agent"]);
    expect(views(layout.compactTrailing)[0]?.props.modifiers).toContainEqual({
      name: "accessibilityElement",
      args: ["ignore"],
    });
    expect(
      views(layout.compactTrailing).find((view) => view.type === "Image")?.props.systemName,
    ).toBe("circle.dashed");
  });
  it("keeps the brand on the no-activity logo", () => {
    const layout = AgentActivity(
      { title: "Agents", subtitle: "Status", activeCount: 0, updatedAt: "", activities: [] },
      activityEnvironment,
    );
    expect(labels(layout.minimal)).toEqual(["INVRT Code"]);
  });
});

describe("subscription widget prompts through actual platform functions", () => {
  it.each(["ios", "android"] as const)("renders expired timeline detail on %s", (platform) => {
    using _clock = vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    const expired = subscriptionUsageTimeline(snapshot, now)[1]!.props;
    const tree = platform === "ios" ? renderIOS(expired, iosEnvironment) : renderAndroid(expired);
    expect(texts(tree)).toContain("Open INVRT Code to refresh");
    expect(texts(tree).join(" ")).not.toContain("T3");
  });
  it("names INVRT Code in the iOS accessory empty state and its announcement", () => {
    using _clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const tree = renderIOS(
      {
        ...snapshot,
        providers: [
          {
            ...snapshot.providers[0]!,
            windows: [],
            detail: "Open INVRT Code to connect",
            totalWindows: 0,
          },
        ],
      },
      { ...iosEnvironment, widgetFamily: "accessoryRectangular" },
    );
    expect(texts(tree)).toContain("Open INVRT Code");
    expect(labels(tree)).toContain("Codex. Open INVRT Code to connect.");
  });
  it.each(["ios", "android"] as const)(
    "brands hidden-window and connection prompts on %s",
    (platform) => {
      using _clock = vi.spyOn(Date, "now").mockReturnValue(now);
      const props = { ...snapshot, checkedAt: 0 };
      const tree = platform === "ios" ? renderIOS(props, iosEnvironment) : renderAndroid(props);
      expect(texts(tree)).toContain(
        platform === "ios" ? "3 more in INVRT Code" : "5 more in INVRT Code",
      );
      expect(texts(tree)).toContain("Tap to connect in INVRT Code");
      expect(texts(tree).join(" ")).not.toContain("T3");
    },
  );
});
