/**
 * Text generation for the ZCode driver. The ZCode Protocol exposes workspace/generateText,
 * but it requires a configured model provider (ModelConfigMissing otherwise) and the
 * machine this adapter was built on has none. Every operation fails closed with the
 * contract TextGenerationError instead of pretending the capability exists.
 */
import { TextGenerationError } from "@t3tools/contracts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import * as Effect from "effect/Effect";

const unavailable = (operation: string) =>
  new TextGenerationError({
    operation,
    detail:
      "ZCode text generation is unavailable in this build: the ZCode Protocol exposes no text-generation surface without a configured model provider on the host.",
  });

export const makeZcodeTextGeneration = (): ProviderTextGeneration => ({
  generateCommitMessage: () => Effect.fail(unavailable("generateCommitMessage")),
  generatePrContent: () => Effect.fail(unavailable("generatePrContent")),
  generateBranchName: () => Effect.fail(unavailable("generateBranchName")),
  generateThreadTitle: () => Effect.fail(unavailable("generateThreadTitle")),
  generateReviewGuide: () => Effect.fail(unavailable("generateReviewGuide")),
});
