/**
 * LITIX domain model.
 *
 * The pipeline runs in four stages and each stage has its own family of types:
 *
 *   ingest    -> ChannelSnapshot, VideoRecord, OwnerMetrics   (facts from the YouTube APIs)
 *   analyse   -> ChannelProfile                                (what is working on this channel)
 *   benchmark -> BenchmarkReport                               (how proven operators in the niche do it)
 *   monetize  -> AudienceModel, Projection, Play               (what that audience is worth, and the cheapest path to it)
 *
 * Everything downstream of `ingest` is pure: given the same records you get the
 * same numbers. Only the advisor layer is non-deterministic, and it is handed
 * the computed numbers rather than being asked to invent them.
 */

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/** How a video is treated for analysis. YouTube does not expose this directly. */
export type VideoFormat = "short" | "long" | "live";

/** Public channel facts from the Data API (`channels.list`). */
export interface ChannelSnapshot {
  channelId: string;
  handle?: string;
  title: string;
  description: string;
  publishedAt: string;
  country?: string;
  subscriberCount: number;
  /** Zero when the channel hides its subscriber count. */
  subscriberCountHidden: boolean;
  viewCount: number;
  videoCount: number;
  uploadsPlaylistId: string;
  thumbnailUrl?: string;
  fetchedAt: string;
}

/** A single upload, merged from `playlistItems.list` + `videos.list`. */
export interface VideoRecord {
  videoId: string;
  channelId: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  format: VideoFormat;
  views: number;
  likes: number;
  comments: number;
  tags: string[];
  categoryId?: string;
  thumbnailUrl?: string;
  /** Days between publish and the moment the snapshot was taken. */
  ageDays: number;
}

/**
 * Per-video metrics that only the channel owner can read, via the YouTube
 * Analytics API. Absent for every competitor and for un-authorised runs.
 */
export interface OwnerVideoMetrics {
  videoId: string;
  averageViewPercentage?: number;
  averageViewDurationSeconds?: number;
  estimatedMinutesWatched?: number;
  subscribersGained?: number;
  impressions?: number;
  /** Percent, 0-100, as YouTube reports it. */
  impressionClickThroughRate?: number;
}

/** An audience-retention curve: how much of the audience is still watching at each point. */
export interface RetentionCurve {
  videoId: string;
  points: RetentionPoint[];
}

export interface RetentionPoint {
  /** 0..1 through the video. */
  elapsedVideoTimeRatio: number;
  /** 1.0 means "all the viewers who started are still watching". */
  audienceWatchRatio: number;
  /** YouTube's comparison against similar videos, when available. */
  relativeRetentionPerformance?: number;
}

/** Channel-level owner metrics used to sharpen the audience model. */
export interface OwnerChannelMetrics {
  periodStart: string;
  periodEnd: string;
  views?: number;
  estimatedMinutesWatched?: number;
  averageViewDurationSeconds?: number;
  subscribersGained?: number;
  subscribersLost?: number;
  /** Only exposed on some report types; drives a much better reach estimate when present. */
  uniqueViewers?: number;
  estimatedRevenue?: number;
  trafficSources?: TrafficSourceShare[];
}

export interface TrafficSourceShare {
  source: string;
  views: number;
  share: number;
}

