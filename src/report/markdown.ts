import type { LitixReport, Play, VideoFormat } from "../types.js";
import { formatCount, formatMultiple, formatPercent, formatUsd, truncate } from "../util/format.js";

/**
 * The report is written to be read by a person deciding what to do on Monday,
 * so it leads with the decision and puts the workings underneath. Every
 * projection is shown as a range with its assumptions attached — a number
 * without its assumption is a guess wearing a suit.
 */
export function renderMarkdownReport(report: LitixReport): string {
  const { profile, audience, plays, benchmark, advisor } = report;
  const out: string[] = [];

  out.push(`# LITIX — ${profile.channel.title}`);
  out.push(
    `_${profile.channel.handle ? `@${profile.channel.handle} · ` : ""}${formatCount(profile.channel.subscriberCount)} subscribers · ${formatCount(profile.channel.viewCount)} lifetime views · generated ${report.generatedAt.slice(0, 10)}_`,
  );

  const headline = plays.find((p) => p.blockers.length === 0) ?? plays[0];
  if (headline) {
    out.push(`\n## The short version\n`);
    out.push(
      `**${headline.archetype.name}** is the highest-return move that is actually available to this channel today: base case **${formatUsd(headline.projection.scenarios.base.netMonthlyRevenue)}/month net**, first revenue in roughly **${headline.archetype.timeToFirstRevenueDays} days**, at about **${headline.archetype.effort === 1 ? "2" : headline.archetype.effort * 5}h/week**.`,
    );
    out.push(`\n${headline.archetype.description}`);
  }

  // --- What the data says -------------------------------------------------
  out.push(`\n## What the data says\n`);
  for (const line of profile.verdict) out.push(`- ${line}`);

  // --- Format performance -------------------------------------------------
  out.push(`\n## Format performance\n`);
  out.push(`| Format | Uploads | Share | Median views | p90 | Hit skew | Engagement | Median runtime |`);
  out.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const f of profile.formats) {
    out.push(
      `| ${labelFor(f.format)} | ${f.count} | ${formatPercent(f.share, 0)} | ${formatCount(f.medianViews)} | ${formatCount(f.p90Views)} | ${formatMultiple(f.hitSkew)} | ${formatPercent(f.medianEngagementRate, 2)} | ${Math.round(f.medianDurationSeconds)}s |`,
    );
  }

  // --- Outliers -----------------------------------------------------------
  if (profile.performance.outliers.length > 0) {
    out.push(`\n## What over-performed\n`);
    out.push(`| Multiple | Format | Views | Title |`);
    out.push(`| ---: | --- | ---: | --- |`);
    for (const o of profile.performance.outliers) {
      out.push(
        `| ${formatMultiple(o.multipleOfBaseline)} | ${labelFor(o.format)} | ${formatCount(o.views)} | ${escapePipes(truncate(o.title, 70))} |`,
      );
    }
    out.push(
      `\n_Measured against this channel's own median for the same format, using only uploads old enough to have finished accumulating views._`,
    );
  }

  // --- Hooks --------------------------------------------------------------
  const hooks = profile.hooks.filter((h) => h.confidence !== "low");
  if (hooks.length > 0) {
    out.push(`\n## Packaging patterns, measured on this channel\n`);
    out.push(`| Pattern | Lift | Videos | Confidence |`);
    out.push(`| --- | ---: | ---: | --- |`);
    for (const h of hooks.slice(0, 10)) {
      out.push(`| ${h.label} | ${formatMultiple(h.lift)} | ${h.matchCount} | ${h.confidence} |`);
    }
    out.push(
      `\n_Lift is the median performance of videos using the pattern divided by the median of videos that do not. These are observational splits on one channel, not controlled tests._`,
    );
  }

  // --- Retention ----------------------------------------------------------
  if (profile.retention) {
    const r = profile.retention;
    out.push(`\n## Retention\n`);
    out.push(`- Videos with retention data: **${r.videosAnalysed}**`);
    if (r.medianAverageViewPercentage !== undefined) {
      out.push(`- Median average view percentage: **${r.medianAverageViewPercentage}%**`);
    }
    if (r.medianRetentionAt30s !== undefined) {
      out.push(`- Still watching at 30 seconds: **${formatPercent(r.medianRetentionAt30s, 0)}**`);
    }
    if (r.medianRetentionAtHalf !== undefined) {
      out.push(`- Still watching at halfway: **${formatPercent(r.medianRetentionAtHalf, 0)}**`);
    }
    if (r.medianHookDropoff !== undefined) {
      out.push(`- Lost across the opening 10%: **${formatPercent(r.medianHookDropoff, 0)}**`);
    }
    if (r.strongest) out.push(`- Best retained: "${r.strongest.title}" (${r.strongest.averageViewPercentage}%)`);
    if (r.weakest) out.push(`- Worst retained: "${r.weakest.title}" (${r.weakest.averageViewPercentage}%)`);
    for (const note of r.notes) out.push(`\n> ${note}`);
  }

  // --- Audience -----------------------------------------------------------
  out.push(`\n## What the audience is actually worth\n`);
  out.push(`| Measure | Value |`);
  out.push(`| --- | ---: |`);
  out.push(`| Monthly views${audience.reachIsMeasured ? " (measured)" : " (estimated)"} | ${formatCount(audience.monthlyViews)} |`);
  out.push(`| Monthly reach (distinct people) | ${formatCount(audience.estimatedMonthlyReach)} |`);
  out.push(`| **Engaged audience** (the sellable slice) | **${formatCount(audience.estimatedEngagedAudience)}** |`);
  out.push(`| Owned audience (reachable without the algorithm) | ${formatCount(audience.estimatedOwnedAudience)} |`);
  out.push(`| Engagement rate | ${formatPercent(audience.engagementRate, 2)} |`);
  out.push(`| Audience quality score | ${audience.audienceQualityScore.toFixed(2)} / 1.00 |`);
  out.push(`| Commercial intent (${profile.niche.label}) | ${formatPercent(audience.commercialIntent, 0)} |`);

  out.push(`\n<details>\n<summary>Assumptions behind these figures</summary>\n`);
  for (const a of audience.assumptions) {
    out.push(`- **${a.key}** = \`${a.value}\` — ${a.basis}`);
  }
  out.push(`\n</details>`);

  // --- Plays --------------------------------------------------------------
  out.push(`\n## Ranked plays\n`);
  out.push(
    `Ranked by return relative to what it costs to get there — money, effort, time to the first dollar, and whether it can actually be executed. Ranking on revenue alone always crowns the slowest option.\n`,
  );
  out.push(`| # | Play | Net/month (low → base → high) | 90-day value | Effort | First $ | Score |`);
  out.push(`| ---: | --- | --- | ---: | ---: | ---: | ---: |`);
  plays.forEach((play, index) => {
    const s = play.projection.scenarios;
    out.push(
      `| ${index + 1} | ${play.archetype.name}${play.blockers.length > 0 ? " ⚠" : ""} | ${formatUsd(s.conservative.netMonthlyRevenue)} → **${formatUsd(s.base.netMonthlyRevenue)}** → ${formatUsd(s.optimistic.netMonthlyRevenue)} | ${formatUsd(play.projection.expectedValue90d)} | ${play.archetype.effort}/5 | ${play.archetype.timeToFirstRevenueDays}d | ${play.resistanceScore.toFixed(2)} |`,
    );
  });
  out.push(`\n_⚠ marks a play with blockers listed below._`);

  for (const play of plays.slice(0, 5)) {
    out.push(renderPlayDetail(play));
  }

  // --- Benchmark ----------------------------------------------------------
  if (benchmark && benchmark.peers.length > 0) {
    out.push(`\n## Benchmark\n`);
    out.push(`Compared against operators working the same niche:\n`);
    for (const peer of benchmark.peers) {
      out.push(`- **${peer.name}** (@${peer.handle}, ${formatCount(peer.subscribers)} subs) — ${peer.mechanic}`);
    }
    out.push(`\n| Metric | You | Peer median | Delta |`);
    out.push(`| --- | ---: | ---: | ---: |`);
    for (const d of benchmark.deltas) {
      out.push(
        `| ${d.metric} | ${formatNumber(d.you)} | ${formatNumber(d.peerMedian)} | ${d.deltaPct >= 0 ? "+" : ""}${formatPercent(d.deltaPct, 0)} |`,
      );
    }
    out.push("");
    for (const d of benchmark.deltas) out.push(`- **${d.metric}:** ${d.interpretation}`);

    if (benchmark.transferablePatterns.length > 0) {
      out.push(`\n### Worth borrowing\n`);
      for (const p of benchmark.transferablePatterns) {
        out.push(`- **${p.label}** — ${p.description}`);
      }
    }
    for (const note of benchmark.notes) out.push(`\n> ${note}`);
  }

  // --- Advisor ------------------------------------------------------------
  if (advisor) {
    out.push(`\n---\n`);
    out.push(`## Strategy\n`);
    out.push(`### Positioning\n\n${advisor.positioning}`);

    if (advisor.contentVerdict.length > 0) {
      out.push(`\n### Content verdict\n`);
      for (const line of advisor.contentVerdict) out.push(`- ${line}`);
    }

    advisor.recommendations.forEach((rec, index) => {
      out.push(`\n### ${index + 1}. ${rec.title}\n`);
      out.push(`**Offer.** ${rec.offer}\n`);
      out.push(`**Why this channel.** ${rec.whyThisChannel}\n`);
      out.push(`**Pricing.** ${rec.pricing}\n`);
      if (rec.firstThreeVideos.length > 0) {
        out.push(`**The three videos that set it up:**\n`);
        for (const video of rec.firstThreeVideos) {
          out.push(`- **"${video.title}"**`);
          out.push(`  - Hook: _${video.hook}_`);
          out.push(`  - Angle: ${video.angle}`);
        }
        out.push("");
      }
      if (rec.first30Days.length > 0) {
        out.push(`**First 30 days:**\n`);
        rec.first30Days.forEach((step, i) => out.push(`${i + 1}. ${step}`));
        out.push("");
      }
      out.push(`**Success metric.** ${rec.successMetric}\n`);
      out.push(`**Kill criteria.** ${rec.killCriteria}`);
    });

    if (advisor.risks.length > 0) {
      out.push(`\n### Risks\n`);
      for (const risk of advisor.risks) out.push(`- ${risk}`);
    }
  }

  out.push(`\n---\n`);
  out.push(
    `_Projections are modelled ranges, not forecasts. They are built from this channel's measured performance and stated assumptions, both listed above. Conversion bands come from published creator-commerce norms and should be replaced with your own numbers as soon as you have them._`,
  );

  return out.join("\n");
}

