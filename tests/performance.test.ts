import { describe, expect, it } from "vitest";
import {
  computeBaselines,
  computeConsistency,
  computeFormatStats,
  computePerformanceProfile,
  computeTrend,
  engagementRate,
  isMature,
  pendingVideos,
} from "../src/analysis/performance.js";
import { video, videos } from "./helpers.js";

describe("isMature", () => {
  it("uses a shorter window for Shorts than for long-form", () => {
    expect(isMature(video({ views: 10, durationSeconds: 30, ageDays: 20 }))).toBe(true);
    expect(isMature(video({ views: 10, durationSeconds: 600, ageDays: 20 }))).toBe(false);
    expect(isMature(video({ views: 10, durationSeconds: 600, ageDays: 45 }))).toBe(true);
  });
});

describe("computeBaselines", () => {
  it("computes a separate median per format", () => {
    const list = [
      video({ views: 100, durationSeconds: 30 }),
      video({ views: 300, durationSeconds: 30 }),
      video({ views: 1000, durationSeconds: 600 }),
      video({ views: 3000, durationSeconds: 600 }),
    ];
    const baselines = computeBaselines(list);
    expect(baselines.short).toBe(200);
    expect(baselines.long).toBe(2000);
  });
});

describe("computePerformanceProfile", () => {
  it("scores outliers against the same-format baseline, not the channel total", () => {
    const list = [
      ...videos(6, [1000], { durationSeconds: 600, ageDays: 100 }),
      // A Short with far fewer views than long-form is still a Shorts outlier.
      ...videos(5, [100], { durationSeconds: 30, ageDays: 100 }),
      video({ views: 500, durationSeconds: 30, ageDays: 100, videoId: "short-hit", title: "Short hit" }),
    ];

    const profile = computePerformanceProfile(list);
    const hit = profile.outliers.find((o) => o.videoId === "short-hit");
    expect(hit).toBeDefined();
    expect(hit!.multipleOfBaseline).toBeCloseTo(5, 5);
  });

  it("excludes immature uploads from the baseline so young videos cannot drag it down", () => {
    const mature = videos(6, [1000], { durationSeconds: 600, ageDays: 120 });
    const fresh = video({ views: 5, durationSeconds: 600, ageDays: 1, videoId: "fresh" });
    const profile = computePerformanceProfile([...mature, fresh]);

    expect(profile.baselines.long).toBe(1000);
    expect(profile.outliers.some((o) => o.videoId === "fresh")).toBe(false);
    expect(profile.laggards.some((o) => o.videoId === "fresh")).toBe(false);
  });

  it("reports young uploads as pending rather than scoring them", () => {
    const list = [
      ...videos(5, [1000], { durationSeconds: 600, ageDays: 120 }),
      video({ views: 10, durationSeconds: 600, ageDays: 2, videoId: "new" }),
    ];
    expect(pendingVideos(list).map((v) => v.videoId)).toEqual(["new"]);
  });

  it("falls back to all videos when nothing is mature yet", () => {
    const list = videos(4, [100, 200], { durationSeconds: 600, ageDays: 3 });
    const profile = computePerformanceProfile(list);
    expect(profile.baselines.long).toBeGreaterThan(0);
  });
});

describe("computeTrend", () => {
  it("returns null below six uploads rather than claiming a trend", () => {
    const list = videos(5, [100], { durationSeconds: 600, ageDays: 120 });
    expect(computeTrend(list).long).toBeNull();
  });

  it("detects growth between the older and newer halves", () => {
    const older = Array.from({ length: 4 }, (_, i) =>
      video({ views: 100, durationSeconds: 600, ageDays: 300 - i, videoId: `old-${i}` }),
    );
    const newer = Array.from({ length: 4 }, (_, i) =>
      video({ views: 400, durationSeconds: 600, ageDays: 100 - i, videoId: `new-${i}` }),
    );
    expect(computeTrend([...older, ...newer]).long).toBeCloseTo(4, 5);
  });
});

describe("computeConsistency", () => {
  it("is high for even performance and low for lottery outcomes", () => {
    const steady = videos(8, [1000], { durationSeconds: 600, ageDays: 120 });
    const erratic = videos(8, [10, 20, 5000, 30, 8000, 15, 25, 12000], {
      durationSeconds: 600,
      ageDays: 120,
    });
    expect(computeConsistency(steady)).toBe(1);
    expect(computeConsistency(erratic)).toBeLessThan(0.4);
  });
});

describe("computeFormatStats", () => {
  it("reports hit skew as p90 over median", () => {
    const list = [
      ...videos(9, [1000], { durationSeconds: 600, ageDays: 120 }),
      video({ views: 10_000, durationSeconds: 600, ageDays: 120, videoId: "spike" }),
    ];
    const [long] = computeFormatStats(list);
    expect(long!.medianViews).toBe(1000);
    expect(long!.hitSkew).toBeGreaterThan(1);
  });
});

describe("engagementRate", () => {
  it("guards against a zero-view video", () => {
    expect(engagementRate(video({ views: 0, likes: 0, comments: 0 }))).toBe(0);
    expect(engagementRate(video({ views: 100, likes: 8, comments: 2 }))).toBeCloseTo(0.1, 10);
  });
});
