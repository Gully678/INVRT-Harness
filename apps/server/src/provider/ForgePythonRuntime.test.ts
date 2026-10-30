import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { observationSchema, matchesObservation } from "./ForgePythonRuntime.ts";

const evidence =
  "/Users/mac/My Drive/Claude/Projects/INVRT-CODE/research/2026-10-30/CODEX-CONTINUE/forge-f1";
const observations = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const current = observationSchema.parse(
    JSON.parse(yield* fs.readFileString(`${evidence}/PROBE03-stdout.txt`)),
  );
  const baseline = observationSchema.parse(
    JSON.parse(yield* fs.readFileString(`${evidence}/ORIGIN-PROBE-stdout.txt`)),
  );
  return { current, baseline };
});
it.layer(NodeServices.layer)(
  "FORGE exact observed runtime contract, no process execution",
  (it) => {
    it.effect("accepts the exact reviewed parser metadata", () =>
      Effect.gen(function* () {
        const { current, baseline } = yield* observations;
        expect(matchesObservation(current, current, baseline)).toBe(true);
        expect(current.modules).toHaveLength(81);
        expect(current.actual_opened_stdlib_files).toHaveLength(35);
      }),
    );
    it.effect("permits only the second exact argparse record under the same identities", () =>
      Effect.gen(function* () {
        const { current, baseline } = yield* observations;
        const changed = structuredClone(current);
        const index = changed.actual_exec_code.findIndex((code) =>
          code.filename.endsWith("/argparse.py"),
        );
        const prior = baseline.actual_exec_code.find((code) =>
          code.filename.endsWith("/argparse.py"),
        )!;
        changed.actual_exec_code[index] = prior;
        expect(matchesObservation(changed, current, baseline)).toBe(true);
        changed.actual_exec_code[index] = { ...prior, sha256: "0".repeat(64) };
        expect(matchesObservation(changed, current, baseline)).toBe(false);
        changed.actual_exec_code[index] = { ...prior, caller: "unreviewed" };
        expect(matchesObservation(changed, current, baseline)).toBe(false);
      }),
    );
    it.effect.each(["module", "cache", "frozen", "cwd"] as const)(
      "refuses changed %s rather than widening the observed contract",
      (kind) =>
        Effect.gen(function* () {
          const { current, baseline } = yield* observations;
          const changed = structuredClone(current);
          if (kind === "module")
            changed.modules.push({ ...changed.modules[0]!, name: "unreviewed" });
          if (kind === "cache") changed.actual_opened_stdlib_files[0]!.sha256 = "0".repeat(64);
          if (kind === "frozen")
            changed.modules.find(
              (module) => module.origin === "frozen",
            )!.frozen_registry_code_sha256 = "0".repeat(64);
          if (kind === "cwd") changed.cwd = "/unreviewed";
          expect(matchesObservation(changed, current, baseline)).toBe(false);
        }),
    );
  },
);
