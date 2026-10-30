import { describe, expect, it } from "vitest";
import { isModeId, MODE_IDS, publicModes, resolveMode } from "../src/modes.js";

describe("resolveMode", () => {
  it("resolves each known id", () => {
    for (const id of MODE_IDS) expect(resolveMode(id).id).toBe(id);
  });

  it("falls back to riff for anything else", () => {
    expect(resolveMode("nonsense").id).toBe("riff");
    expect(resolveMode(undefined).id).toBe("riff");
    expect(resolveMode(42).id).toBe("riff");
  });
});

describe("isModeId", () => {
  it("accepts only the known ids", () => {
    expect(isModeId("build")).toBe(true);
    expect(isModeId("Build")).toBe(false);
    expect(isModeId(null)).toBe(false);
  });
});

describe("publicModes", () => {
  it("sends the phone labels and blurbs but never the instructions", () => {
    const modes = publicModes();
    expect(modes.map((mode) => mode.id)).toEqual([...MODE_IDS]);
    for (const mode of modes) {
      expect(Object.keys(mode).sort()).toEqual(["blurb", "id", "label"]);
    }
  });
});
