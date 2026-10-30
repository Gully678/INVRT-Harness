import { EnvironmentId } from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { renderToStaticMarkup } from "react-dom/server";
import * as Option from "effect/Option";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  hosts: {} as Record<string, { enabled: boolean; account?: string }>,
  tokens: {},
}));
vi.mock("../../hooks/useSettings", () => ({ useEnvironmentSettings: () => state }));
vi.mock("../../state/server", () => ({ serverEnvironment: { updateSettings: "fixture" } }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async () => ({ _tag: "Success" }),
}));
import { SourceControlAccountSettings } from "./SourceControlAccountSettings";
import { SourceControlTokenSettings } from "./SourceControlTokenSettings";

const definition = sourceControlClients.find("github")!;
const props = {
  environmentId: EnvironmentId.make("fixture"),
  definition,
  credentials: definition.credentials!,
  onSaved: () => {},
};
const accounts = [
  { host: "github.com", account: "personal", active: true, authenticated: true },
  {
    host: "github.com",
    account: "bot",
    active: false,
    authenticated: true,
    environmentVariable: "GH_TOKEN",
  },
];
const auth = {
  status: "unauthenticated",
  account: Option.none<string>(),
  host: Option.some("github.com"),
  detail: Option.none<string>(),
  accounts,
} as const;
beforeEach(() => {
  state.hosts = { "github.com": { enabled: true, account: "gone" } };
});
it("keeps an unavailable GitHub selection visible and requires an explicit switch", () => {
  const html = renderToStaticMarkup(<SourceControlAccountSettings {...props} auth={auth} />);
  expect(html).toContain("GitHub requests are blocked");
  expect(html).toContain("Use active login");
  expect(html).not.toContain("so the active gh login is used");
  expect(html).toContain("ignored while a login is chosen");
  expect(html).not.toContain("overrides the account chosen");
});
it("shows a pinned GitHub host even when discovery returns no accounts", () => {
  const html = renderToStaticMarkup(
    <SourceControlAccountSettings {...props} auth={{ ...auth, accounts: [] }} />,
  );
  expect(html).toContain("github.com");
  expect(html).toContain("GitHub requests are blocked");
  expect(html).toContain("Use active login");
});
it("explains that saved and environment tokens cannot override an explicit GitHub login", () => {
  const html = renderToStaticMarkup(<SourceControlTokenSettings {...props} />);
  expect(html).toContain("ignored while a login is chosen");
  expect(html).not.toContain("No token saved; the server uses GH_TOKEN");
});
it("retains default token guidance when no GitHub login is selected", () => {
  state.hosts = {};
  const html = renderToStaticMarkup(<SourceControlTokenSettings {...props} />);
  expect(html).toContain("No token saved; the server uses GH_TOKEN");
});
