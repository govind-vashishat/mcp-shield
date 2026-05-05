export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; scope: "perKey" | "global"; retryAfterMs: number };

export class RateLimiter {
  private perKey = new Map<string, number[]>();
  private globalHits: number[] = [];

  constructor(
    private readonly perKeyLimit: number,
    private readonly globalLimit: number,
    private readonly windowMs: number,
  ) {}

  check(identity: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;

    this.globalHits = pruneInPlace(this.globalHits, cutoff);
    if (this.globalHits.length >= this.globalLimit) {
      const oldest = this.globalHits[0] ?? now;
      return { allowed: false, scope: "global", retryAfterMs: oldest + this.windowMs - now };
    }

    const arr = pruneInPlace(this.perKey.get(identity) ?? [], cutoff);
    this.perKey.set(identity, arr);
    if (arr.length >= this.perKeyLimit) {
      const oldest = arr[0] ?? now;
      return { allowed: false, scope: "perKey", retryAfterMs: oldest + this.windowMs - now };
    }

    arr.push(now);
    this.globalHits.push(now);
    return { allowed: true };
  }
}

function pruneInPlace(arr: number[], cutoff: number): number[] {
  let i = 0;
  while (i < arr.length && arr[i]! < cutoff) i++;
  return i === 0 ? arr : arr.slice(i);
}
