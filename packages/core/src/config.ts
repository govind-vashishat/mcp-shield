import { resolve } from "node:path";
import type { ResolvedConfig, ShieldConfig } from "./types.ts";

export async function loadConfig(configPath: string): Promise<ResolvedConfig> {
  const abs = resolve(process.cwd(), configPath);
  const mod = await import(abs);
  const raw = (mod.default ?? mod) as ShieldConfig;
  return resolveDefaults(raw);
}

export function resolveDefaults(raw: ShieldConfig): ResolvedConfig {
  if (!raw?.auth?.keys?.length) {
    throw new Error("mcp-shield config: auth.keys must contain at least one entry");
  }

  const customPatterns = raw.sanitization?.customPatterns ?? [];
  const builtInInjectionPatterns = [
    /ignore (?:all |the )?previous instructions/i,
    /you are now/i,
    /disregard (?:all |the )?(?:above|prior|previous)/i,
    /system prompt/i,
  ];

  return {
    auth: { keys: raw.auth.keys },
    rateLimit: {
      perKey: raw.rateLimit?.perKey ?? 100,
      global: raw.rateLimit?.global ?? 500,
      windowMs: raw.rateLimit?.windowMs ?? 60_000,
    },
    logging: {
      output: raw.logging?.output ?? "stdout",
      path: raw.logging?.path ?? "./mcp-shield.sqlite",
    },
    sanitization: {
      enabled: raw.sanitization?.enabled ?? true,
      patterns: [
        ...builtInInjectionPatterns,
        ...customPatterns.map((p) => new RegExp(escapeRegex(p), "i")),
      ],
    },
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
