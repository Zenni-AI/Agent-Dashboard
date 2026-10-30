/**
 * What the paywall talks to.
 *
 * There are two stores behind this interface and the server cannot tell them
 * apart: a JSON file, which is right for one laptop, and Postgres, which is
 * right the moment the app is somewhere other people can reach. Keeping the
 * seam here means moving between them is a config change, not a rewrite, and
 * means an existing token works the same either side of the move.
 *
 * Everything is async, including the reads. The file store could answer a
 * balance synchronously; Postgres cannot, and an interface that leaks that
 * difference is an interface the server has to know about.
 */
export interface Account {
  /** Creations this token may still make. */
  credits: number;
  /** Creations it has made. Kept for support questions, not for billing. */
  spent: number;
  createdAt: number;
  note?: string;
}

export type RedeemResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "missing" | "unknown" | "empty" };

export type ClaimResult =
  /** First time here: a token with the free creation on it. */
  | { ok: true; token: string; credits: number }
  /** This claim key already had its free one, or claims are switched off. */
  | { ok: false; reason: "already" | "disabled" | "unavailable" };

export interface Ledger {
  /** Spend one credit. Must be atomic: two requests cannot spend the same one. */
  redeem(token: unknown): Promise<RedeemResult>;
  /** Hand one back when a creation fails. */
  refund(token: unknown): Promise<void>;
  /** Add credits, creating the account if needed. This is what a payment calls. */
  grant(token: string, credits: number, note?: string): Promise<number>;
  balance(token: unknown): Promise<number>;
  known(token: unknown): Promise<boolean>;
  /**
   * The free first creation, decided by the store rather than by the phone.
   *
   * Takes an opaque claim key (see `hashClaim`) and either issues a token or
   * says this key has already had its one. The store is the only thing that
   * can answer that honestly — a client-side flag is a suggestion.
   */
  claimFree(claimKey: string): Promise<ClaimResult>;
  /** One line for the startup banner, so it is obvious which store is live. */
  describe(): Promise<string>;
}
