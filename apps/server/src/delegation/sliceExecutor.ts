// @effect-diagnostics nodeBuiltinImport:off - the fixture executor drives the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import * as Effect from "effect/Effect";

import { ExecutorFailed, type WorkOrderExecutor } from "./workOrder.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export const SLICE_EXECUTOR_MODEL = "slice-fixture-executor";
// The fixture performs this one change; any other request is refused rather than faked.
const SLICE_REQUEST_TEXT =
  "In src/limits.py rename DEFAULT_TIMEOUT to DEFAULT_TIMEOUT_SECONDS and update its one caller.";
const FIXED_DATE = "2026-11-14T09:00:00Z";
const LIMITS_FILE = "src/limits.py";
const SEED = "DEFAULT_TIMEOUT = 30\n\n\ndef default_timeout():\n    return DEFAULT_TIMEOUT\n";

/** The same seed always yields the same commits: fixed identity, dates, config and file bytes. */
const git = async (cwd: string, args: ReadonlyArray<string>): Promise<string> => {
  const { stdout } = await execFile(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.autocrlf=false",
      "-c",
      "user.name=INVRT CODE Slice Fixture",
      "-c",
      "user.email=slice-fixture@invrt.invalid",
      ...args,
    ],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_DATE: FIXED_DATE,
        GIT_COMMITTER_DATE: FIXED_DATE,
      },
    },
  );
  return stdout.trim();
};

/**
 * Fixture executor for the slice: a scratch git repository per work order under
 * `directory`, seeded with `src/limits.py`, renamed and committed locally.
 */
export const makeSliceExecutor = (directory: string): WorkOrderExecutor => ({
  model: SLICE_EXECUTOR_MODEL,
  run: (order) =>
    Effect.tryPromise({
      try: async () => {
        if (order.request_text !== SLICE_REQUEST_TEXT) {
          throw new Error("the fixture executor only performs the slice request");
        }
        const repo = NodePath.join(
          directory,
          NodeCrypto.createHash("sha256").update(order.work_order_id).digest("hex"),
        );
        await NodeFSP.mkdir(NodePath.join(repo, "src"), { recursive: true });
        await git(repo, ["init", "--quiet", "--initial-branch=main"]);
        await NodeFSP.writeFile(NodePath.join(repo, LIMITS_FILE), SEED);
        await git(repo, ["add", LIMITS_FILE]);
        await git(repo, ["commit", "--quiet", "--message", "Seed src/limits.py"]);
        const base = await git(repo, ["rev-parse", "HEAD"]);
        await NodeFSP.writeFile(
          NodePath.join(repo, LIMITS_FILE),
          SEED.replaceAll("DEFAULT_TIMEOUT", "DEFAULT_TIMEOUT_SECONDS"),
        );
        await git(repo, [
          "commit",
          "--quiet",
          "--all",
          "--message",
          "Rename DEFAULT_TIMEOUT to DEFAULT_TIMEOUT_SECONDS",
        ]);
        return { base, head: await git(repo, ["rev-parse", "HEAD"]) };
      },
      catch: (cause) => {
        const reason = cause instanceof Error ? cause.message : String(cause);
        process.stderr.write(`slice-fixture-executor failed: ${reason}\n`);
        return new ExecutorFailed({ reason });
      },
    }),
});
