import type {
  BenchmarkDelta,
  BenchmarkPeer,
  BenchmarkReport,
  ChannelProfile,
  HookPattern,
  ReferenceCreator,
} from "../types.js";
import type { YouTubeDataApi } from "../youtube/dataApi.js";
import { buildChannelProfile } from "../analysis/profile.js";
import { actionableHooks } from "../analysis/hooks.js";
import { log } from "../util/logger.js";
import { median, round, safeDivide } from "../util/stats.js";

export interface BenchmarkOptions {
  /** Uploads to pull per peer. Peers are context, not the subject, so this stays small. */
  videosPerPeer?: number;
  sinceDays?: number;
}

/**
 * Benchmarking runs on public data only.
 *
 * Retention, impressions and traffic sources are owner-scoped — no tool can
 * read them for a channel you do not control, and anything claiming otherwise
 * is inferring. LITIX compares what is genuinely observable: format mix,
 * cadence, packaging patterns, and how far each upload travels relative to the
 * channel's own subscriber base.
 */
export async function benchmarkAgainst(
  subject: ChannelProfile,
  references: ReferenceCreator[],
  api: YouTubeDataApi,
  options: BenchmarkOptions = {},
): Promise<BenchmarkReport> {
  const videosPerPeer = options.videosPerPeer ?? 60;
  const peers: BenchmarkPeer[] = [];
  const notes: string[] = [];

  for (const reference of references) {
    try {
      const sweep = await api.sweepChannel(`@${reference.handle}`, {
        maxVideos: videosPerPeer,
        sinceDays: options.sinceDays,
      });
      peers.push({
        reference,
        profile: buildChannelProfile({ channel: sweep.channel, videos: sweep.videos }),
      });
    } catch (error) {
      // A stale handle must not sink the whole run.
      log.warn(`Skipping reference ${reference.name}: ${(error as Error).message}`);
      notes.push(
        `Could not resolve @${reference.handle} (${reference.name}) — update data/references.json.`,
      );
    }
  }

  if (peers.length === 0) {
    return {
      niche: subject.niche.slug,
      peers: [],
      deltas: [],
      transferablePatterns: [],
      notes: [
        ...notes,
        "No reference channels resolved, so no comparison was made. Add handles for the accounts you actually compete with in data/references.json.",
      ],
    };
  }

  notes.push(
    "Peer figures are public-data only: format mix, cadence, packaging and views-per-subscriber. Retention and click-through are owner-scoped and cannot be read for another channel.",
  );

  return {
    niche: subject.niche.slug,
    peers: peers.map((p) => ({
      name: p.reference.name,
      handle: p.reference.handle,
      subscribers: p.profile.channel.subscriberCount,
      mechanic: p.reference.mechanic,
    })),
    deltas: computeDeltas(subject, peers),
    transferablePatterns: findTransferablePatterns(subject, peers),
    notes,
  };
}

