import type { HookPattern, VideoFormat, VideoRecord } from "../types.js";
import { median, safeDivide } from "../util/stats.js";
import { analysableVideos } from "./format.js";
import { computeBaselines, isMature } from "./performance.js";

/**
 * Hook detection.
 *
 * A "hook" here is a packaging decision visible in the title: the promise that
 * earns the click. LITIX does not guess which hooks are good in the abstract —
 * it tests each pattern against the channel's own baseline and reports the
 * measured lift. A pattern that works everywhere else but not on this channel
 * is reported as not working on this channel.
 */
export interface HookDefinition {
  id: string;
  label: string;
  description: string;
  test: (video: VideoRecord) => boolean;
}

const NUMBER_LEAD = /^\s*\d+\s|\b\d+\s+(ways?|things?|tips?|steps?|reasons?|mistakes?|secrets?|rules?|hacks?)\b/i;
const CURIOSITY = /\b(why|what happens|nobody tells you|the truth about|secret|nobody talks about|hidden|actually|really)\b/i;
const NEGATIVE = /\b(stop|never|don'?t|mistake|wrong|worst|avoid|fail(ed|ing|ure)?|scam|warning|myth)\b/i;
const HOWTO = /\b(how to|how i|tutorial|guide|step by step|beginner)\b/i;
const MONEY = /(\$[\d,]+|\b\d+k\b|\b(profit|revenue|paid|price|cost|charge|income|made|earn(ed|ing)?)\b)/i;
const SUPERLATIVE = /\b(best|ultimate|perfect|greatest|top|#1|number one|only)\b/i;
const TIMEBOUND = /\b(in \d+ (minutes?|hours?|days?|weeks?|months?|years?)|\b20\d\d\b|today|right now|fast|quick(ly)?)\b/i;
const VERSUS = /\b(vs\.?|versus|compared to|or)\b/i;
const FIRST_PERSON = /\b(i|my|we|our)\b/i;
const DIRECT_ADDRESS = /\b(you|your|you'?re)\b/i;
const QUESTION = /\?/;
const BRACKETED = /[[(][^\])]{2,}[\])]/;
const ALL_CAPS_WORD = /\b[A-Z]{3,}\b/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

export const HOOK_DEFINITIONS: HookDefinition[] = [
  {
    id: "numbered-list",
    label: "Numbered list",
    description: "Leads with a count — a bounded promise the viewer can price before clicking.",
    test: (v) => NUMBER_LEAD.test(v.title),
  },
  {
    id: "curiosity-gap",
    label: "Curiosity gap",
    description: "Withholds the payoff: the title poses the question the video answers.",
    test: (v) => CURIOSITY.test(v.title),
  },
  {
    id: "negative-framing",
    label: "Negative / warning framing",
    description: "Mistakes, myths and what not to do. Loss aversion outpulls gain framing in most niches.",
    test: (v) => NEGATIVE.test(v.title),
  },
  {
    id: "how-to",
    label: "How-to / tutorial",
    description: "Explicit instructional promise. Predictable floor, limited ceiling.",
    test: (v) => HOWTO.test(v.title),
  },
  {
    id: "money-stakes",
    label: "Money on screen",
    description: "A dollar figure or income claim in the title. The strongest commercial-intent signal.",
    test: (v) => MONEY.test(v.title),
  },
  {
    id: "superlative",
    label: "Superlative",
    description: "Best / ultimate / #1 framing.",
    test: (v) => SUPERLATIVE.test(v.title),
  },
  {
    id: "time-bound",
    label: "Time-bound promise",
    description: "A deadline or speed claim — 'in 30 days', 'in 5 minutes'.",
    test: (v) => TIMEBOUND.test(v.title),
  },
  {
    id: "comparison",
    label: "Comparison",
    description: "Head-to-head framing. Captures viewers already at the decision stage.",
    test: (v) => VERSUS.test(v.title),
  },
  {
    id: "first-person",
    label: "First-person story",
    description: "'I' / 'my' framing. Trades authority for relatability.",
    test: (v) => FIRST_PERSON.test(v.title),
  },
  {
    id: "direct-address",
    label: "Direct address",
    description: "Speaks to 'you'. Narrows the promise to the individual viewer.",
    test: (v) => DIRECT_ADDRESS.test(v.title),
  },
  {
    id: "question",
    label: "Question title",
    description: "Ends on a question mark.",
    test: (v) => QUESTION.test(v.title),
  },
  {
    id: "bracket-annotation",
    label: "Bracketed annotation",
    description: "A [qualifier] or (proof) appended to the promise.",
    test: (v) => BRACKETED.test(v.title),
  },
  {
    id: "caps-emphasis",
    label: "Capitalised emphasis",
    description: "At least one all-caps word carrying the emphasis.",
    test: (v) => ALL_CAPS_WORD.test(v.title),
  },
  {
    id: "emoji",
    label: "Emoji in title",
    description: "Visual break in a wall of text. Mostly a Shorts device.",
    test: (v) => EMOJI.test(v.title),
  },
  {
    id: "short-title",
    label: "Short title (under 40 chars)",
    description: "Fits mobile without truncation.",
    test: (v) => v.title.length > 0 && v.title.length < 40,
  },
];

export interface HookAnalysisOptions {
  /** Patterns matching fewer videos than this are dropped as noise. */
  minMatches?: number;
  /** Restrict analysis to one format. */
  format?: VideoFormat;
}

/**
 * Score every hook pattern by lift: the median performance of videos using it
 * divided by the median of videos that do not. A lift of 1.4 means titles
 * carrying that pattern typically land 40% above the ones that do not.
 */
export function analyseHooks(
  allVideos: VideoRecord[],
  options: HookAnalysisOptions = {},
): HookPattern[] {
  const minMatches = options.minMatches ?? 3;

  let videos = analysableVideos(allVideos).filter(isMature);
  if (options.format) videos = videos.filter((v) => v.format === options.format);
  if (videos.length < minMatches * 2) return [];

  const baselines = computeBaselines(videos);
  const multiples = new Map<string, number>();
  for (const video of videos) {
    multiples.set(video.videoId, safeDivide(video.views, baselines[video.format], 0));
  }

  const patterns: HookPattern[] = [];

  for (const definition of HOOK_DEFINITIONS) {
    const matching = videos.filter(definition.test);
    const notMatching = videos.filter((v) => !definition.test(v));

    // Both sides need enough mass for the comparison to mean anything.
    if (matching.length < minMatches || notMatching.length < minMatches) continue;

    const matchedMultiples = matching.map((v) => multiples.get(v.videoId) ?? 0);
    const unmatchedMultiples = notMatching.map((v) => multiples.get(v.videoId) ?? 0);

    const medianMultiple = median(matchedMultiples);
    const controlMultiple = median(unmatchedMultiples);
    const lift = safeDivide(medianMultiple, controlMultiple, 1);

    patterns.push({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      matchCount: matching.length,
      medianMultiple,
      lift,
      examples: [...matching]
        .sort(
          (a, b) => (multiples.get(b.videoId) ?? 0) - (multiples.get(a.videoId) ?? 0),
        )
        .slice(0, 3)
        .map((v) => ({
          videoId: v.videoId,
          title: v.title,
          multipleOfBaseline: multiples.get(v.videoId) ?? 0,
        })),
      confidence: confidenceFor(matching.length, notMatching.length),
    });
  }

  return patterns.sort((a, b) => b.lift - a.lift);
}

/**
 * Sample-size gate. These are observational splits on a single channel, not
 * controlled experiments, so nothing here is ever labelled high confidence on
 * a handful of videos.
 */
function confidenceFor(matches: number, controls: number): HookPattern["confidence"] {
  const smaller = Math.min(matches, controls);
  if (smaller >= 15) return "high";
  if (smaller >= 7) return "medium";
  return "low";
}

/** Patterns worth acting on: meaningful lift, and enough data to believe it. */
export function actionableHooks(patterns: HookPattern[], minLift = 1.2): HookPattern[] {
  return patterns.filter(
    (p) => p.lift >= minLift && p.confidence !== "low",
  );
}

/** Patterns the channel leans on that are measurably underperforming. */
export function underperformingHooks(patterns: HookPattern[], maxLift = 0.85): HookPattern[] {
  return patterns.filter((p) => p.lift <= maxLift && p.confidence !== "low");
}
