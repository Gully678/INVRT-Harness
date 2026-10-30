import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ChildProcessSpawner } from "effect/process";

import { DEFAULT_SERVER_SETTINGS, ServerSettingsError } from "@t3tools/contracts";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as GitHubRest from "./GitHubRest.ts";
import * as GitHubMediaFetch from "./gitHubMediaFetch.ts";
import * as GitHubQuota from "./GitHubQuota.ts";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/http";

const TOKEN_VARIABLES = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
] as const;

const hostSettings = (
  hosts: Record<string, { readonly account?: string; readonly enabled?: boolean }>,
) =>
  Object.fromEntries(
    Object.entries(hosts).map(([host, choice]) => [host, { enabled: true, ...choice }]),
  );

function harness(
  hosts: Record<string, { readonly account?: string; readonly enabled?: boolean }> = {},
  signedOut: ReadonlyArray<string> = [],
  tokens: Record<string, string> = {},
  settingsUnavailable = false,
) {
  const calls: Array<ReadonlyArray<string>> = [];
  const environments: Array<NodeJS.ProcessEnv | undefined> = [];
  const run: SourceControlHost.SourceControlHost["Service"]["process"]["run"] = (input) =>
    Effect.sync(() => {
      calls.push(input.args);
      environments.push(input.env);
      const user = input.args[input.args.indexOf("--user") + 1];
      if (input.args.includes("--user") && user !== undefined && signedOut.includes(user)) {
        return {
          exitCode: ChildProcessSpawner.ExitCode(0),
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      }
      return {
        exitCode: ChildProcessSpawner.ExitCode(0),
        stdout: input.args.includes("--user") ? `token-for-${user}\n` : "active-token\n",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    });
  const testHost = TestSourceControlHost.layer({
    settings: applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      sourceControlHosts: { github: { hosts: hostSettings(hosts), tokens } },
    }),
    process: { run },
  });
  const hostLayer = settingsUnavailable
    ? Layer.effect(
        SourceControlHost.SourceControlHost,
        Effect.gen(function* () {
          const host = yield* SourceControlHost.SourceControlHost;
          return {
            ...host,
            settings: {
              get: Effect.fail(
                new ServerSettingsError({
                  settingsPath: "/fixture/settings",
                  operation: "read-file",
                }),
              ),
            },
          };
        }),
      ).pipe(Layer.provideMerge(testHost))
    : testHost;
  const layer = GitHubCredentials.layer.pipe(
    Layer.provideMerge(hostLayer),
    Layer.provide(NodeCrypto.layer),
  );
  return { layer, calls, environments };
}

