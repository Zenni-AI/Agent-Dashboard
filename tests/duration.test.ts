import { describe, expect, it } from "vitest";
import { daysBetween, formatDuration, parseIsoDuration } from "../src/util/duration.js";

describe("parseIsoDuration", () => {
  it("parses the forms the Data API returns", () => {
    expect(parseIsoDuration("PT30S")).toBe(30);
    expect(parseIsoDuration("PT4M13S")).toBe(253);
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT15M")).toBe(900);
    expect(parseIsoDuration("P1DT2H")).toBe(93_600);
  });

  it("returns 0 for empty or malformed input rather than NaN", () => {
    expect(parseIsoDuration("")).toBe(0);
    expect(parseIsoDuration("nonsense")).toBe(0);
  });
});

describe("formatDuration", () => {
  it("omits the hour component below an hour", () => {
    expect(formatDuration(253)).toBe("4:13");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("daysBetween", () => {
  it("measures forward in days", () => {
    expect(daysBetween("2026-01-01T00:00:00Z", "2026-01-11T00:00:00Z")).toBe(10);
  });
});
