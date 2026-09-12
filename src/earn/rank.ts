import { clamp, round, safeDivide } from "../util/stats.js";
import { PLAYS } from "./catalog.js";
import { GENERAL_COMPLIANCE, refusalSummary } from "./guardrails.js";
import type { EarnPlan, IncomePlay, PlayRequirement, RankedPlay, Situation } from "./types.js";

/**
 * Ranking for someone who needs money soon.
 *
 * The usual way to rank income options is by how much they pay. That produces
 * a list headed by things that pay in six weeks, which is useless to someone
 * whose rent is due in nine days. This ranker asks a different question: how
 * many dollars can this play realistically put in the person's hand inside
 * their window, given the hours they have, the things they own, and the days
 * the play takes to start paying? Speed is weighted explicitly on top, scaled
 * by urgency, so a same-day play beats a slightly richer next-week one when
 * the window is short and loses when it is long.
 */

/** Hours per day are assumed to be available six days a week, not seven. */
export const WORKING_DAYS_PER_WEEK = 6;

/** Weights on the three scored dimensions. Speed leads because the brief says so. */
export const WEIGHTS = { speed: 0.45, money: 0.4, skill: 0.15 } as const;

export const REQUIREMENT_LABELS: Record<PlayRequirement, string> = {
  "age-18": "be at least 18",
  "age-21": "be at least 21",
  car: "have a car",
  "drivers-license": "hold a driver's licence",
  smartphone: "have a smartphone",
  computer: "have a computer",
  internet: "have internet access",
  "bank-account": "have a bank account",
  "can-leave-home": "be able to work outside the home",
  "physical-work": "be able to do physical work",
  "work-authorization": "be authorised to work in the US",
  "clean-driving-record": "have a clean driving record",
  "background-check": "pass a background check",
};

export interface RankOptions {
  /** Keep blocked plays in the list (ranked after the available ones). Default true. */
  includeBlocked?: boolean;
}

export function rankIncomePlays(situation: Situation, options: RankOptions = {}): RankedPlay[] {
  const weeklyHours = Math.max(0, situation.hoursPerDay) * WORKING_DAYS_PER_WEEK;
  const excluded = new Set(situation.excludePlayIds ?? []);
  const candidates = PLAYS.filter((p) => !excluded.has(p.id));

  const scored = candidates.map((play) => {
    const allocated = Math.min(play.maxHoursPerWeek, weeklyHours);
    const windowUsd = expectedInWindow(play, allocated, situation.urgencyDays);
    const firstWeekUsd = expectedInWindow(play, allocated, 7);
    return { play, allocated, windowUsd, firstWeekUsd };
  });

  // Money is relative to the best option on the board for this person.
  const bestMid = Math.max(...scored.map((s) => mid(s.windowUsd)), 1);

  const ranked = scored.map(({ play, allocated, windowUsd, firstWeekUsd }): RankedPlay => {
    const blockers = findBlockers(play, situation);
    const speedScore = clamp(
      safeDivide(situation.urgencyDays, play.timeToFirstDollarDays + situation.urgencyDays, 0),
      0,
      1,
    );
    const moneyScore = clamp(safeDivide(mid(windowUsd), bestMid, 0), 0, 1);
    const skillScore = scoreSkills(play, situation.skills);
    const score = clamp(
      WEIGHTS.speed * speedScore + WEIGHTS.money * moneyScore + WEIGHTS.skill * skillScore,
      0,
      1,
    );

    return {
      play,
      expectedUsdInWindow: windowUsd,
      expectedUsdFirstWeek: firstWeekUsd,
      allocatedHoursPerWeek: allocated,
      speedScore: round(speedScore, 3),
      moneyScore: round(moneyScore, 3),
      skillScore: round(skillScore, 3),
      score: round(score, 3),
      blockers,
      mustDoFirst: play.compliance.filter((c) => c.blocking).map((c) => c.requirement),
      rationale: buildRationale(play, windowUsd, allocated, situation),
    };
  });

  ranked.sort((a, b) => {
    const aBlocked = a.blockers.length > 0 ? 1 : 0;
    const bBlocked = b.blockers.length > 0 ? 1 : 0;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    return b.score - a.score;
  });

  return options.includeBlocked === false ? ranked.filter((r) => r.blockers.length === 0) : ranked;
}

