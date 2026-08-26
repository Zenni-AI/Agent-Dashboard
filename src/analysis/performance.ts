import type {
  FormatStats,
  PerformanceProfile,
  VideoFormat,
  VideoInsight,
  VideoRecord,
} from "../types.js";
import {
  clamp,
  coefficientOfVariation,
  median,
  percentile,
  safeDivide,
  sum,
} from "../util/stats.js";
import { analysableVideos, splitByFormat } from "./format.js";

/**
 * A video keeps accumulating views for weeks after upload, so comparing a
 * three-day-old upload against a three-year-old one by total views is
 * meaningless. LITIX only measures a video against the channel baseline once it
 * has had time to find its audience; younger uploads are reported as pending
 * rather than being scored on partial data.
 */
export const MATURITY_DAYS: Record<VideoFormat, number> = {
  short: 14,
  long: 30,
  live: 30,
};

export function isMature(video: VideoRecord): boolean {
  return video.ageDays >= MATURITY_DAYS[video.format];
}

export function engagementRate(video: VideoRecord): number {
  return safeDivide(video.likes + video.comments, video.views);
}

export function viewsPerDay(video: VideoRecord): number {
  return safeDivide(video.views, Math.max(1, video.ageDays));
}

export function computeFormatStats(videos: VideoRecord[]): FormatStats[] {
  const buckets = splitByFormat(videos);
  const totalCount = videos.length;

  return (Object.keys(buckets) as VideoFormat[])
    .filter((format) => buckets[format].length > 0)
    .map((format) => {
      const bucket = buckets[format];
      const views = bucket.map((v) => v.views);
      const medianViews = median(views);
      const p90Views = percentile(views, 0.9);

      return {
        format,
        count: bucket.length,
        share: safeDivide(bucket.length, totalCount),
        totalViews: sum(views),
        medianViews,
        meanViews: safeDivide(sum(views), bucket.length),
        p90Views,
        // How hit-driven the format is: a high skew means a handful of videos
        // carry it and the median upload is not representative of the upside.
        hitSkew: safeDivide(p90Views, medianViews, 1),
        medianEngagementRate: median(bucket.map(engagementRate)),
        medianViewsPerDay: median(bucket.map(viewsPerDay)),
        medianDurationSeconds: median(bucket.map((v) => v.durationSeconds)),
      };
    })
    .sort((a, b) => b.totalViews - a.totalViews);
}

export interface PerformanceOptions {
  /** How many outliers and laggards to surface. */
  topN?: number;
  /** Multiple of baseline above which a video counts as an outlier. */
  outlierThreshold?: number;
}

export function computePerformanceProfile(
  allVideos: VideoRecord[],
  options: PerformanceOptions = {},
): PerformanceProfile {
  const topN = options.topN ?? 8;
  const outlierThreshold = options.outlierThreshold ?? 1.5;

  const videos = analysableVideos(allVideos);
  const mature = videos.filter(isMature);
  const baselines = computeBaselines(mature.length > 0 ? mature : videos);

  const scored = (mature.length > 0 ? mature : videos).map((video) =>
    toInsight(video, baselines[video.format]),
  );

  const outliers = scored
    .filter((insight) => insight.multipleOfBaseline >= outlierThreshold)
    .sort((a, b) => b.multipleOfBaseline - a.multipleOfBaseline)
    .slice(0, topN);

  const laggards = scored
    .filter((insight) => insight.multipleOfBaseline > 0)
    .sort((a, b) => a.multipleOfBaseline - b.multipleOfBaseline)
    .slice(0, topN);

  return {
    baselines,
    outliers,
    laggards,
    trend: computeTrend(mature),
    consistencyScore: computeConsistency(mature),
  };
}

export function computeBaselines(videos: VideoRecord[]): Record<VideoFormat, number> {
  const buckets = splitByFormat(videos);
  return {
    short: median(buckets.short.map((v) => v.views)),
    long: median(buckets.long.map((v) => v.views)),
    live: median(buckets.live.map((v) => v.views)),
  };
}

export function toInsight(video: VideoRecord, baseline: number | undefined): VideoInsight {
  return {
    videoId: video.videoId,
    title: video.title,
    format: video.format,
    publishedAt: video.publishedAt,
    ageDays: Math.round(video.ageDays),
    views: video.views,
    viewsPerDay: viewsPerDay(video),
    engagementRate: engagementRate(video),
    multipleOfBaseline: safeDivide(video.views, baseline ?? 0, 0),
    durationSeconds: video.durationSeconds,
  };
}

/**
 * Recent-half median over older-half median, per format. Above 1.0 the channel
 * is growing; below 1.0 the format is cooling off.
 */
export function computeTrend(videos: VideoRecord[]): Record<VideoFormat, number | null> {
  const buckets = splitByFormat(videos);
  const trend = {} as Record<VideoFormat, number | null>;

  for (const format of ["short", "long", "live"] as VideoFormat[]) {
    const bucket = [...buckets[format]].sort(
      (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
    );
    // Fewer than six mature uploads cannot support a trend claim.
    if (bucket.length < 6) {
      trend[format] = null;
      continue;
    }
    const mid = Math.floor(bucket.length / 2);
    const older = median(bucket.slice(0, mid).map((v) => v.views));
    const recent = median(bucket.slice(mid).map((v) => v.views));
    trend[format] = older > 0 ? safeDivide(recent, older, 1) : null;
  }

  return trend;
}

/**
 * 0..1. How reliably an upload lands near the channel's own median. A channel
 * that can predict its floor can plan a launch around it; a lottery channel
 * cannot.
 */
export function computeConsistency(videos: VideoRecord[]): number {
  const analysable = analysableVideos(videos);
  if (analysable.length < 4) return 0;
  const cv = coefficientOfVariation(analysable.map((v) => v.views));
  // A coefficient of variation of 2 or more is effectively a lottery.
  return clamp(1 - cv / 2, 0, 1);
}

/** Uploads too young to score, reported so the numbers are not silently partial. */
export function pendingVideos(videos: VideoRecord[]): VideoRecord[] {
  return analysableVideos(videos).filter((v) => !isMature(v));
}
