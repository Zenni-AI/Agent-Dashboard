import { buildChannelProfile } from "./analysis/profile.js";
import { benchmarkAgainst } from "./benchmark/compare.js";
import { loadReferences, referencesForNiche } from "./benchmark/registry.js";
import { generateAdvice } from "./ai/advisor.js";
import {
  loadConfig,
  requireAnthropicKey,
  requireDataApiKey,
  requireOAuthClient,
  type LitixConfig,
} from "./config.js";
import { buildAudienceModel } from "./monetize/audience.js";
import { rankPlays } from "./monetize/plays.js";
import { DiskCache } from "./store/cache.js";
import type {
  ChannelDataset,
  LitixReport,
  OperatorProfile,
} from "./types.js";
import { log } from "./util/logger.js";
import { analyticsWindow, YouTubeAnalyticsApi } from "./youtube/analyticsApi.js";
import { YouTubeDataApi } from "./youtube/dataApi.js";
import { YouTubeOAuth } from "./youtube/oauth.js";

export interface RunOptions {
  channel: string;
  maxVideos?: number;
  sinceDays?: number;
  /** Pull owner-only analytics: retention, impressions, traffic sources. */
  owner?: boolean;
  /** How many of the owner's videos to pull retention curves for. */
  retentionSampleSize?: number;
  benchmark?: boolean;
  referencesPath?: string;
  advise?: boolean;
  operator?: OperatorProfile;
  noCache?: boolean;
  config?: LitixConfig;
}

/** Ingest a channel: public data always, owner analytics when authorised. */
export async function ingest(options: RunOptions): Promise<{
  dataset: ChannelDataset;
  api: YouTubeDataApi;
}> {
  const config = options.config ?? loadConfig();
  const cache = DiskCache.fromHours(
    config.LITIX_CACHE_DIR,
    config.LITIX_CACHE_TTL_HOURS,
    !options.noCache,
  );

  const api = new YouTubeDataApi({
    apiKey: requireDataApiKey(config),
    cache,
  });

  const { channel, videos } = await api.sweepChannel(options.channel, {
    maxVideos: options.maxVideos ?? 200,
    sinceDays: options.sinceDays,
  });

  const dataset: ChannelDataset = { channel, videos };

  if (options.owner) {
    dataset.owner = await ingestOwnerData(config, videos.map((v) => v.videoId), {
      retentionSampleSize: options.retentionSampleSize ?? 12,
      sinceDays: options.sinceDays ?? 90,
    });
  }

  return { dataset, api };
}

async function ingestOwnerData(
  config: LitixConfig,
  videoIds: string[],
  options: { retentionSampleSize: number; sinceDays: number },
): Promise<ChannelDataset["owner"]> {
  const { clientId, clientSecret } = requireOAuthClient(config);
  const oauth = new YouTubeOAuth({
    clientId,
    clientSecret,
    tokenFile: config.LITIX_TOKEN_FILE,
    redirectPort: config.YOUTUBE_OAUTH_REDIRECT_PORT,
  });
  const analytics = new YouTubeAnalyticsApi(oauth);
  const { startDate, endDate } = analyticsWindow(options.sinceDays);

  log.info(`pulling owner analytics for ${startDate} to ${endDate}…`);

  const channelMetrics = await analytics.getChannelMetrics(startDate, endDate);
  const videoMetrics = await analytics.getVideoMetrics(videoIds, startDate, endDate);

  // Retention curves cost one request each, so only the best-performing
  // uploads are sampled — those are the ones worth learning from anyway.
  const sample = [...videoMetrics]
    .sort((a, b) => (b.estimatedMinutesWatched ?? 0) - (a.estimatedMinutesWatched ?? 0))
    .slice(0, options.retentionSampleSize)
    .map((m) => m.videoId);

  log.info(`pulling ${sample.length} retention curves…`);
  const retentionCurves = await analytics.getRetentionCurves(sample, startDate, endDate);

  return { channelMetrics, videoMetrics, retentionCurves };
}

/** The full pipeline: ingest, analyse, benchmark, price, and optionally advise. */
export async function run(options: RunOptions): Promise<LitixReport> {
  const config = options.config ?? loadConfig();
  const { dataset, api } = await ingest({ ...options, config });

  const profile = buildChannelProfile(dataset);
  const audience = buildAudienceModel(profile, dataset, {
    ownedListSize: options.operator?.ownedListSize,
  });
  const plays = rankPlays(profile, audience, { operator: options.operator });

  const report: LitixReport = {
    generatedAt: new Date().toISOString(),
    profile,
    audience,
    plays,
  };

  if (options.benchmark) {
    const references = await loadReferences(options.referencesPath);
    const peers = referencesForNiche(references, profile.niche.slug);
    if (peers.length === 0) {
      log.warn(
        `No reference operators registered for niche "${profile.niche.slug}". Add some to data/references.json to enable benchmarking.`,
      );
    } else {
      report.benchmark = await benchmarkAgainst(profile, peers, api);
    }
  }

  if (options.advise) {
    report.advisor = await generateAdvice({
      apiKey: requireAnthropicKey(config),
      model: config.LITIX_MODEL,
      profile,
      audience,
      plays,
      benchmark: report.benchmark,
      operator: options.operator,
    });
  }

  return report;
}
