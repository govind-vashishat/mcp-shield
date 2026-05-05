import type { AuthEntry } from "./types.ts";

export class Auth {
  private byKey: Map<string, string>;

  constructor(entries: AuthEntry[]) {
    this.byKey = new Map(entries.map((e) => [e.key, e.identity]));
  }

  identityFor(key: string | undefined): string | null {
    if (!key) return null;
    return this.byKey.get(key) ?? null;
  }
}
