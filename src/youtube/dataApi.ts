import { classifyFormat } from "../analysis/format.js";
import type { DiskCache } from "../store/cache.js";
import type { ChannelSnapshot, VideoRecord } from "../types.js";
import { daysBetween, parseIsoDuration } from "../util/duration.js";
import { log } from "../util/logger.js";
import { QuotaTracker } from "./quota.js";
import { channelRefQueryParam, parseChannelRef, type ChannelRef } from "./resolve.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }

  get isQuotaExceeded(): boolean {
    return this.reason === "quotaExceeded" || this.reason === "dailyLimitExceeded";
  }
}

export interface DataApiOptions {
  apiKey: string;
  cache?: DiskCache;
  quota?: QuotaTracker;
  /** Duration cutoff for Shorts classification, in seconds. */
  shortsMaxSeconds?: number;
}

export interface ChannelSweepOptions {
  /** Hard cap on uploads pulled, newest first. */
  maxVideos?: number;
  /** Ignore uploads older than this many days. */
  sinceDays?: number;
}

/** Read-only client for the public YouTube Data API v3. */
export class YouTubeDataApi {
  private readonly quota: QuotaTracker;

  constructor(private readonly options: DataApiOptions) {
    this.quota = options.quota ?? new QuotaTracker();
  }

  get quotaTracker(): QuotaTracker {
    return this.quota;
  }

  private async request<T>(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${API_BASE}/${endpoint.replace(".list", "")}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("key", this.options.apiKey);

    const cacheKey = url.toString();
    const cache = this.options.cache;
    const cached = cache ? await cache.get<T>(cacheKey) : null;
    if (cached !== null) {
      log.debug(`cache hit ${endpoint}`);
      return cached;
    }

    this.quota.record(endpoint);
    const body = await fetchWithRetry(url, endpoint);
    if (cache) await cache.set(cacheKey, body);
    return body as T;
  }