beforeEach(() => {
  for (const name of TOKEN_VARIABLES) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("GitHubCredentials", () => {
  it.effect("uses the explicit account without environment-token overrides", () => {
    vi.stubEnv("GH_TOKEN", "from-env");
    const { layer, calls, environments } = harness({ "github.com": { account: "work" } });
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      const credential = yield* credentials.get("github.com");
      expect(Redacted.value(credential.token)).toBe("token-for-work");
      expect(credential.source).toBe("gh");
      expect(calls).toEqual([["auth", "token", "--hostname", "github.com", "--user", "work"]]);
      for (const name of TOKEN_VARIABLES) expect(environments[0]?.[name]).toBe("");
    }).pipe(Effect.provide(layer));
  });

  it.effect("picks up a changed account on the next request without a restart", () => {
    const { layer, calls } = harness();
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      const settings = yield* TestSourceControlHost.TestSourceControlHostSettings;
      expect(Redacted.value((yield* credentials.get("github.com")).token)).toBe("active-token");

      yield* settings.update({
        sourceControlHosts: {
          github: { hosts: { "github.com": { account: "work", enabled: true } } },
        },
      });
      expect(Redacted.value((yield* credentials.get("github.com")).token)).toBe("token-for-work");

      yield* settings.update({
        sourceControlHosts: { github: { hosts: { "github.com": { enabled: false } } } },
      });
      expect((yield* Effect.flip(credentials.get("github.com")))._tag).toBe(
        "GitHubHostDisabledError",
      );

      yield* settings.update({ sourceControlHosts: { github: { hosts: {} } } });
      expect(Redacted.value((yield* credentials.get("github.com")).token)).toBe("active-token");
      expect(calls).toHaveLength(2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails closed when the pinned login is unavailable", () => {
    const { layer, calls } = harness({ "github.com": { account: "gone" } }, ["gone"]);
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      const error = yield* Effect.flip(credentials.get("github.com"));
      expect(error).toMatchObject({ _tag: "GitHubNotSignedInError", account: "gone" });
      expect(calls).toEqual([["auth", "token", "--hostname", "github.com", "--user", "gone"]]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("uses a token saved in Settings before GH_TOKEN and gh", () => {
    vi.stubEnv("GH_TOKEN", "env-token");
    const { layer, calls } = harness({}, [], { "github.com": "saved-token" });
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      const credential = yield* credentials.get("github.com");
      expect(Redacted.value(credential.token)).toBe("saved-token");
      expect(credential.source).toBe("settings");
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps a host turned off even with a token saved in Settings", () => {
    const { layer } = harness({ "github.com": { enabled: false } }, [], {
      "github.com": "saved-token",
    });
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      expect((yield* Effect.flip(credentials.get("github.com")))._tag).toBe(
        "GitHubHostDisabledError",
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("never hands a token to a host that is not a plain hostname", () => {
    vi.stubEnv("GH_TOKEN", "env-token");
    const { layer, calls } = harness();
    return Effect.gen(function* () {
      const credentials = yield* GitHubCredentials.GitHubCredentials;
      for (const host of ["evil.com#.ghe.com", "evil.com/.ghe.com", "user@x.ghe.com"]) {
        expect(GitHubCredentials.environmentToken(host, { GH_TOKEN: "env-token" })).toBeNull();
        expect((yield* Effect.flip(credentials.get(host)))._tag).toBe("GitHubNotSignedInError");
      }
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(layer));
  });
});

it.effect(
  "repository HTTP requests reject malformed hosts before forwarding any credential",
  () => {
    vi.stubEnv("GH_TOKEN", "fixture-env-token");
    const malformedHosts = ["evil.com#.ghe.com", "evil.com/.ghe.com", "user@x.ghe.com"];
    const { layer, calls } = harness(
      {},
      [],
      Object.fromEntries(malformedHosts.map((host) => [host, "fixture-saved-token"])),
    );
    const requests: Array<HttpClientRequest.HttpClientRequest> = [];
    const http = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        requests.push(request);
        return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ id: 1 })));
      }),
    );
    const restLayer = GitHubRest.layer.pipe(
      Layer.provide(Layer.mergeAll(layer, http)),
      Layer.provideMerge(GitHubQuota.layer),
      Layer.provideMerge(SourceControlRateLimit.layer),
    );
    return Effect.gen(function* () {
      const rest = yield* GitHubRest.GitHubRest;
      for (const host of malformedHosts) {
        const failure = yield* Effect.flip(
          rest.rest({ host, operation: "repository lookup", path: "/repos/team/project" }),
        );
        expect(failure._tag).toBe("GitHubNotSignedInError");
      }
      expect(requests).toEqual([]);
      expect(calls).toEqual([]);
      expect(
        (yield* rest.rest({
          host: " GitHub.COM ",
          operation: "repository lookup",
          path: "/repos/team/project",
        })).status,
      ).toBe(200);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://api.github.com/repos/team/project");
      expect(requests[0]?.headers.authorization).toBe("Bearer fixture-env-token");
    }).pipe(Effect.provide(restLayer));
  },
);

function transportHarness(input: Parameters<typeof harness>) {
  const held = harness(...input);
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request);
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ id: 1 })));
    }),
  );
  const layer = GitHubRest.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(held.layer, http)),
    Layer.provideMerge(GitHubQuota.layer),
    Layer.provideMerge(SourceControlRateLimit.layer),
  );
  return { ...held, layer, requests };
}
const post = (rest: GitHubRest.GitHubRest["Service"], host = "github.com") =>
  rest.rest({
    host,
    operation: "createPullRequest",
    method: "POST",
    path: "/repos/team/project/pulls",
    body: { title: "Fixture" },
  });
