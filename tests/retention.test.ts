import { describe, expect, it } from "vitest";
import {
  buildRetentionProfile,
  hookDropoff,
  watchRatioAt,
  watchRatioAtSecond,
} from "../src/analysis/retention.js";
import type { RetentionCurve } from "../src/types.js";
import { video } from "./helpers.js";

const curve: RetentionCurve = {
  videoId: "v1",
  points: [
    { elapsedVideoTimeRatio: 0, audienceWatchRatio: 1 },
    { elapsedVideoTimeRatio: 0.1, audienceWatchRatio: 0.6 },
    { elapsedVideoTimeRatio: 0.5, audienceWatchRatio: 0.4 },
    { elapsedVideoTimeRatio: 1, audienceWatchRatio: 0.2 },
  ],
};

describe("watchRatioAt", () => {
  it("returns exact points and interpolates between them", () => {
    expect(watchRatioAt(curve, 0)).toBe(1);
    expect(watchRatioAt(curve, 0.5)).toBe(0.4);
    // Halfway between 0.1 (0.6) and 0.5 (0.4).
    expect(watchRatioAt(curve, 0.3)).toBeCloseTo(0.5, 10);
  });

  it("clamps beyond either end of the curve", () => {
    expect(watchRatioAt(curve, -1)).toBe(1);
    expect(watchRatioAt(curve, 2)).toBe(0.2);
  });

  it("returns undefined for an empty curve", () => {
    expect(watchRatioAt({ videoId: "x", points: [] }, 0.5)).toBeUndefined();
  });
});

describe("watchRatioAtSecond", () => {
  it("converts a wall-clock second into a ratio", () => {
    // 30s into a 300s video is the 10% mark.
    expect(watchRatioAtSecond(curve, 300, 30)).toBeCloseTo(0.6, 10);
  });

  it("refuses to answer past the end of a short video", () => {
    expect(watchRatioAtSecond(curve, 15, 30)).toBeUndefined();
    expect(watchRatioAtSecond(curve, 0, 30)).toBeUndefined();
  });
});

describe("hookDropoff", () => {
  it("measures the loss across the opening tenth", () => {
    expect(hookDropoff(curve)).toBeCloseTo(0.4, 10);
  });
});

describe("buildRetentionProfile", () => {
  it("summarises curves and flags a costly hook", () => {
    const v = video({ videoId: "v1", views: 1000, durationSeconds: 300, ageDays: 60 });
    const profile = buildRetentionProfile(
      [curve],
      [{ videoId: "v1", averageViewPercentage: 25 }],
      [v],
    );

    expect(profile.videosAnalysed).toBe(1);
    expect(profile.medianRetentionAt30s).toBeCloseTo(0.6, 4);
    expect(profile.medianRetentionAtHalf).toBeCloseTo(0.4, 4);
    expect(profile.medianAverageViewPercentage).toBe(25);
    // Both the 40% hook drop and the sub-30% view percentage warrant a note.
    expect(profile.notes.length).toBeGreaterThanOrEqual(2);
  });

  it("says plainly when there is no owner data", () => {
    const profile = buildRetentionProfile([], [], []);
    expect(profile.videosAnalysed).toBe(0);
    expect(profile.notes.join(" ")).toMatch(/owner-only/);
  });
});
