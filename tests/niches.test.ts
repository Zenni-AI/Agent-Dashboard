import { describe, expect, it } from "vitest";
import { classifyNiche, findNiche, NICHES } from "../src/analysis/niches.js";
import { channel, video } from "./helpers.js";

describe("classifyNiche", () => {
  it("identifies a niche from video titles", () => {
    const videos = [
      video({ views: 100, title: "Soft wash roof cleaning on a big house" }),
      video({ views: 100, title: "Pressure wash driveway before and after" }),
      video({ views: 100, title: "Gutter cleaning quote walkthrough" }),
      video({ views: 100, title: "How I price exterior cleaning jobs" }),
    ];
    const niche = classifyNiche(channel(), videos);

    expect(niche.slug).toBe("home-services");
    expect(niche.commercialIntent).toBeGreaterThan(0.8);
    expect(niche.signals.length).toBeGreaterThan(0);
  });

  it("falls back to neutral assumptions when nothing matches", () => {
    const niche = classifyNiche(channel(), [video({ views: 1, title: "zzzz qqqq" })]);
    expect(niche.slug).toBe("general");
    expect(niche.confidence).toBe(0);
    expect(niche.commercialIntent).toBe(0.5);
  });

  it("reports low confidence when two niches match equally", () => {
    const videos = [
      video({ views: 100, title: "gameplay walkthrough speedrun" }),
      video({ views: 100, title: "workout gym muscle training" }),
    ];
    expect(classifyNiche(channel(), videos).confidence).toBeLessThan(0.5);
  });

  it("weights titles above the channel description", () => {
    const niche = classifyNiche(
      channel({ description: "gaming gameplay" }),
      Array.from({ length: 6 }, (_, i) =>
        video({ videoId: `v${i}`, views: 100, title: "welding hvac plumbing job site" }),
      ),
    );
    expect(niche.slug).toBe("skilled-trades");
  });
});

describe("niche registry", () => {
  it("has unique slugs and sane commercial intent", () => {
    const slugs = NICHES.map((n) => n.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const niche of NICHES) {
      expect(niche.commercialIntent).toBeGreaterThan(0);
      expect(niche.commercialIntent).toBeLessThanOrEqual(1);
      expect(niche.rpmRange.low).toBeLessThan(niche.rpmRange.high);
      expect(niche.keywords.length).toBeGreaterThan(0);
    }
  });

  it("returns the fallback for an unknown slug", () => {
    expect(findNiche("does-not-exist").slug).toBe("general");
  });
});
