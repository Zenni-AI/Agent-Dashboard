import { describe, expect, it } from "vitest";
import {
  clamp,
  coefficientOfVariation,
  median,
  normalize,
  percentile,
  safeDivide,
  saturate,
  weightedAverage,
} from "../src/util/stats.js";

describe("percentile", () => {
  it("returns 0 for an empty set", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("returns the only value for a single-element set", () => {
    expect(percentile([42], 0.9)).toBe(42);
  });

  it("interpolates between neighbours", () => {
    // p50 of [1,2,3,4] sits halfway between 2 and 3.
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("does not mutate the input", () => {
    const input = [5, 1, 3];
    percentile(input, 0.5);
    expect(input).toEqual([5, 1, 3]);
  });

  it("clamps out-of-range percentiles", () => {
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 5)).toBe(3);
  });
});

describe("median", () => {
  it("handles odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("safeDivide", () => {
  it("returns the fallback instead of Infinity or NaN", () => {
    expect(safeDivide(1, 0)).toBe(0);
    expect(safeDivide(1, 0, 7)).toBe(7);
    expect(safeDivide(Number.NaN, 2, -1)).toBe(-1);
  });
});

describe("saturate", () => {
  it("maps the midpoint to 0.5 and never exceeds 1", () => {
    expect(saturate(10, 10)).toBe(0.5);
    expect(saturate(0, 10)).toBe(0);
    expect(saturate(1e9, 10)).toBeLessThan(1);
  });
});

describe("weightedAverage", () => {
  it("weights entries proportionally", () => {
    expect(weightedAverage([{ value: 0, weight: 1 }, { value: 10, weight: 3 }])).toBe(7.5);
  });

  it("returns 0 when every weight is zero", () => {
    expect(weightedAverage([{ value: 5, weight: 0 }])).toBe(0);
  });
});

describe("clamp and normalize", () => {
  it("clamps NaN to the minimum", () => {
    expect(clamp(Number.NaN, 2, 8)).toBe(2);
  });

  it("normalizes into 0..1 and guards an inverted range", () => {
    expect(normalize(5, 0, 10)).toBe(0.5);
    expect(normalize(5, 10, 10)).toBe(0);
  });
});

describe("coefficientOfVariation", () => {
  it("is zero for identical values and rises with spread", () => {
    expect(coefficientOfVariation([5, 5, 5])).toBe(0);
    expect(coefficientOfVariation([1, 10, 100])).toBeGreaterThan(1);
  });
});
