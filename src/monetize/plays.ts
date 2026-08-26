import type {
  AudienceModel,
  ChannelProfile,
  OperatorProfile,
  Play,
  ProductArchetype,
  Projection,
} from "../types.js";
import { formatCount, formatUsd } from "../util/format.js";
import { clamp, round, safeDivide } from "../util/stats.js";
import { ARCHETYPES, isViewDriven } from "./archetypes.js";
import {
  DELIVERY_HOURS_SHARE,
  projectRevenue,
  type ProjectionContext,
} from "./projection.js";

/**
 * Play ranking — the path of least resistance.
 *
 * Ranking purely on revenue always crowns the same option: build software, sell
 * it forever. That is correct arithmetic and terrible advice for someone with
 * ten hours a week and no runway. A play is ranked here on what it returns
 * *relative to what it costs to reach* — money, effort, time to the first
 * dollar, and whether the operator can actually do it.
 */

/** Rough weekly hours each effort level demands once the offer is live. */
export const EFFORT_HOURS: Record<ProductArchetype["effort"], number> = {
  1: 2,
  2: 5,
  3: 10,
  4: 20,
  5: 35,
};

/** Archetypes with real up-front cash requirements. */
const CAPITAL_REQUIRED: Record<string, number> = {
  "physical-product": 3000,
  saas: 5000,
  "done-for-you": 1500,
};

export interface PlanOptions {
  operator?: OperatorProfile;
  /** Restrict to specific archetype IDs. */
  only?: string[];
  /** Include plays whose blockers make them impractical today. */
  includeBlocked?: boolean;
}

export function rankPlays(
  profile: ChannelProfile,
  audience: AudienceModel,
  options: PlanOptions = {},
): Play[] {
  const operator = options.operator;
  const context: ProjectionContext = {
    audience,
    profile,
    // Only part of a working week can go to delivery; the rest makes the content.
    ...(operator?.hoursPerWeek
      ? { deliveryHoursPerWeek: operator.hoursPerWeek * DELIVERY_HOURS_SHARE }
      : {}),
  };

  const candidates = options.only?.length
    ? ARCHETYPES.filter((a) => options.only!.includes(a.id))
    : ARCHETYPES;

  const projections = candidates.map((archetype) => ({
    archetype,
    projection: projectRevenue(archetype, context),
  }));

  // Money is scored relative to the best option on the board, so the ranking
  // reflects this channel's realistic ceiling rather than an absolute scale.
  const bestEv = Math.max(...projections.map((p) => p.projection.expectedValue90d), 1);

  const plays = projections.map(({ archetype, projection }) => {
    const fitScore = scoreFit(archetype, profile, audience);
    const skillScore = scoreSkills(archetype, operator);
    const blockers = findBlockers(archetype, audience, operator);

    const moneyScore = clamp(safeDivide(projection.expectedValue90d, bestEv, 0), 0, 1);
    const effortFactor = (6 - archetype.effort) / 5;
    // 30 days to first revenue scores 0.5; faster climbs steeply from there.
    const speedFactor = 30 / (archetype.timeToFirstRevenueDays + 30);

    const resistanceScore = clamp(
      (0.4 * moneyScore + 0.2 * effortFactor + 0.2 * speedFactor + 0.2 * skillScore) *
        fitScore,
      0,
      1,
    );

    return {
      archetype,
      projection,
      fitScore: round(fitScore, 3),
      skillScore: round(skillScore, 3),
      resistanceScore: round(resistanceScore, 3),
      rationale: buildRationale(archetype, projection, profile, audience, fitScore),
      blockers,
    } satisfies Play;
  });

  const ranked = plays.sort((a, b) => b.resistanceScore - a.resistanceScore);
  return options.includeBlocked === false
    ? ranked.filter((p) => p.blockers.length === 0)
    : ranked;
}

/** How well the archetype suits this specific channel, independent of the operator. */
function scoreFit(
  archetype: ProductArchetype,
  profile: ChannelProfile,
  audience: AudienceModel,
): number {
  // An empty bestForNiches list means broadly applicable, not perfect.
  const nicheFit =
    archetype.bestForNiches.length === 0
      ? 0.75
      : archetype.bestForNiches.includes(profile.niche.slug)
        ? 1
        : 0.45;

  const scaleFit =
    archetype.minimumEngagedAudience <= 0
      ? 1
      : clamp(
          safeDivide(audience.estimatedEngagedAudience, archetype.minimumEngagedAudience, 0),
          0.2,
          1,
        );

  const longStats = profile.formats.find((f) => f.format === "long");
  const hasLongForm = (longStats?.count ?? 0) >= 5;
  // Anything above roughly $200 needs the trust that long-form builds; Shorts
  // alone rarely carry a considered purchase.
  const needsTrust = archetype.price.base >= 200 && !isViewDriven(archetype);
  const formatFit = needsTrust && !hasLongForm ? 0.55 : 1;

  // Recurring revenue depends on showing up reliably.
  const consistencyFit = archetype.recurring
    ? clamp(0.6 + 0.4 * profile.performance.consistencyScore, 0, 1)
    : 1;

  return clamp(nicheFit * scaleFit * formatFit * consistencyFit, 0, 1);
}

