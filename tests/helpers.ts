import type { ChannelSnapshot, VideoRecord } from "../src/types.js";
import { classifyFormat } from "../src/analysis/format.js";

/** Build a video record with sensible defaults; override only what a test cares about. */
export function video(overrides: Partial<VideoRecord> & { views: number }): VideoRecord {
  const durationSeconds = overrides.durationSeconds ?? 600;
  const title = overrides.title ?? "A video";
  const description = overrides.description ?? "";
  const tags = overrides.tags ?? [];
  const ageDays = overrides.ageDays ?? 90;

  return {
    videoId: overrides.videoId ?? `vid-${Math.round(overrides.views)}-${durationSeconds}-${title.length}`,
    channelId: overrides.channelId ?? "UC_test",
    title,
    description,
    publishedAt:
      overrides.publishedAt ?? new Date(Date.now() - ageDays * 86_400_000).toISOString(),
    durationSeconds,
    format: overrides.format ?? classifyFormat(durationSeconds, title, description, tags),
    views: overrides.views,
    likes: overrides.likes ?? Math.round(overrides.views * 0.03),
    comments: overrides.comments ?? Math.round(overrides.views * 0.005),
    tags,
    ageDays,
    ...(overrides.thumbnailUrl ? { thumbnailUrl: overrides.thumbnailUrl } : {}),
  };
}

export function channel(overrides: Partial<ChannelSnapshot> = {}): ChannelSnapshot {
  return {
    channelId: "UC_test",
    handle: "testchannel",
    title: "Test Channel",
    description: "",
    publishedAt: new Date(Date.now() - 900 * 86_400_000).toISOString(),
    subscriberCount: 50_000,
    subscriberCountHidden: false,
    viewCount: 5_000_000,
    videoCount: 120,
    uploadsPlaylistId: "UU_test",
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** N videos whose views follow the supplied list, cycled as needed. */
export function videos(count: number, viewsPattern: number[], base: Partial<VideoRecord> = {}): VideoRecord[] {
  return Array.from({ length: count }, (_, i) =>
    video({
      ...base,
      views: viewsPattern[i % viewsPattern.length]!,
      videoId: `vid-${i}`,
      title: base.title ?? `Video ${i}`,
      ageDays: base.ageDays ?? 60 + i,
    }),
  );
}
