// @effect-diagnostics globalTimers:off -- Request timeouts and dispose grace use plain timers inside the raw stdio client.
// @effect-diagnostics nodeBuiltinImport:off -- The protocol client is a plain node wrapper around the ZCode CLI process; effect/process cannot answer server-to-client requests inside raw stream callbacks.
/**
 * Client for the ZCode Protocol stdio app-server (`zcode.cjs app-server`).
 *
 * Framing (verified against ZCode CLI 0.16.5, see oneday-evidence/ZCODE-PROTOCOL-NOTES.md):
 * newline-delimited JSON. Client requests are `{id, method, params}` with no `jsonrpc`
 * key. Replies are `{id, result}` or `{id, error: {code, message, data?}}`. The server
 * also sends requests to the client (ids issued by the server) which must be answered,
 * and notifications such as `session/event` which carry no id.
 */
import { spawn, type ChildProcess } from "node:child_process";

import type { ZcodeProtocolErrorShape, ZcodeSessionEventNotification } from "./protocolTypes.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DISPOSE_GRACE_MS = 2_000;

export class ZcodeProtocolError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(error: ZcodeProtocolErrorShape) {
    super(error.message);
    this.name = "ZcodeProtocolError";
    this.code = error.code;
    this.data = error.data;
  }
}

export class ZcodeProtocolClosedError extends Error {
  constructor(detail: string) {
    super(`ZCode app-server closed: ${detail}`);
    this.name = "ZcodeProtocolClosedError";
  }
}

export interface ZcodeClientRequestHandlers {
  /**
   * Answers the server's session/requestRuntimePreferences handshake, which session/create
   * and session/resume block on (timeout -32022 when unanswered).
   */
  readonly requestRuntimePreferences?: () => {
    readonly nativeSearchEnhancementsEnabled: boolean;
    readonly memoryEnabled: boolean;
    readonly askUserQuestionAutoResolutionEnabled: boolean;
    readonly modelContextBudgetStrategy: "legacy" | "preflight-v1";
  };
  /** Replies -32601 to any other server request; the safe fail-closed default. */
  readonly onUnhandledServerRequest?: (method: string, params: unknown) => unknown;
}

export interface ZcodeClientOptions {
  readonly command: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly handlers?: ZcodeClientRequestHandlers | undefined;
  readonly onNotification?: ((method: string, params: unknown) => void) | undefined;
  readonly onExit?: ((code: number | null) => void) | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly spawn?: typeof spawn | undefined;
}

interface PendingRequest {
  resolve: (value: {
    result?: unknown;
    error?: ZcodeProtocolErrorShape | ZcodeProtocolClosedError;
  }) => void;
  timer: NodeJS.Timeout;
}

export interface ZcodeProtocolClient {
  /** Resolves with the method result or rejects with ZcodeProtocolError/ClosedError. */
  request(method: string, params?: unknown): Promise<unknown>;
  readonly closed: boolean;
  dispose(): Promise<void>;
  /** Test seam: the child PID, undefined after exit. */
  readonly pid: number | undefined;
}

export function startZcodeProtocolClient(options: ZcodeClientOptions): ZcodeProtocolClient {
  const spawnFn = options.spawn ?? spawn;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const commandHead = options.command[0];
  if (commandHead === undefined)
    throw new Error("ZCode app-server command requires a binary path.");
  const child: ChildProcess = spawnFn(commandHead, options.command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let disposed = false;
  let closed = false;
  let closeDetail: string | null = null;
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();
  const waiters: (() => void)[] = [];

  const settleClosed = (detail: string) => {
    if (closed) return;
    closed = true;
    closeDetail = detail;
    // Pending and new requests reject with the same closed error for a deterministic contract.
    const closedError = new ZcodeProtocolClosedError(detail);
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ error: closedError });
    }
    pending.clear();
    for (const wake of waiters) wake();
    waiters.length = 0;
    options.onExit?.(child.exitCode);
  };

  child.on("error", (cause) => settleClosed(`spawn failed: ${String(cause)}`));
  child.on("exit", (code) => settleClosed(`exited with code ${String(code)}`));

  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line.length === 0) continue;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        // A malformed frame must not kill the connection; skip it.
        continue;
      }
      handleFrame(frame);
    }
  });

  const handleFrame = (frame: unknown) => {
    if (frame === null || typeof frame !== "object") return;
    const record = frame as Record<string, unknown>;
    const id = record.id;
    // Server request: has an id and a method. Must be answered or the server aborts.
    if (typeof id === "number" && typeof record.method === "string") {
      answerServerRequest(id, record.method, record.params);
      return;
    }
    if (typeof id === "string" && typeof record.method === "string") {
      // The server numbers its own requests; string ids are treated the same way.
      const numeric = Number(id);
      if (Number.isInteger(numeric)) answerServerRequest(numeric, record.method, record.params);
      return;
    }
    // Reply to one of our requests.
    if (typeof id === "number" && (record.result !== undefined || record.error !== undefined)) {
      const entry = pending.get(id);
      if (entry === undefined) return;
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.resolve(
        record.error === undefined
          ? { result: record.result }
          : { result: record.result, error: record.error as ZcodeProtocolErrorShape },
      );
      return;
    }
    // Notification.
    if (id === undefined && typeof record.method === "string") {
      if (record.method === "session/event") {
        options.onNotification?.(
          record.method,
          record.params as ZcodeSessionEventNotification | undefined,
        );
      } else {
        options.onNotification?.(record.method, record.params);
      }
    }
  };

  const write = (frame: Record<string, unknown>): void => {
    child.stdin?.write(`${JSON.stringify(frame)}\n`);
  };

  const answerServerRequest = (id: number, method: string, params: unknown) => {
    if (
      method === "session/requestRuntimePreferences" &&
      options.handlers?.requestRuntimePreferences
    ) {
      write({ id, result: options.handlers.requestRuntimePreferences() });
      return;
    }
    const unhandled = options.handlers?.onUnhandledServerRequest?.(method, params);
    if (unhandled !== undefined) {
      write({ id, result: unhandled });
      return;
    }
    write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  };

  return {
    request(method: string, params?: unknown): Promise<unknown> {
      if (closed) {
        return Promise.reject(new ZcodeProtocolClosedError(closeDetail ?? "closed"));
      }
      const id = nextId++;
      const frame: Record<string, unknown> = { id, method };
      if (params !== undefined) frame.params = params;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ZcodeProtocolError({ code: -32000, message: `Request timed out: ${method}` }));
        }, timeoutMs);
        pending.set(id, {
          resolve: (reply) => {
            if (reply.error === undefined) resolve(reply.result);
            else if (reply.error instanceof ZcodeProtocolClosedError) reject(reply.error);
            else reject(new ZcodeProtocolError(reply.error));
          },
          timer,
        });
        write(frame);
      });
    },
    get closed() {
      return closed;
    },
    get pid() {
      return disposed || child.pid === undefined ? undefined : child.pid;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (!closed) {
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const finish = () => resolve();
          child.once("exit", finish);
          setTimeout(() => {
            child.removeListener("exit", finish);
            if (!closed && child.pid !== undefined) child.kill("SIGKILL");
            resolve();
          }, DISPOSE_GRACE_MS);
        });
      }
    },
  };
}

/** Convenience: the standard app-server command for a ZCode CLI script path. */
export const appServerCommand = (binaryPath: string): readonly string[] => [
  binaryPath,
  "app-server",
];
