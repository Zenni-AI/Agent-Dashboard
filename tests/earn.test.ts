import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findPlay, PLAYS } from "../src/earn/catalog.js";
import { GENERAL_COMPLIANCE, PROHIBITIONS, refusalSummary, screenActivity } from "../src/earn/guardrails.js";
import { addEntry, loadLedger, saveLedger, summarizeLedger, TAX_RESERVE_RATE } from "../src/earn/ledger.js";
import { buildEarnPlan, expectedInWindow, rankIncomePlays, valueDensity, WORKING_DAYS_PER_WEEK } from "../src/earn/rank.js";
import { renderEarnPlan } from "../src/earn/report.js";
import { buildSituationBrief, DailyBriefSchema, EARNER_SYSTEM_PROMPT } from "../src/earn/agent.js";
import type { Ledger, PlayRequirement, Situation } from "../src/earn/types.js";

const EVERYTHING: PlayRequirement[] = [
  "age-18", "age-21", "car", "drivers-license", "smartphone", "computer", "internet",
  "bank-account", "can-leave-home", "physical-work", "work-authorization",
  "clean-driving-record", "background-check",
];

function situation(overrides: Partial<Situation> = {}): Situation {
  return {
    urgencyDays: 14,
    hoursPerDay: 6,
    cashOnHandUsd: 100,
    skills: [],
    has: EVERYTHING,
    ...overrides,
  };
}

describe("catalogue", () => {
  it("has unique ids and every play carries economics, compliance and ethics", () => {
    const ids = new Set(PLAYS.map((p) => p.id));
    expect(ids.size).toBe(PLAYS.length);
    for (const play of PLAYS) {
      expect(play.hourlyUsd.low).toBeLessThanOrEqual(play.hourlyUsd.high);
      expect(play.hourlyUsd.high).toBeGreaterThan(0);
      expect(play.maxHoursPerWeek).toBeGreaterThan(0);
      expect(play.timeToFirstDollarDays).toBeGreaterThanOrEqual(0);
      expect(play.startupCapitalUsd).toBeGreaterThanOrEqual(0);
      expect(play.compliance.length, play.id).toBeGreaterThan(0);
      expect(play.ethics.length, play.id).toBeGreaterThan(0);
      expect(play.risks.length, play.id).toBeGreaterThan(0);
      expect(play.platforms.length, play.id).toBeGreaterThan(0);
    }
  });

  it("contains nothing its own charter would block", () => {
    for (const play of PLAYS) {
      const result = screenActivity(`${play.name}. ${play.description}`);
      expect(result.verdict, play.id).toBe("allowed");
    }
  });

  it("never requires borrowing: no play needs more than a few hundred dollars to start", () => {
    for (const play of PLAYS) expect(play.startupCapitalUsd, play.id).toBeLessThanOrEqual(500);
  });

  it("has at least one play that pays the same day and several inside a week", () => {
    expect(PLAYS.some((p) => p.timeToFirstDollarDays === 0)).toBe(true);
    expect(PLAYS.filter((p) => p.timeToFirstDollarDays <= 7).length).toBeGreaterThanOrEqual(8);
  });

  it("finds plays by id", () => {
    expect(findPlay("sell-belongings")?.category).toBe("liquidate");
    expect(findPlay("nope")).toBeUndefined();
  });
});

describe("screenActivity", () => {
  it("blocks the obvious shapes of illegal or deceptive income", () => {
    const cases: [string, string][] = [
      ["sports betting with a system", "gambling"],
      ["write fake reviews for local businesses", "fraud-deception"],
      ["join an MLM and build a downline", "mlm-pyramid"],
      ["do electrical work for neighbours without a license", "unlicensed-regulated-work"],
      ["get paid under the table cleaning houses", "tax-evasion"],
      ["cash checks for a guy online and keep 10%", "financial-crime"],
      ["sell my Instagram account", "data-abuse"],
      ["write students' essays for money", "academic-dishonesty"],
      ["print Disney shirts and sell them", "ip-theft"],
    ];
    for (const [text, id] of cases) {
      const result = screenActivity(text);
      expect(result.verdict, text).toBe("blocked");
      expect(result.matched.map((m) => m.id), text).toContain(id);
    }
  });

  it("declines legal-but-out-of-scope activities without calling them illegal", () => {
    const result = screenActivity("start an OnlyFans");
    expect(result.verdict).toBe("declined");
    expect(result.matched[0]!.label).toBe("Adult content");
  });

  it("allows ordinary honest work and always returns the general obligations", () => {
    for (const text of ["tutor algebra", "walk dogs", "sell my old bike", "deliver for DoorDash"]) {
      const result = screenActivity(text);
      expect(result.verdict, text).toBe("allowed");
      expect(result.generalObligations.length).toBe(GENERAL_COMPLIANCE.length);
    }
  });

  it("summarises every refusal for the plan", () => {
    expect(refusalSummary().length).toBeGreaterThanOrEqual(PROHIBITIONS.length);
  });
});

