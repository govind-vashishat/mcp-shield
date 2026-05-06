export type SanitizeResult =
  | { ok: true; cleaned: unknown }
  | { ok: false; reason: string };

export class Sanitizer {
  constructor(
    private readonly enabled: boolean,
    private readonly patterns: RegExp[],
  ) {}

  scan(value: unknown): SanitizeResult {
    if (!this.enabled) return { ok: true, cleaned: value };
    try {
      const cleaned = this.walk(value);
      return { ok: true, cleaned };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  private walk(v: unknown): unknown {
    if (typeof v === "string") return this.cleanString(v);
    if (Array.isArray(v)) return v.map((x) => this.walk(x));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = this.walk(val);
      }
      return out;
    }
    return v;
  }

  private cleanString(s: string): string {
    for (const pat of this.patterns) {
      if (pat.test(s)) {
        throw new Error(`blocked pattern: ${pat.source}`);
      }
    }
    
    return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }
}
