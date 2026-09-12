#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { Command, Option } from "commander";
import { buildChannelProfile } from "./analysis/profile.js";
import { loadConfig, MissingCredentialError, requireOAuthClient } from "./config.js";
import { buildAudienceModel } from "./monetize/audience.js";
import { rankPlays } from "./monetize/plays.js";
import { ingest, run, type RunOptions } from "./pipeline.js";
import { renderMarkdownReport } from "./report/markdown.js";
import { DiskCache } from "./store/cache.js";
import { runEarnAgent } from "./earn/agent.js";
import { findPlay, PLAYS } from "./earn/catalog.js";
import { screenActivity } from "./earn/guardrails.js";
import {
  addEntry,
  DEFAULT_LEDGER_PATH,
  isoDate,
  loadLedger,
  saveLedger,
  summarizeLedger,
} from "./earn/ledger.js";
import { buildEarnPlan, REQUIREMENT_LABELS } from "./earn/rank.js";
import { renderEarnPlan } from "./earn/report.js";
import type { PlayRequirement, Situation } from "./earn/types.js";
import type { LitixReport, OperatorProfile } from "./types.js";
import { formatCount, formatUsd } from "./util/format.js";
import { log, setLogLevel } from "./util/logger.js";
import { QuotaTracker } from "./youtube/quota.js";
import { YouTubeOAuth } from "./youtube/oauth.js";

const program = new Command();

program
  .name("litix")
  .description(
    "Turn a YouTube channel's analytics into a ranked, costed set of monetization plays.",
  )
  .version("0.1.0")
  .option("-v, --verbose", "verbose logging")
  .option("-q, --quiet", "errors only")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.quiet) setLogLevel("error");
    else if (opts.verbose) setLogLevel("debug");
  });

/** Options shared by every command that reads a channel. */
function withIngestOptions(command: Command): Command {
  return command
    .option("-n, --max-videos <count>", "uploads to analyse, newest first", "200")
    .option("-s, --since <days>", "ignore uploads older than this many days")
    .option("--owner", "pull owner-only analytics (retention, impressions, traffic sources)")
    .option("--retention-sample <count>", "videos to pull retention curves for", "12")
    .option("--no-cache", "bypass the on-disk cache")
    .addOption(new Option("--json", "emit JSON instead of markdown"))
    .option("-o, --out <file>", "write the report to a file");
}

/** Operator inputs that decide the path of least resistance. */
function withOperatorOptions(command: Command): Command {
  return command
    .option("--skills <list>", "comma-separated skills you already have")
    .option("--hours <count>", "hours per week available", "10")
    .option("--capital <usd>", "starting capital in USD", "0")
    .option("--list-size <count>", "existing email or SMS list size", "0")
    .option("--goals <text>", "what you are trying to achieve");
}

function parseOperator(opts: Record<string, unknown>): OperatorProfile | undefined {
  const skills = typeof opts.skills === "string" ? opts.skills : "";
  const hours = Number(opts.hours ?? 0);
  const capital = Number(opts.capital ?? 0);
  const listSize = Number(opts.listSize ?? 0);
  const goals = typeof opts.goals === "string" ? opts.goals : undefined;

  // Nothing supplied means no operator constraints, which the model treats
  // differently from an operator who stated zero of everything.
  if (!skills && !goals && listSize === 0 && capital === 0 && hours === 10) {
    return undefined;
  }

  return {
    skills: skills ? skills.split(",").map((s) => s.trim()).filter(Boolean) : [],
    hoursPerWeek: Number.isFinite(hours) ? hours : 10,
    startingCapitalUsd: Number.isFinite(capital) ? capital : 0,
    ownedListSize: Number.isFinite(listSize) ? listSize : 0,
    ...(goals ? { goals } : {}),
  };
}

function baseRunOptions(channel: string, opts: Record<string, unknown>): RunOptions {
  const since = opts.since === undefined ? undefined : Number(opts.since);
  return {
    channel,
    maxVideos: Number(opts.maxVideos ?? 200),
    ...(since !== undefined && Number.isFinite(since) ? { sinceDays: since } : {}),
    owner: Boolean(opts.owner),
    retentionSampleSize: Number(opts.retentionSample ?? 12),
    // Commander maps --no-cache to cache:false.
    noCache: opts.cache === false,
    operator: parseOperator(opts),
  };
}

