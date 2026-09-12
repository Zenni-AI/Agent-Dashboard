/**
 * LITIX — YouTube analytics turned into monetization intelligence.
 *
 * The library surface mirrors the pipeline: ingest a channel, analyse what is
 * working, price the audience, rank the plays. Every stage is usable on its own.
 */
export * from "./types.js";

export { loadConfig, MissingCredentialError } from "./config.js";
export { ingest, run, type RunOptions } from "./pipeline.js";

// Ingest
export { YouTubeDataApi, YouTubeApiError } from "./youtube/dataApi.js";
export { YouTubeAnalyticsApi, analyticsWindow } from "./youtube/analyticsApi.js";
export { YouTubeOAuth, REQUIRED_SCOPES } from "./youtube/oauth.js";
export { parseChannelRef } from "./youtube/resolve.js";
export { QuotaTracker, QUOTA_COST } from "./youtube/quota.js";
export { DiskCache } from "./store/cache.js";

// Analysis
export { buildChannelProfile } from "./analysis/profile.js";
export { classifyFormat, splitByFormat, SHORTS_MAX_SECONDS_CURRENT } from "./analysis/format.js";
export {
  computeFormatStats,
  computePerformanceProfile,
  engagementRate,
  isMature,
} from "./analysis/performance.js";
export { analyseHooks, actionableHooks, HOOK_DEFINITIONS } from "./analysis/hooks.js";
export { computeCadence } from "./analysis/cadence.js";
export { buildRetentionProfile, watchRatioAt, hookDropoff } from "./analysis/retention.js";
export { classifyNiche, NICHES, findNiche } from "./analysis/niches.js";

// Benchmark
export { benchmarkAgainst } from "./benchmark/compare.js";
export { loadReferences, referencesForNiche } from "./benchmark/registry.js";

// Monetize
export { buildAudienceModel, VIEWS_PER_VIEWER } from "./monetize/audience.js";
export { ARCHETYPES, findArchetype } from "./monetize/archetypes.js";
export { projectRevenue, rampedRevenue } from "./monetize/projection.js";
export { rankPlays, pathOfLeastResistance, EFFORT_HOURS } from "./monetize/plays.js";

// Output
export { generateAdvice } from "./ai/advisor.js";
export { renderMarkdownReport } from "./report/markdown.js";

// The Earner — legal income in New Jersey, fastest first
export * from "./earn/types.js";
export { PLAYS, findPlay, playsByCategory } from "./earn/catalog.js";
export {
  PROHIBITIONS,
  DECLINED_BY_POLICY,
  GENERAL_COMPLIANCE,
  screenActivity,
  refusalSummary,
} from "./earn/guardrails.js";
export { rankIncomePlays, buildEarnPlan, expectedInWindow, REQUIREMENT_LABELS } from "./earn/rank.js";
export { loadLedger, saveLedger, addEntry, summarizeLedger, DEFAULT_LEDGER_PATH, TAX_RESERVE_RATE } from "./earn/ledger.js";
export { renderEarnPlan } from "./earn/report.js";
export { runEarnAgent, EARNER_SYSTEM_PROMPT, DailyBriefSchema, EarnerRefusalError } from "./earn/agent.js";
