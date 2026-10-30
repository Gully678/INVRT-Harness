import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import { readSourceControlHostSettings } from "@t3tools/source-control-core/shared/definition";
import type { ServerSettings, ServerSettingsError } from "@t3tools/contracts";

import * as GitHubClient from "../shared/definition.ts";

/**
 * Every gh run on the server shares this. A burst of them (a status poll across many checkouts)
 * otherwise starts enough at once to trip GitHub's secondary rate limit.
 */
export const GH_PROCESS_CONCURRENCY = { key: "gh", limit: 4 } as const;

const TOKEN_TTL = Duration.minutes(5);
const MISSING_TTL = Duration.seconds(10);

export const GitHubCredentialSource = Schema.Literals(["settings", "env", "gh"]);
export type GitHubCredentialSource = typeof GitHubCredentialSource.Type;

export interface GitHubCredential {
  readonly host: string;
  readonly token: Redacted.Redacted<string>;
  readonly source: GitHubCredentialSource;
  readonly fingerprint: string;
}

export class GitHubCliMissingError extends Schema.TaggedError<GitHubCliMissingError>()(
  "GitHubCliMissingError",
  { host: Schema.String },
) {
  override get message(): string {
    return `No GitHub credential for ${this.host}: set GH_TOKEN, or install the GitHub CLI and run \`gh auth login\`.`;
  }
}

export class GitHubNotSignedInError extends Schema.TaggedError<GitHubNotSignedInError>()(
  "GitHubNotSignedInError",
  { host: Schema.String, account: Schema.optional(Schema.String) },
) {
  override get message(): string {
    return this.account === undefined
      ? `No GitHub credential for ${this.host}: run \`gh auth login --hostname ${this.host}\`.`
      : `The selected GitHub login ${this.account} on ${this.host} could not provide a credential. Sign in to it or explicitly choose another login in Settings → Source Control.`;
  }
}

export class GitHubHostDisabledError extends Schema.TaggedError<GitHubHostDisabledError>()(
  "GitHubHostDisabledError",
  { host: Schema.String, account: Schema.optional(Schema.String) },
) {
  override get message(): string {
    return `GitHub host ${this.host} is turned off in Settings → Source Control.`;
  }
}

export class GitHubCliFailedError extends Schema.TaggedError<GitHubCliFailedError>()(
  "GitHubCliFailedError",
  { host: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The GitHub CLI could not hand over a credential for ${this.host}. Check \`gh auth status\` on the server.`;
  }
}

/** Per-child overrides; a selected CLI login must not inherit an unrelated token. */
export const GITHUB_CLI_WITHOUT_ENVIRONMENT_TOKENS = {
  GH_TOKEN: "",
  GITHUB_TOKEN: "",
  GH_ENTERPRISE_TOKEN: "",
  GITHUB_ENTERPRISE_TOKEN: "",
} as const;

export type GitHubCredentialUnavailableError =
  | GitHubCliMissingError
  | GitHubNotSignedInError
  | GitHubHostDisabledError
  | GitHubCliFailedError
  | ServerSettingsError;

export class GitHubCredentials extends Context.Service<
  GitHubCredentials,
  {
    readonly get: (
      host: string,
    ) => Effect.Effect<GitHubCredential, GitHubCredentialUnavailableError>;
    readonly invalidate: (host: string) => Effect.Effect<void>;
  }
>()("@t3tools/source-control-github/server/GitHubCredentials") {}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

const HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/;

