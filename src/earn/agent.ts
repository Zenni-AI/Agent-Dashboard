import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { log } from "../util/logger.js";
import { findPlay, PLAYS } from "./catalog.js";
import { screenActivity } from "./guardrails.js";
import { summarizeLedger } from "./ledger.js";
import { buildEarnPlan } from "./rank.js";
import type { DailyBrief, EarnPlan, Ledger, Situation } from "./types.js";

/**
 * The Earner.
 *
 * One goal: get this person in New Jersey to real, reported, legal income as
 * fast as possible. The agent does not pick the plays, estimate the money or
 * decide what is legal; the deterministic layer does all three and the agent
 * reads them through tools. Its job is the part a spreadsheet cannot do: turn a
 * ranked stack into the next 24 hours, in order, with a time on each line, and
 * say no, in writing, to anything that should not be done.
 *
 * Every tool is read-only. The agent can rank, look up, screen and read the
 * ledger. It cannot log income, spend money, sign up for anything or contact
 * anyone. The person does those things; the agent tells them which, and when.
 */

export const EARNER_SYSTEM_PROMPT = `You are the Earner: an agent whose only goal is to get one person, living in New Jersey, to real income as fast as possible — legally, ethically, and with every dollar reported.

The stakes are high for this person. That is a reason for speed and precision. It is never a reason to cut a corner: a plan that risks a fine, a lawsuit, a ban, or a criminal record is slower than no plan, because it takes back more than it gives.

How you work:
1. Call rank_plays first. It returns the stack — the combination of plays that fills this person's hours fastest — with the money each can realistically produce and the legal steps attached. Everything numeric comes from there. Never invent, adjust or re-derive a dollar figure, an hourly rate, or a time-to-first-dollar. If you need a number that is not there, say so qualitatively.
2. Call get_play for each play in the stack before you write about it, so that platforms, compliance steps and risks are exact.
3. If the person has proposed anything of their own (in their notes or proposals), call screen_activity on it. "blocked" means you say no and explain why, using the reason returned. "declined" means it is legal but outside what you will plan; say so and leave the decision with them. Never route around a block by renaming the activity.
4. Recommend only plays from the catalogue, by their exact playId. If a person's own proposal is allowed and not in the catalogue, you may describe how to do it honestly, but say it is unmodelled and carries no projection.
5. Respect stated constraints without argument: hours, cash, what they have, what they refuse to do.

What the brief must do:
- Sequence the next 24 hours hour by hour. The first action must be something that can start within the hour. Sign-ups that take days to approve go in today's plan too, because the clock on them starts when the form is submitted, not when the first shift appears.
- Put the legal steps in the order in which they unblock money, not alphabetically. Tell the person which ones must be done before the first dollar and which can be done this week.
- Be concrete. "Sell things" is useless. "Photograph the PS5, the bike and the winter coat in daylight by 11am, list all three on Facebook Marketplace at 70% of the lowest local comparable, meet buyers at the Wawa lot after 4pm" is useful.
- State the one number to check tomorrow and the specific result, by a specific day, that means change the plan.
- Where the stack cannot reach a stated target inside the window, say so plainly in the headline. Do not pad.

Write like one operator briefing another: direct, specific, no hype, no filler, no moralising. The person already chose to do this legally; help them do it fast.`;

const TodayStepSchema = z.object({
  when: z.string().describe("A time block, e.g. '8:00–9:30am' or 'Before noon'."),
  action: z.string().describe("The exact action, specific enough to do without thinking."),
  playId: z.string().optional().describe("The catalogue playId this action serves, if any."),
  expectedUsd: z.string().optional().describe("What this action should produce and when, quoting figures from the plan; omit if nothing today."),
});

