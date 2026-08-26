/** Small, dependency-free statistics used across the analysis layer. */

export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

/**
 * Linear-interpolated percentile over a copy of the input.
 * `p` is 0..1. Returns 0 for an empty input so callers can stay branch-free.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const clamped = clamp(p, 0, 1);
  const pos = clamped * (sorted.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower]!;
  const weight = pos - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    sum(values.map((v) => (v - m) ** 2)) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Coefficient of variation, guarded against a zero mean. Used as a spread
 * measure that is comparable across channels of wildly different size.
 */
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stdev(values) / m;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Divide without producing Infinity or NaN. */
export function safeDivide(a: number, b: number, fallback = 0): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return fallback;
  const result = a / b;
  return Number.isFinite(result) ? result : fallback;
}

export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Map a value onto 0..1 by where it sits between `min` and `max`. */
export function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/**
 * Compress an unbounded positive quantity into 0..1 with diminishing returns.
 * `midpoint` is the value that maps to 0.5.
 */
export function saturate(value: number, midpoint: number): number {
  if (midpoint <= 0) return 0;
  const v = Math.max(0, value);
  return v / (v + midpoint);
}

export function weightedAverage(
  entries: { value: number; weight: number }[],
): number {
  const totalWeight = sum(entries.map((e) => e.weight));
  if (totalWeight === 0) return 0;
  return sum(entries.map((e) => e.value * e.weight)) / totalWeight;
}
