import type {
  ChannelDataset,
  ChannelProfile,
  FormatStats,
  VideoFormat,
} from "../types.js";
import { formatCount, formatMultiple, formatPercent } from "../util/format.js";
import { safeDivide } from "../util/stats.js";
import { computeCadence } from "./cadence.js";
import { analysableVideos } from "./format.js";
import { actionableHooks, analyseHooks, underperformingHooks } from "./hooks.js";
import { classifyNiche } from "./niches.js";
import { computeFormatStats, computePerformanceProfile, pendingVideos } from "./performance.js";
import { buildRetentionProfile } from "./retention.js";

export interface ProfileOptions {
  outlierThreshold?: number;
  topN?: number;
}

/** Run every analyser over one ingested dataset and assemble the channel read. */
export function buildChannelProfile(
  dataset: ChannelDataset,
  options: ProfileOptions = {},
): ChannelProfile {
  const { channel, videos, owner } = dataset;
  const analysable = analysableVideos(videos);

  const formats = computeFormatStats(videos);
  const performance = computePerformanceProfile(videos, options);
  const hooks = analyseHooks(videos);
  const cadence = computeCadence(videos);
  const niche = classifyNiche(channel, videos);

  const sortedByDate = [...videos].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );

  const profile: ChannelProfile = {
    channel,
    window: {
      from: sortedByDate[0]?.publishedAt ?? channel.publishedAt,
      to: sortedByDate[sortedByDate.length - 1]?.publishedAt ?? channel.fetchedAt,
      videoCount: videos.length,
    },
    formats,
    performance,
    hooks,
    cadence,
    niche,
    verdict: [],
  };

  if (owner && (owner.retentionCurves.length > 0 || owner.videoMetrics.length > 0)) {
    profile.retention = buildRetentionProfile(
      owner.retentionCurves,
      owner.videoMetrics,
      videos,
    );
  }

  profile.verdict = buildVerdict(profile, analysable.length, pendingVideos(videos).length);
  return profile;
}

/**
 * The plain-language read on the channel. Every line has to be defensible from
 * a number computed above — this is the summary a creator would actually act
 * on, not a restatement of the dashboard.
 */
function buildVerdict(
  profile: ChannelProfile,
  analysableCount: number,
  pendingCount: number,
): string[] {
  const lines: string[] = [];
  const { formats, performance, cadence, hooks, retention, niche } = profile;

  const shorts = formats.find((f) => f.format === "short");
  const long = formats.find((f) => f.format === "long");

  if (shorts && long) {
    lines.push(describeFormatSplit(shorts, long));
  } else if (shorts) {
    lines.push(
      `Shorts-only channel: ${shorts.count} uploads at a median of ${formatCount(shorts.medianViews)} views. Without long-form there is nowhere to sell a considered purchase — Shorts build reach, long-form builds trust.`,
    );
  } else if (long) {
    lines.push(
      `Long-form only: ${long.count} uploads at a median of ${formatCount(long.medianViews)} views. Shorts are the cheapest untapped reach channel available to this account.`,
    );
  }

  const topFormat = formats[0];
  if (topFormat && topFormat.hitSkew >= 3) {
    lines.push(
      `${labelFor(topFormat.format)} performance is hit-driven — the 90th percentile lands ${formatMultiple(topFormat.hitSkew)} the median. A typical upload is not what this channel is capable of, so plan revenue off the median and treat outliers as upside.`,
    );
  }

  if (performance.consistencyScore >= 0.6) {
    lines.push(
      `Output is consistent (${formatPercent(performance.consistencyScore, 0)} consistency): the floor is predictable enough to plan a launch around.`,
    );
  } else if (performance.consistencyScore > 0 && performance.consistencyScore < 0.35) {
    lines.push(
      `Results swing hard between uploads (${formatPercent(performance.consistencyScore, 0)} consistency). Revenue plans should assume the median, never the best video.`,
    );
  }

  for (const [format, trend] of Object.entries(performance.trend) as [VideoFormat, number | null][]) {
    if (trend === null) continue;
    if (trend >= 1.25) {
      lines.push(`${labelFor(format)} is trending up: recent uploads land ${formatMultiple(trend)} the older half of the window.`);
    } else if (trend <= 0.75) {
      lines.push(`${labelFor(format)} is cooling: recent uploads land ${formatMultiple(trend)} the older half of the window.`);
    }
  }

  const winners = actionableHooks(hooks);
  if (winners.length > 0) {
    const top = winners.slice(0, 2)
      .map((h) => `${h.label} (${formatMultiple(h.lift)} lift, n=${h.matchCount})`)
      .join(" and ");
    lines.push(`Packaging that measurably works here: ${top}.`);
  }

  const losers = underperformingHooks(hooks);
  if (losers.length > 0) {
    const worst = losers[0]!;
    lines.push(
      `${worst.label} underperforms on this channel (${formatMultiple(worst.lift)} lift across ${worst.matchCount} videos) despite being a common pattern elsewhere.`,
    );
  }

  if (cadence.uploadsPerWeek > 0) {
    const regularity = cadence.regularity >= 0.6 ? "on a regular rhythm" : "in bursts";
    lines.push(
      `Publishing ${cadence.uploadsPerWeek.toFixed(1)}x per week ${regularity} (median gap ${cadence.medianGapDays.toFixed(1)} days, longest ${Math.round(cadence.longestGapDays)}).`,
    );
  }

  if (retention?.medianAverageViewPercentage !== undefined) {
    lines.push(
      `Median average view percentage is ${retention.medianAverageViewPercentage}% across ${retention.videosAnalysed} videos with retention data.`,
    );
  }
  for (const note of retention?.notes ?? []) lines.push(note);

  lines.push(
    `Niche read: ${niche.label} (confidence ${formatPercent(niche.confidence, 0)}), commercial intent ${formatPercent(niche.commercialIntent, 0)}. That intent figure is what every revenue projection below is scaled by.`,
  );

  if (pendingCount > 0) {
    lines.push(
      `${pendingCount} recent upload${pendingCount === 1 ? " is" : "s are"} too young to score and ${analysableCount === 0 ? "no videos" : "are"} excluded from the baselines.`,
    );
  }

  if (analysableCount < 10) {
    lines.push(
      `Only ${analysableCount} scoreable videos in the window — treat every figure here as directional until there are 20 or more.`,
    );
  }

  return lines;
}

function describeFormatSplit(shorts: FormatStats, long: FormatStats): string {
  const ratio = safeDivide(shorts.medianViews, long.medianViews, 0);
  const engagementEdge = safeDivide(long.medianEngagementRate, shorts.medianEngagementRate, 0);

  if (ratio >= 3) {
    return `Shorts out-reach long-form ${formatMultiple(ratio)} on median views (${formatCount(shorts.medianViews)} vs ${formatCount(long.medianViews)}), but long-form holds ${formatMultiple(engagementEdge)} the engagement rate. Shorts are the top of the funnel here; the money is made further down it.`;
  }
  if (ratio <= 0.5 && ratio > 0) {
    return `Long-form out-performs Shorts ${formatMultiple(safeDivide(1, ratio, 0))} on median views (${formatCount(long.medianViews)} vs ${formatCount(shorts.medianViews)}). The Shorts effort is not paying for itself at current packaging.`;
  }
  return `Shorts and long-form land in the same range (${formatCount(shorts.medianViews)} vs ${formatCount(long.medianViews)} median views). Long-form is the better bet at parity — it earns more per view and converts better.`;
}

function labelFor(format: VideoFormat): string {
  return format === "short" ? "Shorts" : format === "long" ? "Long-form" : "Live";
}
