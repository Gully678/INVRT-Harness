import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { TextGenerationPolicy } from "@t3tools/provider-core/server/textGenerationPolicy";

import {
  conventionalCommitsTextGenerationPolicy,
  customTextGenerationPolicy,
  repositoryConventionsTextGenerationPolicy,
} from "./TextGenerationPresets.ts";

const decodePolicy = Schema.decodeUnknownSync(TextGenerationPolicy);

describe("TextGenerationPresets", () => {
  it("exposes the shipped presets as valid policies with their inference switches", () => {
    expect(conventionalCommitsTextGenerationPolicy).toMatchObject({
      kind: "conventional_commits",
      inferRepositoryConventions: false,
    });
    expect(repositoryConventionsTextGenerationPolicy).toMatchObject({
      kind: "repo_conventions",
      inferRepositoryConventions: true,
    });
    expect(decodePolicy(conventionalCommitsTextGenerationPolicy)).toEqual(
      conventionalCommitsTextGenerationPolicy,
    );
    expect(decodePolicy(repositoryConventionsTextGenerationPolicy)).toEqual(
      repositoryConventionsTextGenerationPolicy,
    );
  });

  it("builds a custom policy that defaults conventions off and preserves given instructions", () => {
    const custom = customTextGenerationPolicy({
      commitInstructions: "Prefer concise subjects.",
      changeRequestInstructions: "Summarise the blast radius.",
    });
    expect(custom).toEqual({
      kind: "custom",
      inferRepositoryConventions: false,
      commitInstructions: "Prefer concise subjects.",
      changeRequestInstructions: "Summarise the blast radius.",
    });
    expect(decodePolicy(custom)).toEqual(custom);
    expect(customTextGenerationPolicy({})).toEqual({
      kind: "custom",
      inferRepositoryConventions: false,
    });
  });
});