async function emit(
  report: LitixReport,
  opts: Record<string, unknown>,
): Promise<void> {
  const output = opts.json
    ? JSON.stringify(report, null, 2)
    : renderMarkdownReport(report);

  if (typeof opts.out === "string" && opts.out) {
    await writeFile(opts.out, output, "utf8");
    log.info(`written to ${opts.out}`);
    return;
  }
  console.log(output);
}

// --- profile --------------------------------------------------------------

withIngestOptions(
  program
    .command("profile")
    .argument("<channel>", "@handle, channel URL, or UC... id")
    .description("Analyse what is working on a channel. No monetization modelling."),
).action(async (channel: string, opts: Record<string, unknown>) => {
  const { dataset } = await ingest(baseRunOptions(channel, opts));
  const profile = buildChannelProfile(dataset);

  if (opts.json) {
    await emitRaw(JSON.stringify(profile, null, 2), opts);
    return;
  }

  console.log(`\n${profile.channel.title} — ${formatCount(profile.channel.subscriberCount)} subscribers\n`);
  for (const line of profile.verdict) console.log(`  · ${line}`);
  console.log("");
  for (const format of profile.formats) {
    console.log(
      `  ${format.format.padEnd(6)} ${String(format.count).padStart(4)} uploads   median ${formatCount(format.medianViews).padStart(7)}   p90 ${formatCount(format.p90Views).padStart(7)}`,
    );
  }
  console.log("");
});

// --- money ----------------------------------------------------------------

withOperatorOptions(
  withIngestOptions(
    program
      .command("money")
      .argument("<channel>", "@handle, channel URL, or UC... id")
      .description("Model what the audience is worth and rank the monetization plays."),
  ),
).action(async (channel: string, opts: Record<string, unknown>) => {
  const options = baseRunOptions(channel, opts);
  const { dataset } = await ingest(options);
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

  if (opts.json || opts.out) {
    await emit(report, opts);
    return;
  }

  console.log(`\n${profile.channel.title}\n`);
  console.log(`  Monthly reach       ${formatCount(audience.estimatedMonthlyReach)}`);
  console.log(`  Engaged audience    ${formatCount(audience.estimatedEngagedAudience)}`);
  console.log(`  Owned audience      ${formatCount(audience.estimatedOwnedAudience)}`);
  console.log(`  Commercial intent   ${Math.round(audience.commercialIntent * 100)}% (${profile.niche.label})\n`);
  console.log(`  Ranked plays:\n`);

  plays.slice(0, 8).forEach((play, index) => {
    const s = play.projection.scenarios;
    console.log(
      `  ${String(index + 1).padStart(2)}. ${play.archetype.name.padEnd(38)} ${formatUsd(s.base.netMonthlyRevenue).padStart(9)}/mo   90d ${formatUsd(play.projection.expectedValue90d).padStart(9)}   effort ${play.archetype.effort}/5${play.blockers.length > 0 ? "  ⚠" : ""}`,
    );
  });
  console.log("");
});

// --- run ------------------------------------------------------------------

withOperatorOptions(
  withIngestOptions(
    program
      .command("run")
      .argument("<channel>", "@handle, channel URL, or UC... id")
      .description("The full pipeline: analyse, benchmark, price, and write the strategy."),
  ),
)
  .option("--benchmark", "compare against reference operators in the same niche")
  .option("--references <path>", "path to a custom reference registry")
  .option("--no-advise", "skip the Claude strategy layer and emit the computed report only")
  .action(async (channel: string, opts: Record<string, unknown>) => {
    const report = await run({
      ...baseRunOptions(channel, opts),
      benchmark: Boolean(opts.benchmark),
      ...(typeof opts.references === "string" ? { referencesPath: opts.references } : {}),
      // Commander maps --no-advise to advise:false; default is on.
      advise: opts.advise !== false,
    });
    await emit(report, opts);
  });

// --- auth -----------------------------------------------------------------

program
  .command("auth")
  .description("Authorise LITIX to read your own YouTube Analytics (retention, impressions).")
  .action(async () => {
    const config = loadConfig();
    const { clientId, clientSecret } = requireOAuthClient(config);
    const oauth = new YouTubeOAuth({
      clientId,
      clientSecret,
      tokenFile: config.LITIX_TOKEN_FILE,
      redirectPort: config.YOUTUBE_OAUTH_REDIRECT_PORT,
    });
    await oauth.authorizeInteractively().then(async (tokens) => {
      log.info(`authorised; scopes: ${tokens.scope}`);
    });
    console.log(`\nAuthorised. Re-run any command with --owner to include retention data.\n`);
  });

