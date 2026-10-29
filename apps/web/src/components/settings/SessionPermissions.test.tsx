import { EnvironmentId, type AuthSessionState } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  data: null as AuthSessionState | null,
  hasError: false,
  isPending: false,
}));
vi.mock("~/state/session", () => ({ useEnvironmentSessionState: () => state }));
import { SessionPermissions } from "./SessionPermissions";

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
const render = (connected = true) =>
  renderToStaticMarkup(
    <SessionPermissions
      environmentId={EnvironmentId.make("test-environment")}
      connected={connected}
    />,
  );
beforeEach(() => Object.assign(state, { data: null, hasError: false, isPending: false }));
it("shows current checking, retrying, rejected and disconnected permission states", () => {
  state.isPending = true;
  expect(render()).toContain("Checking permissions");
  state.isPending = false;
  state.hasError = true;
  expect(render()).toContain("Retrying automatically");
  state.hasError = false;
  state.data = { ...session, authenticated: false };
  expect(render()).toContain("did not accept your session");
  expect(render(false)).toContain("Connect to this environment");
});
it("only displays verified grants and removes stale grants on an error", () => {
  state.data = { ...session, permissions: ["orchestration:read"] };
  expect(render()).toContain("View environment");
  expect(render()).toContain("Allowed");
  expect(render()).toContain("Not granted");
  state.hasError = true;
  expect(render()).not.toContain("Allowed");
});
