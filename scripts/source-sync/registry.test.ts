import { describe, expect, it } from "vite-plus/test";

import {
  loadRegistry,
  RegistryValidationError,
  validateRegistry,
  type SourceRegistry,
} from "./registry.ts";

function withEntry(base: SourceRegistry, mutate: (entry: Record<string, unknown>) => void) {
  const entry = JSON.parse(JSON.stringify(base.sources[1])) as Record<string, unknown>;
  mutate(entry);
  const sources = JSON.parse(JSON.stringify(base.sources)) as Array<Record<string, unknown>>;
  return { ...base, sources: [sources[0]!, entry] };
}

describe("loadRegistry", () => {
  it("round-trips the committed registry", () => {
    const registry = loadRegistry();
    expect(registry.schemaVersion).toBe(1);
    expect(registry.summary.sourcesTotal).toBe(registry.sources.length);
    expect(registry.sources.length).toBe(41);
    const ids = registry.sources.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(registry.summary.admittedRecords).toBe(795);
  });
});

describe("validateRegistry", () => {
  it("accepts the committed registry unchanged", () => {
    const registry = loadRegistry();
    expect(validateRegistry(JSON.parse(JSON.stringify(registry))).sources.length).toBe(41);
  });

  it("rejects a duplicate id", () => {
    const registry = loadRegistry();
    const dupe = withEntry(registry, (entry) => {
      entry.id = registry.sources[0]!.id;
    });
    expect(() => validateRegistry(dupe)).toThrow(RegistryValidationError);
    try {
      validateRegistry(dupe);
    } catch (error) {
      expect((error as RegistryValidationError).code).toBe("duplicate-id");
    }
  });

  it("rejects an unknown adoption status", () => {
    const registry = loadRegistry();
    const bad = withEntry(registry, (entry) => {
      entry.adoptionStatus = "maybe";
    });
    expect(() => validateRegistry(bad)).toThrow(/adoptionStatus/);
  });

  it("rejects adopted without a pin", () => {
    const registry = loadRegistry();
    const bad = withEntry(registry, (entry) => {
      entry.adoptionStatus = "adopted";
      entry.pin = null;
    });
    expect(() => validateRegistry(bad)).toThrow(/pin/);
  });

  it("rejects a malformed sha where a pin is present", () => {
    const registry = loadRegistry();
    const bad = withEntry(registry, (entry) => {
      entry.pin = { kind: "sha", sha: "70ECCD48", source: "test" };
    });
    expect(() => validateRegistry(bad)).toThrow(/sha/);
  });

  it("rejects a missing or malformed lastReviewed date", () => {
    const registry = loadRegistry();
    const bad = withEntry(registry, (entry) => {
      entry.lastReviewed = "27/10/2026";
    });
    expect(() => validateRegistry(bad)).toThrow(/lastReviewed/);
    const missing = withEntry(registry, (entry) => {
      delete entry.lastReviewed;
    });
    expect(() => validateRegistry(missing)).toThrow(/lastReviewed/);
  });

  it("rejects a local pin on a non-first-party entry and an unknown schemaVersion", () => {
    const registry = loadRegistry();
    const localPin = withEntry(registry, (entry) => {
      entry.pin = { kind: "local", note: "no sha recorded" };
    });
    expect(() => validateRegistry(localPin)).toThrow(/firstParty/);
    expect(() => validateRegistry({ ...registry, schemaVersion: 2 })).toThrow(/schemaVersion/);
  });
});