  /** Resolve a channel reference to its public snapshot. */
  async getChannel(reference: string | ChannelRef): Promise<ChannelSnapshot> {
    const ref =
      typeof reference === "string" ? parseChannelRef(reference) : reference;
    const [param, value] = channelRefQueryParam(ref);

    const response = await this.request<ChannelListResponse>("channels.list", {
      part: "snippet,statistics,contentDetails",
      [param]: value,
      maxResults: "1",
    });

    const item = response.items?.[0];
    if (!item) {
      throw new YouTubeApiError(
        `No channel found for ${ref.kind} "${ref.value}". Check the handle, or pass the /channel/UC... URL.`,
        404,
        "notFound",
      );
    }

    const stats = item.statistics ?? {};
    return {
      channelId: item.id,
      handle: item.snippet?.customUrl?.replace(/^@/, ""),
      title: item.snippet?.title ?? "(untitled)",
      description: item.snippet?.description ?? "",
      publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
      country: item.snippet?.country,
      subscriberCount: Number(stats.subscriberCount ?? 0),
      subscriberCountHidden: Boolean(stats.hiddenSubscriberCount),
      viewCount: Number(stats.viewCount ?? 0),
      videoCount: Number(stats.videoCount ?? 0),
      uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? "",
      thumbnailUrl: item.snippet?.thumbnails?.high?.url,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Walk the uploads playlist newest-first. Costs 1 quota unit per 50 uploads,
   * versus 100 units for a single `search.list` call — which is why LITIX never
   * uses search to enumerate a channel.
   */
  async listUploadIds(
    uploadsPlaylistId: string,
    options: ChannelSweepOptions = {},
  ): Promise<string[]> {
    if (!uploadsPlaylistId) return [];
    const maxVideos = options.maxVideos ?? 200;
    const cutoff =
      options.sinceDays !== undefined
        ? Date.now() - options.sinceDays * 86_400_000
        : null;

    const ids: string[] = [];
    let pageToken: string | undefined;

    while (ids.length < maxVideos) {
      const params: Record<string, string> = {
        part: "contentDetails",
        playlistId: uploadsPlaylistId,
        maxResults: String(Math.min(50, maxVideos - ids.length)),
      };
      if (pageToken) params.pageToken = pageToken;

      const page = await this.request<PlaylistItemsResponse>(
        "playlistItems.list",
        params,
      );

      let reachedCutoff = false;
      for (const item of page.items ?? []) {
        const videoId = item.contentDetails?.videoId;
        if (!videoId) continue;
        const publishedAt = item.contentDetails?.videoPublishedAt;
        if (cutoff && publishedAt && new Date(publishedAt).getTime() < cutoff) {
          // The playlist is ordered newest-first, so the window is closed.
          reachedCutoff = true;
          break;
        }
        ids.push(videoId);
      }

      if (reachedCutoff) break;
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }

    return ids.slice(0, maxVideos);
  }

  /** Hydrate video IDs into records, batching 50 per call to stay cheap. */
  async getVideos(videoIds: string[], channelId: string): Promise<VideoRecord[]> {
    const records: VideoRecord[] = [];
    const now = new Date();

    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const response = await this.request<VideoListResponse>("videos.list", {
        part: "snippet,statistics,contentDetails,liveStreamingDetails",
        id: batch.join(","),
        maxResults: "50",
      });

      for (const item of response.items ?? []) {
        const snippet = item.snippet;
        if (!snippet) continue;
        const durationSeconds = parseIsoDuration(
          item.contentDetails?.duration ?? "",
        );
        const tags = snippet.tags ?? [];
        const isLiveBroadcast =
          Boolean(item.liveStreamingDetails) ||
          snippet.liveBroadcastContent === "live";

        records.push({
          videoId: item.id,
          channelId: snippet.channelId ?? channelId,
          title: snippet.title ?? "",
          description: snippet.description ?? "",
          publishedAt: snippet.publishedAt ?? now.toISOString(),
          durationSeconds,
          format: classifyFormat(durationSeconds, snippet.title ?? "", snippet.description ?? "", tags, {
            shortsMaxSeconds: this.options.shortsMaxSeconds,
            isLiveBroadcast,
          }),
          views: Number(item.statistics?.viewCount ?? 0),
          likes: Number(item.statistics?.likeCount ?? 0),
          comments: Number(item.statistics?.commentCount ?? 0),
          tags,
          categoryId: snippet.categoryId,
          thumbnailUrl: snippet.thumbnails?.high?.url,
          ageDays: Math.max(
            0,
            daysBetween(snippet.publishedAt ?? now.toISOString(), now),
          ),
        });
      }
    }

    // Newest first, matching how creators think about their catalogue.
    return records.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
  }

  /** One call to get a channel and its recent uploads. */
  async sweepChannel(
    reference: string | ChannelRef,
    options: ChannelSweepOptions = {},
  ): Promise<{ channel: ChannelSnapshot; videos: VideoRecord[] }> {
    const channel = await this.getChannel(reference);
    log.info(
      `${channel.title}: ${channel.videoCount} uploads, ${channel.subscriberCount.toLocaleString()} subscribers`,
    );
    const ids = await this.listUploadIds(channel.uploadsPlaylistId, options);
    const videos = await this.getVideos(ids, channel.channelId);
    log.info(`pulled ${videos.length} videos (${this.quota.summary()})`);
    return { channel, videos };
  }
}

async function fetchWithRetry(
  url: URL,
  endpoint: string,
  attempt = 0,
): Promise<unknown> {
  const MAX_ATTEMPTS = 4;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (cause) {
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(2 ** attempt * 500);
      return fetchWithRetry(url, endpoint, attempt + 1);
    }
    throw new YouTubeApiError(
      `Network failure calling ${endpoint}: ${(cause as Error).message}`,
      0,
      "network",
    );
  }

  if (response.ok) return response.json();

  const text = await response.text();
  const reason = extractReason(text);

  // Quota exhaustion is terminal — retrying just burns time.
  const retryable =
    (response.status === 429 || response.status >= 500) && reason !== "quotaExceeded";
  if (retryable && attempt < MAX_ATTEMPTS - 1) {
    await sleep(2 ** attempt * 1000);
    return fetchWithRetry(url, endpoint, attempt + 1);
  }

  throw new YouTubeApiError(
    `${endpoint} failed (${response.status}${reason ? ` ${reason}` : ""}): ${text.slice(0, 300)}`,
    response.status,
    reason,
  );
}

function extractReason(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: { reason?: string }[] };
    };
    return parsed.error?.errors?.[0]?.reason;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Minimal shapes for the fields LITIX actually reads -------------------

interface ChannelListResponse {
  items?: {
    id: string;
    snippet?: {
      title?: string;
      description?: string;
      customUrl?: string;
      publishedAt?: string;
      country?: string;
      thumbnails?: { high?: { url?: string } };
    };
    statistics?: {
      viewCount?: string;
      subscriberCount?: string;
      hiddenSubscriberCount?: boolean;
      videoCount?: string;
    };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }[];
}

interface PlaylistItemsResponse {
  nextPageToken?: string;
  items?: {
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
  }[];
}

interface VideoListResponse {
  items?: {
    id: string;
    snippet?: {
      channelId?: string;
      title?: string;
      description?: string;
      publishedAt?: string;
      tags?: string[];
      categoryId?: string;
      liveBroadcastContent?: string;
      thumbnails?: { high?: { url?: string } };
    };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
    liveStreamingDetails?: Record<string, unknown>;
  }[];
}
