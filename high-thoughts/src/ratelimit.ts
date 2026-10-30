/**
 * Fixed-window per-key counter.
 *
 * Deliberately in-memory: this guards one process against one person holding
 * the button down, not against a distributed attacker. A restart resetting the
 * counters is fine. Expired windows are swept lazily on write so an idle
 * process does not hold a map of every IP that ever visited.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window rolls over. */
  retryAfter: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    this.sweep(now);

    const existing = this.windows.get(key);
    const window =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + this.windowMs };

    window.count += 1;
    this.windows.set(key, window);

    const retryAfter = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    return {
      allowed: window.count <= this.limit,
      remaining: Math.max(0, this.limit - window.count),
      retryAfter,
    };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}