it.effect(
  "never POSTs with saved, environment, active or anonymous identity when a pin is missing",
  () => {
    vi.stubEnv("GH_TOKEN", "fixture-global-token");
    const held = transportHarness([
      { "github.com": { account: "gone" } },
      ["gone"],
      { "github.com": "fixture-saved-token" },
    ]);
    return Effect.gen(function* () {
      const rest = yield* GitHubRest.GitHubRest;
      const error = yield* Effect.flip(post(rest));
      expect(error).toMatchObject({ _tag: "GitHubNotSignedInError", account: "gone" });
      const fetchMedia = yield* GitHubMediaFetch.make;
      expect(
        (yield* Effect.result(
          fetchMedia({
            url: "https://raw.githubusercontent.com/team/project/main/image.png",
            headers: {},
          }),
        ))._tag,
      ).toBe("Failure");
      expect(held.requests).toEqual([]);
      expect(held.calls).toEqual([["auth", "token", "--hostname", "github.com", "--user", "gone"]]);
    }).pipe(Effect.provide(held.layer), Effect.scoped);
  },
);
it.effect("POSTs only the selected login token, isolating CLI token environment", () => {
  for (const name of TOKEN_VARIABLES) vi.stubEnv(name, "fixture-global-token");
  const held = transportHarness([
    { "github.com": { account: "work" } },
    [],
    { "github.com": "fixture-saved-token" },
  ]);
  return Effect.gen(function* () {
    const rest = yield* GitHubRest.GitHubRest;
    expect((yield* post(rest)).status).toBe(200);
    expect(held.requests[0]?.headers.authorization).toBe("Bearer token-for-work");
    expect(held.calls).toEqual([["auth", "token", "--hostname", "github.com", "--user", "work"]]);
    for (const name of TOKEN_VARIABLES) expect(held.environments[0]?.[name]).toBe("");
  }).pipe(Effect.provide(held.layer));
});
it.effect("preserves unselected active-login POST behaviour", () => {
  const held = transportHarness([]);
  return Effect.gen(function* () {
    const rest = yield* GitHubRest.GitHubRest;
    expect((yield* post(rest)).status).toBe(200);
    expect(held.requests[0]?.headers.authorization).toBe("Bearer active-token");
    expect(held.calls).toEqual([["auth", "token", "--hostname", "github.com"]]);
  }).pipe(Effect.provide(held.layer));
});
it.effect("rejects settings-read failure instead of assuming a default credential", () => {
  vi.stubEnv("GH_TOKEN", "fixture-global-token");
  const held = transportHarness([{}, [], {}, true]);
  return Effect.gen(function* () {
    const rest = yield* GitHubRest.GitHubRest;
    const error = yield* Effect.flip(post(rest));
    expect(error._tag).toBe("ServerSettingsError");
    expect(held.requests).toEqual([]);
    expect(held.calls).toEqual([]);
  }).pipe(Effect.provide(held.layer));
});
it.effect("preserves native IPv6 authorities and rejects malformed authorities before HTTP", () => {
  const valid = ["ghe.corp:8443", "ghe.corp:443", "[::1]", "[::1]:8443", "[2001:db8:0:0::1]:443"];
  const invalid = [
    "https://evil.test",
    "user@evil.test",
    "@evil.test",
    "evil.test/path",
    "evil.test?",
    "evil.test#",
    "evil.test\\path",
    "evil.test:65536",
    "evil.test:",
    "evil.test:-1",
    "evil.test:abc",
    "evil.test\n",
    "[::1]:65536",
    "[::1]extra",
  ];
  const held = transportHarness([
    {},
    [],
    Object.fromEntries(
      [...valid, ...invalid].map((host) => [host.trim().toLowerCase(), "fixture-host-token"]),
    ),
  ]);
  return Effect.gen(function* () {
    const rest = yield* GitHubRest.GitHubRest;
    for (const host of invalid)
      expect((yield* Effect.result(post(rest, host)))._tag, host).toBe("Failure");
    expect(held.requests).toEqual([]);
    expect(held.calls).toEqual([]);
    for (const host of valid) {
      expect((yield* post(rest, host)).status).toBe(200);
      const request = held.requests.at(-1);
      expect(new URL(request!.url).toString()).toBe(
        new URL(`https://${host}/api/v3/repos/team/project/pulls`).toString(),
      );
      expect(request?.headers.authorization).toBe("Bearer fixture-host-token");
    }
  }).pipe(Effect.provide(held.layer));
});

it.effect("preserves the complete selected account in its cache key", () => {
  const account = "work\u0000other";
  const held = transportHarness([{ "github.com": { account } }, [account]]);
  return Effect.gen(function* () {
    const rest = yield* GitHubRest.GitHubRest;
    const error = yield* Effect.flip(post(rest));
    expect(error).toMatchObject({ _tag: "GitHubNotSignedInError", account });
    expect(held.requests).toEqual([]);
    expect(held.calls).toEqual([["auth", "token", "--hostname", "github.com", "--user", account]]);
  }).pipe(Effect.provide(held.layer));
});

it.effect.each(["settings", "env"] as const)(
  "preserves unselected %s-token POST behaviour",
  (source) => {
    vi.stubEnv("GH_TOKEN", "fixture-env-token");
    const held = transportHarness([
      {},
      [],
      source === "settings" ? { "github.com": "fixture-saved-token" } : {},
    ]);
    return Effect.gen(function* () {
      const rest = yield* GitHubRest.GitHubRest;
      yield* post(rest);
      expect(held.requests[0]?.headers.authorization).toBe(
        `Bearer fixture-${source === "settings" ? "saved" : "env"}-token`,
      );
      expect(held.calls).toEqual([]);
    }).pipe(Effect.provide(held.layer));
  },
);