function renderPlayDetail(play: Play): string {
  const lines: string[] = [];
  const s = play.projection.scenarios;

  lines.push(`\n### ${play.archetype.name}\n`);
  lines.push(`${play.archetype.description}\n`);

  lines.push(`| Scenario | Buyers/month | Price | Net/month | Net/year |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: |`);
  for (const scenario of [s.conservative, s.base, s.optimistic]) {
    lines.push(
      `| ${scenario.label} | ${scenario.buyers > 0 ? scenario.buyers.toFixed(1) : "—"} | ${formatUsd(scenario.price, scenario.price < 100 ? 2 : 0)} | ${formatUsd(scenario.netMonthlyRevenue)} | ${formatUsd(scenario.netAnnualRevenue)} |`,
    );
  }

  lines.push("");
  for (const reason of play.rationale) lines.push(`- ${reason}`);

  if (play.blockers.length > 0) {
    lines.push(`\n**Blockers:**\n`);
    for (const blocker of play.blockers) lines.push(`- ${blocker}`);
  }

  if (play.projection.sensitivity.length > 0) {
    lines.push(`\n<details>\n<summary>Sensitivity and assumptions</summary>\n`);
    lines.push(`| Driver | Change | Net/month | Delta |`);
    lines.push(`| --- | --- | ---: | ---: |`);
    for (const row of play.projection.sensitivity) {
      lines.push(
        `| ${row.driver} | ${row.change} | ${formatUsd(row.netMonthlyRevenue)} | ${row.deltaPct >= 0 ? "+" : ""}${formatPercent(row.deltaPct, 0)} |`,
      );
    }
    lines.push("");
    for (const a of play.projection.assumptions) {
      lines.push(`- **${a.key}** = \`${a.value}\` — ${a.basis}`);
    }
    for (const note of play.archetype.notes) lines.push(`- ${note}`);
    lines.push(`\n</details>`);
  }

  return lines.join("\n");
}

function labelFor(format: VideoFormat): string {
  return format === "short" ? "Shorts" : format === "long" ? "Long-form" : "Live";
}

function formatNumber(value: number): string {
  if (Math.abs(value) < 1) return value.toFixed(3);
  if (Math.abs(value) < 100) return value.toFixed(2);
  return formatCount(value);
}

/** Table cells cannot contain unescaped pipes. */
function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|");
}
