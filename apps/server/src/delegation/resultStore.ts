// @effect-diagnostics nodeBuiltinImport:off - one JSON file per work order, written with fsync and rename.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { CommandId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { CommandReceiptStoreV2 } from "../orchestration-v2/CommandReceiptStore.ts";
import { CodeResultV1, REFUSALS, WORK_ORDER_COMMAND_TYPE, type WorkOrderV1 } from "./workOrder.ts";

export type ResultStoreRefusal = typeof REFUSALS.resultUnbound | typeof REFUSALS.storeUnavailable;
const unbound: ResultStoreRefusal = REFUSALS.resultUnbound;
const unavailable: ResultStoreRefusal = REFUSALS.storeUnavailable;

/**
 * Results are bound to the order CODE accepted: a result is written or returned only for
 * an order with an accepted receipt, and only when its ids are that order's. Anything else
 * refuses and leaves the store untouched.
 */
export interface ResultStore {
  readonly write: (
    order: WorkOrderV1,
    result: CodeResultV1,
  ) => Effect.Effect<void, ResultStoreRefusal, CommandReceiptStoreV2>;
  /**
   * Atomically takes the stored result away when `claimable` accepts it, so exactly one of many
   * concurrent callers gets `true` and the rest (and any later reader) see no result until the
   * winner records a new one. A result `claimable` rejects is left in place.
   */
  readonly claim: (
    order: WorkOrderV1,
    claimable: (result: CodeResultV1) => boolean,
  ) => Effect.Effect<boolean, ResultStoreRefusal, CommandReceiptStoreV2>;
  /** `null` when no result has been recorded for the order. */
  readonly read: (
    order: WorkOrderV1,
  ) => Effect.Effect<CodeResultV1 | null, ResultStoreRefusal, CommandReceiptStoreV2>;
}

const resultJson = Schema.fromJsonString(CodeResultV1);
const encodeResult = Schema.encodeEffect(resultJson);
const decodeResult = Schema.decodeUnknownOption(resultJson, { onExcessProperty: "error" });

const isBound = (order: WorkOrderV1, result: CodeResultV1): boolean =>
  result.work_order_id === order.work_order_id &&
  result.correlation_id === order.correlation_id &&
  result.project === order.project &&
  result.story_id === order.story_id;

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const requireAcceptedReceipt = Effect.fn("requireAcceptedReceipt")(function* (order: WorkOrderV1) {
  const receipts = yield* CommandReceiptStoreV2;
  const receipt = yield* receipts
    .getProjectByCommandId(CommandId.make(order.work_order_id))
    .pipe(Effect.mapError(() => unavailable));
  if (
    Option.isNone(receipt) ||
    receipt.value.status !== "accepted" ||
    receipt.value.commandType !== WORK_ORDER_COMMAND_TYPE ||
    receipt.value.projectId !== order.project
  ) {
    return yield* Effect.fail(unbound);
  }
});

/** The results directory must be a real directory of this user: a symbolic link would redirect writes. */
const requireRealDirectory = async (directory: string): Promise<void> => {
  const stat = await NodeFSP.lstat(directory).catch((error: unknown) => {
    if (isMissingFile(error)) return null;
    throw error;
  });
  if (stat === null) return;
  if (!stat.isDirectory() || (process.getuid !== undefined && stat.uid !== process.getuid())) {
    throw new Error("results directory is not a real directory owned by this user");
  }
};

/** Temp file, fsync, rename, fsync the directory: a reader sees the old file or the whole new one. */
const writeAtomically = (file: string, content: string) =>
  Effect.tryPromise({
    try: async () => {
      await requireRealDirectory(NodePath.dirname(file));
      await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.${NodeCrypto.randomUUID()}.tmp`;
      try {
        const handle = await NodeFSP.open(temp, "wx", 0o600);
        try {
          await handle.writeFile(content);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await NodeFSP.rename(temp, file);
      } catch (error) {
        await NodeFSP.rm(temp, { force: true });
        throw error;
      }
      const directory = await NodeFSP.open(NodePath.dirname(file), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    },
    catch: () => unavailable,
  });

const readIfPresent = (file: string) =>
  Effect.tryPromise({
    try: async () => {
      await requireRealDirectory(NodePath.dirname(file));
      try {
        return await NodeFSP.readFile(file, "utf8");
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
    catch: () => unavailable,
  });

/** One file per work order: `<directory>/<sha256(work_order_id)>.json`, mode 0600. */
export const makeFileResultStore = (directory: string): ResultStore => {
  const fileFor = (order: WorkOrderV1) =>
    NodePath.join(
      directory,
      `${NodeCrypto.createHash("sha256").update(order.work_order_id).digest("hex")}.json`,
    );
  return {
    write: Effect.fn("ResultStore.write")(function* (order, result) {
      yield* requireAcceptedReceipt(order);
      if (!isBound(order, result)) return yield* Effect.fail(unbound);
      const json = yield* encodeResult(result).pipe(Effect.mapError(() => unavailable));
      yield* writeAtomically(fileFor(order), `${json}\n`);
    }),
    claim: Effect.fn("ResultStore.claim")(function* (order, claimable) {
      yield* requireAcceptedReceipt(order);
      const file = fileFor(order);
      return yield* Effect.tryPromise({
        try: async () => {
          await requireRealDirectory(directory);
          // rename is atomic: of any number of racing callers exactly one moves the file.
          const taken = `${file}.${process.pid}.${NodeCrypto.randomUUID()}.claimed`;
          try {
            await NodeFSP.rename(file, taken);
          } catch (error) {
            if (isMissingFile(error)) return false;
            throw error;
          }
          // A result that is not claimable (a newer one was written since the caller read) goes
          // back, unless an even newer result already exists (link never overwrites).
          const putBack = () =>
            NodeFSP.link(taken, file)
              .catch((error: unknown) => {
                if (
                  !(
                    typeof error === "object" &&
                    error !== null &&
                    "code" in error &&
                    error.code === "EEXIST"
                  )
                )
                  throw error;
              })
              .then(() => NodeFSP.rm(taken, { force: true }));
          try {
            const decoded = decodeResult(await NodeFSP.readFile(taken, "utf8"));
            const mine =
              Option.isSome(decoded) && isBound(order, decoded.value) && claimable(decoded.value);
            if (!mine) {
              await putBack();
              return false;
            }
          } catch (error) {
            await putBack();
            throw error;
          }
          await NodeFSP.rm(taken, { force: true });
          return true;
        },
        catch: () => unavailable,
      });
    }),
    read: Effect.fn("ResultStore.read")(function* (order) {
      yield* requireAcceptedReceipt(order);
      const text = yield* readIfPresent(fileFor(order));
      if (text === null) return null;
      const stored = decodeResult(text);
      // A file that cannot be read back as a result is store damage, not a foreign result.
      if (Option.isNone(stored)) return yield* Effect.fail(unavailable);
      if (!isBound(order, stored.value)) return yield* Effect.fail(unbound);
      return stored.value;
    }),
  };
};
