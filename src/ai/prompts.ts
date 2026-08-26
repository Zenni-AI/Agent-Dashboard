import type {
  AudienceModel,
  BenchmarkReport,
  ChannelProfile,
  OperatorProfile,
  Play,
} from "../types.js";
import { formatCount, formatMultiple, formatPercent, formatUsd } from "../util/format.js";

/**
 * The advisor is given the arithmetic and asked for the judgement.
 *
 * Everything numeric in the output has already been computed deterministically
 * upstream — the model's job is to turn a ranked table into an offer someone
 * can ship on Monday, not to estimate revenue. The system prompt is frozen so
 * it caches cleanly across runs; only the channel brief varies.
 */
export const ADVISOR_SYSTEM_PROMPT = `You are the strategy layer of LITIX, a YouTube analytics engine that turns channel data into monetization plays.

Everything numeric in the brief you receive was computed from the channel's actual API data by a deterministic model upstream of you. Your job is judgement, not arithmetic.

Rules:
1. Never invent, re-derive or contradict a number. Cite the figures in the brief as given. If you need a number that is not there, describe it qualitatively instead.
2. Recommend only from the ranked plays supplied. Use the exact archetypeId when you name one.
3. Lead with the play that produces revenue soonest for the least work, unless a clearly better option is only marginally harder — and say so explicitly when you make that trade.
4. Be concrete. "Sell a course" is useless. "A $497 four-module course on quoting and pricing residential roof washes, pre-sold to the email list before recording" is useful.
5. Video titles you propose must use the packaging patterns that measurably work on THIS channel, per the hook analysis in the brief. Do not import generic YouTube advice that the data contradicts.
6. Respect the operator's stated skills, hours and capital. A plan they cannot execute is not a plan.
7. State kill criteria for every recommendation: the specific result that means stop, and by when.
8. Where the data is thin or the audience is small, say so plainly rather than padding the recommendation with confidence it has not earned.

Write like an operator briefing another operator: direct, specific, no hype, no filler.`;