// --- quota ----------------------------------------------------------------

program
  .command("quota")
  .argument("<videos>", "number of uploads you intend to analyse")
  .description("Estimate the Data API quota a sweep will cost before you spend it.")
  .action((videos: string) => {
    const count = Number(videos);
    const units = QuotaTracker.estimateChannelSweep(Number.isFinite(count) ? count : 0);
    console.log(
      `\n  ${count} uploads ≈ ${units} quota units (${((units / 10_000) * 100).toFixed(1)}% of a default 10,000/day project).\n  Cached responses cost nothing on re-runs.\n`,
    );
  });

// --- cache ----------------------------------------------------------------

program
  .command("cache")
  .argument("<action>", "'clear'")
  .description("Manage the on-disk API cache.")
  .action(async (action: string) => {
    if (action !== "clear") {
      throw new Error(`Unknown cache action "${action}". Only 'clear' is supported.`);
    }
    const config = loadConfig();
    await DiskCache.fromHours(config.LITIX_CACHE_DIR, config.LITIX_CACHE_TTL_HOURS).clear();
    console.log(`\n  Cleared ${config.LITIX_CACHE_DIR}.\n`);
  });

// --- earn -----------------------------------------------------------------
//
// The Earner: one goal, legal income in New Jersey as fast as possible. The
// ranking is deterministic and needs no key; the daily brief asks Claude.

const earn = program
  .command("earn")
  .description("The Earner: the fastest legal, ethical route to income in New Jersey, given what you have.");

const REQUIREMENT_IDS = Object.keys(REQUIREMENT_LABELS) as PlayRequirement[];

/** Inputs that describe the person. Shared by `earn rank` and `earn plan`. */
function withSituationOptions(command: Command): Command {
  return command
    .option("--days <count>", "days until you need the money", "14")
    .option("--hours <count>", "hours per day you can work", "6")
    .option("--cash <usd>", "cash you can spend on getting started", "0")
    .option("--target <usd>", "dollar target inside the window")
    .option("--skills <list>", "comma-separated skills you have")
    .option(
      "--has <list>",
      `comma-separated things you have: ${REQUIREMENT_IDS.join(", ")}; or 'all'`,
      "age-18,smartphone,internet,bank-account,can-leave-home,work-authorization",
    )
    .option("--exclude <list>", "comma-separated playIds you refuse to do")
    .option("--town <name>", "your municipality, for local-ordinance reminders")
    .option("--notes <text>", "anything else, in your words")
    .option("--ledger <path>", "where the income ledger lives", DEFAULT_LEDGER_PATH)
    .addOption(new Option("--json", "emit JSON instead of markdown"))
    .option("-o, --out <file>", "write the plan to a file");
}

