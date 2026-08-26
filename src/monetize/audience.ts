import type {
  Assumption,
  AudienceModel,
  ChannelDataset,
  ChannelProfile,
  VideoFormat,
  VideoRecord,
} from "../types.js";
import { analysableVideos } from "../analysis/format.js";
import { engagementRate } from "../analysis/performance.js";
import { clamp, median, round, safeDivide, sum, weightedAverage } from "../util/stats.js";

/**
 * The audience model.
 *
 * This is where view counts stop being a vanity number and become a commercial
 * quantity. Three translations happen here, and each one loses people:
 *
 *   views -> reach     : a view is not a person. Shorts especially are re-watched
 *                        and swiped past by the same accounts.
 *   reach -> engaged   : most of the reach felt nothing. Only the slice that
 *                        actually pays attention can be sold to.
 *   engaged -> owned   : the algorithm's audience is rented. Subscribers and a
 *                        list are the part that survives a bad month.
 *
 * Every constant below is a stated assumption, not a fact, and each one is
 * emitted in `assumptions` so the numbers can be argued with.
 */

/**
 * View-events per distinct viewer per month, by format. Shorts are re-served to
 * the same accounts far more aggressively than long-form.
 */
export const VIEWS_PER_VIEWER: Record<VideoFormat, number> = {
  short: 2.2,
  long: 1.4,
  live: 1.2,
};

/** Window used to measure current output rather than lifetime totals. */
export const RECENT_WINDOW_DAYS = 90;

/**
 * Views still arriving from the back catalogue, as a share of what new uploads
 * produce. Deliberately low: LITIX would rather understate revenue than overstate it.
 */
export const CATALOGUE_TAIL_SHARE = 0.15;

export interface AudienceOptions {
  /** An existing email or SMS list, which converts far better than platform reach. */
  ownedListSize?: number;
}

export function buildAudienceModel(
  profile: ChannelProfile,
  dataset: ChannelDataset,
  options: AudienceOptions = {},
): AudienceModel {
  const assumptions: Assumption[] = [];
  const videos = analysableVideos(dataset.videos);

  const { monthlyViews, monthlyViewsByFormat, measured } = estimateMonthlyViews(
    videos,
    dataset,
    assumptions,
  );

  const reach = estimateReach(monthlyViews, monthlyViewsByFormat, dataset, assumptions);

  const rate = videos.length > 0 ? median(videos.map(engagementRate)) : 0;
  assumptions.push({
    key: "engagementRate",
    value: round(rate, 5),
    basis: `Median (likes + comments) / views across ${videos.length} analysable uploads.`,
  });

  const quality = scoreAudienceQuality(profile, rate, dataset, assumptions);

  // Only a slice of reach is commercially real. The band is 1%-8%: below 1% even
  // a strong offer finds nobody, and above 8% is not observed outside small,
  // unusually devoted communities. This is the single most consequential
  // assumption in LITIX — everything sold to the audience is priced off it —
  // so it is set deliberately low. Most creator revenue calculators quietly
  // apply a figure several times this and produce fantasy numbers as a result.
  const engagedShare = 0.01 + 0.07 * quality;
  assumptions.push({
    key: "engagedShare",
    value: round(engagedShare, 4),
    basis: `Share of monthly reach treated as commercially reachable, scaled 1%-8% by an audience quality score of ${round(quality, 2)}.`,
  });

  // Subscriber counts flatter everyone; only a fraction see any given upload
  // and fewer still act on one.
  const subscriberActivityRate = 0.05 + 0.1 * quality;
  const activeSubscribers = dataset.channel.subscriberCount * subscriberActivityRate;
  const ownedList = options.ownedListSize ?? 0;
  const ownedAudience = activeSubscribers + ownedList;

  assumptions.push({
    key: "subscriberActivityRate",
    value: round(subscriberActivityRate, 4),
    basis: `Share of subscribers treated as genuinely reachable (5%-15%, scaled by audience quality). Applied to ${dataset.channel.subscriberCount.toLocaleString()} subscribers.`,
  });
  if (ownedList > 0) {
    assumptions.push({
      key: "ownedListSize",
      value: ownedList,
      basis: "Operator-supplied email or SMS list, counted as fully reachable.",
    });
  }

  // An engaged audience can never be smaller than the people who already opted
  // in, so the owned audience sets the floor.
  const engagedFromReach = reach * engagedShare;
  const engagedFloor = ownedAudience * 0.15;
  const engaged = Math.max(engagedFromReach, engagedFloor);
  if (engagedFloor > engagedFromReach) {
    assumptions.push({
      key: "engagedAudienceFloor",
      value: round(engagedFloor, 0),
      basis: "Owned audience sets the floor: 15% of reachable subscribers and list exceeded the estimate derived from monthly reach.",
    });
  }

  return {
    monthlyViews: round(monthlyViews, 0),
    monthlyViewsByFormat: {
      short: round(monthlyViewsByFormat.short, 0),
      long: round(monthlyViewsByFormat.long, 0),
      live: round(monthlyViewsByFormat.live, 0),
    },
    subscribers: dataset.channel.subscriberCount,
    estimatedMonthlyReach: round(reach, 0),
    estimatedEngagedAudience: round(engaged, 0),
    estimatedOwnedAudience: round(ownedAudience, 0),
    engagementRate: round(rate, 5),
    audienceQualityScore: round(quality, 3),
    commercialIntent: profile.niche.commercialIntent,
    reachIsMeasured: measured,
    assumptions,
  };
}

