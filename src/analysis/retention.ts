import type {
  OwnerVideoMetrics,
  RetentionCurve,
  RetentionProfile,
  VideoRecord,
} from "../types.js";
import { median, round } from "../util/stats.js";

/**
 * Retention analysis.
 *
 * Views tell you the packaging worked. Retention tells you the video did. The
 * two numbers that matter most sit at opposite ends of the curve: how much of
 * the audience survives the first few seconds (the hook), and how much reaches
 * the halfway mark (the payoff). Everything else is commentary.
 */

/** Interpolate the watch ratio at an arbitrary point through the video. */
export function watchRatioAt(curve: RetentionCurve, elapsedRatio: number): number | undefined {
  const points = curve.points;
  if (points.length === 0) return undefined;

  const target = Math.min(1, Math.max(0, elapsedRatio));
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (target <= first.elapsedVideoTimeRatio) return first.audienceWatchRatio;
  if (target >= last.elapsedVideoTimeRatio) return last.audienceWatchRatio;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]!;
    const current = points[i]!;
    if (current.elapsedVideoTimeRatio >= target) {
      const span = current.elapsedVideoTimeRatio - previous.elapsedVideoTimeRatio;
      if (span <= 0) return current.audienceWatchRatio;
      const weight = (target - previous.elapsedVideoTimeRatio) / span;
      return (
        previous.audienceWatchRatio * (1 - weight) + current.audienceWatchRatio * weight
      );
    }
  }
  return last.audienceWatchRatio;
}

/** Watch ratio at a wall-clock second, given the video's duration. */
export function watchRatioAtSecond(
  curve: RetentionCurve,
  durationSeconds: number,
  second: number,
): number | undefined {
  if (durationSeconds <= 0) return undefined;
  // A video shorter than the probe point cannot answer the question.
  if (second > durationSeconds) return undefined;
  return watchRatioAt(curve, second / durationSeconds);
}

/**
 * The share of the starting audience lost across the opening 10% of the video —
 * the cost of the hook. Anything above roughly 0.3 means the opening is
 * writing cheques the video does not cash.
 */
export function hookDropoff(curve: RetentionCurve): number | undefined {
  const start = watchRatioAt(curve, 0);
  const atTenPercent = watchRatioAt(curve, 0.1);
  if (start === undefined || atTenPercent === undefined) return undefined;
  return Math.max(0, start - atTenPercent);
}

export function buildRetentionProfile(
  curves: RetentionCurve[],
  videoMetrics: OwnerVideoMetrics[],
  videos: VideoRecord[],
): RetentionProfile {
  const byId = new Map(videos.map((v) => [v.videoId, v]));
  const notes: string[] = [];

  const at30s: number[] = [];
  const atHalf: number[] = [];
  const dropoffs: number[] = [];

  for (const curve of curves) {
    const video = byId.get(curve.videoId);
    if (!video) continue;

    const thirty = watchRatioAtSecond(curve, video.durationSeconds, 30);
    if (thirty !== undefined) at30s.push(thirty);

    const half = watchRatioAt(curve, 0.5);
    if (half !== undefined) atHalf.push(half);

    const drop = hookDropoff(curve);
    if (drop !== undefined) dropoffs.push(drop);
  }

  const percentages = videoMetrics
    .map((m) => m.averageViewPercentage)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const ranked = videoMetrics
    .filter(
      (m): m is OwnerVideoMetrics & { averageViewPercentage: number } =>
        typeof m.averageViewPercentage === "number",
    )
    .sort((a, b) => b.averageViewPercentage - a.averageViewPercentage);

  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];

  const profile: RetentionProfile = {
    videosAnalysed: curves.length,
    notes,
  };

  if (at30s.length > 0) profile.medianRetentionAt30s = round(median(at30s), 4);
  if (atHalf.length > 0) profile.medianRetentionAtHalf = round(median(atHalf), 4);
  if (dropoffs.length > 0) profile.medianHookDropoff = round(median(dropoffs), 4);
  if (percentages.length > 0) {
    profile.medianAverageViewPercentage = round(median(percentages), 2);
  }
  if (strongest && byId.has(strongest.videoId)) {
    profile.strongest = {
      videoId: strongest.videoId,
      title: byId.get(strongest.videoId)!.title,
      averageViewPercentage: strongest.averageViewPercentage,
    };
  }
  if (weakest && weakest !== strongest && byId.has(weakest.videoId)) {
    profile.weakest = {
      videoId: weakest.videoId,
      title: byId.get(weakest.videoId)!.title,
      averageViewPercentage: weakest.averageViewPercentage,
    };
  }

  if (profile.medianHookDropoff !== undefined && profile.medianHookDropoff > 0.3) {
    notes.push(
      `Roughly ${Math.round(profile.medianHookDropoff * 100)}% of the audience leaves in the first tenth of the video. The openings are the cheapest thing to fix on this channel.`,
    );
  }
  if (
    profile.medianAverageViewPercentage !== undefined &&
    profile.medianAverageViewPercentage < 30
  ) {
    notes.push(
      `Median average view percentage is ${profile.medianAverageViewPercentage}%. Below 30% the algorithm has little reason to keep serving the videos — shorter runtimes would raise the percentage without changing the content.`,
    );
  }
  if (curves.length === 0) {
    notes.push(
      "No retention curves available. Retention is owner-only data — run `litix auth` and re-run with --owner to unlock it.",
    );
  }

  return profile;
}