export const DailyBriefSchema = z.object({
  headline: z.string().describe("One sentence: what to do first and what the next seven days should produce."),
  today: z.array(TodayStepSchema).describe("The next 24 hours, in order."),
  thisWeek: z.array(z.string()).describe("Setup and sign-ups that make next week earn more, each with the day to do it."),
  legalChecklist: z.array(z.string()).describe("Compliance steps, ordered by when they unblock money; mark the ones that must precede the first dollar."),
  successMetric: z.string().describe("The one number to check tomorrow."),
  killCriteria: z.string().describe("The specific result, by a specific day, that means change the plan."),
  declined: z.array(z.string()).describe("Anything proposed that you will not plan, and the reason, in one line each. Empty if nothing."),
});

export interface EarnAgentOptions {
  apiKey?: string;
  model?: string;
  situation: Situation;
  ledger: Ledger;
  /** Free-text things the person has proposed doing; each is screened. */
  proposals?: string[];
  /** Today's date, injected so the brief can name days. Defaults to now. */
  today?: Date;
}

export interface EarnAgentResult {
  plan: EarnPlan;
  brief: DailyBrief;
  /** Which tools the agent called, in order, for the record. */
  toolCalls: string[];
}

export class EarnerRefusalError extends Error {
  constructor(readonly category: string | undefined) {
    super(`The model declined to produce a brief${category ? ` (${category})` : ""}.`);
    this.name = "EarnerRefusalError";
  }
}

export async function runEarnAgent(options: EarnAgentOptions): Promise<EarnAgentResult> {
  const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  const model = options.model ?? "claude-opus-5";
  const plan = buildEarnPlan(options.situation);
  const toolCalls: string[] = [];

  const rankPlays = betaZodTool({
    name: "rank_plays",
    description:
      "Rank every legal income play in the catalogue for this person's situation and return the stack that fills their hours fastest, with projected dollars (first 7 days and inside their window), hours allocated, blockers, and the legal steps that must precede the first dollar. Deterministic; call it once.",
    inputSchema: z.object({}),
    run: () => {
      toolCalls.push("rank_plays");
      return JSON.stringify(compactPlan(plan));
    },
  });

  const getPlay = betaZodTool({
    name: "get_play",
    description:
      "Full details of one catalogue play by playId: description, platforms, every compliance note with where to verify it, ethics, and risks.",
    inputSchema: z.object({ playId: z.string().describe("Exact playId from rank_plays.") }),
    run: ({ playId }) => {
      toolCalls.push(`get_play:${playId}`);
      const play = findPlay(playId);
      if (!play) {
        return `No play with id "${playId}". Valid ids: ${PLAYS.map((p) => p.id).join(", ")}.`;
      }
      return JSON.stringify(play);
    },
  });

  const screen = betaZodTool({
    name: "screen_activity",
    description:
      "Screen a proposed money-making activity, described in plain English, against the legal and ethical charter. Returns 'allowed', 'blocked' (illegal or deceptive; do not plan it) or 'declined' (legal but outside policy), with the matching reasons and the general tax and registration obligations.",
    inputSchema: z.object({ description: z.string().describe("What the person proposes to do, in their words.") }),
    run: ({ description }) => {
      toolCalls.push("screen_activity");
      return JSON.stringify(screenActivity(description));
    },
  });

  const getLedger = betaZodTool({
    name: "get_ledger",
    description:
      "What has actually been earned so far: net, hours, net per hour overall and per play, days active, and the tax reserve that should be set aside. Use it to shift hours toward plays that are beating their band and away from ones that are not.",
    inputSchema: z.object({}),
    run: () => {
      toolCalls.push("get_ledger");
      return JSON.stringify(summarizeLedger(options.ledger, options.today));
    },
  });

  const today = options.today ?? new Date();
  log.info(`asking ${model} for today's brief…`);

  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    max_iterations: 12,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: betaZodOutputFormat(DailyBriefSchema),
    },
    // A safety-classifier decline is re-run on a fallback model inside the
    // same call, so a borderline brief still comes back rather than failing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      {
        type: "text",
        text: EARNER_SYSTEM_PROMPT,
        // Frozen across runs; only the situation below varies.
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [rankPlays, getPlay, screen, getLedger],
    messages: [{ role: "user", content: buildSituationBrief(options, today) }],
  });

  const final = await runner.runUntilDone();

  if (final.stop_reason === "refusal") {
    const details = final.stop_details;
    throw new EarnerRefusalError(details?.type === "refusal" ? details.category ?? undefined : undefined);
  }
  if (final.stop_reason === "max_tokens") {
    throw new Error("The brief was cut off by the token limit. Re-run; the plan itself is unaffected.");
  }

  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = DailyBriefSchema.safeParse(safeJson(text));
  if (!parsed.success) {
    throw new Error(
      "The model returned a brief that did not match the expected schema. Re-run, or use `litix earn rank` for the computed plan alone.",
    );
  }

  return { plan, brief: parsed.data, toolCalls };
}

