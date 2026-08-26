import { describe, expect, it } from "vitest";
import { findArchetype } from "../src/monetize/archetypes.js";
import {
  MONTHLY_OFFER_EXPOSURE,
  projectRevenue,
  rampedRevenue,
  SHORTS_RPM_FACTOR,
} from "../src/monetize/projection.js";
import { buildChannelProfile } from "../src/analysis/profile.js";
import type { AudienceModel, ChannelProfile } from "../src/types.js";
import { channel, videos } from "./helpers.js";

function profileFixture(nicheSlug = "business-operations"): ChannelProfile {
  const dataset = {
    channel: channel({ description: "agency client lead gen sales consulting" }),
    videos: videos(20, [10_000], { durationSeconds: 600, ageDays: 120 }),
  };
  const profile = buildChannelProfile(dataset);
  // Pin the niche so the projection maths is tested, not the classifier.
  profile.niche = { ...profile.niche, slug: nicheSlug, commercialIntent: 0.6 };
  return profile;
}

function audienceFixture(overrides: Partial<AudienceModel> = {}): AudienceModel {
  return {
    monthlyViews: 200_000,
    monthlyViewsByFormat: { short: 100_000, long: 100_000, live: 0 },
    subscribers: 50_000,
    estimatedMonthlyReach: 100_000,
    estimatedEngagedAudience: 10_000,
    estimatedOwnedAudience: 5_000,
    engagementRate: 0.03,
    audienceQualityScore: 0.5,
    commercialIntent: 0.6,
    reachIsMeasured: false,
    assumptions: [],
    ...overrides,
  };
}

describe("rampedRevenue", () => {
  it("is zero when the build takes the whole quarter", () => {
    expect(rampedRevenue(10_000, 90)).toBe(0);
    expect(rampedRevenue(10_000, 120)).toBe(0);
  });

  it("discounts the first month rather than counting three full ones", () => {
    // 90 days available: 3 months of runway, ramped = 3 - 0.25 = 2.75 months.
    expect(rampedRevenue(1000, 0)).toBeCloseTo(2750, 5);
  });

  it("handles a partial first month", () => {
    // 60 days to launch leaves 1 month; ramped = 0.5 + 0.25 = 0.75.
    expect(rampedRevenue(1000, 60)).toBeCloseTo(750, 5);
  });

  it("rewards a faster launch with strictly more 90-day revenue", () => {
    expect(rampedRevenue(1000, 7)).toBeGreaterThan(rampedRevenue(1000, 45));
  });
});

