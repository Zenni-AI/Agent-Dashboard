import type { VideoFormat, VideoRecord } from "../types.js";

/**
 * YouTube exposes no "is this a Short" flag on the API, so LITIX infers it.
 *
 * Duration is the reliable signal: the Shorts shelf accepted uploads up to 60
 * seconds until October 2024 and up to 3 minutes after. A channel's back
 * catalogue therefore straddles two thresholds, so the cutoff is configurable
 * and defaults to the current 3 minutes. Videos are also treated as Shorts when
 * they are under the legacy 60s bound regardless of the configured cutoff, and
 * an explicit `#shorts` tag on a sub-threshold video reinforces the call.
 */
export const SHORTS_MAX_SECONDS_CURRENT = 180;
export const SHORTS_MAX_SECONDS_LEGACY = 60;

export interface FormatClassifierOptions {
  /** Upper duration bound for a Short, in seconds. */
  shortsMaxSeconds?: number;
  /** Live broadcasts and premieres skew every average and are tagged separately. */
  isLiveBroadcast?: boolean;
}

export function classifyFormat(
  durationSeconds: number,
  title: string,
  description: string,
  tags: string[],
  options: FormatClassifierOptions = {},
): VideoFormat {
  if (options.isLiveBroadcast) return "live";

  const cutoff = options.shortsMaxSeconds ?? SHORTS_MAX_SECONDS_CURRENT;

  // A zero duration means the Data API withheld it (still processing, or live).
  // Treating that as a Short would corrupt the Shorts baseline, so it is long.
  if (durationSeconds <= 0) return "long";

  if (durationSeconds <= SHORTS_MAX_SECONDS_LEGACY) return "short";
  if (durationSeconds <= cutoff) {
    // Between 60s and the cutoff the duration alone is ambiguous — a 2 minute
    // upload may be a Short or a short long-form video. The hashtag decides.
    return hasShortsHashtag(title, description, tags) ? "short" : "long";
  }
  return "long";
}

export function hasShortsHashtag(
  title: string,
  description: string,
  tags: string[],
): boolean {
  const haystack = `${title} ${description}`.toLowerCase();
  if (haystack.includes("#short")) return true;
  return tags.some((tag) => tag.toLowerCase().replace(/^#/, "").startsWith("short"));
}

export function splitByFormat(
  videos: VideoRecord[],
): Record<VideoFormat, VideoRecord[]> {
  const buckets: Record<VideoFormat, VideoRecord[]> = {
    short: [],
    long: [],
    live: [],
  };
  for (const video of videos) buckets[video.format].push(video);
  return buckets;
}

/** Live broadcasts are excluded from performance baselines; they are a different game. */
export function analysableVideos(videos: VideoRecord[]): VideoRecord[] {
  return videos.filter((v) => v.format !== "live");
}
