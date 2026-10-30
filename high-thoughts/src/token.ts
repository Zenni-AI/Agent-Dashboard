import { createHash, randomBytes } from "node:crypto";

/**
 * Credit tokens.
 *
 * A token is a bearer secret: whoever holds it can spend the balance. It is
 * never stored in the clear anywhere — not in the JSON ledger, not in Postgres
 * — so a leaked store hands an attacker hashes and nothing spendable.
 *
 * This file is a leaf on purpose. Both ledger backends need these three
 * functions, and neither should have to import the other to get them.
 */
const TOKEN_PREFIX = "ht_";

export function issueToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check, so a malformed header never reaches the store. */
export function looksLikeToken(value: unknown): value is string {
  return typeof value === "string" && /^ht_[0-9a-f]{48}$/.test(value);
}

/**
 * Turn whatever identifies a first-time visitor into an opaque claim key.
 *
 * The raw material is an IP address, which is personal data we have no reason
 * to keep. Salting and hashing it means the store can answer "has this one
 * already had its free creation?" without holding anybody's address.
 */
export function hashClaim(salt: string, raw: string): string {
  return createHash("sha256").update(`${salt}:${raw}`).digest("hex");
}