/** API URLs are built from the host text, so anything but a bare hostname could redirect a token. */
export function isGitHubHost(host: string): boolean {
  // URL parsing normalises controls, userinfo and default ports; reject their original shape first.
  if (/[\u0000-\u001f\u007f]/u.test(host)) return false;
  const value = normalizeHost(host);
  const url = URL.parse(`https://${value}`);
  if (
    url === null ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    return false;
  const end = value.startsWith("[")
    ? value.indexOf("]") + 1
    : value.indexOf(":") === -1
      ? value.length
      : value.indexOf(":");
  const hostname = value.slice(0, end);
  const port = value.slice(end);
  if (port !== "" && (port[0] !== ":" || !/^\d+$/u.test(port.slice(1)))) return false;
  // The native parser validates IPv6 and port ranges; retain the existing DNS-label contract.
  return hostname.startsWith("[")
    ? URL.parse(`https://${hostname}`)?.hostname === url.hostname
    : HOSTNAME.test(hostname) && hostname === url.hostname;
}

function isGitHubDotCom(host: string): boolean {
  return host === "github.com" || host.endsWith(".ghe.com");
}

/** Restrict GH_ENTERPRISE_TOKEN to GH_HOST to prevent remote URLs from leaking it. */
export function environmentToken(
  host: string,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  if (!isGitHubHost(host)) return null;
  const names = isGitHubDotCom(host)
    ? ["GH_TOKEN", "GITHUB_TOKEN"]
    : env.GH_HOST?.trim().toLowerCase() === host
      ? ["GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]
      : [];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

/** @public */
export const make = Effect.gen(function* () {
  const sourceControlHost = yield* SourceControlHost.SourceControlHost;
  const process = sourceControlHost.process;
  const crypto = yield* Crypto.Crypto;
  const environment = yield* HostProcess.Environment;
  const workingDirectory = yield* HostProcess.WorkingDirectory;

  const fingerprintOf = (host: string, token: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(token)).pipe(
      Effect.map((digest) => `${host}:${Hex.encode(digest)}`),
      Effect.orDie,
    );

  const fromGh = (host: string, account: string | undefined) =>
    process
      .run({
        operation: "GitHubCredentials.get",
        command: "gh",
        args: [
          "auth",
          "token",
          "--hostname",
          host,
          ...(account === undefined ? [] : ["--user", account]),
        ],
        cwd: workingDirectory,
        // Never let gh print the token into a debug log.
        env: {
          GH_DEBUG: "",
          GH_PROMPT_DISABLED: "1",
          ...(account === undefined ? {} : GITHUB_CLI_WITHOUT_ENVIRONMENT_TOKENS),
        },
        timeoutMs: 10_000,
        concurrency: GH_PROCESS_CONCURRENCY,
      })
      .pipe(
        Effect.mapError((error) =>
          error._tag === "VcsProcessSpawnError" &&
          error.cause instanceof PlatformError.PlatformError &&
          error.cause.reason._tag === "NotFound"
            ? new GitHubCliMissingError({ host })
            : // gh exits non-zero with "no oauth token" when it has no login for the host.
              error._tag === "VcsProcessExitError"
              ? new GitHubNotSignedInError({ host, ...(account === undefined ? {} : { account }) })
              : new GitHubCliFailedError({ host, cause: error }),
        ),
        Effect.map((output) => output.stdout.trim()),
        Effect.filterOrFail(
          (token) => token !== "",
          () => new GitHubNotSignedInError({ host, ...(account === undefined ? {} : { account }) }),
        ),
      );

  const readSettings = (settings: ServerSettings) =>
    readSourceControlHostSettings(
      GitHubClient.settings,
      settings.sourceControlHosts[GitHubClient.definition.kind],
    );

  const cacheKey = (host: string, account: string | undefined) =>
    account === undefined ? host : `${host}\u0000${account}`;

  const lookup = Effect.fn("GitHubCredentials.lookup")(function* (key: string) {
    const separator = key.indexOf("\u0000");
    const host = separator === -1 ? key : key.slice(0, separator);
    const choice = separator === -1 ? undefined : key.slice(separator + 1);
    const fromEnv = choice === undefined ? environmentToken(host, environment) : null;
    const token =
      fromEnv ??
      (yield* fromGh(host, choice).pipe(
        Effect.mapError((error) =>
          choice === undefined ? error : new GitHubNotSignedInError({ host, account: choice }),
        ),
      ));
    return {
      host,
      token: Redacted.make(token),
      source: fromEnv !== null ? "env" : "gh",
      fingerprint: yield* fingerprintOf(host, token),
    } satisfies GitHubCredential;
  });

  const cache = yield* Cache.makeWith(lookup, {
    capacity: 32,
    timeToLive: (exit) =>
      Exit.isSuccess(exit)
        ? TOKEN_TTL
        : Exit.findErrorOption(exit).pipe(
              Option.exists((error) => error._tag === "GitHubCliFailedError"),
            )
          ? Duration.zero
          : MISSING_TTL,
  });

  return GitHubCredentials.of({
    get: Effect.fn("GitHubCredentials.get")(function* (rawHost) {
      const host = normalizeHost(rawHost);
      if (!isGitHubHost(rawHost)) return yield* new GitHubNotSignedInError({ host });
      const settings = readSettings(yield* sourceControlHost.settings.get);
      const choice = settings.hosts[host];
      if (choice?.enabled === false) {
        return yield* new GitHubHostDisabledError({
          host,
          ...(choice.account === undefined ? {} : { account: choice.account }),
        });
      }
      if (choice?.account !== undefined)
        return yield* Cache.get(cache, cacheKey(host, choice.account));
      const saved = settings.tokens[host]?.trim() || null;
      if (saved !== null) {
        return {
          host,
          token: Redacted.make(saved),
          source: "settings",
          fingerprint: yield* fingerprintOf(host, saved),
        } satisfies GitHubCredential;
      }
      return yield* Cache.get(cache, cacheKey(host, choice?.account));
    }),
    invalidate: Effect.fn("GitHubCredentials.invalidate")(function* (rawHost) {
      const host = normalizeHost(rawHost);
      // Clear every identity for this host without reading possibly unavailable account settings.
      for (const key of yield* Cache.keys(cache)) {
        if (key === host || key.startsWith(`${host}\u0000`)) yield* Cache.invalidate(cache, key);
      }
    }),
  });
});

export const layer = Layer.effect(GitHubCredentials, make);
