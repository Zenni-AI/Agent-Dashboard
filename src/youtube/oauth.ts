import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { log } from "../util/logger.js";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Read-only scopes. LITIX never needs write access — it reports on a channel,
 * it does not touch it.
 */
export const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
}

export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  tokenFile: string;
  redirectPort: number;
}

/**
 * Google OAuth installed-app flow over a loopback redirect.
 *
 * The user authorises once in a browser; the refresh token is written to disk
 * and every later run silently mints a new access token.
 */
export class YouTubeOAuth {
  constructor(private readonly options: OAuthClientOptions) {}

  private get redirectUri(): string {
    return `http://127.0.0.1:${this.options.redirectPort}`;
  }

  async loadTokens(): Promise<StoredTokens | null> {
    try {
      const raw = await readFile(this.options.tokenFile, "utf8");
      return JSON.parse(raw) as StoredTokens;
    } catch {
      return null;
    }
  }

  private async saveTokens(tokens: StoredTokens): Promise<void> {
    await mkdir(path.dirname(this.options.tokenFile), { recursive: true });
    // Owner-only: this file holds a long-lived refresh token.
    await writeFile(this.options.tokenFile, JSON.stringify(tokens, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  /** A valid access token, refreshing or prompting for consent as needed. */
  async getAccessToken(): Promise<string> {
    const stored = await this.loadTokens();

    // Refresh a minute early so a long request cannot straddle expiry.
    if (stored && stored.expiresAt > Date.now() + 60_000) {
      return stored.accessToken;
    }

    if (stored?.refreshToken) {
      try {
        const refreshed = await this.refresh(stored.refreshToken);
        await this.saveTokens(refreshed);
        return refreshed.accessToken;
      } catch (error) {
        log.warn(
          `Refresh token rejected (${(error as Error).message}); re-authorising.`,
        );
      }
    }

    const fresh = await this.authorizeInteractively();
    await this.saveTokens(fresh);
    return fresh.accessToken;
  }

  private async refresh(refreshToken: string): Promise<StoredTokens> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      throw new Error(`token refresh failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as TokenResponse;
    return {
      accessToken: body.access_token,
      // A refresh response does not re-issue the refresh token; keep the old one.
      refreshToken,
      expiresAt: Date.now() + body.expires_in * 1000,
      scope: body.scope ?? REQUIRED_SCOPES.join(" "),
    };
  }

  /** Open the consent screen and capture the code on the loopback listener. */
  async authorizeInteractively(): Promise<StoredTokens> {
    const state = randomBytes(16).toString("hex");
    const authUrl = new URL(AUTH_ENDPOINT);
    authUrl.searchParams.set("client_id", this.options.clientId);
    authUrl.searchParams.set("redirect_uri", this.redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", REQUIRED_SCOPES.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("state", state);
    // Force consent so Google re-issues a refresh token on repeat authorisations.
    authUrl.searchParams.set("prompt", "consent");

    console.error("\nAuthorise LITIX to read your YouTube Analytics:\n");
    console.error(`  ${authUrl.toString()}\n`);

    const code = await this.waitForCode(state);
    return this.exchangeCode(code);
  }

  private waitForCode(expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", this.redirectUri);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const state = url.searchParams.get("state");

        const reply = (status: number, message: string) => {
          res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><meta charset="utf-8"><title>LITIX</title><body style="font:16px system-ui;padding:3rem"><h1>LITIX</h1><p>${message}</p></body>`,
          );
        };

        if (error) {
          reply(400, `Authorisation failed: ${escapeHtml(error)}`);
          server.close();
          reject(new Error(`Authorisation denied: ${error}`));
          return;
        }
        if (state !== expectedState) {
          reply(400, "State mismatch — request rejected.");
          server.close();
          reject(new Error("OAuth state mismatch; possible interception."));
          return;
        }
        if (!code) {
          reply(400, "No authorisation code in the callback.");
          return;
        }

        reply(200, "Authorised. You can close this tab and return to the terminal.");
        server.close();
        resolve(code);
      });

      server.on("error", reject);
      server.listen(this.options.redirectPort, "127.0.0.1", () => {
        log.info(`waiting for the OAuth callback on ${this.redirectUri}`);
      });

      // Do not hang a CI run forever waiting on a browser that will not arrive.
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error("Timed out after 5 minutes waiting for authorisation."));
      }, 300_000);
      timeout.unref?.();
    });
  }

  private async exchangeCode(code: string): Promise<StoredTokens> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`code exchange failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as TokenResponse;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      scope: body.scope ?? REQUIRED_SCOPES.join(" "),
    };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}