describe("rankIncomePlays", () => {
  it("sorts available plays by score and blocked plays after them", () => {
    const ranked = rankIncomePlays(situation({ has: ["smartphone", "internet", "age-18", "computer"] }));
    const firstBlocked = ranked.findIndex((r) => r.blockers.length > 0);
    expect(firstBlocked).toBeGreaterThan(0);
    for (let i = 1; i < firstBlocked; i += 1) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
    for (let i = firstBlocked; i < ranked.length; i += 1) {
      expect(ranked[i]!.blockers.length).toBeGreaterThan(0);
    }
  });

  it("puts same-day money first when the window is a week", () => {
    const ranked = rankIncomePlays(situation({ urgencyDays: 7 }), { includeBlocked: false });
    expect(ranked[0]!.play.timeToFirstDollarDays).toBeLessThanOrEqual(1);
  });

  it("weights speed less as the window lengthens", () => {
    const short = rankIncomePlays(situation({ urgencyDays: 7 })).find((r) => r.play.id === "notary")!;
    const long = rankIncomePlays(situation({ urgencyDays: 120 })).find((r) => r.play.id === "notary")!;
    expect(long.speedScore).toBeGreaterThan(short.speedScore);
    expect(long.expectedUsdInWindow.high).toBeGreaterThan(short.expectedUsdInWindow.high);
  });

  it("blocks what the person cannot do and says why", () => {
    const ranked = rankIncomePlays(situation({ has: ["smartphone", "internet", "age-18", "computer"] }));
    const rideshare = ranked.find((r) => r.play.id === "rideshare")!;
    expect(rideshare.blockers.join(" ")).toMatch(/car/);
    expect(rideshare.blockers.join(" ")).toMatch(/21/);
    const tutoring = ranked.find((r) => r.play.id === "tutoring")!;
    expect(tutoring.blockers).toEqual([]);
  });

  it("blocks plays that cost more to start than the person has", () => {
    const broke = rankIncomePlays(situation({ cashOnHandUsd: 0 })).find((r) => r.play.id === "exterior-cleaning")!;
    expect(broke.blockers.join(" ")).toMatch(/up front/);
    const funded = rankIncomePlays(situation({ cashOnHandUsd: 400 })).find((r) => r.play.id === "exterior-cleaning")!;
    expect(funded.blockers).toEqual([]);
  });

  it("respects plays the person refuses, without ranking them at all", () => {
    const ranked = rankIncomePlays(situation({ excludePlayIds: ["plasma-donation", "clinical-trials"] }));
    expect(ranked.some((r) => r.play.id === "plasma-donation")).toBe(false);
    expect(ranked.some((r) => r.play.id === "clinical-trials")).toBe(false);
  });

  it("rewards stated skills without gating on them", () => {
    const none = rankIncomePlays(situation()).find((r) => r.play.id === "tutoring")!;
    const teacher = rankIncomePlays(situation({ skills: ["teaching", "math"] })).find((r) => r.play.id === "tutoring")!;
    expect(teacher.skillScore).toBeGreaterThan(none.skillScore);
    expect(none.blockers).toEqual([]);
  });

  it("surfaces blocking compliance steps as must-do-first", () => {
    const delivery = rankIncomePlays(situation()).find((r) => r.play.id === "food-delivery")!;
    expect(delivery.mustDoFirst.join(" ")).toMatch(/insurer/);
  });
});

