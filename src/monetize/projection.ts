import type {
  Assumption,
  AudienceModel,
  Band,
  ChannelProfile,
  ProductArchetype,
  Projection,
  RevenueScenario,
  SensitivityRow,
} from "../types.js";
import { findNiche, type NicheDefinition } from "../analysis/niches.js";
import { clamp, round, safeDivide } from "../util/stats.js";
import { isViewDriven } from "./archetypes.js";

/**
 * Revenue projection.
 *
 * Three scenarios, always. A single number implies a precision that does not
 * exist when the inputs are a conversion band and an estimated audience — the
 * spread between conservative and optimistic *is* the finding, and a plan that
 * only works in the optimistic column is not a plan.
 */

/** Shorts earn a small fraction of long-form RPM. */
export const SHORTS_RPM_FACTOR = 0.06;

/** Sponsored integrations assumed per month. */
export const SPONSORSHIPS_PER_MONTH = 1;

/**
 * Weekly hours a solo operator can put into delivery when they have not said
 * otherwise. The rest of a working week goes on making the content that
 * produces the demand in the first place.
 */
export const DEFAULT_DELIVERY_HOURS_PER_WEEK = 15;

/** Share of an operator's stated weekly hours that can go to delivery rather than content. */
export const DELIVERY_HOURS_SHARE = 0.6;

const WEEKS_PER_MONTH = 4.33;

/**
 * Share of the engaged audience newly exposed to an offer in any given month.
 *
 * Published conversion rates are launch figures: what a creator converts the
 * first time they put an offer in front of an audience. Applying a launch rate
 * every month assumes an audience with no memory — that the same people who
 * declined in March are equally likely to buy in April. They are not. Only the
 * portion that is new to the offer converts at anything like the headline rate,
 * and for an established channel that is roughly a third of monthly reach.
 */
export const MONTHLY_OFFER_EXPOSURE = 0.35;

export interface ProjectionContext {
  audience: AudienceModel;
  profile: ChannelProfile;
  /** Hours per week available for delivering one-to-one work. */
  deliveryHoursPerWeek?: number;
  /** Overrides for any assumption the operator knows better than the model does. */
  overrides?: {
    price?: number;
    conversionRate?: number;
    sponsorshipsPerMonth?: number;
  };
}

export function projectRevenue(
  archetype: ProductArchetype,
  context: ProjectionContext,
): Projection {
  const niche = findNiche(context.profile.niche.slug);
  const assumptions: Assumption[] = [];
  const warnings: string[] = [];

  const scenarios = isViewDriven(archetype)
    ? projectViewDriven(archetype, context, niche, assumptions)
    : projectAudienceDriven(archetype, context, assumptions, warnings);

  const base = scenarios.base;

  if (archetype.deliveryHoursPerUnit) {
    const hours = context.deliveryHoursPerWeek ?? DEFAULT_DELIVERY_HOURS_PER_WEEK;
    const capacity = (hours * WEEKS_PER_MONTH) / archetype.deliveryHoursPerUnit;
    const intentMultiplier = clamp(
      safeDivide(context.audience.commercialIntent, 0.6, 1),
      0.4,
      1.6,
    );
    const demand =
      context.audience.estimatedEngagedAudience *
      MONTHLY_OFFER_EXPOSURE *
      (context.overrides?.conversionRate ?? archetype.conversionRate.base * intentMultiplier);
    if (demand > capacity) {
      warnings.push(
        `Demand exceeds what you can deliver: the audience supports about ${Math.round(demand)} sales a month but ${hours}h/week covers ${Math.round(capacity)}. Revenue here is capped by your calendar, so raise the price rather than chase more leads.`,
      );
    }
  }

  const expectedValue90d = rampedRevenue(
    base.netMonthlyRevenue,
    archetype.timeToFirstRevenueDays,
  );

  assumptions.push({
    key: "expectedValue90d",
    value: round(expectedValue90d, 0),
    basis: `Base-case monthly net, ramped from ${archetype.timeToFirstRevenueDays} days to first revenue: a new offer is assumed to reach half its steady rate in month one and full rate from month two.`,
  });

  if (
    !isViewDriven(archetype) &&
    context.audience.estimatedEngagedAudience < archetype.minimumEngagedAudience
  ) {
    warnings.push(
      `Engaged audience of ${Math.round(context.audience.estimatedEngagedAudience).toLocaleString()} is below the ${archetype.minimumEngagedAudience.toLocaleString()} this archetype normally needs. The projection is shown for completeness but the conversion band was not built at this scale.`,
    );
  }

  return {
    archetypeId: archetype.id,
    archetypeName: archetype.name,
    category: archetype.category,
    scenarios,
    expectedValue90d: round(expectedValue90d, 0),
    sensitivity: computeSensitivity(archetype, context, base),
    assumptions,
    warnings,
  };
}

