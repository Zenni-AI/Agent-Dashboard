import { describe, expect, it } from "vitest";
import { MODE_IDS, MODES } from "../src/modes.js";
import { buildDevelopPrompt, followUpInstruction } from "../src/prompts.js";

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
