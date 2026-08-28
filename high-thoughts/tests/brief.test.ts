import { describe, expect, it } from "vitest";
import { BriefSchema, renderChains } from "../src/brief.js";
import { CHAPTERS, renderBrief } from "../src/textbook.js";
import {
  normaliseProfile,
  validateBrief,
  validateChainsRequest,
  ValidationError,
} from "../src/validate.js";

const options = { maxThoughtChars: 4000, maxHistoryTurns: 6, maxChains: 3 };

const chain = {
  thought: "rocket car on the salt flats",
  turns: [
    {
      mode: "riff",
      text: "## The idea\nA car with a rocket on it.",
      marks: [
        { index: 0, state: "keep" as const, text: "A car with a rocket on it." },
        { index: 1, state: "kill" as const, text: "Make it street legal." },
      ],
    },
  ],
};

describe("renderChains", () => {
  it("restates marked lines under their turn so the mark cannot be missed", () => {
    const rendered = renderChains([chain]);
    expect(rendered).toContain("KEPT: A car with a rocket on it.");
    expect(rendered).toContain("KILLED: Make it street legal.");
  });

  it("tells the reader that later passes and marks win", () => {
    const rendered = renderChains([chain]);
    expect(rendered).toMatch(/Later passes override earlier ones/);
    expect(rendered).toMatch(/Marked lines override everything/);
  });

  it("numbers the thoughts only when there is more than one", () => {
    expect(renderChains([chain])).not.toContain("THOUGHT 1 OF");
    expect(renderChains([chain, chain])).toContain("THOUGHT 1 OF 2");
  });

  it("labels each pass with its mode", () => {
    expect(renderChains([chain])).toContain("Pass 1 (Riff)");
  });
});

describe("validateChainsRequest", () => {
  it("keeps a developed chain and its marks", () => {
    const [result] = validateChainsRequest({ chains: [chain] }, options);
    expect(result?.turns[0]?.marks).toHaveLength(2);
  });

  it("drops chains that were never developed", () => {
    expect(() =>
      validateChainsRequest({ chains: [{ thought: "never answered", turns: [] }] }, options),
    ).toThrow(/develop a thought first/);
  });

  it("drops marks with an unknown state rather than the whole turn", () => {
    const [result] = validateChainsRequest(
      {
        chains: [
          {
            thought: "x",
            turns: [{ mode: "riff", text: "answer", marks: [{ state: "maybe", text: "hm" }] }],
          },
        ],
      },
      options,
    );
    expect(result?.turns[0]?.marks).toEqual([]);
  });

  it("caps how many thoughts one book can be built from", () => {
    const many = Array.from({ length: 9 }, () => chain);
    expect(validateChainsRequest({ chains: many }, options)).toHaveLength(3);
  });

  it("rejects a body with no chains at all", () => {
    expect(() => validateChainsRequest({}, options)).toThrow(ValidationError);
    expect(() => validateChainsRequest({ chains: [] }, options)).toThrow(ValidationError);
  });
});

describe("validateBrief", () => {
  const brief = {
    title: "Reverse Tuesday",
    building: "A rocket car.",
    goingWith: ["salt flats"],
    ruledOut: ["street legal"],
    stillOpen: ["who drives it"],
    needToLearn: ["pressure vessels"],
    searchConcepts: ["land speed record"],
    looksLikeSeveral: false,
    separateIdeas: [],
  };

  it("accepts a brief the model produced", () => {
    expect(validateBrief({ brief }).title).toBe("Reverse Tuesday");
  });

  it("rejects a hand-made one missing required fields", () => {
    expect(() => validateBrief({ brief: { title: "x" } })).toThrow(ValidationError);
    expect(() => validateBrief({})).toThrow(ValidationError);
  });

  it("is the same schema the model is held to", () => {
    expect(BriefSchema.safeParse(brief).success).toBe(true);
  });
});

describe("renderBrief", () => {
  const brief = BriefSchema.parse({
    title: "Rocket Car",
    building: "A rocket car for the salt flats.",
    goingWith: ["pulsejet"],
    ruledOut: ["street legal"],
    stillOpen: ["who drives it"],
    needToLearn: ["pressure vessels"],
    searchConcepts: ["pulsejet design"],
    looksLikeSeveral: false,
    separateIdeas: [],
  });

  it("tells the writer not to re-argue settled decisions", () => {
    const rendered = renderBrief(brief);
    expect(rendered).toMatch(/do not re-argue/i);
    expect(rendered).toMatch(/do not propose these again/i);
  });

  it("names every chapter in order", () => {
    const rendered = renderBrief(brief);
    const headings = [...rendered.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([...CHAPTERS]);
  });

  it("omits empty sections rather than emitting a blank heading", () => {
    const sparse = BriefSchema.parse({
      ...brief,
      goingWith: [],
      ruledOut: [],
      stillOpen: [],
      needToLearn: [],
    });
    const rendered = renderBrief(sparse);
    expect(rendered).not.toMatch(/Decided —/);
    expect(rendered).not.toMatch(/Ruled out —/);
    expect(rendered).toContain("A rocket car for the salt flats.");
  });
});

describe("normaliseProfile", () => {
  it("caps every list so a hand-edited profile cannot flood the prompt", () => {
    const profile = normaliseProfile({
      thoughtCount: 5,
      subjects: Array.from({ length: 50 }, (_, i) => `s${i}`),
      keeps: Array.from({ length: 50 }, () => "x".repeat(900)),
      returning: Array.from({ length: 40 }, () => ({ title: "t", passes: 2 })),
      books: Array.from({ length: 30 }, () => "b"),
    });
    expect(profile?.subjects).toHaveLength(6);
    expect(profile?.keeps).toHaveLength(12);
    expect(profile?.keeps[0]).toHaveLength(200);
    expect(profile?.returning).toHaveLength(5);
    expect(profile?.books).toHaveLength(6);
  });

  it("returns null for junk or an empty profile", () => {
    expect(normaliseProfile(null)).toBeNull();
    expect(normaliseProfile("nope")).toBeNull();
    expect(normaliseProfile({ thoughtCount: 3 })).toBeNull();
  });

  it("drops a mode it does not recognise", () => {
    const profile = normaliseProfile({ subjects: ["bees"], favouriteMode: "chaos" });
    expect(profile?.favouriteMode).toBeNull();
  });

  it("keeps a real one", () => {
    const profile = normaliseProfile({ subjects: ["bees"], favouriteMode: "deep" });
    expect(profile?.favouriteMode).toBe("deep");
    expect(profile?.subjects).toEqual(["bees"]);
  });
});