/** Ad revenue and sponsorships are priced off views, not off conversion. */
function projectViewDriven(
  archetype: ProductArchetype,
  context: ProjectionContext,
  niche: NicheDefinition,
  assumptions: Assumption[],
): Projection["scenarios"] {
  const { audience, profile } = context;

  if (archetype.category === "platform") {
    const rpmBand: Band = {
      low: niche.rpmRange.low,
      base: (niche.rpmRange.low + niche.rpmRange.high) / 2,
      high: niche.rpmRange.high,
    };

    assumptions.push({
      key: "rpm",
      value: `$${rpmBand.low}-$${rpmBand.high}`,
      basis: `Long-form RPM range for ${niche.label}. Shorts are modelled at ${Math.round(SHORTS_RPM_FACTOR * 100)}% of the long-form rate.`,
    });

    const build = (label: RevenueScenario["label"], rpm: number): RevenueScenario => {
      const longRevenue = (audience.monthlyViewsByFormat.long / 1000) * rpm;
      const shortRevenue =
        (audience.monthlyViewsByFormat.short / 1000) * rpm * SHORTS_RPM_FACTOR;
      const gross = longRevenue + shortRevenue;
      return toScenario(label, {
        buyers: 0,
        price: rpm,
        conversionRate: 0,
        gross,
        deliveryCostRate: archetype.deliveryCostRate,
        refundRate: archetype.refundRate,
      });
    };

    return {
      conservative: build("conservative", rpmBand.low),
      base: build("base", rpmBand.base),
      optimistic: build("optimistic", rpmBand.high),
    };
  }

  // Sponsorships: a placement reaches one video's audience, not the month's.
  const perMonth = context.overrides?.sponsorshipsPerMonth ?? SPONSORSHIPS_PER_MONTH;
  const longStats = profile.formats.find((f) => f.format === "long");
  const viewsPerPlacement = longStats?.medianViews ?? 0;

  assumptions.push({
    key: "sponsorshipReach",
    value: round(viewsPerPlacement, 0),
    basis: `Median long-form views, which is what one integration actually reaches — not monthly channel views. ${perMonth} integration${perMonth === 1 ? "" : "s"} per month assumed.`,
  });

  const build = (label: RevenueScenario["label"], cpm: number): RevenueScenario =>
    toScenario(label, {
      buyers: perMonth,
      price: cpm,
      conversionRate: 0,
      gross: (viewsPerPlacement / 1000) * cpm * perMonth,
      deliveryCostRate: archetype.deliveryCostRate,
      refundRate: archetype.refundRate,
    });

  return {
    conservative: build("conservative", archetype.price.low),
    base: build("base", archetype.price.base),
    optimistic: build("optimistic", archetype.price.high),
  };
}

/** Everything sold directly to the audience. */
function projectAudienceDriven(
  archetype: ProductArchetype,
  context: ProjectionContext,
  assumptions: Assumption[],
  warnings: string[],
): Projection["scenarios"] {
  const { audience, overrides } = context;
  const engaged = audience.estimatedEngagedAudience;

  // A niche's commercial intent moves conversion up or down. 0.6 is the neutral
  // point; the multiplier is capped so no niche is written off or waved through.
  const intentMultiplier = clamp(safeDivide(audience.commercialIntent, 0.6, 1), 0.4, 1.6);

  assumptions.push({
    key: "intentMultiplier",
    value: round(intentMultiplier, 2),
    basis: `Commercial intent of ${Math.round(audience.commercialIntent * 100)}% for this niche, relative to a neutral 60%. Conversion rates are scaled by this factor and clamped to 0.4x-1.6x.`,
  });
  const convertible = engaged * MONTHLY_OFFER_EXPOSURE;

  assumptions.push({
    key: "engagedAudience",
    value: round(engaged, 0),
    basis: "Conversion is applied to the engaged audience, not to views or subscribers. This is the single biggest reason these figures are lower than typical creator revenue calculators.",
  });
  assumptions.push({
    key: "monthlyOfferExposure",
    value: MONTHLY_OFFER_EXPOSURE,
    basis: `Only ${Math.round(MONTHLY_OFFER_EXPOSURE * 100)}% of the engaged audience is newly exposed to the offer in a given month, giving ${Math.round(convertible)} genuinely convertible people. The rest have already seen it and passed — published conversion rates are launch numbers, not monthly ones.`,
  });
  assumptions.push({
    key: "priceBand",
    value: `$${archetype.price.low}-$${archetype.price.high}`,
    basis: `Scenarios hold the price at $${overrides?.price ?? archetype.price.base} and vary conversion only. Price is a decision, not an uncertainty — stacking the lowest price against the lowest conversion would manufacture a range far wider than the real one. The effect of moving price is in the sensitivity table.`,
  });

  if (archetype.recurring && archetype.retentionMonths) {
    assumptions.push({
      key: "retentionMonths",
      value: archetype.retentionMonths,
      basis: `Recurring revenue is modelled at steady state: monthly joins multiplied by ${archetype.retentionMonths} months of assumed tenure.`,
    });
  }

  if (engaged <= 0) {
    warnings.push("Engaged audience is zero, so every audience-driven projection is zero.");
  }

  // Anything delivered one-to-one is bounded by hours, not by demand. Without
  // this ceiling the model happily projects a hundred consulting clients a
  // month for one person, which is the fastest way to make the whole report
  // untrustworthy.
  const monthlyCapacity = archetype.deliveryHoursPerUnit
    ? ((context.deliveryHoursPerWeek ?? DEFAULT_DELIVERY_HOURS_PER_WEEK) * WEEKS_PER_MONTH) /
      archetype.deliveryHoursPerUnit
    : Number.POSITIVE_INFINITY;

  if (Number.isFinite(monthlyCapacity)) {
    const hours = context.deliveryHoursPerWeek ?? DEFAULT_DELIVERY_HOURS_PER_WEEK;
    assumptions.push({
      key: "deliveryCapacity",
      value: round(monthlyCapacity, 1),
      basis: `Delivered one-to-one at ${archetype.deliveryHoursPerUnit}h per sale, against ${hours}h/week of delivery time. Sales are capped at this ceiling however large the audience gets.`,
    });
  }

  const build = (
    label: RevenueScenario["label"],
    conversionRate: number,
  ): RevenueScenario => {
    const effectiveConversion = overrides?.conversionRate ?? conversionRate * intentMultiplier;
    const effectivePrice = overrides?.price ?? archetype.price.base;
    const demand = convertible * effectiveConversion;
    const monthlyBuyers = Math.min(demand, monthlyCapacity);
    // Recurring offers accumulate: steady-state subscribers are the monthly
    // intake multiplied by how long members stay.
    const billedUnits = archetype.recurring
      ? monthlyBuyers * (archetype.retentionMonths ?? 1)
      : monthlyBuyers;

    return toScenario(label, {
      buyers: monthlyBuyers,
      price: effectivePrice,
      conversionRate: effectiveConversion,
      gross: billedUnits * effectivePrice,
      deliveryCostRate: archetype.deliveryCostRate,
      refundRate: archetype.refundRate,
    });
  };

  return {
    conservative: build("conservative", archetype.conversionRate.low),
    base: build("base", archetype.conversionRate.base),
    optimistic: build("optimistic", archetype.conversionRate.high),
  };
}

