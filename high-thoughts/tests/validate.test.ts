import { describe, expect, it } from "vitest";
import { validateDevelopRequest, ValidationError } from "../src/validate.js";

const options = { maxThoughtChars: 100, maxHistoryTurns: 3 };

describe("validateDevelopRequest", () => {
  it("accepts a plain thought and trims it", () => {
    const request = validateDevelopRequest({ thought: "  what if doors were sideways  " }, options);
    expect(request.thought).toBe("what if doors were sideways");
  });

  it("defaults to riff when the mode is missing or unknown", () => {
    expect(validateDevelopRequest({ thought: "hi" }, options).mode).toBe("riff");
    expect(validateDevelopRequest({ thought: "hi", mode: "chaos" }, options).mode).toBe("riff");
  });

  it("keeps a known mode", () => {
    expect(validateDevelopRequest({ thought: "hi", mode: "sober" }, options).mode).toBe("sober");
  });

  it("rejects a thought that is empty or only whitespace", () => {
    expect(() => validateDevelopRequest({ thought: "   " }, options)).toThrow(ValidationError);
    expect(() => validateDevelopRequest({}, options)).toThrow(ValidationError);
  });

  it("rejects a thought past the character cap", () => {
    expect(() => validateDevelopRequest({ thought: "x".repeat(101) }, options)).toThrow(
      /Keep it under 100/,
    );
  });

  it("rejects a non-object body", () => {
    expect(() => validateDevelopRequest("nope", options)).toThrow(ValidationError);
    expect(() => validateDevelopRequest(null, options)).toThrow(ValidationError);
  });

  describe("history", () => {
    it("drops anything that is not a turn", () => {
      const request = validateDevelopRequest(
        { thought: "hi", history: [null, 7, { mode: "riff" }, { text: "   " }, "x"] },
        options,
      );
      expect(request.history).toEqual([]);
    });

    it("keeps only the most recent turns", () => {
      const history = Array.from({ length: 6 }, (_, index) => ({ mode: "riff", text: `t${index}` }));
      const request = validateDevelopRequest({ thought: "hi", history }, options);
      expect(request.history.map((turn) => turn.text)).toEqual(["t3", "t4", "t5"]);
    });

    it("normalises an unknown mode on a stored turn rather than dropping it", () => {
      const request = validateDevelopRequest(
        { thought: "hi", history: [{ mode: "from-an-old-build", text: "kept" }] },
        options,
      );
      expect(request.history).toEqual([{ mode: "riff", text: "kept" }]);
    });

    it("ignores history that is not an array", () => {
      expect(validateDevelopRequest({ thought: "hi", history: "no" }, options).history).toEqual([]);
    });
  });
});