describe("expectedInWindow", () => {
  it("is zero when the play cannot start inside the window", () => {
    const notary = findPlay("notary")!;
    expect(expectedInWindow(notary, 10, 7)).toEqual({ low: 0, high: 0 });
  });

  it("subtracts startup capital and never goes negative", () => {
    const washing = findPlay("exterior-cleaning")!;
    // 3 earning days of a 7-day window at 20h/week ≈ 8.6h: low = 8.6*40 - 350 < 0,
    // clamped to zero; high = 8.6*80 - 350 ≈ 336.
    const band = expectedInWindow(washing, 20, 7);
    expect(band.low).toBe(0);
    expect(band.high).toBeGreaterThan(300);
    expect(band.high).toBeLessThan(400);
    // With too few hours to cover the washer, both ends clamp rather than go negative.
    expect(expectedInWindow(washing, 10, 7)).toEqual({ low: 0, high: 0 });
  });

  it("scales with hours and with window", () => {
    const tutoring = findPlay("tutoring")!;
    const small = expectedInWindow(tutoring, 5, 14);
    const big = expectedInWindow(tutoring, 10, 14);
    const longer = expectedInWindow(tutoring, 5, 28);
    expect(big.high).toBeGreaterThan(small.high);
    expect(longer.high).toBeGreaterThan(small.high);
  });
});

describe("valueDensity", () => {
  it("charges slow starters for the days they pay nothing", () => {
    const selling = findPlay("sell-belongings")!;
    const freelance = findPlay("freelance-services")!;
    // Comparable hourly bands, but freelance waits a week; in a 10-day window it must lose.
    expect(valueDensity(selling, 36, 10)).toBeGreaterThan(valueDensity(freelance, 36, 10));
    // Over a long window the lag matters less and the rates decide.
    expect(valueDensity(freelance, 36, 120)).toBeGreaterThan(valueDensity(freelance, 36, 10));
  });

  it("is zero when nothing can be earned inside the window", () => {
    expect(valueDensity(findPlay("notary")!, 36, 14)).toBe(0);
    expect(valueDensity(findPlay("tutoring")!, 0, 14)).toBe(0);
  });
});

