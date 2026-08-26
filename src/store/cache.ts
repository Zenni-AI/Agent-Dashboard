import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

/**
 * A plain on-disk JSON cache.
 *
 * The Data API gives 10,000 quota units per project per day and a single
 * channel sweep can burn several hundred. Re-running `litix run` while tuning
 * the monetization assumptions should not cost quota, so every network read is
 * cached by request key and only revalidated once the TTL lapses.
 */
export class DiskCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs: number,
    private readonly enabled = true,
  ) {}

  static fromHours(dir: string, ttlHours: number, enabled = true): DiskCache {
    return new DiskCache(dir, ttlHours * 3_600_000, enabled);
  }

  private keyPath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
    return path.join(this.dir, `${hash}.json`);
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    try {
      const raw = await readFile(this.keyPath(key), "utf8");
      const entry = JSON.parse(raw) as { storedAt: number; value: T };
      if (Date.now() - entry.storedAt > this.ttlMs) return null;
      return entry.value;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.enabled) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const payload = JSON.stringify({ storedAt: Date.now(), value });
      await writeFile(this.keyPath(key), payload, "utf8");
    } catch {
      // A cache write failure must never break a run.
    }
  }

  /** Read-through helper: return the cached value or produce and store one. */
  async wrap<T>(key: string, produce: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await produce();
    await this.set(key, value);
    return value;
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}
