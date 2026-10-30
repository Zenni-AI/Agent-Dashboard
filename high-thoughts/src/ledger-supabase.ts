import type { ClaimResult, Ledger, RedeemResult } from "./ledger.js";
import { hashToken, issueToken, looksLikeToken } from "./token.js";

/**
 * The ledger in Postgres, reached over Supabase's REST interface.
 *
 * Two things this fixes that the file ledger cannot. Spends are atomic in the
 * database — a single conditional UPDATE — so two requests racing for the last
 * credit cannot both win, which matters the moment the app runs anywhere more
 * than one person can reach. And the ledger outlives the container, so a
 * redeploy stops being a way to lose everybody's purchase.
 *
 * No client library. Every call is one POST to a stored procedure, which keeps
 * the dependency list where it is and keeps the rules in one place — the
 * database decides whether a spend is allowed, not this file.
 *
 * The key here is the service role key. It bypasses row-level security, so it
 * must only ever live on the server. The tables themselves sit in a schema
 * PostgREST does not expose, so even a leaked publishable key reaches nothing.
 */
export interface SupabaseLedgerOptions {
  url: string;
  serviceRoleKey: string;
  freeCredits?: number;
  /** Network timeout. A hung ledger must fail closed, not hang the request. */
  timeoutMs?: number;
}

export class SupabaseLedgerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SupabaseLedgerError";
  }
}

export class SupabaseLedger implements Ledger {
  private readonly endpoint: string;
  private readonly key: string;
  private readonly freeCredits: number;
  private readonly timeoutMs: number;

  constructor(options: SupabaseLedgerOptions) {
    this.endpoint = `${options.url.replace(/\/+$/, "")}/rest/v1/rpc`;
    this.key = options.serviceRoleKey;
    this.freeCredits = options.freeCredits ?? 1;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const abort = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/${fn}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: this.key,
          authorization: `Bearer ${this.key}`,
        },
        body: JSON.stringify(args),
        signal: abort,
      });
    } catch (error) {
      throw new SupabaseLedgerError(`Could not reach the ledger: ${(error as Error).message}`);
    }

    if (!response.ok) {
      // Deliberately not including the response body: it can echo arguments,
      // and the arguments are token hashes.
      throw new SupabaseLedgerError(`Ledger rejected ${fn}`, response.status);
    }

    return (await response.json()) as T;
  }

  async redeem(token: unknown): Promise<RedeemResult> {
    if (!looksLikeToken(token)) return { ok: false, reason: "missing" };
    // Any failure here must read as "not paid". Letting a ledger outage open
    // the endpoint would make an outage the cheapest way to get free work.
    return this.rpc<RedeemResult>("ht_redeem", { p_token_hash: hashToken(token) });
  }

  async refund(token: unknown): Promise<void> {
    if (!looksLikeToken(token)) return;
    await this.rpc("ht_refund", { p_token_hash: hashToken(token) });
  }

  async grant(token: string, credits: number, note?: string): Promise<number> {
    if (!looksLikeToken(token)) throw new Error("Not a valid token.");
    if (!Number.isInteger(credits) || credits < 1) throw new Error("Credits must be a positive integer.");

    const result = await this.rpc<{ credits: number }>("ht_grant", {
      p_token_hash: hashToken(token),
      p_credits: credits,
      p_note: note ?? null,
    });
    return result.credits;
  }

  /**
   * The free first creation.
   *
   * The token is minted here rather than in the database, because the database
   * must only ever see the hash. The insert of the claim row is what makes it
   * once-only: a second call with the same key hits the primary key and comes
   * back as `already`, so two simultaneous claims cannot both succeed.
   */
  async claimFree(claimKey: string): Promise<ClaimResult> {
    if (!claimKey) return { ok: false, reason: "unavailable" };

    const token = issueToken();
    const result = await this.rpc<{ ok: boolean; reason?: "already" }>("ht_claim_free", {
      p_claim_hash: claimKey,
      p_token_hash: hashToken(token),
      p_credits: this.freeCredits,
    });

    if (!result.ok) return { ok: false, reason: result.reason ?? "already" };
    return { ok: true, token, credits: this.freeCredits };
  }

  async balance(token: unknown): Promise<number> {
    if (!looksLikeToken(token)) return 0;
    const result = await this.rpc<{ credits: number; known: boolean }>("ht_account", {
      p_token_hash: hashToken(token),
    });
    return result.credits;
  }

  async known(token: unknown): Promise<boolean> {
    if (!looksLikeToken(token)) return false;
    const result = await this.rpc<{ credits: number; known: boolean }>("ht_account", {
      p_token_hash: hashToken(token),
    });
    return result.known;
  }

  async describe(): Promise<string> {
    const host = new URL(this.endpoint).host;
    try {
      const result = await this.rpc<{ accounts: number }>("ht_stats", {});
      return `supabase ledger at ${host} (${result.accounts} account(s))`;
    } catch (error) {
      return `supabase ledger at ${host} (unreachable: ${(error as Error).message})`;
    }
  }
}