describe("buildEarnPlan", () => {
  it("fills the available hours with a stack and never over-allocates", () => {
    const plan = buildEarnPlan(situation({ hoursPerDay: 5 }));
    const total = plan.stack.reduce((s, r) => s + r.allocatedHoursPerWeek, 0);
    expect(total).toBeLessThanOrEqual(5 * WORKING_DAYS_PER_WEEK);
    expect(total).toBeGreaterThan(0);
    for (const item of plan.stack) {
      expect(item.blockers).toEqual([]);
      expect(item.allocatedHoursPerWeek).toBeLessThanOrEqual(item.play.maxHoursPerWeek);
      expect(item.expectedUsdInWindow.high).toBeGreaterThan(0);
    }
  });

  it("projects the stack's first week and window totals", () => {
    const plan = buildEarnPlan(situation({ urgencyDays: 14 }));
    expect(plan.projection.windowUsd.high).toBeGreaterThanOrEqual(plan.projection.firstWeekUsd.high);
    expect(plan.projection.firstWeekUsd.high).toBeGreaterThan(0);
    expect(plan.projection.targetReachable).toBeNull();
  });

  it("says honestly whether a target is reachable", () => {
    const tiny = buildEarnPlan(situation({ targetUsd: 50 }));
    expect(tiny.projection.targetReachable).toBe(true);
    const absurd = buildEarnPlan(situation({ targetUsd: 1_000_000 }));
    expect(absurd.projection.targetReachable).toBe(false);
  });

  it("puts blocking legal steps before the general obligations in the checklist", () => {
    // Only plasma is available here, and its FDA screening note is blocking.
    const plan = buildEarnPlan(situation({ has: ["age-18", "can-leave-home"], urgencyDays: 7 }));
    expect(plan.stack.map((s) => s.play.id)).toEqual(["plasma-donation"]);
    expect(plan.setupChecklist[0]!.startsWith("[Plasma donation]")).toBe(true);
    const authorised = plan.setupChecklist.findIndex((s) => /authorised to work/.test(s));
    const report = plan.setupChecklist.findIndex((s) => /Report all income/.test(s));
    expect(authorised).toBeGreaterThan(0);
    expect(report).toBeGreaterThan(authorised);
    expect(new Set(plan.setupChecklist).size).toBe(plan.setupChecklist.length);
  });

  it("keeps same-day selling in the stack even when big plays could fill every hour", () => {
    const plan = buildEarnPlan(situation({ urgencyDays: 10, hoursPerDay: 6, cashOnHandUsd: 50 }));
    const ids = plan.stack.map((s) => s.play.id);
    expect(ids).toContain("sell-belongings");
    expect(ids).toContain("local-labor");
    expect(plan.stack.find((s) => s.play.id === "sell-belongings")!.allocatedHoursPerWeek).toBe(8);
    // Whole dollars, and the rationale agrees with the stacked allocation.
    for (const item of plan.stack) {
      expect(Number.isInteger(item.expectedUsdInWindow.low)).toBe(true);
      expect(item.rationale.join(" ")).toContain(`${item.allocatedHoursPerWeek}h/week`);
    }
  });

  it("presents the stack fastest-first so the headline play pays soonest", () => {
    const plan = buildEarnPlan(situation({ urgencyDays: 14 }));
    for (let i = 1; i < plan.stack.length; i += 1) {
      expect(plan.stack[i - 1]!.play.timeToFirstDollarDays).toBeLessThanOrEqual(
        plan.stack[i]!.play.timeToFirstDollarDays,
      );
    }
    expect(plan.stack[0]!.play.timeToFirstDollarDays).toBe(0);
  });

  it("excludes plays that cannot pay inside the window from the stack", () => {
    const plan = buildEarnPlan(situation({ urgencyDays: 5, hoursPerDay: 12 }));
    for (const item of plan.stack) {
      expect(item.play.timeToFirstDollarDays).toBeLessThan(5);
    }
  });

  it("carries the refusals into the plan", () => {
    const plan = buildEarnPlan(situation());
    expect(plan.refused.join(" ")).toMatch(/Gambling/);
    expect(plan.refused.join(" ")).toMatch(/Fraud/);
  });

  it("produces an empty stack, not a crash, when nothing is available", () => {
    const plan = buildEarnPlan(situation({ has: [], cashOnHandUsd: 0, hoursPerDay: 0 }));
    expect(plan.stack).toEqual([]);
    expect(plan.projection.firstWeekUsd).toEqual({ low: 0, high: 0 });
  });
});

describe("ledger", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "litix-earn-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts empty when the file does not exist and round-trips through disk", async () => {
    const path = join(dir, "nested", "ledger.json");
    const empty = await loadLedger(path);
    expect(empty.entries).toEqual([]);

    const withEntry = addEntry(empty, {
      date: "2026-09-12", playId: "pet-care", grossUsd: 80, hours: 3, expensesUsd: 5, note: "two walks",
    });
    await saveLedger(withEntry, path);
    const reloaded = await loadLedger(path);
    expect(reloaded.entries).toHaveLength(1);
    expect(JSON.parse(await readFile(path, "utf8")).entries[0].playId).toBe("pet-care");
  });

  it("rejects malformed entries", () => {
    const ledger: Ledger = { createdAt: "2026-09-01T00:00:00.000Z", entries: [] };
    expect(() => addEntry(ledger, { date: "9/12/26", playId: "x", grossUsd: 1, hours: 1, expensesUsd: 0 })).toThrow(/YYYY-MM-DD/);
    expect(() => addEntry(ledger, { date: "2026-09-12", playId: "x", grossUsd: -1, hours: 1, expensesUsd: 0 })).toThrow(/grossUsd/);
  });

  it("summarises net, rates, per-play breakdown and tax reserve", () => {
    const ledger: Ledger = {
      createdAt: "2026-09-01T00:00:00.000Z",
      entries: [
        { date: "2026-09-10", playId: "sell-belongings", grossUsd: 300, hours: 2, expensesUsd: 0 },
        { date: "2026-09-11", playId: "food-delivery", grossUsd: 120, hours: 6, expensesUsd: 30 },
        { date: "2026-09-11", playId: "food-delivery", grossUsd: 60, hours: 3, expensesUsd: 10 },
      ],
    };
    const summary = summarizeLedger(ledger, new Date("2026-09-12T12:00:00Z"));
    expect(summary.grossUsd).toBe(480);
    expect(summary.expensesUsd).toBe(40);
    expect(summary.netUsd).toBe(440);
    expect(summary.hours).toBe(11);
    expect(summary.netPerHour).toBe(40);
    expect(summary.daysActive).toBe(3);
    expect(summary.taxReserveUsd).toBe(Math.round(440 * TAX_RESERVE_RATE * 100) / 100);
    expect(summary.byPlay[0]!.playId).toBe("sell-belongings");
    expect(summary.byPlay.find((p) => p.playId === "food-delivery")!.netUsd).toBe(140);
  });
});

