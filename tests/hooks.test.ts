import { describe, expect, it } from "vitest";
import { actionableHooks, analyseHooks, underperformingHooks } from "../src/analysis/hooks.js";
import { video } from "./helpers.js";

/** Half the catalogue uses a numbered-list title and performs `multiplier` times better. */
function catalogue(multiplier: number, count = 24) {
  return Array.from({ length: count }, (_, i) => {
    const usesPattern = i % 2 === 0;
    return video({
      videoId: `v-${i}`,
      title: usesPattern ? `${i + 3} Ways To Fix This` : `Fixing this today`,
      views: usesPattern ? 1000 * multiplier : 1000,
      durationSeconds: 600,
      ageDays: 120,
    });
  });
}

describe("analyseHooks", () => {
  it("measures lift for a pattern that genuinely outperforms", () => {
    const patterns = analyseHooks(catalogue(3));
    const numbered = patterns.find((p) => p.id === "numbered-list");

    expect(numbered).toBeDefined();
    expect(numbered!.lift).toBeCloseTo(3, 1);
    expect(numbered!.matchCount).toBe(12);
    expect(numbered!.confidence).toBe("medium");
  });

  it("reports lift below 1 for a pattern that underperforms on this channel", () => {
    const patterns = analyseHooks(catalogue(0.25));
    const numbered = patterns.find((p) => p.id === "numbered-list");

    expect(numbered!.lift).toBeCloseTo(0.25, 2);
    expect(underperformingHooks(patterns).some((p) => p.id === "numbered-list")).toBe(true);
    expect(actionableHooks(patterns).some((p) => p.id === "numbered-list")).toBe(false);
  });

  it("drops patterns without enough videos on both sides of the split", () => {
    const list = [
      video({ videoId: "a", title: "5 Ways To Win", views: 5000, ageDays: 120 }),
      ...Array.from({ length: 10 }, (_, i) =>
        video({ videoId: `b-${i}`, title: "Plain title", views: 1000, ageDays: 120 }),
      ),
    ];
    // One match is below the minimum, so the pattern is not reported at all.
    expect(analyseHooks(list).some((p) => p.id === "numbered-list")).toBe(false);
  });

  it("returns nothing when the catalogue is too small to split", () => {
    expect(analyseHooks([video({ views: 100, ageDays: 120 })])).toEqual([]);
  });

  it("ignores uploads too young to have settled", () => {
    const fresh = catalogue(3).map((v) => ({ ...v, ageDays: 2 }));
    expect(analyseHooks(fresh)).toEqual([]);
  });

  it("marks confidence high only with a large sample on both sides", () => {
    const patterns = analyseHooks(catalogue(2, 40));
    expect(patterns.find((p) => p.id === "numbered-list")!.confidence).toBe("high");
  });
});
