import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Account, ClaimResult, Ledger, RedeemResult } from "./ledger.js";
import { hashToken, issueToken, looksLikeToken } from "./token.js";

// Re-exported because plenty of callers reach for the token helpers and the
// ledger in the same breath, and splitting them into two imports bought
// nothing.
export { hashToken, issueToken, looksLikeToken };
export type { Account, RedeemResult };

/**
 * The ledger as a JSON file.
 *
 * Right for one machine: no service to run, no account to open, and a ledger
 * you can read with `cat`. Wrong for anything with real users, for two reasons
 * it cannot fix — it is single-process, so two server instances against one
 * file will double-spend, and it lives on a container disk, so a redeploy can
 * take everybody's credits with it. `SupabaseLedger` is the answer to both.
 *
 * Writes go through a queue and land by rename, so a crash mid-write cannot
 * leave a truncated ledger that reads as everyone having zero.
 */
interface FreeClaim {
  tokenHash: string;
  at: number;
}

interface LedgerFile {
  accounts: Record<string, Account>;
  freeClaims: Record<string, FreeClaim>;
}

export interface CreditStoreOptions {
  /** Credits handed out by a successful free claim. */
  freeCredits?: number;
}

export class CreditStore implements Ledger {
  private accounts: Record<string, Account> = {};
  private freeClaims: Record<string, FreeClaim> = {};
  /** Serialises writes; within one process this is what keeps spends atomic. */
  private queue: Promise<void> = Promise.resolve();
  /** mtime of the copy in memory, so an outside write can be noticed. */
  private loadedAt = 0;
  private readonly freeCredits: number;

  constructor(
    private readonly file: string,
    options: CreditStoreOptions = {},
  ) {
    this.freeCredits = options.freeCredits ?? 1;
    this.load();
  }

  private load(): void {
    try {
      this.loadedAt = statSync(this.file).mtimeMs;
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<LedgerFile> | null;
      this.accounts = parsed && typeof parsed === "object" ? (parsed.accounts ?? {}) : {};
      this.freeClaims = parsed && typeof parsed === "object" ? (parsed.freeClaims ?? {}) : {};
    } catch {
      // No ledger yet, or an unreadable one. Starting empty is correct: the
      // failure mode is "nobody can make a creation", never "everybody can".
      this.accounts = {};
      this.freeClaims = {};
      this.loadedAt = 0;
    }
  }

  /**
   * Pick up credits granted by something else since we last looked.
   *
   * The ledger is a file, and the things that top it up — the CLI now, a
   * payment webhook later — are separate processes. Without this, a running
   * server never sees a credit somebody just paid for, and the person is told
   * to buy a creation they already own.
   */
  private reloadIfChanged(): void {
    try {
      if (statSync(this.file).mtimeMs !== this.loadedAt) this.load();
    } catch {
      // File not there yet; whatever is in memory is as good as it gets.
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const payload: LedgerFile = { accounts: this.accounts, freeClaims: this.freeClaims };
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
    // Our own write must not read back as somebody else's.
    try {
      this.loadedAt = statSync(this.file).mtimeMs;
    } catch {
      this.loadedAt = 0;
    }
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
      this.reloadIfChanged();
      const account = this.accounts[hashToken(token)];
      if (!account) return { ok: false, reason: "unknown" } as const;
      if (account.credits < 1) return { ok: false, reason: "empty" } as const;

      account.credits -= 1;
      account.spent += 1;
      return { ok: true, remaining: account.credits } as const;
    });
  }

  /**
   * Hand a credit back when a creation fails.
   *
   * Nobody should pay for a creation they never received, and the alternative
   * is a support request we have no way to verify.
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
      this.reloadIfChanged();
      const key = hashToken(token);
      const account = (this.accounts[key] ??= { credits: 0, spent: 0, createdAt: Date.now() });
      account.credits += credits;
      if (note) account.note = note;
      return account.credits;
    });
  }

  /**
   * The free first creation.
   *
   * Recorded against the claim key so the same key cannot come back for a
   * second one. What that is worth depends entirely on how hard the claim key
   * is to change — see docs/SECURITY_RISKS.md. The store's job is only to make
   * the decision once and remember it.
   */
  async claimFree(claimKey: string): Promise<ClaimResult> {
    if (!claimKey) return { ok: false, reason: "unavailable" };

    return this.write(() => {
      this.reloadIfChanged();
      if (this.freeClaims[claimKey]) return { ok: false, reason: "already" } as const;

      const token = issueToken();
      const tokenHash = hashToken(token);
      this.accounts[tokenHash] = {
        credits: this.freeCredits,
        spent: 0,
        createdAt: Date.now(),
        note: "free first creation",
      };
      this.freeClaims[claimKey] = { tokenHash, at: Date.now() };
      return { ok: true, token, credits: this.freeCredits } as const;
    });
  }

  async balance(token: unknown): Promise<number> {
    if (!looksLikeToken(token)) return 0;
    this.reloadIfChanged();
    return this.accounts[hashToken(token)]?.credits ?? 0;
  }

  async known(token: unknown): Promise<boolean> {
    if (!looksLikeToken(token)) return false;
    this.reloadIfChanged();
    return hashToken(token) in this.accounts;
  }

  async describe(): Promise<string> {
    this.reloadIfChanged();
    return `file ledger at ${this.file} (${this.accountCount} account(s))`;
  }

  get accountCount(): number {
    return Object.keys(this.accounts).length;
  }
}
