import "dotenv/config";

/**
 * The part of the config the credit ledger needs, and nothing else.
 *
 * Split out so the `credits` CLI can open the live ledger without an API key.
 * Granting someone a credit has nothing to do with talking to the model, and
 * demanding a key to do it made the one tool a support person needs the one
 * tool they could not run.
 */
export interface LedgerConfig {
  /** Where the JSON ledger lives, when that is the one in use. */
  creditsFile: string;
  /**
   * Which store the ledger uses. `file` is one machine; `supabase` is anything
   * with real users, because it survives a redeploy and cannot double-spend.
   */
  ledger: "file" | "supabase";
  supabaseUrl: string | null;
  /** Service role key. Bypasses row-level security, so server-only, always. */
  supabaseServiceRoleKey: string | null;
  /** Credits a successful free claim is worth. */
  freeCredits: number;
}

export interface Config extends LedgerConfig {
  apiKey: string;
  /**
   * Required only for an identity-linked key — one scoped to the organization
   * and tied to a user rather than to a workspace. Those are rejected outright
   * unless the request names the workspace it acts in.
   */
  workspaceId: string | null;
  model: string;
  port: number;
  host: string;
  /** Requests allowed per IP per window. Keeps a public deploy from burning the key. */
  rateLimit: number;
  rateWindowMs: number;
  /** Longest thought accepted, in characters. Generous — people ramble. */
  maxThoughtChars: number;
  /** Earlier turns replayed as context on a follow-up. */
  maxHistoryTurns: number;
  /** Thoughts a single textbook may be built from. */
  maxChains: number;
  /**
   * Whether the server hands out a free first creation at all.
   *
   * Off by default. A creation costs real money, so switching this on is a
   * decision about spend, not a default to inherit.
   */
  freeClaims: boolean;
  /**
   * Salt for the claim key. Without it an address hash is a lookup table, so
   * free claims refuse to switch on until this is set.
   */
  claimSalt: string | null;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class MissingKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add a key from console.anthropic.com.",
    );
    this.name = "MissingKeyError";
  }
}

export function loadLedgerConfig(): LedgerConfig {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || null;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;

  // Taken from the env var when it says so, inferred otherwise: having both
  // Supabase values set is an unambiguous statement of intent, and quietly
  // preferring the file in that case would mean paid credits landing nowhere.
  const requested = process.env.HIGH_THOUGHTS_LEDGER?.trim().toLowerCase();
  const ledger: LedgerConfig["ledger"] =
    requested === "supabase" || (!requested && supabaseUrl && supabaseServiceRoleKey) ? "supabase" : "file";

  if (ledger === "supabase" && !(supabaseUrl && supabaseServiceRoleKey)) {
    throw new ConfigError(
      "HIGH_THOUGHTS_LEDGER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Both are in the project's API settings.",
    );
  }

  return {
    creditsFile: process.env.HIGH_THOUGHTS_CREDITS_FILE?.trim() || ".high-thoughts/credits.json",
    ledger,
    supabaseUrl,
    supabaseServiceRoleKey,
    freeCredits: int("HIGH_THOUGHTS_FREE_CREDITS", 1),
  };
}

export function loadConfig(): Config {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new MissingKeyError();

  const claimSalt = process.env.HIGH_THOUGHTS_CLAIM_SALT?.trim() || null;
  const freeClaims = flag("HIGH_THOUGHTS_FREE_CLAIMS", false);
  if (freeClaims && !claimSalt) {
    throw new ConfigError(
      "HIGH_THOUGHTS_FREE_CLAIMS needs HIGH_THOUGHTS_CLAIM_SALT. An unsalted address hash is reversible by anyone with a list of addresses.",
    );
  }

  return {
    ...loadLedgerConfig(),
    apiKey,
    workspaceId: process.env.ANTHROPIC_WORKSPACE_ID?.trim() || null,
    model: process.env.HIGH_THOUGHTS_MODEL?.trim() || "claude-opus-5",
    port: int("PORT", 8080),
    host: process.env.HOST?.trim() || "0.0.0.0",
    rateLimit: int("HIGH_THOUGHTS_RATE_LIMIT", 30),
    rateWindowMs: int("HIGH_THOUGHTS_RATE_WINDOW_MS", 60_000),
    maxThoughtChars: int("HIGH_THOUGHTS_MAX_CHARS", 4000),
    maxHistoryTurns: int("HIGH_THOUGHTS_MAX_HISTORY", 6),
    maxChains: int("HIGH_THOUGHTS_MAX_CHAINS", 8),
    freeClaims,
    claimSalt,
  };
}
