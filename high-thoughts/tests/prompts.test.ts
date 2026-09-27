import { describe, expect, it } from "vitest";
import { MODE_IDS, MODES } from "../src/modes.js";
import { buildDevelopPrompt, followUpInstruction, renderProfile } from "../src/prompts.js";

describe("buildDevelopPrompt", () => {
  it("names every required section for the mode, in order", () => {
    const { system } = buildDevelopPrompt({ thought: "a thought", mode: MODES.build });
    const headings = [...system.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(MODES.build.sections);
  });

  it("puts the raw thought in the first user message and nothing else", () => {
    const { messages } = buildDevelopPrompt({ thought: "what if clouds paid rent", mode: MODES.riff });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toContain("what if clouds paid rent");
  });

  it("replays prior turns as alternating assistant/user messages", () => {
    const { messages } = buildDevelopPrompt({
      thought: "a thought",
      mode: MODES.sober,
      history: [
        { mode: "riff", text: "first answer" },
        { mode: "build", text: "second answer" },
      ],
    });

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages[1]?.content).toBe("first answer");
    expect(messages[3]?.content).toBe("second answer");
  });

  it("carries the mode instruction for the mode being asked for now", () => {
    const { system } = buildDevelopPrompt({
      thought: "a thought",
      mode: MODES.deep,
      history: [{ mode: "riff", text: "earlier" }],
    });
    expect(system).toContain(MODES.deep.instruction);
    expect(system).not.toContain(MODES.riff.instruction);
  });

  it("forbids flattery and clarifying questions in every mode", () => {
    for (const id of MODE_IDS) {
      const { system } = buildDevelopPrompt({ thought: "x", mode: MODES[id] });
      expect(system).toMatch(/Never ask a clarifying question/);
      expect(system).toMatch(/no "great question"/);
    }
  });
});

describe("followUpInstruction", () => {
  it("tells a repeat of the same mode not to restate itself", () => {
    expect(followUpInstruction("riff", "riff")).toMatch(/do not restate it/i);
  });

  it("frames a switch to sober as the morning after", () => {
    expect(followUpInstruction("riff", "sober")).toMatch(/morning after/i);
  });

  it("tells any other switch not to repeat itself", () => {
    expect(followUpInstruction("riff", "build")).toMatch(/do not repeat it/i);
  });
});

describe("MODES", () => {
  it("gives every mode four sections and a distinct instruction", () => {
    const instructions = new Set<string>();
    for (const id of MODE_IDS) {
      const mode = MODES[id];
      expect(mode.sections).toHaveLength(4);
      expect(mode.instruction.length).toBeGreaterThan(120);
      instructions.add(mode.instruction);
    }
    expect(instructions.size).toBe(MODE_IDS.length);
  });

  it("spends the least reasoning on riff and the most on the reflective modes", () => {
    expect(MODES.riff.effort).toBe("low");
    expect(MODES.sober.effort).toBe("high");
    expect(MODES.deep.effort).toBe("high");
  });
});

describe("renderProfile", () => {
  const profile = {
    thoughtCount: 12,
    subjects: ["hydroponics", "welding"],
    returning: [{ title: "Reverse Tuesday", passes: 3 }],
    keeps: ["salt flats"],
    kills: ["street legal"],
    favouriteMode: "deep",
    books: ["Rocket Car"],
  };

  it("forbids steering the new thought toward past interests", () => {
    const rendered = renderProfile(profile);
    expect(rendered).toMatch(/Do NOT steer this thought toward their past interests/);
    expect(rendered).toMatch(/do not mention that you know any of this/);
    expect(rendered).toMatch(/ignore all of it/);
  });

  it("tells it not to re-propose what they already rejected", () => {
    expect(renderProfile(profile)).toMatch(/do not re-propose these/i);
    expect(renderProfile(profile)).toContain("street legal");
  });

  it("says which ground the books already cover", () => {
    expect(renderProfile(profile)).toMatch(/Rocket Car.*Assume that ground is covered/s);
  });

  it("omits sections it has nothing for", () => {
    const sparse = { ...profile, subjects: [], returning: [], keeps: [], kills: [], books: [] };
    const rendered = renderProfile(sparse);
    expect(rendered).not.toMatch(/Subjects that keep coming up/);
    expect(rendered).not.toMatch(/rejected before/);
    expect(rendered).toContain("12 thoughts");
  });
});

describe("buildDevelopPrompt with a profile", () => {
  const profile = {
    thoughtCount: 5,
    subjects: ["bees"],
    returning: [],
    keeps: [],
    kills: ["anything with a subscription"],
    favouriteMode: "riff",
    books: [],
  };

  it("puts the profile in the system prompt, not the user turn", () => {
    const { system, messages } = buildDevelopPrompt({
      thought: "a thought",
      mode: MODES.riff,
      profile,
    });
    expect(system).toContain("anything with a subscription");
    expect(messages[0]?.content).not.toContain("anything with a subscription");
  });

  it("changes nothing when there is no profile", () => {
    const withNone = buildDevelopPrompt({ thought: "x", mode: MODES.riff });
    const withNull = buildDevelopPrompt({ thought: "x", mode: MODES.riff, profile: null });
    expect(withNone.system).toBe(withNull.system);
    expect(withNone.system).not.toMatch(/background on the person/);
  });
});
