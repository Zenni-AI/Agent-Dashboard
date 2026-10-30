import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupabaseLedger, SupabaseLedgerError } from "../src/ledger-supabase.js";
import { hashToken, issueToken, looksLikeToken } from "../src/token.js";

/**
 * The Postgres ledger, without Postgres.
 *
 * What is worth testing here is not SQL — that lives in the migration — but
 * the three things this file could get wrong in a way that costs money or
 * leaks a secret: what it puts on the wire, what it does when the wire fails,
 * and whether it ever sends a spendable token anywhere.
 */
const URL_BASE = "https://example.supabase.co";
const KEY = "service-role-key-not-a-real-one";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[];
let reply: (fn: string) => { status?: number; body?: unknown };
let ledger: SupabaseLedger;

beforeEach(() => {
  calls = [];
  reply = () => ({ body: {} });

  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const fn = url.split("/").pop() ?? "";
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body ?? "{}")),
    });
    const { status = 200, body = {} } = reply(fn);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });

  ledger = new SupabaseLedger({ url: URL_BASE, serviceRoleKey: KEY });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what goes on the wire", () => {
  it("sends the hash and never the token itself", async () => {
    const token = issueToken();
    reply = () => ({ body: { ok: true, remaining: 2 } });

    await ledger.redeem(token);

    const sent = JSON.stringify(calls[0].body);
    expect(sent).toContain(hashToken(token));
    expect(sent).not.toContain(token);
  });

  it("puts the service key in headers, never in the URL", async () => {
    reply = () => ({ body: { credits: 1, known: true } });
    await ledger.balance(issueToken());

    expect(calls[0].url).not.toContain(KEY);
    expect(calls[0].headers.apikey).toBe(KEY);
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("calls one stored procedure per operation rather than the table", async () => {
    reply = (fn) =>
      fn === "ht_account" ? { body: { credits: 0, known: false } } : { body: { ok: true, remaining: 0 } };

    await ledger.redeem(issueToken());
    await ledger.balance(issueToken());

    expect(calls.map((call) => call.url.replace(`${URL_BASE}/rest/v1/rpc/`, ""))).toEqual([
      "ht_redeem",
      "ht_account",
    ]);
  });

  it("does not touch the network for a token that cannot be real", async () => {
    expect(await ledger.redeem("nope")).toEqual({ ok: false, reason: "missing" });
    expect(await ledger.balance(null)).toBe(0);
    expect(await ledger.known(undefined)).toBe(false);
    await ledger.refund("ht_short");
    expect(calls).toHaveLength(0);
  });
});

describe("when the ledger is unreachable", () => {
  it("throws rather than reporting a spend, so the caller can fail closed", async () => {
    reply = () => ({ status: 500, body: { message: "boom" } });
    await expect(ledger.redeem(issueToken())).rejects.toBeInstanceOf(SupabaseLedgerError);
  });

  it("keeps the token hash out of the error it throws", async () => {
    const token = issueToken();
    reply = () => ({ status: 400, body: { message: hashToken(token) } });

    const error = await ledger.redeem(token).catch((caught: Error) => caught);
    expect(String(error)).not.toContain(hashToken(token));
    expect(String(error)).not.toContain(token);
  });

  it("reports an unreachable ledger in describe instead of throwing at startup", async () => {
    reply = () => ({ status: 503, body: {} });
    expect(await ledger.describe()).toContain("unreachable");
  });
});

describe("the free first creation", () => {
  it("mints the token locally and sends only its hash", async () => {
    reply = () => ({ body: { ok: true } });

    const result = await ledger.claimFree("claim-hash");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(looksLikeToken(result.token)).toBe(true);
    const sent = calls[0].body as Record<string, string>;
    expect(sent.p_token_hash).toBe(hashToken(result.token));
    expect(JSON.stringify(sent)).not.toContain(result.token);
  });

  it("hands back nothing when the database says the key already claimed", async () => {
    reply = () => ({ body: { ok: false, reason: "already" } });
    expect(await ledger.claimFree("claim-hash")).toEqual({ ok: false, reason: "already" });
  });

  it("refuses an empty claim key without asking the database", async () => {
    expect(await ledger.claimFree("")).toEqual({ ok: false, reason: "unavailable" });
    expect(calls).toHaveLength(0);
  });
});

describe("grant", () => {
  it("rejects a non-positive amount before it reaches the database", async () => {
    await expect(ledger.grant(issueToken(), 0)).rejects.toThrow(/positive integer/);
    await expect(ledger.grant(issueToken(), 1.5)).rejects.toThrow(/positive integer/);
    expect(calls).toHaveLength(0);
  });

  it("returns the new balance the database reports", async () => {
    reply = () => ({ body: { credits: 7 } });
    expect(await ledger.grant(issueToken(), 3, "stripe")).toBe(7);
    expect((calls[0].body as Record<string, unknown>).p_note).toBe("stripe");
  });
});