export function buildChannelBrief(input: {
  profile: ChannelProfile;
  audience: AudienceModel;
  plays: Play[];
  benchmark?: BenchmarkReport;
  operator?: OperatorProfile;
}): string {
  const { profile, audience, plays, benchmark, operator } = input;
  const sections: string[] = [];

  sections.push(`## Channel
Name: ${profile.channel.title}
Handle: ${profile.channel.handle ? `@${profile.channel.handle}` : "(none)"}
Subscribers: ${formatCount(profile.channel.subscriberCount)}
Lifetime views: ${formatCount(profile.channel.viewCount)}
Uploads analysed: ${profile.window.videoCount} (${profile.window.from.slice(0, 10)} to ${profile.window.to.slice(0, 10)})
Niche: ${profile.niche.label} (confidence ${formatPercent(profile.niche.confidence, 0)}, commercial intent ${formatPercent(profile.niche.commercialIntent, 0)})`);

  sections.push(`## What the data says
${profile.verdict.map((line) => `- ${line}`).join("\n")}`);

  sections.push(`## Format performance
${profile.formats
  .map(
    (f) =>
      `- ${f.format}: ${f.count} uploads (${formatPercent(f.share, 0)} of output), median ${formatCount(f.medianViews)} views, p90 ${formatCount(f.p90Views)}, engagement ${formatPercent(f.medianEngagementRate, 2)}, median runtime ${Math.round(f.medianDurationSeconds)}s`,
  )
  .join("\n")}`);

  if (profile.performance.outliers.length > 0) {
    sections.push(`## Outliers (what over-performed this channel's own baseline)
${profile.performance.outliers
  .slice(0, 6)
  .map((o) => `- ${formatMultiple(o.multipleOfBaseline)} | ${o.format} | ${formatCount(o.views)} views | "${o.title}"`)
  .join("\n")}`);
  }

  const measuredHooks = profile.hooks.filter((h) => h.confidence !== "low").slice(0, 8);
  if (measuredHooks.length > 0) {
    sections.push(`## Packaging patterns measured on this channel
${measuredHooks
  .map(
    (h) =>
      `- ${h.label}: ${formatMultiple(h.lift)} lift across ${h.matchCount} videos (${h.confidence} confidence) — ${h.description}`,
  )
  .join("\n")}`);
  }

  if (profile.retention) {
    const r = profile.retention;
    sections.push(`## Retention (owner data)
- Videos with curves: ${r.videosAnalysed}
- Median average view percentage: ${r.medianAverageViewPercentage ?? "n/a"}
- Median retention at 30s: ${r.medianRetentionAt30s !== undefined ? formatPercent(r.medianRetentionAt30s, 0) : "n/a"}
- Median retention at halfway: ${r.medianRetentionAtHalf !== undefined ? formatPercent(r.medianRetentionAtHalf, 0) : "n/a"}
- Median hook drop-off over the first 10%: ${r.medianHookDropoff !== undefined ? formatPercent(r.medianHookDropoff, 0) : "n/a"}
${r.strongest ? `- Best retained: "${r.strongest.title}" (${r.strongest.averageViewPercentage}%)` : ""}
${r.weakest ? `- Worst retained: "${r.weakest.title}" (${r.weakest.averageViewPercentage}%)` : ""}`);
  }

  sections.push(`## Audience model
- Monthly views: ${formatCount(audience.monthlyViews)}${audience.reachIsMeasured ? " (measured)" : " (estimated)"}
- Monthly reach (distinct people): ${formatCount(audience.estimatedMonthlyReach)}
- Engaged audience (the sellable slice): ${formatCount(audience.estimatedEngagedAudience)}
- Owned audience (subscribers reachable + list): ${formatCount(audience.estimatedOwnedAudience)}
- Engagement rate: ${formatPercent(audience.engagementRate, 2)}
- Audience quality score: ${audience.audienceQualityScore.toFixed(2)} of 1.00

Key assumptions behind those figures:
${audience.assumptions.map((a) => `- ${a.key} = ${a.value}: ${a.basis}`).join("\n")}`);

  sections.push(`## Ranked plays (computed, in path-of-least-resistance order)
${plays
  .slice(0, 8)
  .map((play, index) => {
    const s = play.projection.scenarios;
    return `${index + 1}. ${play.archetype.name} [archetypeId: ${play.archetype.id}]
   Net monthly: ${formatUsd(s.conservative.netMonthlyRevenue)} / ${formatUsd(s.base.netMonthlyRevenue)} / ${formatUsd(s.optimistic.netMonthlyRevenue)} (conservative / base / optimistic)
   90-day expected value: ${formatUsd(play.projection.expectedValue90d)}
   Effort ${play.archetype.effort}/5, first revenue in ~${play.archetype.timeToFirstRevenueDays} days
   Resistance score: ${play.resistanceScore.toFixed(2)}, fit ${play.fitScore.toFixed(2)}, skill match ${play.skillScore.toFixed(2)}
   ${play.rationale.map((r) => `· ${r}`).join("\n   ")}${play.blockers.length > 0 ? `\n   BLOCKERS: ${play.blockers.join(" ")}` : ""}`;
  })
  .join("\n\n")}`);

  if (benchmark && benchmark.peers.length > 0) {
    sections.push(`## Benchmark against ${benchmark.niche} operators
Peers: ${benchmark.peers.map((p) => `${p.name} (@${p.handle}, ${formatCount(p.subscribers)} subs) — ${p.mechanic}`).join("; ")}

Gaps:
${benchmark.deltas
  .map(
    (d) =>
      `- ${d.metric}: you ${d.you}, peer median ${d.peerMedian} (${d.deltaPct >= 0 ? "+" : ""}${formatPercent(d.deltaPct, 0)}) — ${d.interpretation}`,
  )
  .join("\n")}
${
  benchmark.transferablePatterns.length > 0
    ? `\nPatterns peers use that this channel does not:\n${benchmark.transferablePatterns.map((p) => `- ${p.label}: ${p.description}`).join("\n")}`
    : ""
}`);
  }

  sections.push(`## Operator
${
  operator
    ? `- Skills: ${operator.skills.join(", ") || "(not stated)"}
- Hours available per week: ${operator.hoursPerWeek}
- Starting capital: ${formatUsd(operator.startingCapitalUsd)}
- Existing owned list: ${formatCount(operator.ownedListSize)}
${operator.goals ? `- Goal: ${operator.goals}` : ""}
${operator.constraints?.length ? `- Constraints: ${operator.constraints.join("; ")}` : ""}`
    : "No operator profile supplied. Assume a solo operator with the skills visibly demonstrated in the channel's own content, and say so in your positioning."
}`);

  sections.push(`## Your task
Produce 3 recommendations drawn from the ranked plays above, ordered as you would actually sequence them. The first must be the fastest credible route to revenue. Ground every claim in the figures above.`);

  return sections.join("\n\n");
}