/**
 * Current monthly view volume.
 *
 * The Data API only exposes lifetime views per video, so monthly volume is
 * derived from how much recent uploads have accumulated over the days they have
 * existed. Owner analytics, when present, replace the estimate outright.
 */
function estimateMonthlyViews(
  videos: VideoRecord[],
  dataset: ChannelDataset,
  assumptions: Assumption[],
): {
  monthlyViews: number;
  monthlyViewsByFormat: Record<VideoFormat, number>;
  measured: boolean;
} {
  const ownerViews = dataset.owner?.channelMetrics?.views;
  const period = dataset.owner?.channelMetrics;

  const recent = videos.filter((v) => v.ageDays <= RECENT_WINDOW_DAYS);
  const observedSpan = recent.length > 0 ? Math.max(...recent.map((v) => v.ageDays)) : 0;
  const spanDays = clamp(observedSpan, 1, RECENT_WINDOW_DAYS);

  const byFormat: Record<VideoFormat, number> = { short: 0, long: 0, live: 0 };
  for (const video of recent) byFormat[video.format] += video.views;

  const newUploadViews = sum(Object.values(byFormat));
  const perMonthFromNew = safeDivide(newUploadViews * 30, spanDays);
  const olderCount = videos.length - recent.length;
  const tail = olderCount > 20 ? perMonthFromNew * CATALOGUE_TAIL_SHARE : 0;
  let monthlyViews = perMonthFromNew + tail;

  if (recent.length === 0) {
    assumptions.push({
      key: "monthlyViews",
      value: 0,
      basis: `No uploads in the last ${RECENT_WINDOW_DAYS} days. Current monthly volume cannot be estimated from a dormant channel.`,
    });
  } else {
    assumptions.push({
      key: "monthlyViews",
      value: round(monthlyViews, 0),
      basis: `${recent.length} uploads in the last ${Math.round(spanDays)} days accumulated ${Math.round(newUploadViews).toLocaleString()} views, normalised to 30 days${tail > 0 ? `, plus a ${Math.round(CATALOGUE_TAIL_SHARE * 100)}% back-catalogue tail` : ""}.`,
    });
  }

  let measured = false;
  if (ownerViews !== undefined && period) {
    const days = Math.max(
      1,
      (new Date(period.periodEnd).getTime() - new Date(period.periodStart).getTime()) /
        86_400_000,
    );
    const measuredMonthly = safeDivide(ownerViews * 30, days);
    if (measuredMonthly > 0) {
      // Preserve the observed format mix while replacing the total with measured data.
      const scale = safeDivide(measuredMonthly, monthlyViews, 1);
      if (monthlyViews > 0) {
        byFormat.short *= scale;
        byFormat.long *= scale;
        byFormat.live *= scale;
      }
      monthlyViews = measuredMonthly;
      measured = true;
      assumptions.push({
        key: "monthlyViews",
        value: round(measuredMonthly, 0),
        basis: `Measured: YouTube Analytics reported ${ownerViews.toLocaleString()} views over ${Math.round(days)} days, normalised to 30. This replaces the estimate above.`,
      });
    }
  } else {
    // Scale the raw recent-window totals to the same monthly basis.
    const scale = safeDivide(monthlyViews, newUploadViews, 0);
    byFormat.short *= scale;
    byFormat.long *= scale;
    byFormat.live *= scale;
  }

  return { monthlyViews, monthlyViewsByFormat: byFormat, measured };
}

