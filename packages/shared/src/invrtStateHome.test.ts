// @effect-diagnostics nodeBuiltinImport:off - disposable homes are real directories.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { DatabaseSync } from "node:sqlite";

import { assert, describe, it } from "@effect/vitest";

import {
  importLegacyState,
  previewLegacyState,
  resolveInvrtStateDirectory,
} from "./invrtStateHome.ts";

const SECRET = "secret-token-do-not-leak-7f3a";

const disposableHome = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "invrt-state-"));
  return {
    root,
    remove: () => NodeFS.rmSync(root, { recursive: true, force: true }),
  };
};

const sha256 = (filePath: string) =>
  NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(filePath)).digest("hex");

const writeTree = (root: string, files: Readonly<Record<string, string>>) => {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = NodePath.join(root, relativePath);
    NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
    NodeFS.writeFileSync(filePath, contents);
  }
};

const writeProjectDatabase = (filePath: string) => {
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  database.exec(`
    CREATE TABLE projection_projects (project_id TEXT, title TEXT);
    CREATE TABLE projection_threads (thread_id TEXT, title TEXT);
    INSERT INTO projection_projects (project_id, title) VALUES ('p1', '${SECRET}');
    INSERT INTO projection_threads (thread_id, title) VALUES ('t1', '${SECRET}'), ('t2', 'visible-title');
  `);
  database.close();
};

describe("resolveInvrtStateDirectory", () => {
  it("resolves a fresh home to <home>/.invrt-code", () => {
    const home = disposableHome();
    try {
      assert.equal(
        resolveInvrtStateDirectory({ homeDirectory: home.root }),
        NodePath.join(home.root, ".invrt-code"),
      );
      assert.isFalse(NodeFS.existsSync(NodePath.join(home.root, ".invrt-code")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(home.root, ".t3")));
    } finally {
      home.remove();
    }
  });

  it("selects INVRT_CODE_HOME after trim", () => {
    const home = disposableHome();
    try {
      const selected = NodePath.join(home.root, "custom");
      assert.equal(
        resolveInvrtStateDirectory({
          homeDirectory: NodePath.join(home.root, "unused"),
          environment: { INVRT_CODE_HOME: `  ${selected}  ` },
        }),
        NodePath.resolve(selected),
      );
    } finally {
      home.remove();
    }
  });

  it("does not read or write a T3CODE_HOME sentinel", () => {
    const home = disposableHome();
    try {
      const upstream = NodePath.join(home.root, "upstream");
      const sentinel = NodePath.join(upstream, "sentinel.txt");
      writeTree(upstream, { "sentinel.txt": "upstream-sentinel" });
      const before = sha256(sentinel);
      NodeFS.chmodSync(sentinel, 0o000);
      let resolved = "";
      try {
        resolved = resolveInvrtStateDirectory({
          homeDirectory: home.root,
          environment: { T3CODE_HOME: upstream, INVRT_CODE_HOME: "   " },
        });
      } finally {
        NodeFS.chmodSync(sentinel, 0o644);
      }
      assert.equal(resolved, NodePath.join(home.root, ".invrt-code"));
      assert.notEqual(resolved, upstream);
      assert.equal(sha256(sentinel), before);
      assert.equal(NodeFS.readFileSync(sentinel, "utf8"), "upstream-sentinel");
    } finally {
      home.remove();
    }
  });

  it("leaves a populated .t3 unchanged while resolving .invrt-code", () => {
    const home = disposableHome();
    try {
      const legacy = NodePath.join(home.root, ".t3");
      const current = NodePath.join(home.root, ".invrt-code");
      writeTree(legacy, { "userdata/statev2.sqlite": "legacy-db", "userdata/settings.json": "{}" });
      writeTree(current, { "userdata/statev2.sqlite": "invrt-db" });
      const legacyHash = sha256(NodePath.join(legacy, "userdata/statev2.sqlite"));
      const settingsHash = sha256(NodePath.join(legacy, "userdata/settings.json"));
      const resolved = resolveInvrtStateDirectory({
        homeDirectory: home.root,
        environment: { T3CODE_HOME: legacy },
      });
      assert.equal(resolved, current);
      assert.equal(sha256(NodePath.join(legacy, "userdata/statev2.sqlite")), legacyHash);
      assert.equal(sha256(NodePath.join(legacy, "userdata/settings.json")), settingsHash);
      assert.equal(NodeFS.readFileSync(NodePath.join(current, "userdata/statev2.sqlite"), "utf8"), "invrt-db");
    } finally {
      home.remove();
    }
  });

  it("lets an explicit directory and INVRT_CODE_HOME beat a worktree directory", () => {
    const home = disposableHome();
    try {
      const worktree = NodePath.join(home.root, "worktree");
      const explicit = NodePath.join(home.root, "explicit");
      const fromEnv = NodePath.join(home.root, "from-env");
      NodeFS.mkdirSync(worktree);
      assert.equal(
        resolveInvrtStateDirectory({
          homeDirectory: home.root,
          explicitDirectory: explicit,
          environment: { INVRT_CODE_HOME: fromEnv, T3CODE_HOME: NodePath.join(home.root, ".t3") },
          worktreeDirectory: worktree,
        }),
        NodePath.resolve(explicit),
      );
      assert.equal(
        resolveInvrtStateDirectory({
          homeDirectory: home.root,
          environment: { INVRT_CODE_HOME: fromEnv, T3CODE_HOME: NodePath.join(home.root, ".t3") },
          worktreeDirectory: worktree,
        }),
        NodePath.resolve(fromEnv),
      );
      assert.equal(
        resolveInvrtStateDirectory({
          homeDirectory: home.root,
          environment: { T3CODE_HOME: NodePath.join(home.root, ".t3") },
          worktreeDirectory: worktree,
        }),
        NodePath.join(worktree, ".invrt-code"),
      );
    } finally {
      home.remove();
    }
  });
});

