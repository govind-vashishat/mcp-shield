export type AuthEntry = {
  key: string;
  identity: string;
};

export type ShieldConfig = {
  auth: {
    keys: AuthEntry[];
  };
  rateLimit?: {
    perKey?: number;
    global?: number;
    windowMs?: number;
  };
  logging?: {
    output?: "stdout" | "file";
    path?: string;
  };
  sanitization?: {
    enabled?: boolean;
    customPatterns?: string[];
  };
};

export type ResolvedConfig = {
  auth: { keys: AuthEntry[] };
  rateLimit: { perKey: number; global: number; windowMs: number };
  logging: { output: "stdout" | "file"; path: string };
  sanitization: { enabled: boolean; patterns: RegExp[] };
};

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export type LogEntry = {
  ts: number;
  identity: string;
  direction: "client→upstream" | "upstream→client";
  method?: string;
  toolName?: string;
  paramsJson?: string;
  responseJson?: string;
  latencyMs?: number;
  status: "ok" | "blocked_auth" | "blocked_ratelimit" | "blocked_sanitize" | "error";
  reason?: string;
  bytesIn?: number;
  bytesOut?: number;
  rpcId?: string;
};
