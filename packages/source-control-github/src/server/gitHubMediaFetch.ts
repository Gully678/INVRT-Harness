import type { SourceControlMediaRequest } from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientError,
  type HttpClientResponse,
} from "effect/http";

import { GITHUB_CREDENTIALED_MEDIA_HOSTS } from "../shared/gitHubMedia.ts";

import * as GitHubCredentials from "./GitHubCredentials.ts";

/**
 * Everything a redirect leads to — the presigned object stores GitHub hands assets off to —
 * authorizes with its own signature, and some of them reject a request that also carries a
 * bearer token.
 */
const isCredentialedHost = (url: string) => {
  try {
    return GITHUB_CREDENTIALED_MEDIA_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
};

const MAX_REDIRECTS = 3;
const MANUAL_REDIRECT: RequestInit = { redirect: "manual" };

export const make = Effect.gen(function* () {
  const credentials = yield* GitHubCredentials.GitHubCredentials;
  const httpClient = HttpClient.withScope(yield* HttpClient.HttpClient);

  // Both media hosts are served by github.com's account, which is the host `gh` stores it under.
  // Read on every fetch, so media loads as soon as the user signs in.
  const token = Effect.suspend(() => credentials.get("github.com")).pipe(
    Effect.map((credential) => credential.token),
    Effect.catchIf(
      (error) =>
        error._tag !== "ServerSettingsError" &&
        !("account" in error && error.account !== undefined),
      () => Effect.succeed(null),
    ),
  );

  return Effect.fn("GitHubMediaFetch.fetchMedia")(function* (request: SourceControlMediaRequest) {
    const bearer = yield* token.pipe(
      Effect.mapError(
        (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request: HttpClientRequest.get(request.url),
              cause,
              description:
                cause._tag === "ServerSettingsError"
                  ? "Could not read GitHub account settings. Requests are blocked until settings are available."
                  : cause.message,
            }),
          }),
      ),
    );
    let target = request.url;
    for (let hop = 0; ; hop += 1) {
      const authorization =
        bearer !== null && isCredentialedHost(target) ? `Bearer ${Redacted.value(bearer)}` : null;
      const response: HttpClientResponse.HttpClientResponse = yield* httpClient
        .execute(
          HttpClientRequest.get(target).pipe(
            HttpClientRequest.setHeaders({
              ...request.headers,
              // The bytes are streamed straight through, so never let an encoding layer in.
              "accept-encoding": "identity",
              ...(authorization === null ? {} : { authorization }),
            }),
          ),
        )
        .pipe(Effect.provideService(FetchHttpClient.RequestInit, MANUAL_REDIRECT));
      const location = response.headers.location;
      if (response.status < 300 || response.status >= 400) return response;
      if (!location || hop >= MAX_REDIRECTS) return null;
      const next = new URL(location, target);
      if (next.protocol !== "https:") return null;
      target = next.toString();
    }
  });
});
