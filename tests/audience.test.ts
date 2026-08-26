import { describe, expect, it } from "vitest";
import { buildChannelProfile } from "../src/analysis/profile.js";
import { buildAudienceModel, VIEWS_PER_VIEWER } from "../src/monetize/audience.js";
import type { ChannelDataset } from "../src/types.js";
import { channel, video, videos } from "./helpers.js";

function dataset(overrides: Partial<ChannelDataset> = {}): ChannelDataset {
  return {
    channel: channel(),
    videos: videos(12, [10_000], { durationSeconds: 600, ageDays: 30 }),
    ...overrides,
  };
}

describe("buildAudienceModel", () => {
  it("derives monthly views from the recent window, not lifetime totals", () => {
    const data = dataset({
      // 10 uploads over a 30-day window, 1,000 views each.
      videos: Array.from({ length: 10 }, (_, i) =>
        video({ videoId: `v-${i}`, views: 1000, durationSeconds: 600, ageDays: 30 }),
      ),
    });
    const audience = buildAudienceModel(buildChannelProfile(data), data);
    expect(audience.monthlyViews).toBeCloseTo(10_000, -2);
  });

  it("reports zero monthly views for a dormant channel and says why", () => {
    const data = dataset({
      videos: videos(10, [50_000], { durationSeconds: 600, ageDays: 500 }),
    });
    const audience = buildAudienceModel(buildChannelProfile(data), data);
    expect(audience.monthlyViews).toBe(0);
    expect(audience.assumptions.some((a) => /dormant/.test(a.basis))).toBe(true);
  });

  it("converts views to reach using a format-weighted views-per-viewer figure", () => {
    const data = dataset({
      videos: Array.from({ length: 10 }, (_, i) =>
        video({ videoId: `s-${i}`, views: 1000, durationSeconds: 30, ageDays: 30 }),
      ),
    });
    const audience = buildAudienceModel(buildChannelProfile(data), data);
    // A pure-Shorts channel divides by the Shorts figure.
    expect(audience.estimatedMonthlyReach).toBeCloseTo(
      audience.monthlyViews / VIEWS_PER_VIEWER.short,
      -1,
    );
    expect(audience.estimatedMonthlyReach).toBeLessThan(audience.monthlyViews);
  });

  it("prefers measured owner analytics over the estimate", () => {
    const data = dataset({
      owner: {
        channelMetrics: {
          periodStart: "2026-05-01",
          periodEnd: "2026-05-31",
          views: 500_000,
          uniqueViewers: 300_000,
        },
        videoMetrics: [],
        retentionCurves: [],
      },
    });
    const audience = buildAudienceModel(buildChannelProfile(data), data);

    expect(audience.reachIsMeasured).toBe(true);
    expect(audience.estimatedMonthlyReach).toBe(300_000);
    expect(audience.monthlyViews).toBeCloseTo(500_000, -3);
    expect(audience.assumptions.some((a) => /Measured/.test(a.basis))).toBe(true);
  });

  it("keeps the engaged audience a strict subset of reach", () => {
    const data = dataset();
    const audience = buildAudienceModel(buildChannelProfile(data), data);
    expect(audience.estimatedEngagedAudience).toBeLessThanOrEqual(
      audience.estimatedMonthlyReach,
    );
    expect(audience.estimatedEngagedAudience).toBeGreaterThan(0);
  });

  it("lets an owned list set the floor when platform reach is tiny", () => {
    const data = dataset({
      channel: channel({ subscriberCount: 200, viewCount: 5000 }),
      videos: videos(4, [50], { durationSeconds: 600, ageDays: 30 }),
    });
    const withoutList = buildAudienceModel(buildChannelProfile(data), data);
    const withList = buildAudienceModel(buildChannelProfile(data), data, {
      ownedListSize: 20_000,
    });

    expect(withList.estimatedOwnedAudience).toBeGreaterThan(20_000);
    expect(withList.estimatedEngagedAudience).toBeGreaterThan(
      withoutList.estimatedEngagedAudience,
    );
  });

  it("records an assumption for every derived figure", () => {
    const data = dataset();
    const audience = buildAudienceModel(buildChannelProfile(data), data);
    const keys = audience.assumptions.map((a) => a.key);

    for (const expected of [
      "monthlyViews",
      "viewsPerViewer",
      "engagementRate",
      "audienceQualityScore",
      "engagedShare",
      "subscriberActivityRate",
    ]) {
      expect(keys).toContain(expected);
    }
    expect(audience.assumptions.every((a) => a.basis.length > 0)).toBe(true);
  });
});
