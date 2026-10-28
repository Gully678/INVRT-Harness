import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { SaxesParser } from "saxes";
import { formatAppDisplayName } from "../branding.logic";
import { InvrtLockup } from "./InvrtLockup";

function output(markup: string) {
  let visible = "";
  const names: string[] = [];
  const images: string[] = [];
  let imageDepth = 0;
  let exposed = "";
  let hidden = 0;
  const stack: boolean[] = [];
  const parser = new SaxesParser();
  parser.on("opentag", (tag) => {
    const hides = tag.attributes["aria-hidden"] === "true";
    if (tag.attributes.role === "img") {
      imageDepth = stack.length + 1;
      images.push("");
    }
    stack.push(hides);
    if (hides) hidden++;
    if (!hidden && tag.attributes["aria-label"]) names.push(String(tag.attributes["aria-label"]));
  });
  parser.on("text", (text) => {
    visible += text;
    if (!hidden) exposed += text;
    if (imageDepth) images[images.length - 1] += text;
  });
  parser.on("closetag", () => {
    if (stack.length === imageDepth) imageDepth = 0;
    if (stack.pop()) hidden--;
  });
  parser.write(`<root>${markup}</root>`).close();
  return { visible, names, images, exposed };
}

describe("lockup channel output", () => {
  it.each(["Beta", "Dev", "Nightly", "Latest"])(
    "preserves visible and accessible %s identity",
    (stageLabel) => {
      const title = formatAppDisplayName({ baseName: "INVRT Code", stageLabel });
      const result = output(renderToStaticMarkup(<InvrtLockup {...{ stageLabel, title }} />));
      expect(result.visible).toBe(stageLabel === "Latest" ? "Code" : `Code (${stageLabel})`);
      expect(result.names).toEqual([title]);
    },
  );
  it("keeps callers without a channel on canonical Code", () => {
    expect(output(renderToStaticMarkup(<InvrtLockup />)).images).toEqual(["Code"]);
  });
});

const channel = vi.hoisted(() => ({ stage: "Beta", path: "/new?prompt=fixture" }));
vi.mock("../branding", async () => {
  const { formatAppDisplayName } = await import("../branding.logic");
  return {
    get APP_STAGE_LABEL() {
      return channel.stage;
    },
    get APP_DISPLAY_NAME() {
      return formatAppDisplayName({ baseName: "INVRT Code", stageLabel: channel.stage });
    },
    APP_BASE_NAME: "INVRT Code",
    APP_VERSION: "0.0.0",
    DESKTOP_DOWNLOAD_URL: "https://t3.codes/download",
  };
});
vi.mock("../environments/primary", () => ({
  peekPairingTokenFromUrl: () => null,
  stripPairingTokenFromUrl: () => {},
  submitServerAuthCredential: vi.fn(),
  resolveInitialServerAuthGateState: vi.fn(),
}));
vi.mock("../connection/onboarding", () => ({ connectPairing: vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../hostedPairing", () => ({
  readHostedPairingRequest: () => null,
  isHostedStaticApp: () => true,
  hasHostedPairingRequest: () => false,
}));
vi.mock("../hooks/useLocalStorage", () => ({ useLocalStorage: () => [null, vi.fn()] }));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({ environments: [], isReady: true }),
  useRelayEnvironmentDiscovery: () => ({ environments: new Map() }),
}));
vi.mock("../localEnvironment", () => ({ isLocalEnvironmentDisabled: () => true }));
vi.mock("../cloud/publicConfig", () => ({ hasCloudPublicConfig: () => false }));
vi.mock("./clerk/useT3ConnectAuthPrompt", () => ({
  useT3ConnectAuthPrompt: () => ({ openAuthPrompt: vi.fn() }),
}));
vi.mock("./cloud/CloudEnvironmentConnectList", () => ({ CloudEnvironmentConnectRows: () => null }));
vi.mock("./ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));
vi.mock("../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn(), isCopied: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (options: unknown) => ({ options }),
  useRouter: () => ({ invalidate: vi.fn() }),
  useLocation: ({
    select,
  }: {
    select: (location: { href: string; pathname: string }) => unknown;
  }) => select({ href: channel.path, pathname: "/new" }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
import {
  PairingPendingSurface,
  PairingRouteSurface,
  HostedPairingRouteSurface,
} from "./auth/PairingRouteSurface";
import { HostedEmptyState } from "./HostedEmptyState";
import { useHostedPromptLinkLanding } from "./promptLinks/HostedPromptLinkLanding";
import { AuthSurfaceShell } from "./auth/AuthSurfaceShell";
import { Route } from "../routes/__root";
function PromptLanding() {
  return useHostedPromptLinkLanding(true);
}

vi.mock("./AppSidebarLayout", () => ({ AppSidebarLayout: vi.fn() }));

vi.mock("./CommandPalette", () => ({ CommandPalette: vi.fn() }));

vi.mock("./CustomSnoozeDialog", () => ({ CustomSnoozeDialogHost: vi.fn() }));

vi.mock("./chat/GuestShareControls", () => ({ GuestShareDialogHost: vi.fn() }));

vi.mock("./AddProjectToMachineDialog", () => ({ AddProjectToMachineDialogHost: vi.fn() }));

vi.mock("./ConfirmDialogHost", () => ({ ConfirmDialogHost: vi.fn() }));

vi.mock("./onboarding/FirstRunGate", () => ({ FirstRunGate: vi.fn() }));

vi.mock("./cloud/ConnectOnboardingDialog", () => ({ ConnectOnboardingDialog: vi.fn() }));

vi.mock("./cloud/RelayClientInstallDialog", () => ({ RelayClientInstallDialog: vi.fn() }));

vi.mock("./desktop/SshPasswordPromptDialog", () => ({ SshPasswordPromptDialog: vi.fn() }));

vi.mock("./desktop/SnapShotCoordinator", () => ({ SnapShotCoordinator: vi.fn() }));

vi.mock("./desktop/DesktopAppActivationCoordinator", () => ({
  DesktopAppActivationCoordinator: vi.fn(),
}));

vi.mock("./desktop/DesktopWebLinkCoordinator", () => ({ DesktopWebLinkCoordinator: vi.fn() }));

vi.mock("./desktop/RunningThreadKeepAlive", () => ({ RunningThreadKeepAlive: vi.fn() }));

vi.mock("./ReopenClosedViewShortcut", () => ({ ReopenClosedViewShortcut: vi.fn() }));

vi.mock("./ProjectCloneToastCoordinator", () => ({ ProjectCloneToastCoordinator: vi.fn() }));

vi.mock("./settings/ChatGptWelcomeCoordinator", () => ({ ChatGptWelcomeCoordinator: vi.fn() }));

vi.mock("./settings/ThemeEditorHost", () => ({ ThemeEditorHost: vi.fn() }));

vi.mock("~/components/MorphIcon", () => ({ MorphIcon: vi.fn() }));

vi.mock("./ui/toast", () => ({ AnchoredToastProvider: vi.fn(), ToastProvider: vi.fn() }));

vi.mock("../hooks/useSettings", () => ({ useClientSettings: vi.fn() }));

vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: vi.fn(),
  derivePhysicalProjectKeyFromPath: vi.fn(),
  selectProjectGroupingSettings: vi.fn(),
}));