/** Everything LITIX knows about one channel before analysis runs. */
export interface ChannelDataset {
  channel: ChannelSnapshot;
  videos: VideoRecord[];
  owner?: {
    channelMetrics?: OwnerChannelMetrics;
    videoMetrics: OwnerVideoMetrics[];
    retentionCurves: RetentionCurve[];
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** Aggregate performance of one format on one channel. */
export interface FormatStats {
  format: VideoFormat;
  count: number;
  share: number;
  totalViews: number;
  medianViews: number;
  meanViews: number;
  p90Views: number;
  /** Spread of outcomes: p90 / median. High means the format is hit-driven. */
  hitSkew: number;
  medianEngagementRate: number;
  medianViewsPerDay: number;
  medianDurationSeconds: number;
}

/** A video called out as unusually good or bad against its own channel baseline. */
export interface VideoInsight {
  videoId: string;
  title: string;
  format: VideoFormat;
  publishedAt: string;
  ageDays: number;
  views: number;
  viewsPerDay: number;
  engagementRate: number;
  /** Views as a multiple of the median for the same format on this channel. */
  multipleOfBaseline: number;
  durationSeconds: number;
  averageViewPercentage?: number;
}

export interface PerformanceProfile {
  /** Median views per format, the yardstick every multiple is measured against. */
  baselines: Record<VideoFormat, number>;
  outliers: VideoInsight[];
  laggards: VideoInsight[];
  /** Recent-window median divided by prior-window median, per format. */
  trend: Record<VideoFormat, number | null>;
  consistencyScore: number;
}

/** A recurring, testable title/packaging pattern with measured lift. */
export interface HookPattern {
  id: string;
  label: string;
  description: string;
  matchCount: number;
  medianMultiple: number;
  /** Median multiple for videos matching, divided by the median for videos not matching. */
  lift: number;
  examples: { videoId: string; title: string; multipleOfBaseline: number }[];
  confidence: "low" | "medium" | "high";
}

export interface CadenceProfile {
  uploadsPerWeek: number;
  uploadsPerWeekByFormat: Record<VideoFormat, number>;
  medianGapDays: number;
  longestGapDays: number;
  /** 0..1; how evenly spaced uploads are. Streaks and droughts push this down. */
  regularity: number;
  activeDays: number;
}

export interface RetentionProfile {
  videosAnalysed: number;
  /** Share of the audience still watching at 30 seconds, median across videos. */
  medianRetentionAt30s?: number;
  medianRetentionAtHalf?: number;
  medianAverageViewPercentage?: number;
  /** Median drop across the first 10% of the video: the hook tax. */
  medianHookDropoff?: number;
  strongest?: { videoId: string; title: string; averageViewPercentage: number };
  weakest?: { videoId: string; title: string; averageViewPercentage: number };
  notes: string[];
}

export interface NicheProfile {
  /** Best-guess niche slug, e.g. "home-services". */
  slug: string;
  label: string;
  confidence: number;
  /** 0..1 — how readily this niche's audience converts into off-platform revenue. */
  commercialIntent: number;
  signals: string[];
}

/** The full read on one channel. This is what the advisor and the report consume. */
export interface ChannelProfile {
  channel: ChannelSnapshot;
  window: { from: string; to: string; videoCount: number };
  formats: FormatStats[];
  performance: PerformanceProfile;
  hooks: HookPattern[];
  cadence: CadenceProfile;
  retention?: RetentionProfile;
  niche: NicheProfile;
  /** Which format is carrying the channel right now, and why. */
  verdict: string[];
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

export interface ReferenceCreator {
  id: string;
  name: string;
  handle: string;
  niche: string;
  /** Why this account is worth copying: the specific mechanic it proves. */
  mechanic: string;
  monetization: string[];
}

export interface BenchmarkPeer {
  reference: ReferenceCreator;
  profile: ChannelProfile;
}

export interface BenchmarkDelta {
  metric: string;
  you: number;
  peerMedian: number;
  /** Positive means the channel is ahead of the peer median. */
  deltaPct: number;
  interpretation: string;
}

export interface BenchmarkReport {
  niche: string;
  peers: { name: string; handle: string; subscribers: number; mechanic: string }[];
  deltas: BenchmarkDelta[];
  /** Patterns that show up across peers but are missing or weak on this channel. */
  transferablePatterns: HookPattern[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Monetization
// ---------------------------------------------------------------------------

/**
 * The audience translated into commercial terms. Every figure past
 * `monthlyViews` is an estimate, and every estimate names its assumption.
 */
export interface AudienceModel {
  monthlyViews: number;
  monthlyViewsByFormat: Record<VideoFormat, number>;
  subscribers: number;
  /** Distinct humans reached per month, not view events. */
  estimatedMonthlyReach: number;
  /** The slice that actually pays attention: the only slice worth pricing against. */
  estimatedEngagedAudience: number;
  /** Audience reachable without the algorithm: subscribers plus any owned list. */
  estimatedOwnedAudience: number;
  engagementRate: number;
  /** 0..1, blended from engagement, retention and subscriber conversion. */
  audienceQualityScore: number;
  commercialIntent: number;
  /** True when reach came from owner analytics rather than being modelled. */
  reachIsMeasured: boolean;
  assumptions: Assumption[];
}

/** Every derived number carries the reasoning that produced it. */
export interface Assumption {
  key: string;
  value: number | string;
  basis: string;
}

export type ArchetypeCategory =
  | "platform"
  | "sponsorship"
  | "affiliate"
  | "digital-product"
  | "education"
  | "service"
  | "community"
  | "software"
  | "physical";

/** A way to turn attention into money, with the economics that govern it. */
export interface ProductArchetype {
  id: string;
  name: string;
  category: ArchetypeCategory;
  description: string;
  /** Price point in USD. Recurring archetypes price per month. */
  price: Band;
  /** Share of the engaged audience that buys, per launch window. */
  conversionRate: Band;
  recurring: boolean;
  /** Median months a subscriber stays, for recurring archetypes. */
  retentionMonths?: number;
  /** Share of revenue eaten by delivery, fulfilment and fees. */
  deliveryCostRate: number;
  refundRate: number;
  /**
   * Hours of the operator's own time each sale consumes. Present only for
   * archetypes where delivery is one-to-one, which makes demand irrelevant past
   * a point: you cannot sell more consulting than you can deliver.
   */
  deliveryHoursPerUnit?: number;
  /** 1 = a weekend, 5 = a company. */
  effort: 1 | 2 | 3 | 4 | 5;
  timeToFirstRevenueDays: number;
  requiredSkills: string[];
  /** Niches where this archetype reliably works. Empty means broadly applicable. */
  bestForNiches: string[];
  /** Minimum engaged audience below which the maths stops being honest. */
  minimumEngagedAudience: number;
  notes: string[];
}

export interface Band {
  low: number;
  base: number;
  high: number;
}

export interface RevenueScenario {
  label: "conservative" | "base" | "optimistic";
  buyers: number;
  price: number;
  conversionRate: number;
  grossMonthlyRevenue: number;
  netMonthlyRevenue: number;
  netAnnualRevenue: number;
}

export interface SensitivityRow {
  driver: string;
  change: string;
  netMonthlyRevenue: number;
  deltaPct: number;
}

export interface Projection {
  archetypeId: string;
  archetypeName: string;
  category: ArchetypeCategory;
  scenarios: Record<"conservative" | "base" | "optimistic", RevenueScenario>;
  /** Revenue reachable within 90 days, discounted for ramp-up. */
  expectedValue90d: number;
  sensitivity: SensitivityRow[];
  assumptions: Assumption[];
  warnings: string[];
}

/** A ranked, costed move. The ranking is the product. */
export interface Play {
  archetype: ProductArchetype;
  projection: Projection;
  /** 0..1 fit between the archetype and this specific channel. */
  fitScore: number;
  /** 0..1 fit between the archetype and the operator's stated skills. */
  skillScore: number;
  /** Expected 90-day net revenue per unit of effort. Drives the ranking. */
  resistanceScore: number;
  rationale: string[];
  blockers: string[];
}

/** What the operator brings, which decides the path of least resistance. */
export interface OperatorProfile {
  skills: string[];
  hoursPerWeek: number;
  startingCapitalUsd: number;
  /** Existing email or SMS list they can already reach. */
  ownedListSize: number;
  goals?: string;
  constraints?: string[];
}

// ---------------------------------------------------------------------------
// Advisor output
// ---------------------------------------------------------------------------

/** A concrete, shippable recommendation grounded in the computed projections. */
export interface Recommendation {
  title: string;
  archetypeId: string;
  offer: string;
  whyThisChannel: string;
  pricing: string;
  firstThreeVideos: { title: string; hook: string; angle: string }[];
  first30Days: string[];
  successMetric: string;
  killCriteria: string;
}

export interface AdvisorOutput {
  positioning: string;
  contentVerdict: string[];
  recommendations: Recommendation[];
  risks: string[];
}

/** Everything one `litix run` produces. */
export interface LitixReport {
  generatedAt: string;
  profile: ChannelProfile;
  benchmark?: BenchmarkReport;
  audience: AudienceModel;
  plays: Play[];
  advisor?: AdvisorOutput;
}
