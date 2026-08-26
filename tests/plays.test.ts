import { describe, expect, it } from "vitest";
import { buildChannelProfile } from "../src/analysis/profile.js";
import { buildAudienceModel } from "../src/monetize/audience.js";
import { pathOfLeastResistance, rankPlays } from "../src/monetize/plays.js";
import type { ChannelDataset, OperatorProfile } from "../src/types.js";
import { channel, videos } from "./helpers.js";

function setup(overrides: Partial<ChannelDataset> = {}) {
  const data: ChannelDataset = {
    channel: channel({
      description: "pressure washing softwash roof cleaning driveway exterior cleaning",
    }),
    videos: videos(30, [20_000], { durationSeconds: 600, ageDays: 60 }),
    ...overrides,
  };
  const profile = buildChannelProfile(data);
  const audience = buildAudienceModel(profile, data);
  return { data, profile, audience };
}

describe("rankPlays", () => {
  it("ranks every archetype and sorts by resistance score", () => {
    const { profile, audience } = setup();
    const plays = rankPlays(profile, audience);

    expect(plays.length).toBeGreaterThan(5);
    for (let i = 1; i < plays.length; i += 1) {
      expect(plays[i - 1]!.resistanceScore).toBeGreaterThanOrEqual(plays[i]!.resistanceScore);
    }
  });

  it("does not simply crown the largest revenue number", () => {
    const { profile, audience } = setup();
    const plays = rankPlays(profile, audience);
    const top = plays[0]!;
    const richest = [...plays].sort(
      (a, b) => b.projection.scenarios.base.netMonthlyRevenue - a.projection.scenarios.base.netMonthlyRevenue,
    )[0]!;

    // Ranking weighs effort and time-to-first-dollar, so the top play should be
    // no harder than the highest-revenue one.
    expect(top.archetype.effort).toBeLessThanOrEqual(richest.archetype.effort);
  });

  it("scores niche-matched archetypes above mismatched ones", () => {
    const { profile, audience } = setup();
    const homeServices = rankPlays(profile, audience).find((p) => p.archetype.id === "operator-playbook")!;

    const gamingProfile = { ...profile, niche: { ...profile.niche, slug: "gaming" } };
    const mismatched = rankPlays(gamingProfile, audience).find(
      (p) => p.archetype.id === "operator-playbook",
    )!;

    expect(homeServices.fitScore).toBeGreaterThan(mismatched.fitScore);
  });

  it("blocks plays the operator cannot resource", () => {
    const { profile, audience } = setup();
    const operator: OperatorProfile = {
      skills: ["pressure washing"],
      hoursPerWeek: 4,
      startingCapitalUsd: 0,
      ownedListSize: 0,
    };
    const plays = rankPlays(profile, audience, { operator });

    const saas = plays.find((p) => p.archetype.id === "saas")!;
    expect(saas.blockers.length).toBeGreaterThan(0);
    expect(saas.blockers.join(" ")).toMatch(/h\/week|up front|No stated experience/);
  });

  it("can drop blocked plays entirely", () => {
    const { profile, audience } = setup();
    const operator: OperatorProfile = {
      skills: [],
      hoursPerWeek: 3,
      startingCapitalUsd: 0,
      ownedListSize: 0,
    };
    const all = rankPlays(profile, audience, { operator });
    const unblocked = rankPlays(profile, audience, { operator, includeBlocked: false });

    expect(unblocked.length).toBeLessThan(all.length);
    expect(unblocked.every((p) => p.blockers.length === 0)).toBe(true);
  });

  it("credits skills the operator already demonstrates on camera", () => {
    const { profile, audience } = setup();
    const consulting = rankPlays(profile, audience, {
      operator: { skills: [], hoursPerWeek: 40, startingCapitalUsd: 0, ownedListSize: 0 },
    }).find((p) => p.archetype.id === "consulting")!;

    // "the craft you already film" is satisfied by publishing it every week.
    expect(consulting.skillScore).toBe(1);
  });

  it("filters to a requested subset", () => {
    const { profile, audience } = setup();
    const plays = rankPlays(profile, audience, { only: ["consulting", "affiliate"] });
    expect(plays.map((p) => p.archetype.id).sort()).toEqual(["affiliate", "consulting"]);
  });

  it("penalises high-ticket offers on a channel with no long-form", () => {
    const shortsOnly = setup({
      videos: videos(30, [20_000], { durationSeconds: 30, ageDays: 60 }),
    });
    const withLongForm = setup();

    const a = rankPlays(shortsOnly.profile, shortsOnly.audience).find(
      (p) => p.archetype.id === "online-course",
    )!;
    const b = rankPlays(withLongForm.profile, withLongForm.audience).find(
      (p) => p.archetype.id === "online-course",
    )!;

    expect(a.fitScore).toBeLessThan(b.fitScore);
  });
});

describe("pathOfLeastResistance", () => {
  it("returns the top unblocked play", () => {
    const { profile, audience } = setup();
    const operator: OperatorProfile = {
      skills: [],
      hoursPerWeek: 5,
      startingCapitalUsd: 0,
      ownedListSize: 0,
    };
    const plays = rankPlays(profile, audience, { operator });
    const best = pathOfLeastResistance(plays)!;

    expect(best.blockers).toEqual([]);
  });
});