vi.mock("../uiStateStore", () => ({ useUiStateStore: vi.fn() }));

vi.mock("../observability/clientTracing", () => ({ configureClientTracing: vi.fn() }));

vi.mock("../guestPage", () => ({ GUEST_PAGE_PATH: vi.fn() }));

vi.mock("../state/server", () => ({
  primaryServerConfigAtom: vi.fn(),
  primaryServerWelcomeAtom: vi.fn(),
}));

vi.mock("../state/entities", () => ({ readProject: vi.fn() }));

vi.mock("../lib/desktopSnapShot", () => ({ getDesktopSnapShotBridge: vi.fn() }));

vi.mock("../lib/snapShotSetupResume", () => ({ shouldResumeSnapShotSetupOnStartup: vi.fn() }));

describe("actual channel callers", () => {
  const cases = [
    ["pairing pending", () => <PairingPendingSurface />],
    [
      "pairing credential",
      () => (
        <PairingRouteSurface
          auth={{
            policy: "remote-reachable",
            bootstrapMethods: ["one-time-token"],
            sessionMethods: [],
            sessionCookieName: "fixture",
          }}
          onAuthenticated={() => {}}
        />
      ),
    ],
    ["hosted pairing", () => <HostedPairingRouteSurface />],
    ["hosted empty", () => <HostedEmptyState />],
    ["prompt valid", () => <PromptLanding />],
    [
      "prompt invalid",
      () => {
        channel.path = "/new";
        return <PromptLanding />;
      },
    ],
    [
      "root error",
      () => {
        const ErrorView = Route.options.errorComponent;
        if (!ErrorView) throw new Error("Root error component is missing");
        return <ErrorView error={new Error("fixture")} reset={() => {}} />;
      },
    ],
  ] as const;
  const headings: Record<string, string> = {
    "pairing pending": "Pairing with this environment",
    "pairing credential": "Pair with this environment",
    "hosted pairing": "Pairing failed",
    "hosted empty": "This computer is off",
    "prompt valid": "Open this prompt",
    "prompt invalid": "Could not open the link",
    "root error": "Something went wrong.",
  };
  const stages = ["Beta", "Dev", "Nightly", "Latest"];
  it.each(stages.flatMap((stage) => cases.map(([name, element]) => ({ stage, name, element }))))(
    "$name retains $stage in actual output",
    ({ stage, name, element }) => {
      channel.stage = stage;
      channel.path = "/new?prompt=fixture";
      vi.stubGlobal("window", { location: { origin: "https://example.test" } });
      vi.stubGlobal("navigator", { userAgent: "test" });
      try {
        const result = output(renderToStaticMarkup(element()));
        expect(result.visible).toContain(headings[name]);
        expect(result.images).toEqual([stage === "Latest" ? "Code" : `Code (${stage})`]);
        expect(result.names).toContain(
          formatAppDisplayName({ baseName: "INVRT Code", stageLabel: stage }),
        );
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
  it.each(stages)("auth masthead announces %s through its image once", (stage) => {
    channel.stage = stage;
    const markup = renderToStaticMarkup(<AuthSurfaceShell>Body</AuthSurfaceShell>);
    const result = output(markup);
    expect(result.names).toEqual(["INVRT Code"]);
    expect(result.exposed).toBe(`${stage}Body`);
  });
});
