import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Who is allowed a book.
 *
 * A book costs real money to make, so the endpoint that makes one cannot be
 * open. This is the ledger that decides: a token carries a balance, and a book
 * spends one. Payment providers write into it later — a Stripe webhook grants
 * credits and nothing else about this file changes.
 *
 * Tokens are stored as SHA-256 hashes, never in the clear. A token is a bearer
 * secret: whoever holds it can spend the balance, so a leaked ledger file must
 * not hand an attacker working tokens.
 *
 * File-backed and single-process, which is the honest scope for one server. It
 * is not safe to run two instances against the same file.
 */
export interface Account {
  /** Books this token may still make. */
  credits: number;
  /** Books it has made. Kept for support questions, not for billing. */
  spent: number;
  createdAt: number;
  note?: string;
}

export type RedeemResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "missing" | "unknown" | "empty" };

const TOKEN_PREFIX = "ht_";

export function issueToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check, so a malformed header never reaches the ledger. */
export function looksLikeToken(value: unknown): value is string {
  return typeof value === "string" && /^ht_[0-9a-f]{48}$/.test(value);
}

export class CreditStore {
  private accounts: Record<string, Account> = {};
  /** Serialises writes; within one process this is what keeps spends atomic. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") this.accounts = parsed.accounts ?? {};
    } catch {
      // No ledger yet, or an unreadable one. Starting empty is correct: the
      // failure mode is "nobody can make a book", never "everybody can".
      this.accounts = {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    // Write-then-rename, so a crash mid-write cannot leave a truncated ledger
    // that reads as everyone having zero credits.
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify({ accounts: this.accounts }, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }

  private write<T>(mutate: () => T): Promise<T> {
    const run = this.queue.then(() => {
      const result = mutate();
      this.persist();
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Spend one credit. Called before a job starts, never after — an unpaid
   * request must not be able to reach the model at all.
   */
  async redeem(token: unknown): Promise<RedeemResult> {
    if (!looksLikeToken(token)) return { ok: false, reason: "missing" };

    return this.write(() => {
      const account = this.accounts[hashToken(token)];
      if (!account) return { ok: false, reason: "unknown" } as const;
      if (account.credits < 1) return { ok: false, reason: "empty" } as const;

      account.credits -= 1;
      account.spent += 1;
      return { ok: true, remaining: account.credits } as const;
    });
  }

  /**
   * Hand a credit back when a book fails.
   *
   * Nobody should pay for a book they never received, and the alternative is a
   * support request we have no way to verify.
   */
  async refund(token: unknown): Promise<void> {
    if (!looksLikeToken(token)) return;
    await this.write(() => {
      const account = this.accounts[hashToken(token)];
      if (!account) return;
      account.credits += 1;
      account.spent = Math.max(0, account.spent - 1);
    });
  }

  /** Grant credits, creating the account if needed. This is what a payment calls. */
  async grant(token: string, credits: number, note?: string): Promise<number> {
    if (!looksLikeToken(token)) throw new Error("Not a valid token.");
    if (!Number.isInteger(credits) || credits < 1) throw new Error("Credits must be a positive integer.");

    return this.write(() => {
      const key = hashToken(token);
      const account = (this.accounts[key] ??= { credits: 0, spent: 0, createdAt: Date.now() });
      account.credits += credits;
      if (note) account.note = note;
      return account.credits;
    });
  }

  balance(token: unknown): number {
    if (!looksLikeToken(token)) return 0;
    return this.accounts[hashToken(token)]?.credits ?? 0;
  }

  known(token: unknown): boolean {
    return looksLikeToken(token) && hashToken(token) in this.accounts;
  }

  get accountCount(): number {
    return Object.keys(this.accounts).length;
  }
}
