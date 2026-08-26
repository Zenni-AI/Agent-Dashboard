import "dotenv/config";
import { z } from "zod";

/**
 * LITIX reads every credential from the environment. Nothing is required up
 * front — each stage validates only the keys it actually needs, so `litix
 * profile` works with a bare Data API key and only `--advise` demands an
 * Anthropic key.
 */
const EnvSchema = z.object({
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  YOUTUBE_CLIENT_ID: z.string().min(1).optional(),
  YOUTUBE_CLIENT_SECRET: z.string().min(1).optional(),
  YOUTUBE_OAUTH_REDIRECT_PORT: z.coerce.number().int().positive().default(8788),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LITIX_MODEL: z.string().default("claude-opus-5"),
  LITIX_CACHE_DIR: z.string().default(".litix-cache"),
  LITIX_TOKEN_FILE: z.string().default(".litix/tokens.json"),
  LITIX_CACHE_TTL_HOURS: z.coerce.number().positive().default(12),
});

export type LitixConfig = z.infer<typeof EnvSchema>;

let cached: LitixConfig | null = null;

export function loadConfig(): LitixConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid LITIX configuration:\n${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset memoised config. Tests only. */
export function resetConfig(): void {
  cached = null;
}

export class MissingCredentialError extends Error {
  constructor(key: string, whatItUnlocks: string, howToGet: string) {
    super(
      `Missing ${key}. Needed for: ${whatItUnlocks}.\n  How to get one: ${howToGet}`,
    );
    this.name = "MissingCredentialError";
  }
}

export function requireDataApiKey(config: LitixConfig): string {
  if (!config.YOUTUBE_API_KEY) {
    throw new MissingCredentialError(
      "YOUTUBE_API_KEY",
      "reading public channel and video statistics",
      "console.cloud.google.com -> enable 'YouTube Data API v3' -> Credentials -> API key",
    );
  }
  return config.YOUTUBE_API_KEY;
}

export function requireOAuthClient(config: LitixConfig): {
  clientId: string;
  clientSecret: string;
} {
  if (!config.YOUTUBE_CLIENT_ID || !config.YOUTUBE_CLIENT_SECRET) {
    throw new MissingCredentialError(
      "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET",
      "reading your own retention curves and traffic sources (YouTube Analytics API)",
      "console.cloud.google.com -> enable 'YouTube Analytics API' -> Credentials -> OAuth client ID (Desktop app)",
    );
  }
  return {
    clientId: config.YOUTUBE_CLIENT_ID,
    clientSecret: config.YOUTUBE_CLIENT_SECRET,
  };
}

export function requireAnthropicKey(config: LitixConfig): string {
  if (!config.ANTHROPIC_API_KEY) {
    throw new MissingCredentialError(
      "ANTHROPIC_API_KEY",
      "turning the computed numbers into concrete plays",
      "console.anthropic.com -> API keys",
    );
  }
  return config.ANTHROPIC_API_KEY;
}
