import { formatUsd } from "../util/format.js";
import type { DailyBrief, EarnPlan, LedgerSummary } from "./types.js";

/**
 * The plan on one page, written for someone who will act on it this afternoon.
 * The decision comes first, the workings underneath, the law at the end where
 * it can be checked off.
 */
export function renderEarnPlan(
  plan: EarnPlan,
  extras: { brief?: DailyBrief; ledger?: LedgerSummary } = {},
): string {
  const out: string[] = [];
  const { situation, stack, projection } = plan;

  out.push(`# The Earner — New Jersey`);
  out.push(
    `_${situation.urgencyDays}-day window · ${situation.hoursPerDay}h/day · ${formatUsd(situation.cashOnHandUsd)} on hand${situation.targetUsd ? ` · target ${formatUsd(situation.targetUsd)}` : ""} · generated ${plan.generatedAt.slice(0, 10)}_`,
  );

  // --- The short version ---------------------------------------------------
  out.push(`\n## The short version\n`);
  if (stack.length === 0) {
    out.push(
      `Nothing in the catalogue is available with what you have listed. Check the blockers below; most are a missing entry in \`--has\`, not a real gate.`,
    );
  } else {
    const first = stack[0]!;
    out.push(
      `Start with **${first.play.name}** today. The full stack below fills your ${situation.hoursPerDay * 6} hours a week and should produce **${band(projection.firstWeekUsd)} in the first seven days** and **${band(projection.windowUsd)} inside your ${situation.urgencyDays}-day window**, after costs and before tax.`,
    );
    if (projection.targetReachable === false) {
      out.push(
        `\nThat does not reach your ${formatUsd(situation.targetUsd!)} target on the middle estimate. The honest options are more hours, a longer window, or a blocker removed below. No play on this list is hidden because it pays too little; none is added because you need more.`,
      );
    } else if (projection.targetReachable === true) {
      out.push(`\nThat clears your ${formatUsd(situation.targetUsd!)} target on the middle estimate.`);
    }
  }

  // --- Today -----------------------------------------------------------------
  if (extras.brief) {
    const brief = extras.brief;
    out.push(`\n## Today\n`);
    out.push(`**${brief.headline}**\n`);
    out.push(`| When | Do | Expected |`);
    out.push(`| --- | --- | --- |`);
    for (const step of brief.today) {
      out.push(`| ${esc(step.when)} | ${esc(step.action)} | ${esc(step.expectedUsd ?? "")} |`);
    }
    out.push(`\n**Check tomorrow:** ${brief.successMetric}`);
    out.push(`\n**Change course if:** ${brief.killCriteria}`);
    if (brief.thisWeek.length > 0) {
      out.push(`\n### This week\n`);
      for (const item of brief.thisWeek) out.push(`- ${item}`);
    }
    if (brief.declined.length > 0) {
      out.push(`\n### Declined\n`);
      for (const item of brief.declined) out.push(`- ${item}`);
    }
  }

  // --- The stack -----------------------------------------------------------
  out.push(`\n## The stack\n`);
  out.push(`| # | Play | Hours/wk | First dollar | First 7 days | In window | Start here |`);
  out.push(`| ---: | --- | ---: | ---: | ---: | ---: | --- |`);
  stack.forEach((item, index) => {
    out.push(
      `| ${index + 1} | **${esc(item.play.name)}** | ${item.allocatedHoursPerWeek} | ${item.play.timeToFirstDollarDays === 0 ? "today" : `${item.play.timeToFirstDollarDays}d`} | ${band(item.expectedUsdFirstWeek)} | ${band(item.expectedUsdInWindow)} | ${esc(item.play.platforms.slice(0, 2).join("; "))} |`,
    );
  });

  for (const item of stack) {
    out.push(`\n### ${item.play.name}\n`);
    out.push(item.play.description);
    out.push(``);
    for (const line of item.rationale) out.push(`- ${line}`);
    out.push(`\nWhere: ${item.play.platforms.join(" · ")}`);
    if (item.mustDoFirst.length > 0) {
      out.push(`\nBefore the first dollar:`);
      for (const step of item.mustDoFirst) out.push(`- ${step}`);
    }
    out.push(`\nWhat goes wrong: ${item.play.risks.join(" ")}`);
  }

  // --- Ledger -----------------------------------------------------------------
  if (extras.ledger && extras.ledger.daysActive > 0) {
    const l = extras.ledger;
    out.push(`\n## So far\n`);
    out.push(`| Net | Hours | Net/hour | Net/day | Days | Tax reserve |`);
    out.push(`| ---: | ---: | ---: | ---: | ---: | ---: |`);
    out.push(
      `| ${formatUsd(l.netUsd)} | ${l.hours} | ${formatUsd(l.netPerHour)} | ${formatUsd(l.netPerDay)} | ${l.daysActive} | ${formatUsd(l.taxReserveUsd)} |`,
    );
    if (l.byPlay.length > 0) {
      out.push(`\n| Play | Net | Hours | Net/hour |`);
      out.push(`| --- | ---: | ---: | ---: |`);
      for (const p of l.byPlay) {
        out.push(`| ${p.playId} | ${formatUsd(p.netUsd)} | ${p.hours} | ${formatUsd(p.netPerHour)} |`);
      }
    }
  }

  // --- Everything ranked ---------------------------------------------------
  out.push(`\n## Everything ranked\n`);
  out.push(`| # | Play | Score | Speed | Money | Skill | In window | Status |`);
  out.push(`| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |`);
  plan.ranked.forEach((item, index) => {
    out.push(
      `| ${index + 1} | ${esc(item.play.name)} | ${item.score.toFixed(2)} | ${item.speedScore.toFixed(2)} | ${item.moneyScore.toFixed(2)} | ${item.skillScore.toFixed(2)} | ${band(item.expectedUsdInWindow)} | ${item.blockers.length === 0 ? "available" : esc(item.blockers.join(" "))} |`,
    );
  });

  // --- Legal checklist -----------------------------------------------------
  out.push(`\n## Legal checklist\n`);
  out.push(
    `_These are the obligations a careful person would verify, with where to verify them. They are not legal advice._\n`,
  );
  for (const item of plan.setupChecklist) out.push(`- [ ] ${item}`);

  // --- Refused -------------------------------------------------------------
  out.push(`\n## What this plan will never recommend\n`);
  for (const item of plan.refused) out.push(`- ${item}`);

  return out.join("\n");
}

function band(b: { low: number; high: number }): string {
  if (b.high <= 0) return "—";
  return `${formatUsd(b.low)}–${formatUsd(b.high)}`;
}

function esc(text: string): string {
  return text.replace(/\|/g, "\\|");
}