/**
 * Build the plan: the ranked list, then the stack that fills the available hours.
 *
 * Hours are the scarce resource, so the stack is filled by value per hour
 * inside the window rather than by total value: a play that pays $50 an hour
 * but can only absorb eight hours a week (selling what you own) takes its
 * eight hours first, and the big-capacity plays fill what is left. Filling in
 * rank order instead lets one 25-hour play crowd out the only same-day money
 * on the list, which is exactly wrong for someone who needs cash this week.
 *
 * The stack is then presented fastest-first, so the headline play is the one
 * that pays soonest, not the one with the best density.
 */
export function buildEarnPlan(situation: Situation): EarnPlan {
  const ranked = rankIncomePlays(situation);
  const weeklyHours = Math.max(0, situation.hoursPerDay) * WORKING_DAYS_PER_WEEK;

  const available = ranked
    .filter((r) => r.blockers.length === 0)
    .map((r) => ({ r, density: valueDensity(r.play, weeklyHours, situation.urgencyDays) }))
    // A play that cannot produce a dollar inside the window does not belong in
    // the stack, however well it ranks on paper.
    .filter((c) => c.density > 0)
    .sort((a, b) => b.density - a.density || b.r.score - a.r.score);

  let remaining = weeklyHours;
  const chosen: { r: RankedPlay; density: number }[] = [];
  for (const candidate of available) {
    if (remaining <= 0) break;
    const hours = Math.min(candidate.r.play.maxHoursPerWeek, remaining);
    if (hours <= 0) continue;
    const windowUsd = expectedInWindow(candidate.r.play, hours, situation.urgencyDays);
    if (windowUsd.high <= 0) continue;
    chosen.push({
      density: candidate.density,
      r: {
        ...candidate.r,
        allocatedHoursPerWeek: hours,
        expectedUsdInWindow: windowUsd,
        expectedUsdFirstWeek: expectedInWindow(candidate.r.play, hours, 7),
        // The rationale quotes hours and dollars, so it is rebuilt for the
        // hours the stack actually gives this play.
        rationale: buildRationale(candidate.r.play, windowUsd, hours, situation),
      },
    });
    remaining -= hours;
  }

  const stack = chosen
    .sort(
      (a, b) =>
        a.r.play.timeToFirstDollarDays - b.r.play.timeToFirstDollarDays || b.density - a.density,
    )
    .map((c) => c.r);

  const firstWeekUsd = sumBands(stack.map((s) => s.expectedUsdFirstWeek));
  const windowUsd = sumBands(stack.map((s) => s.expectedUsdInWindow));

  return {
    generatedAt: new Date().toISOString(),
    situation,
    ranked,
    stack,
    setupChecklist: buildChecklist(stack),
    refused: refusalSummary(),
    projection: {
      firstWeekUsd,
      windowUsd,
      targetReachable:
        situation.targetUsd === undefined ? null : mid(windowUsd) >= situation.targetUsd,
    },
  };
}

/**
 * Dollars a play can produce inside a window of N days, given weekly hours.
 *
 * Earning days are the window minus the start lag. Startup capital is
 * subtracted from both ends of the band, so a play that needs a $350 washer
 * shows its true first-week number, which can be negative.
 */
export function expectedInWindow(
  play: IncomePlay,
  hoursPerWeek: number,
  windowDays: number,
): { low: number; high: number } {
  const earningDays = Math.max(0, windowDays - play.timeToFirstDollarDays);
  if (earningDays <= 0 || hoursPerWeek <= 0) {
    return { low: 0, high: 0 };
  }
  const hours = hoursPerWeek * (earningDays / 7);
  return {
    low: round(Math.max(0, hours * play.hourlyUsd.low - play.startupCapitalUsd), 0),
    high: round(Math.max(0, hours * play.hourlyUsd.high - play.startupCapitalUsd), 0),
  };
}

/**
 * Expected mid-band dollars inside the window per hour of weekly capacity the
 * play *reserves* across the whole window, idle start-up days included.
 *
 * Dividing by hours actually worked would flatter slow starters: a play that
 * pays $50 an hour from day eight looks as good as one that pays $50 an hour
 * from day one. Dividing by reserved capacity charges the lag, so the density
 * of a play falls in proportion to the share of the window it spends paying
 * nothing. Startup capital is already subtracted from the band. Zero when the
 * play cannot pay inside the window at all.
 */
