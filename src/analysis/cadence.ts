import type { CadenceProfile, VideoFormat, VideoRecord } from "../types.js";
import { daysBetween } from "../util/duration.js";
import { clamp, coefficientOfVariation, median, safeDivide } from "../util/stats.js";
import { splitByFormat } from "./format.js";

/**
 * Publishing rhythm. Volume drives reach on Shorts and consistency drives the
 * subscriber relationship on long-form, so both the rate and its regularity
 * are measured.
 */
export function computeCadence(videos: VideoRecord[]): CadenceProfile {
  const empty: CadenceProfile = {
    uploadsPerWeek: 0,
    uploadsPerWeekByFormat: { short: 0, long: 0, live: 0 },
    medianGapDays: 0,
    longestGapDays: 0,
    regularity: 0,
    activeDays: 0,
  };
  if (videos.length < 2) return empty;

  const sorted = [...videos].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const activeDays = Math.max(1, daysBetween(first.publishedAt, last.publishedAt));

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(Math.max(0, daysBetween(sorted[i - 1]!.publishedAt, sorted[i]!.publishedAt)));
  }

  const buckets = splitByFormat(videos);
  const perWeek = (count: number) => safeDivide(count * 7, activeDays);

  return {
    uploadsPerWeek: perWeek(videos.length),
    uploadsPerWeekByFormat: {
      short: perWeek(buckets.short.length),
      long: perWeek(buckets.long.length),
      live: perWeek(buckets.live.length),
    },
    medianGapDays: median(gaps),
    longestGapDays: gaps.length > 0 ? Math.max(...gaps) : 0,
    // Even spacing scores 1; bursts followed by droughts score near 0.
    regularity: clamp(1 - coefficientOfVariation(gaps), 0, 1),
    activeDays: Math.round(activeDays),
  };
}

/** Format the channel currently publishes most. */
export function dominantFormat(cadence: CadenceProfile): VideoFormat | null {
  const entries = Object.entries(cadence.uploadsPerWeekByFormat) as [VideoFormat, number][];
  const best = entries.sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}
