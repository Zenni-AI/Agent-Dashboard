import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { describeFailure } from "../src/claude.js";
import { formatEvent } from "../src/sse.js";

/**
 * Build a typed SDK error without going near the network. `generate` needs
 * real headers — given `undefined` it decides the request never landed and
 * hands back an APIConnectionError regardless of the status passed in.
 */
function apiError(status: number): Anthropic.APIError {
  return Anthropic.APIError.generate(
    status,
    { type: "error", error: { type: "api_error", message: "x" } },
    "x",
    new Headers(),
  );
}

describe("describeFailure", () => {
  it("treats a rate limit as worth retrying", () => {
    const result = describeFailure(apiError(429));
    expect(result.retryable).toBe(true);
    expect(result.message).toMatch(/few seconds/i);
  });

  it("treats a bad key as not worth retrying", () => {
    expect(describeFailure(apiError(401)).retryable).toBe(false);
    expect(describeFailure(apiError(403)).retryable).toBe(false);
    expect(describeFailure(apiError(400)).retryable).toBe(false);
  });

  it("treats a server-side failure as worth retrying", () => {
    expect(describeFailure(apiError(500)).retryable).toBe(true);
    expect(describeFailure(apiError(529)).retryable).toBe(true);
  });

  it("treats a lost connection as worth retrying", () => {
    const result = describeFailure(new Anthropic.APIConnectionError({ message: "socket" }));
    expect(result.retryable).toBe(true);
    expect(result.message).toMatch(/signal/i);
  });

  it("never leaks the raw error text to the phone", () => {
    const result = describeFailure(new Error("ANTHROPIC_API_KEY=sk-ant-secret rejected"));
    expect(result.message).not.toContain("sk-ant");
    expect(result.retryable).toBe(true);
  });
});

describe("formatEvent", () => {
  it("frames one event per SSE record", () => {
    expect(formatEvent({ type: "text", text: "hi" })).toBe('data: {"type":"text","text":"hi"}\n\n');
  });

  it("keeps a newline inside the payload from breaking the frame", () => {
    const framed = formatEvent({ type: "text", text: "a\n\nb" });
    expect(framed.split("\n\n")).toHaveLength(2);
    expect(JSON.parse(framed.slice(6))).toEqual({ type: "text", text: "a\n\nb" });
  });
});
