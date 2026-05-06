import { Auth } from "./auth.ts";
import { RateLimiter } from "./ratelimit.ts";
import { Sanitizer } from "./sanitize.ts";
import { ShieldLogger } from "./logger.ts";
import type {
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  ResolvedConfig,
} from "./types.ts";

export type ProxyOptions = {
  config: ResolvedConfig;
  upstreamCmd: string[];
  /**
   * Stdio MCP has no headers, so the key is read once at proxy launch (typically
   * from MCP_SHIELD_KEY in the MCP client config) and bound to the whole session.
   */
  sessionKey: string | undefined;
};

export async function runProxy(opts: ProxyOptions): Promise<number> {
  const { config, upstreamCmd, sessionKey } = opts;

  const auth = new Auth(config.auth.keys);
  const identity = auth.identityFor(sessionKey);
  const logger = new ShieldLogger(config.logging.output, config.logging.path);

  if (!identity) {
    logger.log({
      ts: Date.now(),
      identity: "<unknown>",
      direction: "client→upstream",
      status: "blocked_auth",
      reason: "missing or invalid MCP_SHIELD_KEY",
    });
    process.stderr.write(
      "mcp-shield: missing or invalid MCP_SHIELD_KEY env var; refusing to start upstream\n",
    );
    logger.close();
    return 2;
  }

  const limiter = new RateLimiter(
    config.rateLimit.perKey,
    config.rateLimit.global,
    config.rateLimit.windowMs,
  );
  const sanitizer = new Sanitizer(config.sanitization.enabled, config.sanitization.patterns);

  const [cmd, ...args] = upstreamCmd;
  if (!cmd) throw new Error("mcp-shield: missing upstream command");

  const child = Bun.spawn([cmd, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  const pendingStarts = new Map<string, { ts: number; method: string; toolName?: string }>();

  const writeToClient = (msg: unknown) => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  const writeToUpstream = (msg: unknown) => {
    child.stdin.write(JSON.stringify(msg) + "\n");
  };

  const sendError = (id: JsonRpcId, code: number, message: string) => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message },
    };
    writeToClient(resp);
  };

  // client → upstream
  const clientPump = (async () => {
    for await (const line of readLines(Bun.stdin.stream())) {
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line) as JsonRpcMessage;
      } catch {
        continue;
      }

      const isRequest = "method" in msg && "id" in msg;
      const isNotification = "method" in msg && !("id" in msg);
      const method = (msg as JsonRpcRequest).method;
      const rpcId = "id" in msg && msg.id != null ? String(msg.id) : undefined;

      // Only gate tool invocations through rate-limit and sanitize. initialize,
      // tools/list etc. pass through so the handshake works.
      if (isRequest && method === "tools/call") {
        const rl = limiter.check(identity);
        if (!rl.allowed) {
          logger.log({
            ts: Date.now(),
            identity,
            direction: "client→upstream",
            method,
            status: "blocked_ratelimit",
            reason: `${rl.scope} limit; retry in ${rl.retryAfterMs}ms`,
            rpcId,
          });
          sendError((msg as JsonRpcRequest).id, -32000, `rate limit exceeded (${rl.scope})`);
          continue;
        }

        const params = (msg as JsonRpcRequest).params as
          | { name?: string; arguments?: unknown }
          | undefined;
        const toolName = params?.name;
        const sr = sanitizer.scan(params?.arguments);
        if (!sr.ok) {
          logger.log({
            ts: Date.now(),
            identity,
            direction: "client→upstream",
            method,
            toolName,
            status: "blocked_sanitize",
            reason: sr.reason,
            rpcId,
          });
          sendError((msg as JsonRpcRequest).id, -32001, `input blocked by sanitizer: ${sr.reason}`);
          continue;
        }
        (msg as JsonRpcRequest).params = { ...(params ?? {}), arguments: sr.cleaned };

        if (rpcId !== undefined) {
          pendingStarts.set(rpcId, { ts: Date.now(), method, toolName });
        }
      } else if (isRequest && rpcId !== undefined) {
        pendingStarts.set(rpcId, { ts: Date.now(), method });
      }

      const out = JSON.stringify(msg);
      logger.log({
        ts: Date.now(),
        identity,
        direction: "client→upstream",
        method: isRequest || isNotification ? method : undefined,
        toolName:
          method === "tools/call"
            ? ((msg as JsonRpcRequest).params as { name?: string } | undefined)?.name
            : undefined,
        paramsJson:
          isRequest || isNotification ? safeStringify((msg as JsonRpcRequest).params) : undefined,
        status: "ok",
        bytesIn: out.length,
        rpcId,
      });
      writeToUpstream(msg);
    }
    try {
      child.stdin.end();
    } catch {}
  })();

  // upstream → client
  const upstreamPump = (async () => {
    for await (const line of readLines(child.stdout)) {
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line) as JsonRpcMessage;
      } catch {
        continue;
      }

      const rpcId = "id" in msg && msg.id != null ? String(msg.id) : undefined;
      const start = rpcId !== undefined ? pendingStarts.get(rpcId) : undefined;
      if (rpcId !== undefined) pendingStarts.delete(rpcId);

      const out = JSON.stringify(msg);
      logger.log({
        ts: Date.now(),
        identity,
        direction: "upstream→client",
        method: start?.method,
        toolName: start?.toolName,
        responseJson: safeStringify(
          (msg as JsonRpcResponse).result ?? (msg as JsonRpcResponse).error,
        ),
        latencyMs: start ? Date.now() - start.ts : undefined,
        status: (msg as JsonRpcResponse).error ? "error" : "ok",
        bytesOut: out.length,
        rpcId,
      });
      writeToClient(msg);
    }
  })();

  const exitCode = await child.exited;
  await Promise.allSettled([clientPump, upstreamPump]);
  logger.close();
  return exitCode;
}

async function* readLines(source: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield line;
      }
    }
    const tail = buf.trim();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function safeStringify(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  try {
    return JSON.stringify(v);
  } catch {
    return undefined;
  }
}
