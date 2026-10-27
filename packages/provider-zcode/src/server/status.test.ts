// @effect-diagnostics nodeBuiltinImport:off -- Resolver tests stage real executable files in temp dirs, so node fs/path are required.
import { describe, expect, it } from "@effect/vitest";

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ZCodeSettings } from "../settings.ts";
import {
  buildInitialZcodeProviderSnapshot,
  checkZcodeProviderStatus,
  resolveZcodeCommandCandidates,
  resolveZcodeExecutable,
  ZCODE_APP_BUNDLE_CLI,
  zcodeCommandPlan,
  ZcodeCommandNotFoundError,
} from "./status.ts";

describe("zcodeCommandPlan composition (ZA-02)", () => {
  it("an explicit override stands alone", () => {
    expect(zcodeCommandPlan("/custom/zcode.cjs", "/home/u")).toEqual([
      { commandPath: "/custom/zcode.cjs", source: "explicit" },
    ]);
  });

  it("an empty setting composes PATH then the macOS app bundle", () => {
    expect(zcodeCommandPlan("", "/home/u")).toEqual([
      { commandPath: "zcode", source: "path" },
      { commandPath: ZCODE_APP_BUNDLE_CLI, source: "app-bundle" },
    ]);
  });

  it("the decoded default name composes the same fallback chain as a cleared value", () => {
    // The audited ZA-02 defect: makeBinaryPathSetting decodes both missing and empty to
    // "zcode", and the old candidates function treated that as an explicit override, so
    // the app-bundle fallback was unreachable through normal decoded settings.
    expect(zcodeCommandPlan("zcode", "/home/u")).toEqual([
      { commandPath: "zcode", source: "path" },
      { commandPath: ZCODE_APP_BUNDLE_CLI, source: "app-bundle" },
    ]);
  });

  it("keeps the documented candidates view for the decoded default", () => {
    expect(resolveZcodeCommandCandidates("zcode", "/home/u")).toEqual([
      "zcode",
      ZCODE_APP_BUNDLE_CLI,
    ]);
  });

  it("expands a tilde home prefix in explicit overrides", () => {
    expect(zcodeCommandPlan("~/bin/zcode", "/home/u")).toEqual([
      { commandPath: "/home/u/bin/zcode", source: "explicit" },
    ]);
  });
});

const executableFile = async (path: string) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(path, 0o755);
};

describe("resolveZcodeExecutable discovery (ZA-02)", () => {
  it("resolves the app bundle when PATH has no zcode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-resolve-"));
    try {
      const bundle = join(dir, "bundle", "zcode.cjs");
      await executableFile(bundle);
      const resolved = await Effect.runPromise(
        resolveZcodeExecutable("", { ...process.env, PATH: "" }, bundle),
      );
      expect(resolved.commandPath).toBe(bundle);
      expect(resolved.source).toBe("app-bundle");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is an honest error when PATH has no zcode and no bundle exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-resolve-"));
    try {
      const missingBundle = join(dir, "missing", "zcode.cjs");
      const notFound = await Effect.runPromise(
        Effect.flip(resolveZcodeExecutable("", { ...process.env, PATH: "" }, missingBundle)),
      );
      expect(notFound).toBeInstanceOf(ZcodeCommandNotFoundError);
      expect(notFound.message).toContain("zcode");
      expect(notFound.tried).toContain("zcode");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("an explicit override that cannot resolve errors instead of falling back silently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-resolve-"));
    try {
      // The bundle exists, but an explicit override never falls back to it.
      const bundle = join(dir, "bundle", "zcode.cjs");
      await executableFile(bundle);
      const notFound = await Effect.runPromise(
        Effect.flip(
          resolveZcodeExecutable("/nonexistent/zcode-binary", { ...process.env, PATH: "" }, bundle),
        ),
      );
      expect(notFound).toBeInstanceOf(ZcodeCommandNotFoundError);
      expect(notFound.message).toContain("/nonexistent/zcode-binary");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("expands a tilde override against the environment HOME", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcode-resolve-"));
    try {
      const homeBin = join(dir, "fakebin", "zcode");
      await executableFile(homeBin);
      const resolved = await Effect.runPromise(
        resolveZcodeExecutable(
          "~/fakebin/zcode",
          { ...process.env, HOME: dir },
          join(dir, "bundle", "zcode.cjs"),
        ),
      );
      expect(resolved.commandPath).toBe(homeBin);
      expect(resolved.source).toBe("explicit");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const decodeZcodeSettings = Schema.decodeSync(ZCodeSettings);

/** A spawner whose children always fail: the probe then reports not-installed honestly. */
const failingSpawnerLayer = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() =>
    Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain as never as Sink.Sink<void, Uint8Array>,
        stdout: Stream.encodeText(Stream.empty) as never as Stream.Stream<Uint8Array>,
        stderr: Stream.encodeText(Stream.empty) as never as Stream.Stream<Uint8Array>,
        all: Stream.encodeText(Stream.empty) as never as Stream.Stream<Uint8Array>,
        getInputFd: () => Sink.drain as never as Sink.Sink<void, Uint8Array>,
        getOutputFd: () => Stream.encodeText(Stream.empty) as never as Stream.Stream<Uint8Array>,
      }),
    ),
  ),
);

const statusLayer = Layer.mergeAll(
  failingSpawnerLayer,
  Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
);

describe("snapshot usage limits metadata (ZA-04)", () => {
  it("attaches the unsupported 5h/weekly metadata to the checked snapshot", async () => {
    const snapshot = await Effect.runPromise(
      checkZcodeProviderStatus(decodeZcodeSettings({ enabled: false }), process.env).pipe(
        Effect.provide(statusLayer),
      ),
    );
    expect(snapshot.usageLimits).toBeDefined();
    expect(snapshot.usageLimits?.unavailable?.reason).toBe("unsupported");
    expect(snapshot.usageLimits?.unavailable?.message).toContain("5-hour");
    expect(snapshot.usageLimits?.unavailable?.message).toContain("weekly");
    expect(snapshot.usageLimits?.windows).toEqual([]);
  });

  it("attaches the same honest metadata when the probe cannot find the CLI", async () => {
    const snapshot = await Effect.runPromise(
      checkZcodeProviderStatus(
        decodeZcodeSettings({ enabled: true, binaryPath: "/nonexistent/zcode-binary" }),
        { ...process.env, PATH: "" },
      ).pipe(Effect.provide(statusLayer)),
    );
    expect(snapshot.installed).toBe(false);
    expect(snapshot.usageLimits).toBeDefined();
    expect(snapshot.usageLimits?.unavailable?.reason).toBe("unsupported");
  });

  it("attaches the metadata to the initial snapshot too", async () => {
    const snapshot = await Effect.runPromise(
      buildInitialZcodeProviderSnapshot(decodeZcodeSettings({ enabled: false })).pipe(
        Effect.provide(statusLayer),
      ),
    );
    expect(snapshot.usageLimits).toBeDefined();
    expect(snapshot.usageLimits?.unavailable?.reason).toBe("unsupported");
  });
});