describe("projectRevenue - audience driven", () => {
  const profile = profileFixture();

  it("orders the scenarios and applies conversion to the engaged audience", () => {
    const archetype = findArchetype("digital-product")!;
    const projection = projectRevenue(archetype, { profile, audience: audienceFixture() });
    const { conservative, base, optimistic } = projection.scenarios;

    expect(conservative.netMonthlyRevenue).toBeLessThan(base.netMonthlyRevenue);
    expect(base.netMonthlyRevenue).toBeLessThan(optimistic.netMonthlyRevenue);

    // Neutral intent (0.6) means the multiplier is exactly 1.
    expect(base.conversionRate).toBeCloseTo(archetype.conversionRate.base, 10);
    // Conversion applies to the newly-exposed slice, not the whole engaged audience.
    expect(base.buyers).toBeCloseTo(
      10_000 * MONTHLY_OFFER_EXPOSURE * archetype.conversionRate.base,
      5,
    );
  });

  it("holds price constant across scenarios and varies conversion only", () => {
    const archetype = findArchetype("operator-playbook")!;
    const { conservative, base, optimistic } = projectRevenue(archetype, {
      profile,
      audience: audienceFixture(),
    }).scenarios;

    // Stacking the lowest price against the lowest conversion would manufacture
    // a range several times wider than the real uncertainty.
    expect(conservative.price).toBe(base.price);
    expect(optimistic.price).toBe(base.price);
    expect(base.price).toBe(archetype.price.base);
    expect(conservative.conversionRate).toBeLessThan(optimistic.conversionRate);

    const spread = optimistic.netMonthlyRevenue / conservative.netMonthlyRevenue;
    expect(spread).toBeCloseTo(
      archetype.conversionRate.high / archetype.conversionRate.low,
      0,
    );
  });

  it("nets out delivery cost and refunds", () => {
    const archetype = findArchetype("digital-product")!;
    const { base } = projectRevenue(archetype, { profile, audience: audienceFixture() }).scenarios;
    const expectedNet =
      base.grossMonthlyRevenue * (1 - archetype.deliveryCostRate) * (1 - archetype.refundRate);
    expect(base.netMonthlyRevenue).toBeCloseTo(expectedNet, 0);
  });

  it("scales conversion by commercial intent", () => {
    const archetype = findArchetype("digital-product")!;
    const lowIntent = projectRevenue(archetype, {
      profile,
      audience: audienceFixture({ commercialIntent: 0.25 }),
    });
    const highIntent = projectRevenue(archetype, {
      profile,
      audience: audienceFixture({ commercialIntent: 0.9 }),
    });

    expect(highIntent.scenarios.base.netMonthlyRevenue).toBeGreaterThan(
      lowIntent.scenarios.base.netMonthlyRevenue,
    );
    // The multiplier is clamped, so a 3.6x intent gap cannot become a 3.6x revenue gap.
    const ratio =
      highIntent.scenarios.base.netMonthlyRevenue / lowIntent.scenarios.base.netMonthlyRevenue;
    expect(ratio).toBeLessThanOrEqual(1.6 / 0.42);
  });

  it("bills recurring offers at steady state, not as a single month", () => {
    const membership = findArchetype("membership")!;
    const projection = projectRevenue(membership, { profile, audience: audienceFixture() });
    const { base } = projection.scenarios;

    // Steady-state gross = monthly joins x tenure x price.
    expect(base.grossMonthlyRevenue).toBeCloseTo(
      base.buyers * membership.retentionMonths! * base.price,
      0,
    );
  });

  it("warns rather than silently projecting when the audience is too small", () => {
    const course = findArchetype("online-course")!;
    const projection = projectRevenue(course, {
      profile,
      audience: audienceFixture({ estimatedEngagedAudience: 50 }),
    });
    expect(projection.warnings.join(" ")).toMatch(/below the/);
  });

  it("caps one-to-one delivery at what the calendar allows", () => {
    const consulting = findArchetype("consulting")!;
    // A huge audience cannot buy more hours than the operator has.
    const projection = projectRevenue(consulting, {
      profile,
      audience: audienceFixture({ estimatedEngagedAudience: 500_000 }),
      deliveryHoursPerWeek: 10,
    });

    const capacity = (10 * 4.33) / consulting.deliveryHoursPerUnit!;
    expect(projection.scenarios.base.buyers).toBeCloseTo(capacity, 1);
    expect(projection.scenarios.optimistic.buyers).toBeCloseTo(capacity, 1);
    expect(projection.warnings.join(" ")).toMatch(/capped by your calendar/);
  });

  it("leaves capacity-bound revenue below the uncapped equivalent", () => {
    const consulting = findArchetype("consulting")!;
    const audience = audienceFixture({ estimatedEngagedAudience: 500_000 });

    const constrained = projectRevenue(consulting, { profile, audience, deliveryHoursPerWeek: 5 });
    const roomy = projectRevenue(consulting, { profile, audience, deliveryHoursPerWeek: 40 });

    expect(constrained.scenarios.base.netMonthlyRevenue).toBeLessThan(
      roomy.scenarios.base.netMonthlyRevenue,
    );
  });

  it("does not cap one-to-many archetypes", () => {
    const course = findArchetype("online-course")!;
    expect(course.deliveryHoursPerUnit).toBeUndefined();

    const projection = projectRevenue(course, {
      profile,
      audience: audienceFixture({ estimatedEngagedAudience: 500_000 }),
      deliveryHoursPerWeek: 1,
    });
    // Demand, not hours, sets the number.
    expect(projection.scenarios.base.buyers).toBeGreaterThan(100);
    expect(projection.warnings.join(" ")).not.toMatch(/capped by your calendar/);
  });

  it("honours explicit overrides", () => {
    const archetype = findArchetype("digital-product")!;
    const projection = projectRevenue(archetype, {
      profile,
      audience: audienceFixture(),
      overrides: { price: 100, conversionRate: 0.01 },
    });
    expect(projection.scenarios.base.price).toBe(100);
    expect(projection.scenarios.base.buyers).toBeCloseTo(
      10_000 * MONTHLY_OFFER_EXPOSURE * 0.01,
      5,
    );
  });
});

describe("projectRevenue - view driven", () => {
  const profile = profileFixture();

  it("prices ad revenue off views with Shorts discounted", () => {
    const adRevenue = findArchetype("ad-revenue")!;
    const audience = audienceFixture({
      monthlyViewsByFormat: { short: 1_000_000, long: 0, live: 0 },
    });
    const shortsOnly = projectRevenue(adRevenue, { profile, audience }).scenarios.base;

    const longOnly = projectRevenue(adRevenue, {
      profile,
      audience: audienceFixture({
        monthlyViewsByFormat: { short: 0, long: 1_000_000, live: 0 },
      }),
    }).scenarios.base;

    expect(shortsOnly.grossMonthlyRevenue).toBeCloseTo(
      longOnly.grossMonthlyRevenue * SHORTS_RPM_FACTOR,
      4,
    );
  });

  it("prices sponsorship off one video's reach, not the whole month", () => {
    const sponsorship = findArchetype("sponsorship")!;
    const projection = projectRevenue(sponsorship, { profile, audience: audienceFixture() });
    const medianLongViews = profile.formats.find((f) => f.format === "long")!.medianViews;

    expect(projection.scenarios.base.grossMonthlyRevenue).toBeCloseTo(
      (medianLongViews / 1000) * sponsorship.price.base,
      0,
    );
    // Sponsorship reach must be far below total monthly views for this channel.
    expect(projection.scenarios.base.grossMonthlyRevenue).toBeLessThan(
      (audienceFixture().monthlyViews / 1000) * sponsorship.price.base,
    );
  });

  it("produces a sensitivity table for every archetype", () => {
    for (const id of ["ad-revenue", "sponsorship", "membership", "consulting"]) {
      const projection = projectRevenue(findArchetype(id)!, {
        profile,
        audience: audienceFixture(),
      });
      expect(projection.sensitivity.length).toBeGreaterThan(0);
    }
  });
});