function computeDeltas(subject: ChannelProfile, peers: BenchmarkPeer[]): BenchmarkDelta[] {
  const deltas: BenchmarkDelta[] = [];

  const add = (
    metric: string,
    you: number,
    peerValues: number[],
    interpret: (deltaPct: number, peerMedian: number) => string,
  ) => {
    const peerMedian = median(peerValues.filter((v) => Number.isFinite(v)));
    if (peerMedian === 0 && you === 0) return;
    const deltaPct = peerMedian === 0 ? 0 : safeDivide(you - peerMedian, peerMedian, 0);
    deltas.push({
      metric,
      you: round(you, 3),
      peerMedian: round(peerMedian, 3),
      deltaPct: round(deltaPct, 3),
      interpretation: interpret(deltaPct, peerMedian),
    });
  };

  // Views per subscriber is the one size-independent reach measure available
  // publicly: it says how far each upload travels beyond the existing audience.
  add(
    "Median views per subscriber (long-form)",
    viewsPerSubscriber(subject, "long"),
    peers.map((p) => viewsPerSubscriber(p.profile, "long")),
    (delta) =>
      delta >= 0
        ? "Long-form travels further beyond the subscriber base than the peer median — the packaging is doing work."
        : "Long-form is under-reaching relative to peers at the same subscriber level. This is a packaging problem before it is a content problem.",
  );

  add(
    "Median views per subscriber (Shorts)",
    viewsPerSubscriber(subject, "short"),
    peers.map((p) => viewsPerSubscriber(p.profile, "short")),
    (delta) =>
      delta >= 0
        ? "Shorts are pulling non-subscriber reach at or above the peer rate."
        : "Shorts are under-reaching versus peers — usually the first three seconds, not the topic.",
  );

  add(
    "Uploads per week",
    subject.cadence.uploadsPerWeek,
    peers.map((p) => p.profile.cadence.uploadsPerWeek),
    (delta, peerMedian) =>
      delta >= 0
        ? `Publishing at or above the peer rate of ${peerMedian.toFixed(1)} per week.`
        : `Peers publish ${peerMedian.toFixed(1)}x per week. Volume is the cheapest variable to change here.`,
  );

  add(
    "Shorts share of uploads",
    shareOfFormat(subject, "short"),
    peers.map((p) => shareOfFormat(p.profile, "short")),
    (delta, peerMedian) =>
      delta >= 0
        ? "Leaning on Shorts at least as hard as peers do."
        : `Peers run ${Math.round(peerMedian * 100)}% of uploads as Shorts. There is unclaimed top-of-funnel reach here.`,
  );

  add(
    "Median engagement rate (long-form)",
    subject.formats.find((f) => f.format === "long")?.medianEngagementRate ?? 0,
    peers.map((p) => p.profile.formats.find((f) => f.format === "long")?.medianEngagementRate ?? 0),
    (delta) =>
      delta >= 0
        ? "Audience responds more than the peer median — a good sign for anything sold to them."
        : "Engagement trails peers. A quiet audience converts worse than a small loud one.",
  );

  return deltas;
}

/**
 * Packaging patterns that lift across peers but are absent or weak on the
 * subject channel. These are the concrete, testable borrowings.
 */
function findTransferablePatterns(
  subject: ChannelProfile,
  peers: BenchmarkPeer[],
): HookPattern[] {
  const subjectById = new Map(subject.hooks.map((h) => [h.id, h]));
  const peerPatterns = new Map<string, HookPattern[]>();

  for (const peer of peers) {
    for (const pattern of actionableHooks(peer.profile.hooks, 1.15)) {
      const bucket = peerPatterns.get(pattern.id) ?? [];
      bucket.push(pattern);
      peerPatterns.set(pattern.id, bucket);
    }
  }

  const transferable: HookPattern[] = [];

  for (const [id, patterns] of peerPatterns) {
    // Require the pattern to work for more than one peer before calling it a
    // niche norm rather than one channel's quirk.
    if (patterns.length < Math.min(2, peers.length)) continue;

    const mine = subjectById.get(id);
    const peerLift = median(patterns.map((p) => p.lift));
    const alreadyWorking = mine && mine.lift >= 1.15 && mine.confidence !== "low";
    if (alreadyWorking) continue;

    const template = patterns[0]!;
    transferable.push({
      ...template,
      matchCount: mine?.matchCount ?? 0,
      medianMultiple: mine?.medianMultiple ?? 0,
      lift: round(peerLift, 3),
      examples: patterns.flatMap((p) => p.examples).slice(0, 3),
      confidence: patterns.length >= 3 ? "medium" : "low",
      description: `${template.description} Lifts ${peerLift.toFixed(2)}x across ${patterns.length} peer channel${patterns.length === 1 ? "" : "s"}; ${
        mine
          ? `on this channel it currently sits at ${mine.lift.toFixed(2)}x across ${mine.matchCount} videos.`
          : "this channel does not use it at measurable volume."
      }`,
    });
  }

  return transferable.sort((a, b) => b.lift - a.lift).slice(0, 6);
}

function viewsPerSubscriber(profile: ChannelProfile, format: "short" | "long"): number {
  const stats = profile.formats.find((f) => f.format === format);
  const subscribers = profile.channel.subscriberCount;
  if (!stats || subscribers <= 0) return 0;
  return safeDivide(stats.medianViews, subscribers, 0);
}

function shareOfFormat(profile: ChannelProfile, format: "short" | "long"): number {
  return profile.formats.find((f) => f.format === format)?.share ?? 0;
}
