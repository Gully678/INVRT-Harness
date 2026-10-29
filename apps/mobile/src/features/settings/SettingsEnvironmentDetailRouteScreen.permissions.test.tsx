import { EnvironmentId, type AuthSessionState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  connected: true,
  failed: false,
  session: null as AuthSessionState | null,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => {
    if (atom === "session-value") return state.session;
    if (atom === "session-result")
      return state.failed
        ? AsyncResult.failure(Cause.fail(new Error("Fixture request failed")))
        : state.session === null
          ? AsyncResult.initial()
          : AsyncResult.success(state.session);
    if (atom === "update") return { status: "idle" };
    return null;
  },
}));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationAtom: () => "presentation" },
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    configValueAtom: () => "config",
    updateStateAtom: () => "update",
  },
}));
vi.mock("../../state/session", () => ({
  environmentSession: {
    sessionStateValueAtom: () => "session-value",
    sessionStateAtom: () => "session-result",
  },
  useEnvironmentScope: () => false,
  readEnvironmentScope: () => false,
}));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: {} }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => () => {} }));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useRemoteConnections: () => ({
    connectedEnvironments: [
      {
        environmentId: "environment-fixture",
        environmentLabel: "Fixture",
        isEnabled: true,
        connectionState: state.connected ? "connected" : "disconnected",
      },
    ],
  }),
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock("../../components/ui/ScreenScrollView", () => ({
  ScreenScrollView: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock("../../components/ProviderIcon", () => ({ ProviderIcon: () => null }));
vi.mock("../connection/ConnectionEnvironmentRow", () => ({ ConnectionEnvironmentRow: () => null }));
vi.mock("./EnvironmentRoutesSection", () => ({ EnvironmentRoutesSection: () => null }));
vi.mock("./OutdatedServerUpdateSection", () => ({ OutdatedServerUpdateSection: () => null }));
vi.mock("./components/SettingsActionRow", () => ({ SettingsActionRow: () => null }));
vi.mock("./components/SettingsScreen", () => ({
  SettingsScreen: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock("./components/SettingsSection", () => ({
  SettingsSection: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import { SettingsEnvironmentDetailRouteScreen } from "./SettingsEnvironmentDetailRouteScreen";
const render = () =>
  renderToStaticMarkup(
    <SettingsEnvironmentDetailRouteScreen
      route={{ params: { environmentId: EnvironmentId.make("environment-fixture") } }}
    />,
  );
const session = {
  authenticated: true,
  scopes: ["orchestration:read"],
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "session",
  },
} satisfies AuthSessionState;
beforeEach(() => {
  Object.assign(state, { connected: true, failed: false, session: null });
});
it("renders checking, automatic retry and rejected-session states in the mobile detail consumer", () => {
  expect(render()).toContain("Checking permissions");
  state.failed = true;
  expect(render()).toContain("Retrying automatically");
  state.failed = false;
  state.session = { ...session, authenticated: false };
  expect(render()).toContain("did not accept your session");
});
it("keeps actual denied grants and disconnected state distinct from failed checks", () => {
  state.session = session;
  expect(render()).toContain("does not have permission to manage");
  expect(render()).not.toContain("Retrying automatically");
  state.connected = false;
  expect(render()).toContain("Connect this environment to manage it");
});