describe("legacy state import", () => {
  it("previews counts and file names without copying secret contents into the message", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      writeProjectDatabase(NodePath.join(source, "userdata", "statev2.sqlite"));
      writeTree(source, { "userdata/credentials.json": SECRET });
      const preview = previewLegacyState(source);
      const rendered = JSON.stringify(preview);
      assert.equal(preview.projectCount, 1);
      assert.equal(preview.threadCount, 2);
      assert.include(preview.fileNames.join("\n"), "userdata/credentials.json");
      assert.include(preview.fileNames.join("\n"), "userdata/statev2.sqlite");
      assert.notInclude(rendered, SECRET);
      assert.equal(NodeFS.readFileSync(NodePath.join(source, "userdata/credentials.json"), "utf8"), SECRET);
    } finally {
      home.remove();
    }
  });

  it("copies only after backup, verifies hashes, and is idempotent", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, {
        "userdata/settings.json": "{\"ok\":true}",
        "userdata/credentials.json": SECRET,
      });
      writeTree(destination, { "userdata/settings.json": "{\"ok\":false}" });
      const sourceCredential = sha256(NodePath.join(source, "userdata/credentials.json"));
      const refused = () => importLegacyState({ sourcePath: source, destinationPath: destination });
      assert.throws(refused, /different state/);
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "userdata/settings.json"), "utf8"), "{\"ok\":false}");
      assert.equal(sha256(NodePath.join(source, "userdata/credentials.json")), sourceCredential);

      const copied = importLegacyState({
        sourcePath: source,
        destinationPath: destination,
        replace: true,
      });
      assert.equal(copied.verified, true);
      assert.notInclude(JSON.stringify(copied), SECRET);
      assert.equal(
        sha256(NodePath.join(destination, "userdata/credentials.json")),
        sourceCredential,
      );
      assert.equal(NodeFS.statSync(NodePath.join(destination, "userdata/credentials.json")).size, SECRET.length);
      assert.equal(sha256(NodePath.join(source, "userdata/credentials.json")), sourceCredential);

      const again = importLegacyState({ sourcePath: source, destinationPath: destination });
      assert.equal(again.idempotent, true);
      assert.equal(sha256(NodePath.join(source, "userdata/credentials.json")), sourceCredential);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(destination, "userdata/settings.json"), "utf8"),
        "{\"ok\":true}",
      );
    } finally {
      home.remove();
    }
  });

  it("rolls the destination back to the backup when a copy fails part way", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, {
        "userdata/one.txt": "one",
        "userdata/two.txt": "two",
      });
      writeTree(destination, { "userdata/keep.txt": "original-destination" });
      const sourceOne = sha256(NodePath.join(source, "userdata/one.txt"));
      assert.throws(
        () =>
          importLegacyState({
            sourcePath: source,
            destinationPath: destination,
            replace: true,
            afterCopiedFile: ({ copiedCount }) => {
              if (copiedCount >= 1) throw new Error("injected copy failure");
            },
          }),
        /injected copy failure/,
      );
      assert.equal(
        NodeFS.readFileSync(NodePath.join(destination, "userdata/keep.txt"), "utf8"),
        "original-destination",
      );
      assert.isFalse(NodeFS.existsSync(NodePath.join(destination, "userdata/one.txt")));
      assert.equal(sha256(NodePath.join(source, "userdata/one.txt")), sourceOne);
      assert.equal(NodeFS.readFileSync(NodePath.join(source, "userdata/two.txt"), "utf8"), "two");
    } finally {
      home.remove();
    }
  });
});
