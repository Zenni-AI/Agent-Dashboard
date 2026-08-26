import { describe, expect, it } from "vitest";
import { classifyFormat, hasShortsHashtag, splitByFormat } from "../src/analysis/format.js";
import { video } from "./helpers.js";

describe("classifyFormat", () => {
  it("treats anything at or under 60s as a Short regardless of hashtags", () => {
    expect(classifyFormat(30, "Quick tip", "", [])).toBe("short");
    expect(classifyFormat(60, "Exactly a minute", "", [])).toBe("short");
  });

  it("treats over 3 minutes as long-form even when tagged #shorts", () => {
    expect(classifyFormat(240, "Long one #shorts", "", [])).toBe("long");
  });

  it("uses the hashtag to break the tie in the ambiguous 60s-180s band", () => {
    expect(classifyFormat(120, "Two minutes", "", [])).toBe("long");
    expect(classifyFormat(120, "Two minutes #shorts", "", [])).toBe("short");
    expect(classifyFormat(120, "Two minutes", "", ["Shorts"])).toBe("short");
  });

  it("respects a custom cutoff for back catalogues predating the 3-minute change", () => {
    expect(classifyFormat(120, "Two minutes #shorts", "", [], { shortsMaxSeconds: 60 })).toBe("long");
  });

  it("marks live broadcasts separately", () => {
    expect(classifyFormat(7200, "Stream", "", [], { isLiveBroadcast: true })).toBe("live");
  });

  it("does not classify an unknown duration as a Short", () => {
    // A zero duration means the API withheld it; calling that a Short would
    // corrupt the Shorts baseline.
    expect(classifyFormat(0, "Processing", "", [])).toBe("long");
  });
});

describe("hasShortsHashtag", () => {
  it("finds the tag in titles, descriptions and tag lists", () => {
    expect(hasShortsHashtag("Cool #shorts", "", [])).toBe(true);
    expect(hasShortsHashtag("Cool", "see #short", [])).toBe(true);
    expect(hasShortsHashtag("Cool", "", ["#shortsfeed"])).toBe(true);
    expect(hasShortsHashtag("Cool", "", ["tutorial"])).toBe(false);
  });
});

describe("splitByFormat", () => {
  it("buckets every video exactly once", () => {
    const list = [
      video({ views: 100, durationSeconds: 30 }),
      video({ views: 200, durationSeconds: 600 }),
      video({ views: 300, durationSeconds: 45 }),
    ];
    const buckets = splitByFormat(list);
    expect(buckets.short).toHaveLength(2);
    expect(buckets.long).toHaveLength(1);
    expect(buckets.short.length + buckets.long.length + buckets.live.length).toBe(list.length);
  });
});