describe("renderEarnPlan", () => {
  it("renders the plan with the sections a person acts on", () => {
    const plan = buildEarnPlan(situation({ targetUsd: 800 }));
    const markdown = renderEarnPlan(plan, {
      brief: {
        headline: "Sell the bike, sign up for shifts.",
        today: [{ when: "9am", action: "Photograph and list", playId: "sell-belongings", expectedUsd: "$100 today" }],
        thisWeek: ["Apply to Instawork on Monday"],
        legalChecklist: ["Log every dollar"],
        successMetric: "Listings live",
        killCriteria: "Nothing sold by Sunday",
        declined: [],
      },
    });
    expect(markdown).toContain("# The Earner — New Jersey");
    expect(markdown).toContain("## The short version");
    expect(markdown).toContain("## Today");
    expect(markdown).toContain("## The stack");
    expect(markdown).toContain("## Everything ranked");
    expect(markdown).toContain("## Legal checklist");
    expect(markdown).toContain("## What this plan will never recommend");
    expect(markdown).toContain("Sell the bike, sign up for shifts.");
    expect(markdown).not.toContain("## Declined");
  });

  it("includes the ledger when there is one", () => {
    const plan = buildEarnPlan(situation());
    const ledger: Ledger = {
      createdAt: "2026-09-01T00:00:00.000Z",
      entries: [{ date: "2026-09-10", playId: "tutoring", grossUsd: 90, hours: 2, expensesUsd: 0 }],
    };
    const markdown = renderEarnPlan(plan, { ledger: summarizeLedger(ledger, new Date("2026-09-12T00:00:00Z")) });
    expect(markdown).toContain("## So far");
    expect(markdown).toContain("tutoring");
  });
});

describe("agent surface", () => {
  it("writes the situation brief from the deterministic inputs, volatile parts included", () => {
    const ledger: Ledger = {
      createdAt: "2026-09-01T00:00:00.000Z",
      entries: [{ date: "2026-09-11", playId: "pet-care", grossUsd: 60, hours: 2, expensesUsd: 0 }],
    };
    const brief = buildSituationBrief(
      {
        situation: situation({ town: "Montclair", notes: "I have a bike", targetUsd: 900 }),
        ledger,
        proposals: ["sell my old bike", "sports betting"],
      },
      new Date("2026-09-12T15:00:00Z"),
    );
    expect(brief).toContain("Saturday, 2026-09-12");
    expect(brief).toContain("Montclair");
    expect(brief).toContain("Target: $900");
    expect(brief).toContain("sports betting");
    expect(brief).toContain("Screen each one with screen_activity");
    expect(brief).toContain("Net $60");
  });

  it("keeps the system prompt free of anything that changes between runs", () => {
    expect(EARNER_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(EARNER_SYSTEM_PROMPT).toContain("Never invent");
  });

  it("validates a brief the way the agent's output format does", () => {
    const ok = DailyBriefSchema.safeParse({
      headline: "h", today: [{ when: "9am", action: "list the bike" }], thisWeek: [],
      legalChecklist: ["log income"], successMetric: "one sale", killCriteria: "none by Sunday", declined: [],
    });
    expect(ok.success).toBe(true);
    expect(DailyBriefSchema.safeParse({ headline: "h" }).success).toBe(false);
  });
});