function parseList(value: unknown): string[] {
  return typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function parseSituation(opts: Record<string, unknown>): Situation {
  const hasRaw = parseList(opts.has);
  const has = hasRaw.includes("all") ? REQUIREMENT_IDS : (hasRaw as PlayRequirement[]);
  const unknown = has.filter((h) => !REQUIREMENT_IDS.includes(h));
  if (unknown.length > 0) {
    throw new Error(`Unknown --has entries: ${unknown.join(", ")}. Valid: ${REQUIREMENT_IDS.join(", ")}.`);
  }
  const exclude = parseList(opts.exclude);
  const unknownPlays = exclude.filter((id) => !findPlay(id));
  if (unknownPlays.length > 0) {
    throw new Error(`Unknown --exclude playIds: ${unknownPlays.join(", ")}. See 'litix earn plays'.`);
  }
  const target = opts.target === undefined ? undefined : Number(opts.target);
  return {
    urgencyDays: Math.max(1, Number(opts.days ?? 14) || 14),
    hoursPerDay: Math.max(0, Number(opts.hours ?? 6) || 0),
    cashOnHandUsd: Math.max(0, Number(opts.cash ?? 0) || 0),
    ...(target !== undefined && Number.isFinite(target) ? { targetUsd: target } : {}),
    skills: parseList(opts.skills),
    has,
    ...(exclude.length > 0 ? { excludePlayIds: exclude } : {}),
    ...(typeof opts.town === "string" ? { town: opts.town } : {}),
    ...(typeof opts.notes === "string" ? { notes: opts.notes } : {}),
  };
}

withSituationOptions(
  earn
    .command("rank")
    .description("Rank every legal play for your situation and build the stack. Deterministic; no API key needed."),
).action(async (opts: Record<string, unknown>) => {
  const situation = parseSituation(opts);
  const plan = buildEarnPlan(situation);
  const ledger = summarizeLedger(await loadLedger(String(opts.ledger)));

  if (opts.json) {
    await emitRaw(JSON.stringify({ plan, ledger }, null, 2), opts);
    return;
  }
  if (opts.out) {
    await emitRaw(renderEarnPlan(plan, { ledger }), opts);
    return;
  }

  console.log(`\n  The Earner — ${situation.urgencyDays}-day window, ${situation.hoursPerDay}h/day, ${formatUsd(situation.cashOnHandUsd)} to start\n`);
  if (plan.stack.length === 0) {
    console.log("  Nothing available with what you listed in --has. Run with --has all to see what unlocks.\n");
  } else {
    console.log(`  First 7 days   ${formatUsd(plan.projection.firstWeekUsd.low)} – ${formatUsd(plan.projection.firstWeekUsd.high)}`);
    console.log(`  In window      ${formatUsd(plan.projection.windowUsd.low)} – ${formatUsd(plan.projection.windowUsd.high)}`);
    if (situation.targetUsd !== undefined) {
      console.log(`  Target         ${formatUsd(situation.targetUsd)} — ${plan.projection.targetReachable ? "reachable on the middle estimate" : "NOT reachable on the middle estimate"}`);
    }
    console.log(`\n  The stack:\n`);
    plan.stack.forEach((item, index) => {
      console.log(
        `  ${String(index + 1).padStart(2)}. ${item.play.name.padEnd(46)} ${String(item.allocatedHoursPerWeek).padStart(3)}h/wk   first $ ${item.play.timeToFirstDollarDays === 0 ? "today" : `${item.play.timeToFirstDollarDays}d`.padStart(5)}   7d ${formatUsd(item.expectedUsdFirstWeek.low).padStart(6)}–${formatUsd(item.expectedUsdFirstWeek.high).padEnd(6)}`,
      );
    });
  }
  const blocked = plan.ranked.filter((r) => r.blockers.length > 0);
  if (blocked.length > 0) {
    console.log(`\n  Blocked (${blocked.length}):\n`);
    for (const item of blocked.slice(0, 8)) {
      console.log(`   · ${item.play.name}: ${item.blockers.join(" ")}`);
    }
  }
  console.log(`\n  Full plan with the legal checklist: add --out plan.md\n`);
});

withSituationOptions(
  earn
    .command("plan")
    .description("Today's brief: the next 24 hours, hour by hour, from the ranked stack. Needs ANTHROPIC_API_KEY."),
)
  .option("--propose <text...>", "things you are thinking of doing; each is screened against the charter")
  .action(async (opts: Record<string, unknown>) => {
    const config = loadConfig();
    const situation = parseSituation(opts);
    const ledgerPath = String(opts.ledger);
    const ledger = await loadLedger(ledgerPath);
    const proposals = Array.isArray(opts.propose) ? (opts.propose as string[]) : [];

    const result = await runEarnAgent({
      ...(config.ANTHROPIC_API_KEY ? { apiKey: config.ANTHROPIC_API_KEY } : {}),
      model: config.LITIX_MODEL,
      situation,
      ledger,
      proposals,
    });

    if (opts.json) {
      await emitRaw(JSON.stringify(result, null, 2), opts);
      return;
    }
    await emitRaw(
      renderEarnPlan(result.plan, { brief: result.brief, ledger: summarizeLedger(ledger) }),
      opts,
    );
  });

earn
  .command("log")
  .argument("<playId>", "which play earned it; see 'litix earn plays'")
  .argument("<gross>", "gross dollars received")
  .option("--hours <count>", "hours it took", "0")
  .option("--expenses <usd>", "fees, fuel, supplies", "0")
  .option("--date <yyyy-mm-dd>", "when; defaults to today")
  .option("--note <text>", "anything worth remembering")
  .option("--ledger <path>", "where the income ledger lives", DEFAULT_LEDGER_PATH)
  .description("Record income. The brief re-plans from this, and it is your tax record.")
  .action(async (playId: string, gross: string, opts: Record<string, unknown>) => {
    if (!findPlay(playId)) {
      throw new Error(`Unknown playId "${playId}". See 'litix earn plays'.`);
    }
    const path = String(opts.ledger);
    const ledger = addEntry(await loadLedger(path), {
      date: typeof opts.date === "string" ? opts.date : isoDate(),
      playId,
      grossUsd: Number(gross),
      hours: Number(opts.hours ?? 0),
      expensesUsd: Number(opts.expenses ?? 0),
      ...(typeof opts.note === "string" ? { note: opts.note } : {}),
    });
    await saveLedger(ledger, path);
    const summary = summarizeLedger(ledger);
    console.log(
      `\n  Logged ${formatUsd(Number(gross))} from ${playId}. Net so far ${formatUsd(summary.netUsd)} over ${summary.hours}h (${formatUsd(summary.netPerHour)}/h). Set aside ${formatUsd(summary.taxReserveUsd)} for tax.\n`,
    );
  });

earn
  .command("status")
  .option("--ledger <path>", "where the income ledger lives", DEFAULT_LEDGER_PATH)
  .addOption(new Option("--json", "emit JSON"))
  .description("What has been earned so far, per play, with the tax reserve.")
  .action(async (opts: Record<string, unknown>) => {
    const ledger = await loadLedger(String(opts.ledger));
    const summary = summarizeLedger(ledger);
    if (opts.json) {
      console.log(JSON.stringify({ ledger, summary }, null, 2));
      return;
    }
    if (summary.daysActive === 0) {
      console.log(`\n  Nothing logged yet. Record the first dollar with: litix earn log <playId> <gross> --hours <h>\n`);
      return;
    }
    console.log(`\n  Net ${formatUsd(summary.netUsd)} over ${summary.hours}h in ${summary.daysActive} day(s) — ${formatUsd(summary.netPerHour)}/h, ${formatUsd(summary.netPerDay)}/day. Tax reserve ${formatUsd(summary.taxReserveUsd)}.\n`);
    for (const p of summary.byPlay) {
      console.log(`  ${p.playId.padEnd(22)} ${formatUsd(p.netUsd).padStart(9)}  ${String(p.hours).padStart(5)}h  ${formatUsd(p.netPerHour).padStart(7)}/h`);
    }
    console.log("");
  });

earn
  .command("plays")
  .description("List every play in the catalogue with its id, speed and rate.")
  .action(() => {
    console.log("");
    for (const play of PLAYS) {
      console.log(
        `  ${play.id.padEnd(20)} ${play.name.padEnd(48)} first $ ${play.timeToFirstDollarDays === 0 ? "today" : `${play.timeToFirstDollarDays}d`.padStart(5)}   $${play.hourlyUsd.low}–${play.hourlyUsd.high}/h${play.online ? "   online" : ""}`,
      );
    }
    console.log("");
  });

earn
  .command("screen")
  .argument("<activity...>", "what you are thinking of doing, in plain words")
  .description("Check an idea against the legal and ethical charter before you spend a minute on it.")
  .action((activity: string[]) => {
    const result = screenActivity(activity.join(" "));
    console.log(`\n  ${result.verdict.toUpperCase()}`);
    for (const m of result.matched) console.log(`   · ${m.label}\n     ${m.why}`);
    if (result.verdict === "allowed") {
      console.log("   Nothing in the charter objects. Remember the obligations that attach to every dollar:");
      for (const o of result.generalObligations.slice(0, 3)) console.log(`   · ${o}`);
    }
    console.log("");
  });

async function emitRaw(output: string, opts: Record<string, unknown>): Promise<void> {
  if (typeof opts.out === "string" && opts.out) {
    await writeFile(opts.out, output, "utf8");
    log.info(`written to ${opts.out}`);
    return;
  }
  console.log(output);
}

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof MissingCredentialError) {
    log.error(error.message);
    process.exitCode = 78; // EX_CONFIG
    return;
  }
  log.error((error as Error).message);
  process.exitCode = 1;
});
