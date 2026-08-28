import "dotenv/config";

export interface Config {
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
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class MissingKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add a key from console.anthropic.com.",
    );
    this.name = "MissingKeyError";
  }
}

export function loadConfig(): Config {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new MissingKeyError();

  return {
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
  };
}