function toScenario(
  label: RevenueScenario["label"],
  input: {
    buyers: number;
    price: number;
    conversionRate: number;
    gross: number;
    deliveryCostRate: number;
    refundRate: number;
  },
): RevenueScenario {
  const net = input.gross * (1 - input.deliveryCostRate) * (1 - input.refundRate);
  return {
    label,
    buyers: round(input.buyers, 1),
    price: round(input.price, 2),
    conversionRate: round(input.conversionRate, 5),
    grossMonthlyRevenue: round(input.gross, 0),
    netMonthlyRevenue: round(net, 0),
    netAnnualRevenue: round(net * 12, 0),
  };
}

/**
 * Revenue reachable inside 90 days, discounted for build time and ramp.
 *
 * A course that nets $5,000/month is not $15,000 in a quarter when it takes 45
 * days to launch — it is closer to $4,000. Ranking on steady-state revenue
 * alone systematically favours the slowest options, which is exactly backwards
 * for someone who needs the first dollar to fund the second.
 */
export function rampedRevenue(
  netMonthlyRevenue: number,
  timeToFirstRevenueDays: number,
): number {
  const monthsAvailable = Math.max(0, (90 - timeToFirstRevenueDays) / 30);
  if (monthsAvailable <= 0) return 0;
  // Ramp climbs linearly from 50% to 100% over the first month, then holds.
  const rampedMonths =
    monthsAvailable <= 1
      ? 0.5 * monthsAvailable + 0.25 * monthsAvailable ** 2
      : monthsAvailable - 0.25;
  return netMonthlyRevenue * rampedMonths;
}

/** How much the base case moves when each driver is wrong by a quarter. */
function computeSensitivity(
  archetype: ProductArchetype,
  context: ProjectionContext,
  base: RevenueScenario,
): SensitivityRow[] {
  const rows: SensitivityRow[] = [];
  const baseNet = base.netMonthlyRevenue;

  const add = (driver: string, change: string, factor: number) => {
    const net = round(baseNet * factor, 0);
    rows.push({
      driver,
      change,
      netMonthlyRevenue: net,
      deltaPct: round(safeDivide(net - baseNet, baseNet, 0), 3),
    });
  };

  if (isViewDriven(archetype)) {
    add("Views", "-25%", 0.75);
    add("Views", "+25%", 1.25);
    add(archetype.category === "platform" ? "RPM" : "CPM", "-25%", 0.75);
    add(archetype.category === "platform" ? "RPM" : "CPM", "+25%", 1.25);
    return rows;
  }

  add("Conversion rate", "-25%", 0.75);
  add("Conversion rate", "+25%", 1.25);
  add("Price", "-25%", 0.75);
  add("Price", "+25%", 1.25);
  add("Engaged audience", "-25%", 0.75);
  add("Engaged audience", "+25%", 1.25);
  if (archetype.recurring) {
    add("Member tenure", "-25%", 0.75);
    add("Member tenure", "+25%", 1.25);
  }

  return rows;
}
