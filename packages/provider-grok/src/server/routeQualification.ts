export const GROK_PAID_FALLBACK_REFUSAL = "Refused automatic paid fallback.";

/** Exit status is not a login verdict. Missing text stays unknown. */
export function grokCliAuthenticated(output: string): boolean | null {
  if (/you are logged in/i.test(output)) return true;
  if (/not authenticated|not logged in/i.test(output)) return false;
  return null;
}

export function selectGrokProviderRoute(input: {
  readonly cliAuthenticated: boolean | null;
  readonly apiKeyPresent: boolean;
}): {
  readonly auth: {
    readonly status: "authenticated" | "unauthenticated" | "unknown";
    readonly type?: "api_key" | "cached_token";
    readonly label?: string;
  };
  readonly useApiKey: boolean;
  readonly refusal?: string;
} {
  if (input.cliAuthenticated === null) {
    return {
      auth: { status: "unknown" },
      useApiKey: false,
      ...(input.apiKeyPresent ? { refusal: GROK_PAID_FALLBACK_REFUSAL } : {}),
    };
  }
  if (input.cliAuthenticated) {
    return {
      auth: { status: "authenticated", type: "cached_token", label: "Grok account" },
      useApiKey: false,
      ...(input.apiKeyPresent ? { refusal: GROK_PAID_FALLBACK_REFUSAL } : {}),
    };
  }
  if (input.apiKeyPresent) {
    return {
      auth: { status: "authenticated", type: "api_key", label: "xAI API key" },
      useApiKey: true,
    };
  }
  return { auth: { status: "unauthenticated" }, useApiKey: false };
}
