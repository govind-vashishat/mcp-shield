import type { ShieldConfig } from "./packages/core/src/types.ts";

const config: ShieldConfig = {
  auth: {
    keys: [
      { key: "key_dev_local", identity: "local-dev" },
    ],
  },
  rateLimit: {
    perKey: 100,
    global: 500,
    windowMs: 60_000,
  },
  logging: {
    output: "file",
    path: "./mcp-shield.sqlite",
  },
  sanitization: {
    enabled: true,
    customPatterns: ["rm -rf", "DROP TABLE"],
  },
};

export default config;
