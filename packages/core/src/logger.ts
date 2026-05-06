import { Database } from "bun:sqlite";
import pino, { type Logger as PinoLogger } from "pino";
import type { LogEntry } from "./types.ts";

export class ShieldLogger {
  private pino: PinoLogger;
  private db: Database | null = null;
  private insert: ReturnType<Database["prepare"]> | null = null;

  constructor(output: "stdout" | "file", path: string) {
    // Pino must NEVER write to stdout — that channel is reserved for MCP JSON-RPC
    // traffic flowing back to the client. Always log to stderr; "stdout" mode here
    // means "human-readable on stderr"; "file" mode adds SQLite persistence.
    this.pino = pino({ level: "info" }, pino.destination(2));
    if (output === "file") {
      this.db = new Database(path);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          identity TEXT NOT NULL,
          direction TEXT NOT NULL,
          method TEXT,
          tool_name TEXT,
          params_json TEXT,
          response_json TEXT,
          latency_ms INTEGER,
          status TEXT NOT NULL,
          reason TEXT,
          bytes_in INTEGER,
          bytes_out INTEGER,
          rpc_id TEXT
        );
        CREATE INDEX IF NOT EXISTS calls_ts_idx ON calls(ts);
        CREATE INDEX IF NOT EXISTS calls_identity_idx ON calls(identity);
      `);
      this.insert = this.db.prepare(`
        INSERT INTO calls (ts, identity, direction, method, tool_name, params_json,
          response_json, latency_ms, status, reason, bytes_in, bytes_out, rpc_id)
        VALUES ($ts, $identity, $direction, $method, $tool_name, $params_json,
          $response_json, $latency_ms, $status, $reason, $bytes_in, $bytes_out, $rpc_id)
      `);
    }
  }

  log(entry: LogEntry): void {
    this.pino.info(entry, "mcp-shield");
    if (this.insert) {
      this.insert.run({
        $ts: entry.ts,
        $identity: entry.identity,
        $direction: entry.direction,
        $method: entry.method ?? null,
        $tool_name: entry.toolName ?? null,
        $params_json: entry.paramsJson ?? null,
        $response_json: entry.responseJson ?? null,
        $latency_ms: entry.latencyMs ?? null,
        $status: entry.status,
        $reason: entry.reason ?? null,
        $bytes_in: entry.bytesIn ?? null,
        $bytes_out: entry.bytesOut ?? null,
        $rpc_id: entry.rpcId ?? null,
      });
    }
  }

  close(): void {
    this.db?.close();
  }
}