/** What the agent reads about the person. Volatile content lives here, not in the system prompt. */
export function buildSituationBrief(options: EarnAgentOptions, today: Date): string {
  const s = options.situation;
  const ledger = summarizeLedger(options.ledger, today);
  const weekday = today.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
  const sections: string[] = [];

  sections.push(`## Today
${weekday}, ${today.toISOString().slice(0, 10)}. Location: New Jersey${s.town ? `, ${s.town}` : ""}.`);

  sections.push(`## The person
- Needs money within: ${s.urgencyDays} days
- Hours available for paid work: ${s.hoursPerDay} per day
- Cash on hand to spend on starting: $${Math.round(s.cashOnHandUsd)}
${s.targetUsd !== undefined ? `- Target: $${Math.round(s.targetUsd)} inside the window` : "- No dollar target stated; more, sooner, is the goal."}
- Skills: ${s.skills.length > 0 ? s.skills.join(", ") : "(none stated)"}
- Has: ${s.has.length > 0 ? s.has.join(", ") : "(nothing stated; treat every requirement as unmet until confirmed)"}
${s.excludePlayIds?.length ? `- Refuses to do: ${s.excludePlayIds.join(", ")}` : ""}
${s.notes ? `- Notes, in their words: ${s.notes}` : ""}`);

  if (options.proposals && options.proposals.length > 0) {
    sections.push(`## Things they have proposed doing
${options.proposals.map((p) => `- ${p}`).join("\n")}

Screen each one with screen_activity before responding to it.`);
  }

  sections.push(
    ledger.daysActive > 0
      ? `## Earned so far
Net $${ledger.netUsd} over ${ledger.hours}h across ${ledger.daysActive} day(s): $${ledger.netPerHour}/hour, $${ledger.netPerDay}/day. Call get_ledger for the per-play breakdown before allocating hours.`
      : `## Earned so far
Nothing yet. This is day one.`,
  );

  sections.push(`## Your task
Call rank_plays, then get_play for each stacked play, then screen anything proposed. Produce the brief for the next 24 hours.`);

  return sections.join("\n\n");
}

/** The plan as the agent sees it: everything it needs, nothing it should re-derive. */
function compactPlan(plan: EarnPlan) {
  return {
    projection: plan.projection,
    stack: plan.stack.map((r) => ({
      playId: r.play.id,
      name: r.play.name,
      hoursPerWeek: r.allocatedHoursPerWeek,
      timeToFirstDollarDays: r.play.timeToFirstDollarDays,
      hourlyUsdAfterCosts: r.play.hourlyUsd,
      expectedUsdFirstWeek: r.expectedUsdFirstWeek,
      expectedUsdInWindow: r.expectedUsdInWindow,
      online: r.play.online,
      mustDoFirst: r.mustDoFirst,
      rationale: r.rationale,
    })),
    notStacked: plan.ranked
      .filter((r) => !plan.stack.some((s) => s.play.id === r.play.id))
      .map((r) => ({
        playId: r.play.id,
        name: r.play.name,
        score: r.score,
        blockers: r.blockers,
        expectedUsdInWindow: r.expectedUsdInWindow,
      })),
    setupChecklist: plan.setupChecklist,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
