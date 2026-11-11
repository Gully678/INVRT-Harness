// @effect-diagnostics nodeBuiltinImport:off - disposable homes are real directories.
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

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
  const database = new NodeSqlite.DatabaseSync(filePath);
  database.exec(`
    CREATE TABLE projection_projects (project_id TEXT, title TEXT);
    CREATE TABLE projection_threads (thread_id TEXT, title TEXT);
    INSERT INTO projection_projects (project_id, title) VALUES ('p1', '${SECRET}');
    INSERT INTO projection_threads (thread_id, title) VALUES ('t1', '${SECRET}'), ('t2', 'visible-title');
  `);
  database.close();
};

describe("resolveInvrtStateDirectory", () => {
  it("expands home selections consistently", () => {
    assert.equal(
      resolveInvrtStateDirectory({ homeDirectory: "/tmp/example", explicitDirectory: "~" }),
      "/tmp/example",
    );
    assert.equal(
      resolveInvrtStateDirectory({
        homeDirectory: "/tmp/example",
        environment: { INVRT_CODE_HOME: "~/pilot" },
      }),
      "/tmp/example/pilot",
    );
    assert.equal(
      resolveInvrtStateDirectory({ homeDirectory: "/tmp/example", explicitDirectory: "~\\pilot" }),
      "/tmp/example/pilot",
    );
  });

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
      assert.equal(
        NodeFS.readFileSync(NodePath.join(current, "userdata/statev2.sqlite"), "utf8"),
        "invrt-db",
      );
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
  it("preserves the old destination if the importing process is killed while copying", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, { a: "new-a", b: "new-b" });
      writeTree(destination, { old: "original" });
      const child = NodeChildProcess.spawnSync(process.execPath, [
        "--input-type=module",
        "-e",
        `
        import { importLegacyState } from ${JSON.stringify(new URL("./invrtStateHome.ts", import.meta.url).href)};
        importLegacyState({ sourcePath: ${JSON.stringify(source)}, destinationPath: ${JSON.stringify(destination)}, replace: true, afterCopiedFile() { process.kill(process.pid, "SIGKILL"); } });
      `,
      ]);
      assert.equal(child.signal, "SIGKILL");
      const destinationId = NodeCrypto.createHash("sha256")
        .update(destination)
        .digest("hex")
        .slice(0, 24);
      const orphan = NodeFS.readdirSync(home.root).find((name) =>
        name.startsWith(`.invrt-import-stage-${destinationId}-`),
      );
      assert.isDefined(orphan);
      assert.equal(NodeFS.readFileSync(NodePath.join(home.root, orphan!, "a"), "utf8"), "new-a");
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "old"), "utf8"), "original");
      assert.equal(NodeFS.readFileSync(NodePath.join(source, "a"), "utf8"), "new-a");
    } finally {
      home.remove();
    }
  });

  it("recovers an interrupted publication before retrying", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, { new: "new" });
      writeTree(destination, { old: "old" });
      const child = NodeChildProcess.spawnSync(process.execPath, [
        "--input-type=module",
        "-e",
        `
        import { importLegacyState } from ${JSON.stringify(new URL("./invrtStateHome.ts", import.meta.url).href)};
        importLegacyState({ sourcePath: ${JSON.stringify(source)}, destinationPath: ${JSON.stringify(destination)}, replace: true, afterMovingDestination() { process.kill(process.pid, "SIGKILL"); } });
      `,
      ]);
      assert.equal(child.signal, "SIGKILL");
      assert.throws(
        () => importLegacyState({ sourcePath: source, destinationPath: destination }),
        /different state/,
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "old"), "utf8"), "old");
      importLegacyState({ sourcePath: source, destinationPath: destination, replace: true });
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "new"), "utf8"), "new");
      assert.equal(NodeFS.readFileSync(NodePath.join(source, "new"), "utf8"), "new");
    } finally {
      home.remove();
    }
  });

  it("verifies a published destination after a killed process", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, { new: "new" });
      writeTree(destination, { old: "old" });
      const child = NodeChildProcess.spawnSync(process.execPath, [
        "--input-type=module",
        "-e",
        `
        import { importLegacyState } from ${JSON.stringify(new URL("./invrtStateHome.ts", import.meta.url).href)};
        importLegacyState({ sourcePath: ${JSON.stringify(source)}, destinationPath: ${JSON.stringify(destination)}, replace: true, afterPublishingDestination() { process.kill(process.pid, "SIGKILL"); } });
      `,
      ]);
      assert.equal(child.signal, "SIGKILL");
      assert.isTrue(
        importLegacyState({ sourcePath: source, destinationPath: destination }).idempotent,
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "new"), "utf8"), "new");
    } finally {
      home.remove();
    }
  });

  it("refuses a special filesystem entry in the source", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      NodeFS.mkdirSync(source);
      const fifo = NodeChildProcess.spawnSync("mkfifo", [NodePath.join(source, "pipe")]);
      if (fifo.error && "code" in fifo.error && fifo.error.code === "ENOENT") return;
      assert.equal(fifo.status, 0);
      writeTree(destination, { old: "old" });
      assert.throws(
        () =>
          importLegacyState({ sourcePath: source, destinationPath: destination, replace: true }),
        /unsupported/i,
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "old"), "utf8"), "old");
    } finally {
      home.remove();
    }
  });

  it("refuses an incomplete journal and preserves its foreign contents", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, { new: "new" });
      writeTree(destination, { old: "old" });
      const id = NodeCrypto.createHash("sha256").update(destination).digest("hex").slice(0, 24);
      const journal = NodePath.join(home.root, `.invrt-import-${id}`);
      writeTree(journal, { foreign: "sentinel" });
      assert.throws(
        () =>
          importLegacyState({ sourcePath: source, destinationPath: destination, replace: true }),
        /manual recovery/,
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(journal, "foreign"), "utf8"), "sentinel");
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "old"), "utf8"), "old");
    } finally {
      home.remove();
    }
  });

  it("refuses recovery when a foreign file appears in the journal", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, { new: "new" });
      writeTree(destination, { old: "old" });
      const child = NodeChildProcess.spawnSync(process.execPath, [
        "--input-type=module",
        "-e",
        `
        import fs from "node:fs"; import path from "node:path";
        import { importLegacyState } from ${JSON.stringify(new URL("./invrtStateHome.ts", import.meta.url).href)};
        importLegacyState({ sourcePath: ${JSON.stringify(source)}, destinationPath: ${JSON.stringify(destination)}, replace: true, afterMovingDestination() {
          const journal = fs.readdirSync(${JSON.stringify(home.root)}).find(n => n.startsWith(".invrt-import-") && !n.startsWith(".invrt-import-stage-"));
          fs.writeFileSync(path.join(${JSON.stringify(home.root)}, journal, "foreign"), "sentinel");
          process.kill(process.pid, "SIGKILL");
        }});
      `,
      ]);
      assert.equal(child.signal, "SIGKILL");
      assert.throws(
        () =>
          importLegacyState({ sourcePath: source, destinationPath: destination, replace: true }),
        /foreign state/,
      );
      const journal = NodeFS.readdirSync(home.root).find(
        (name) => name.startsWith(".invrt-import-") && !name.startsWith(".invrt-import-stage-"),
      );
      assert.isDefined(journal);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(home.root, journal!, "foreign"), "utf8"),
        "sentinel",
      );
      assert.equal(
        NodeFS.readFileSync(NodePath.join(home.root, journal!, "backup", "old"), "utf8"),
        "old",
      );
    } finally {
      home.remove();
    }
  });

  it("refuses extra files added to the staged copy", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, { one: "one" });
      writeTree(destination, { old: "old" });
      assert.throws(
        () =>
          importLegacyState({
            sourcePath: source,
            destinationPath: destination,
            replace: true,
            afterCopiedFile: () => {
              const stage = NodeFS.readdirSync(home.root).find((name) =>
                name.startsWith(".invrt-import-stage-"),
              );
              assert.isDefined(stage);
              writeTree(NodePath.join(home.root, stage!), { foreign: "sentinel" });
            },
          }),
        /staged copy/,
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "old"), "utf8"), "old");
      const stage = NodeFS.readdirSync(home.root).find((name) =>
        name.startsWith(".invrt-import-stage-"),
      );
      assert.isDefined(stage);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(home.root, stage!, "foreign"), "utf8"),
        "sentinel",
      );
    } finally {
      home.remove();
    }
  });

  it("refuses changed source or destination without deleting either", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, { one: "one" });
      writeTree(destination, { old: "old" });
      assert.throws(
        () =>
          importLegacyState({
            sourcePath: source,
            destinationPath: destination,
            replace: true,
            afterCopiedFile: () => writeTree(source, { one: "changed" }),
          }),
        /Source changed/,
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "old"), "utf8"), "old");
      assert.throws(
        () =>
          importLegacyState({
            sourcePath: source,
            destinationPath: destination,
            replace: true,
            afterCopiedFile: () => writeTree(destination, { foreign: "sentinel" }),
          }),
        /Destination changed/,
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "foreign"), "utf8"), "sentinel");
      assert.equal(NodeFS.readFileSync(NodePath.join(source, "one"), "utf8"), "changed");
    } finally {
      home.remove();
    }
  });

  it("allows retry after a handled publication failure restores the destination", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, { new: "new" });
      writeTree(destination, { old: "old" });
      assert.throws(
        () =>
          importLegacyState({
            sourcePath: source,
            destinationPath: destination,
            replace: true,
            afterMovingDestination: () => {
              throw new Error("interrupted");
            },
          }),
        /interrupted/,
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "old"), "utf8"), "old");
      assert.isTrue(
        importLegacyState({ sourcePath: source, destinationPath: destination, replace: true })
          .verified,
      );
    } finally {
      home.remove();
    }
  });

  it("refuses concurrent publication without removing the active journal", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const destination = NodePath.join(home.root, "destination");
      writeTree(source, { new: "new" });
      writeTree(destination, { old: "old" });
      importLegacyState({
        sourcePath: source,
        destinationPath: destination,
        replace: true,
        afterMovingDestination: () => {
          assert.throws(
            () =>
              importLegacyState({
                sourcePath: source,
                destinationPath: destination,
                replace: true,
              }),
            /active/,
          );
        },
      });
      assert.equal(NodeFS.readFileSync(NodePath.join(destination, "new"), "utf8"), "new");
    } finally {
      home.remove();
    }
  });

  it("refuses paths that refer to the same physical directory", () => {
    const home = disposableHome();
    try {
      const source = NodePath.join(home.root, "source");
      const alias = NodePath.join(home.root, "alias");
      writeTree(source, { state: "source" });
      NodeFS.symlinkSync(source, alias);
      assert.throws(
        () => importLegacyState({ sourcePath: source, destinationPath: alias, replace: true }),
        /separate directories/,
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(source, "state"), "utf8"), "source");
      assert.throws(
        () =>
          importLegacyState({
            sourcePath: source,
            destinationPath: NodePath.join(alias, "nested"),
            replace: true,
          }),
        /separate directories/,
      );
    } finally {
      home.remove();
    }
  });

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
      assert.equal(
        NodeFS.readFileSync(NodePath.join(source, "userdata/credentials.json"), "utf8"),
        SECRET,
      );
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
        "userdata/settings.json": '{"ok":true}',
        "userdata/credentials.json": SECRET,
      });
      writeTree(destination, { "userdata/settings.json": '{"ok":false}' });
      const sourceCredential = sha256(NodePath.join(source, "userdata/credentials.json"));
      const refused = () => importLegacyState({ sourcePath: source, destinationPath: destination });
      assert.throws(refused, /different state/);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(destination, "userdata/settings.json"), "utf8"),
        '{"ok":false}',
      );
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
      assert.equal(
        NodeFS.statSync(NodePath.join(destination, "userdata/credentials.json")).size,
        SECRET.length,
      );
      assert.equal(sha256(NodePath.join(source, "userdata/credentials.json")), sourceCredential);

      const again = importLegacyState({ sourcePath: source, destinationPath: destination });
      assert.equal(again.idempotent, true);
      assert.equal(sha256(NodePath.join(source, "userdata/credentials.json")), sourceCredential);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(destination, "userdata/settings.json"), "utf8"),
        '{"ok":true}',
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
