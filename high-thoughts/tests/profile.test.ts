// @ts-nocheck — the client is plain ES modules, shipped to the browser unbuilt.
import { describe, expect, it } from "vitest";
import { buildProfile, isUseful, recurringSubjects } from "../public/profile.js";

const thought = (title, text, turns = 1, marks = []) => ({
  id: title,
  title,
  thought: text,
  turns: Array.from({ length: turns }, () => ({ mode: "riff", text: "answer", marks })),
});

describe("recurringSubjects", () => {
  it("finds subjects that appear in more than one thought", () => {
    const subjects = recurringSubjects([
      thought("A", "hydroponic lettuce in a basement"),
      thought("B", "hydroponic strawberries under lights"),
      thought("C", "a rocket car"),
    ]);
    expect(subjects).toContain("hydroponic");
    expect(subjects).not.toContain("rocket");
  });

  it("ignores filler words even when they recur constantly", () => {
    const subjects = recurringSubjects([
      thought("A", "what if we could just make the thing really good"),
      thought("B", "what if we could just make the thing really big"),
    ]);
    expect(subjects).toEqual([]);
  });

  it("counts a word once per thought, not once per mention", () => {
    const subjects = recurringSubjects([thought("A", "bees bees bees bees bees")]);
    expect(subjects).toEqual([]);
  });
});

describe("buildProfile", () => {
  it("says nothing at all until there is history worth reporting", () => {
    expect(buildProfile([])).toBeNull();
    expect(buildProfile([thought("A", "one idea")])).toBeNull();
  });

  it("reports the ideas someone keeps returning to, with pass counts", () => {
    const profile = buildProfile([
      thought("Reverse Tuesday", "buses backwards", 3),
      thought("Rocket Car", "a rocket car", 1),
    ]);
    expect(profile.returning).toEqual([{ title: "Reverse Tuesday", passes: 3 }]);
  });

  it("gathers decisions from marks across every thought", () => {
    const profile = buildProfile([
      thought("A", "one", 1, [{ index: 0, state: "keep", text: "salt flats" }]),
      thought("B", "two", 1, [{ index: 0, state: "kill", text: "street legal" }]),
    ]);
    expect(profile.keeps).toContain("salt flats");
    expect(profile.kills).toContain("street legal");
  });

  it("ignores thoughts that were never developed", () => {
    const undeveloped = { id: "x", title: "X", thought: "never answered", turns: [] };
    expect(buildProfile([thought("A", "one"), undeveloped])).toBeNull();
  });

  it("names the mode they reach for most", () => {
    const profile = buildProfile([
      { id: "a", title: "A", thought: "x", turns: [{ mode: "deep" }, { mode: "deep" }] },
      { id: "b", title: "B", thought: "y", turns: [{ mode: "riff" }] },
    ]);
    expect(profile.favouriteMode).toBe("deep");
  });

  it("lists only finished books", () => {
    const profile = buildProfile(
      [thought("A", "one"), thought("B", "two")],
      [
        { title: "Done Book", status: "done" },
        { title: "Half Book", status: "writing" },
      ],
    );
    expect(profile.books).toEqual(["Done Book"]);
  });

  it("stays small however long the log gets", () => {
    const many = Array.from({ length: 90 }, (_, i) =>
      thought(`T${i}`, `idea ${i}`, 1, [{ index: 0, state: "keep", text: `keep ${i}` }]),
    );
    const profile = buildProfile(many);
    expect(profile.keeps.length).toBeLessThanOrEqual(12);
    expect(profile.returning.length).toBeLessThanOrEqual(5);
    expect(profile.subjects.length).toBeLessThanOrEqual(6);
  });
});

describe("isUseful", () => {
  it("rejects a null or empty profile", () => {
    expect(isUseful(null)).toBe(false);
    expect(
      isUseful({ subjects: [], returning: [], keeps: [], kills: [], books: [] }),
    ).toBe(false);
  });

  it("accepts one with anything real in it", () => {
    expect(isUseful({ subjects: ["bees"], returning: [], keeps: [], kills: [], books: [] })).toBe(true);
  });
});