export function valueDensity(play: IncomePlay, weeklyHours: number, windowDays: number): number {
  const hoursPerWeek = Math.min(play.maxHoursPerWeek, weeklyHours);
  const reservedHours = hoursPerWeek * (windowDays / 7);
  if (reservedHours <= 0) return 0;
  const band = expectedInWindow(play, hoursPerWeek, windowDays);
  if (band.high <= 0) return 0;
  return round(safeDivide(mid(band), reservedHours, 0), 2);
}

function findBlockers(play: IncomePlay, situation: Situation): string[] {
  const has = new Set(situation.has);
  const blockers: string[] = [];
  for (const requirement of play.requirements) {
    if (!has.has(requirement)) {
      blockers.push(`You need to ${REQUIREMENT_LABELS[requirement]}.`);
    }
  }
  if (play.startupCapitalUsd > situation.cashOnHandUsd) {
    blockers.push(
      `Needs $${play.startupCapitalUsd} up front; you have $${Math.round(situation.cashOnHandUsd)}.`,
    );
  }
  return blockers;
}

/** Helpful skills are a bonus, never a gate: a play with none scores full marks. */
function scoreSkills(play: IncomePlay, skills: string[]): number {
  if (play.helpfulSkills.length === 0) return 1;
  const owned = skills.map((s) => s.toLowerCase().trim()).filter(Boolean);
  if (owned.length === 0) return 0.6;
  const matched = play.helpfulSkills.filter((helpful) => {
    const needle = helpful.toLowerCase();
    return owned.some((skill) => needle.includes(skill) || skill.includes(needle));
  });
  return clamp(0.6 + 0.4 * safeDivide(matched.length, play.helpfulSkills.length, 0), 0.6, 1);
}

function buildRationale(
  play: IncomePlay,
  windowUsd: { low: number; high: number },
  allocated: number,
  situation: Situation,
): string[] {
  const lines: string[] = [];
  lines.push(
    play.timeToFirstDollarDays === 0
      ? "Pays the same day you start."
      : `First money in about ${play.timeToFirstDollarDays} day${play.timeToFirstDollarDays === 1 ? "" : "s"}.`,
  );
  lines.push(
    `$${play.hourlyUsd.low}-${play.hourlyUsd.high} an hour after costs; ${allocated}h/week available to it.`,
  );
  if (windowUsd.high > 0) {
    lines.push(`Roughly $${windowUsd.low}-${windowUsd.high} inside your ${situation.urgencyDays}-day window.`);
  } else {
    lines.push(`Will not pay inside your ${situation.urgencyDays}-day window; a later-stage play.`);
  }
  if (play.startupCapitalUsd > 0) {
    lines.push(`Costs $${play.startupCapitalUsd} to start, already subtracted above.`);
  }
  if (play.online) lines.push("Can be done from home.");
  return lines;
}

function buildChecklist(stack: RankedPlay[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (text: string) => {
    if (seen.has(text)) return;
    seen.add(text);
    out.push(text);
  };
  // Things that block a stacked play come first, in stack order.
  for (const item of stack) {
    for (const note of item.play.compliance.filter((c) => c.blocking)) {
      push(`[${item.play.name}] ${note.requirement}${note.verifyAt ? ` Verify: ${note.verifyAt}` : ""}`);
    }
  }
  for (const note of GENERAL_COMPLIANCE.filter((c) => c.blocking)) {
    push(`${note.requirement}${note.verifyAt ? ` Verify: ${note.verifyAt}` : ""}`);
  }
  // Then the obligations that attach to every dollar.
  for (const note of GENERAL_COMPLIANCE.filter((c) => !c.blocking)) {
    push(`${note.requirement}${note.verifyAt ? ` Verify: ${note.verifyAt}` : ""}`);
  }
  for (const item of stack) {
    for (const note of item.play.compliance.filter((c) => !c.blocking)) {
      push(`[${item.play.name}] ${note.requirement}${note.verifyAt ? ` Verify: ${note.verifyAt}` : ""}`);
    }
  }
  return out;
}

function mid(band: { low: number; high: number }): number {
  return (band.low + band.high) / 2;
}

function sumBands(bands: { low: number; high: number }[]): { low: number; high: number } {
  return bands.reduce(
    (acc, b) => ({ low: round(acc.low + b.low, 0), high: round(acc.high + b.high, 0) }),
    { low: 0, high: 0 },
  );
}