/** Overlap between what the archetype demands and what the operator says they have. */
function scoreSkills(archetype: ProductArchetype, operator?: OperatorProfile): number {
  if (archetype.requiredSkills.length === 0) return 1;

  // "the craft you already film" is satisfied by definition — whatever the
  // channel publishes every week is demonstrated skill, stated or not. This is
  // checked before the operator profile, so an operator who listed no skills
  // still gets credit for the one they are visibly performing on camera.
  const isDemonstrated = (skill: string) => skill.toLowerCase().includes("already film");
  const unmet = archetype.requiredSkills.filter((s) => !isDemonstrated(s));
  if (unmet.length === 0) return 1;

  const owned = operator?.skills.map((s) => s.toLowerCase()) ?? [];
  const demonstrated = archetype.requiredSkills.length - unmet.length;

  // Nothing stated: a neutral prior on the requirements that are not already
  // demonstrated, rather than assuming the worst.
  if (owned.length === 0) {
    return clamp(
      safeDivide(demonstrated + 0.6 * unmet.length, archetype.requiredSkills.length, 0.6),
      0.2,
      1,
    );
  }

  const matched = archetype.requiredSkills.filter((required) => {
    if (isDemonstrated(required)) return true;
    const needle = required.toLowerCase();
    return owned.some((skill) => skill.includes(needle) || needle.includes(skill));
  });

  return clamp(safeDivide(matched.length, archetype.requiredSkills.length, 0), 0.2, 1);
}

function findBlockers(
  archetype: ProductArchetype,
  audience: AudienceModel,
  operator?: OperatorProfile,
): string[] {
  const blockers: string[] = [];

  if (
    !isViewDriven(archetype) &&
    audience.estimatedEngagedAudience < archetype.minimumEngagedAudience * 0.5
  ) {
    blockers.push(
      `Engaged audience (${formatCount(audience.estimatedEngagedAudience)}) is less than half the ${formatCount(archetype.minimumEngagedAudience)} this normally needs.`,
    );
  }

  const hoursNeeded = EFFORT_HOURS[archetype.effort];
  if (operator && operator.hoursPerWeek > 0 && operator.hoursPerWeek < hoursNeeded) {
    blockers.push(
      `Needs roughly ${hoursNeeded}h/week to run; ${operator.hoursPerWeek}h available.`,
    );
  }

  const capital = CAPITAL_REQUIRED[archetype.id];
  if (capital && operator && operator.startingCapitalUsd < capital) {
    blockers.push(
      `Needs about ${formatUsd(capital)} up front; ${formatUsd(operator.startingCapitalUsd)} available.`,
    );
  }

  if (operator && archetype.requiredSkills.length > 0) {
    const owned = operator.skills.map((s) => s.toLowerCase());
    const missing = archetype.requiredSkills.filter((required) => {
      const needle = required.toLowerCase();
      if (needle.includes("already film")) return false;
      return !owned.some((skill) => skill.includes(needle) || needle.includes(skill));
    });
    // One gap is a learning curve; most of them missing is a different job.
    if (missing.length > 0 && missing.length >= archetype.requiredSkills.length) {
      blockers.push(`No stated experience in: ${missing.join(", ")}.`);
    }
  }

  return blockers;
}

function buildRationale(
  archetype: ProductArchetype,
  projection: Projection,
  profile: ChannelProfile,
  audience: AudienceModel,
  fitScore: number,
): string[] {
  const rationale: string[] = [];
  const base = projection.scenarios.base;
  const low = projection.scenarios.conservative;
  const high = projection.scenarios.optimistic;

  rationale.push(
    `Base case ${formatUsd(base.netMonthlyRevenue)}/month net, within a range of ${formatUsd(low.netMonthlyRevenue)} to ${formatUsd(high.netMonthlyRevenue)}.`,
  );

  if (isViewDriven(archetype)) {
    rationale.push(
      archetype.category === "platform"
        ? `Priced off ${formatCount(audience.monthlyViews)} monthly views at ${profile.niche.label} RPM, with Shorts earning a fraction of the long-form rate.`
        : `Priced off median long-form reach rather than total monthly views — one integration reaches one video's audience.`,
    );
  } else {
    rationale.push(
      `${base.buyers < 1 ? "Fewer than one buyer" : `About ${Math.round(base.buyers)} buyer${Math.round(base.buyers) === 1 ? "" : "s"}`} per month at ${formatUsd(base.price)}, from an engaged audience of ${formatCount(audience.estimatedEngagedAudience)}.`,
    );
  }

  rationale.push(
    `First revenue in about ${archetype.timeToFirstRevenueDays} days at roughly ${EFFORT_HOURS[archetype.effort]}h/week; ${formatUsd(projection.expectedValue90d)} reachable inside 90 days.`,
  );

  if (fitScore >= 0.85) {
    rationale.push(`Strong fit for ${profile.niche.label} at this channel's scale and format mix.`);
  } else if (fitScore <= 0.5) {
    rationale.push(
      `Weak structural fit: either the niche, the audience size or the format mix works against this one.`,
    );
  }

  for (const warning of projection.warnings) rationale.push(warning);

  return rationale;
}

/** The headline: the highest-return play that is actually unblocked today. */
export function pathOfLeastResistance(plays: Play[]): Play | undefined {
  return plays.find((p) => p.blockers.length === 0) ?? plays[0];
}
