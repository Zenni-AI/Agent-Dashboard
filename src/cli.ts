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
