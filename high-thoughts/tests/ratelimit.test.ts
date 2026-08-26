import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/ratelimit.js";

describe("RateLimiter", () => {
  it("allows up to the limit and then refuses", () => {
    const limiter = new RateLimiter(3, 60_000);
    const now = 1_000;

    expect(limiter.check("a", now).allowed).toBe(true);
    expect(limiter.check("a", now).allowed).toBe(true);
    expect(limiter.check("a", now).allowed).toBe(true);
    expect(limiter.check("a", now).allowed).toBe(false);
  });

  it("counts each key separately", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
  });

  it("resets once the window rolls over", () => {
    const limiter = new RateLimiter(1, 1_000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 500).allowed).toBe(false);
    expect(limiter.check("a", 1_001).allowed).toBe(true);
  });

  it("reports remaining and a retry-after inside the window", () => {
    const limiter = new RateLimiter(2, 10_000);
    expect(limiter.check("a", 0).remaining).toBe(1);
    const second = limiter.check("a", 4_000);
    expect(second.remaining).toBe(0);
    expect(second.retryAfter).toBe(6);
  });

  it("sweeps expired windows instead of growing forever", () => {
    const limiter = new RateLimiter(5, 1_000);
    for (let i = 0; i < 50; i += 1) limiter.check(`key-${i}`, 0);
    expect(limiter.size).toBe(50);

    limiter.check("later", 5_000);
    expect(limiter.size).toBe(1);
  });
});
