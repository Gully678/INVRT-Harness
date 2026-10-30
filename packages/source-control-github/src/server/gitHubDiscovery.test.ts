import * as Option from "effect/Option";
import { DEFAULT_SERVER_SETTINGS, SourceControlProviderKind } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as GitHubRest from "./GitHubRest.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

const unknownContext = (baseUrl: string) => ({
  provider: { kind: SourceControlProviderKind.make("unknown"), name: "Unknown", baseUrl },
  remoteName: "origin",
  remoteUrl: "git@code.example.test:team/project.git",
});

// The default host dies on any command, so refinement never reaches `gh`.
const makeDiscovery = (credential: GitHubRest.GitHubRest["Service"]["credential"]) =>
  GitHubSourceControlProvider.makeDiscovery.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(GitHubRest.GitHubRest)({ credential }),
        TestSourceControlHost.layer(),
      ),
    ),
    Effect.provideService(HostProcess.Environment, {}),
  );

it.effect.each([
  { name: "a credential", credential: "found", claimed: true },
  { name: "a host turned off in Settings", credential: "disabled", claimed: true },
  { name: "no credential", credential: "missing", claimed: false },
  {
    name: "an unavailable explicitly selected login",
    credential: "selected-missing",
    claimed: true,
  },
] as const)("claims a custom-host remote with $name", (scenario) =>
  Effect.gen(function* () {
    const hosts: Array<string> = [];
    const discovery = yield* makeDiscovery((host) => {
      hosts.push(host);
      return scenario.credential === "found"
        ? Effect.succeed({ token: Redacted.make("token"), fingerprint: `${host}:fingerprint` })
        : scenario.credential === "disabled"
          ? Effect.fail(new GitHubCredentials.GitHubHostDisabledError({ host }))
          : Effect.fail(
              new GitHubCredentials.GitHubNotSignedInError({
                host,
                ...(scenario.credential === "selected-missing" ? { account: "gone" } : {}),
              }),
            );
    });
    if (discovery.type !== "managed-cli") return assert.fail("expected a managed CLI");
    const provider = yield* discovery.refineUnknownRemote({
      cwd: "/repo",
      context: unknownContext("https://code.example.test"),
    });
    assert.deepStrictEqual(
      provider,
      scenario.claimed
        ? {
            kind: SourceControlProviderKind.make("github"),
            name: "GitHub Self-Hosted",
            baseUrl: "https://code.example.test",
          }
        : null,
    );
    assert.deepStrictEqual(hosts, ["code.example.test"]);
  }),
);

it.effect("asks for no credential when the identity resolver left the base URL empty", () =>
  Effect.gen(function* () {
    const hosts: Array<string> = [];
    const discovery = yield* makeDiscovery((host) => {
      hosts.push(host);
      return Effect.succeed({ token: Redacted.make("token"), fingerprint: `${host}:fingerprint` });
    });
    if (discovery.type !== "managed-cli") return assert.fail("expected a managed CLI");
    assert.strictEqual(
      yield* discovery.refineUnknownRemote({ cwd: "/repo", context: unknownContext("") }),
      null,
    );
    assert.deepStrictEqual(hosts, []);
  }),
);

it.effect(
  "keeps managed discovery on the selected login despite saved and environment tokens",
  () => {
    const environments: Array<NodeJS.ProcessEnv | undefined> = [];
    const calls: string[] = [];
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      sourceControlHosts: {
        github: {
          hosts: { "github.com": { account: "work", enabled: true } },
          tokens: { "github.com": "fixture-saved-token" },
        },
      },
    };
    return Effect.gen(function* () {
      const held = yield* GitHubSourceControlProvider.makeDiscovery;
      if (held.type !== "managed-cli") return assert.fail("expected a managed CLI");
      const result = yield* held.probe("/fixture");
      assert.deepStrictEqual(result.auth.account, Option.some("work"));
      assert.deepStrictEqual(calls, []);
      assert.isTrue(environments.length > 0);
      for (const env of environments)
        for (const key of [
          "GH_TOKEN",
          "GITHUB_TOKEN",
          "GH_ENTERPRISE_TOKEN",
          "GITHUB_ENTERPRISE_TOKEN",
        ])
          assert.strictEqual(env?.[key], "");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(GitHubRest.GitHubRest)({
            rest: () => {
              calls.push("user");
              return Effect.succeed({
                body: JSON.stringify({ login: "bot" }),
                status: 200,
                headers: {},
                truncated: false,
                invalidUtf8: false,
              });
            },
          }),
          TestSourceControlHost.layer({
            settings,
            process: {
              run: (input) => {
                environments.push(input.env);
                return Effect.succeed(
                  TestSourceControlHost.processOutput(
                    input.args.includes("--version")
                      ? "gh version fixture"
                      : JSON.stringify({
                          hosts: {
                            "github.com": [
                              {
                                state: "success",
                                active: true,
                                host: "github.com",
                                login: "personal",
                              },
                              {
                                state: "success",
                                active: false,
                                host: "github.com",
                                login: "work",
                              },
                            ],
                          },
                        }),
                  ),
                );
              },
            },
          }),
        ),
      ),
      Effect.provideService(HostProcess.Environment, { GH_TOKEN: "fixture-global-token" }),
    );
  },
);