/** Distinct people reached per month, from view events. */
function estimateReach(
  monthlyViews: number,
  byFormat: Record<VideoFormat, number>,
  dataset: ChannelDataset,
  assumptions: Assumption[],
): number {
  const measured = dataset.owner?.channelMetrics?.uniqueViewers;
  if (measured !== undefined && measured > 0) {
    assumptions.push({
      key: "monthlyReach",
      value: measured,
      basis: "Measured: unique viewers reported by YouTube Analytics.",
    });
    return measured;
  }

  const blendedViewsPerViewer = weightedAverage([
    { value: VIEWS_PER_VIEWER.short, weight: byFormat.short },
    { value: VIEWS_PER_VIEWER.long, weight: byFormat.long },
    { value: VIEWS_PER_VIEWER.live, weight: byFormat.live },
  ]);
  const divisor = blendedViewsPerViewer > 0 ? blendedViewsPerViewer : VIEWS_PER_VIEWER.long;
  const reach = safeDivide(monthlyViews, divisor);

  assumptions.push({
    key: "viewsPerViewer",
    value: round(divisor, 2),
    basis: `View events per distinct viewer per month, blended across the channel's format mix (Shorts ${VIEWS_PER_VIEWER.short}, long-form ${VIEWS_PER_VIEWER.long}). Monthly reach = monthly views / this figure.`,
  });

  return reach;
}

/**
 * 0..1 quality score blending the four signals that predict whether an audience
 * will act: how much they respond, how much they watch, how readily they
 * subscribe, and how reliably the channel delivers.
 */
function scoreAudienceQuality(
  profile: ChannelProfile,
  rate: number,
  dataset: ChannelDataset,
  assumptions: Assumption[],
): number {
  // 2% engagement is solid, 6% is exceptional.
  const engagementComponent = clamp(rate / 0.06, 0, 1);

  const avgViewPercentage = profile.retention?.medianAverageViewPercentage;
  // 50% average view percentage is a strong long-form result.
  const retentionComponent =
    avgViewPercentage !== undefined ? clamp(avgViewPercentage / 50, 0, 1) : 0.5;

  const subscriberConversion = safeDivide(
    dataset.channel.subscriberCount,
    dataset.channel.viewCount,
  );
  // One subscriber per 200 lifetime views is a healthy conversion rate.
  const conversionComponent = clamp(subscriberConversion / 0.005, 0, 1);

  const consistencyComponent = clamp(profile.performance.consistencyScore, 0, 1);

  const quality = weightedAverage([
    { value: engagementComponent, weight: 0.35 },
    { value: retentionComponent, weight: 0.3 },
    { value: conversionComponent, weight: 0.2 },
    { value: consistencyComponent, weight: 0.15 },
  ]);

  assumptions.push({
    key: "audienceQualityScore",
    value: round(quality, 3),
    basis: `Weighted blend of engagement (35%), retention (30%${avgViewPercentage === undefined ? ", neutral 0.5 used — no owner data" : ""}), subscriber conversion (20%) and upload consistency (15%).`,
  });

  return quality;
}
