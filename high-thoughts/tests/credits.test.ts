import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CreditStore, hashToken, issueToken, looksLikeToken } from "../src/credits.js";

let file: string;
let store: CreditStore;

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "ht-credits-")), "credits.json");
  store = new CreditStore(file);
});

describe("issueToken / looksLikeToken", () => {
  it("issues tokens that validate and never repeat", () => {
    const a = issueToken();
    const b = issueToken();
    expect(looksLikeToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("rejects anything else, so junk never reaches the ledger", () => {
    for (const bad of ["", "ht_", "ht_xyz", "nope", null, undefined, 7, {}, issueToken() + "a"]) {
      expect(looksLikeToken(bad)).toBe(false);
    }
  });
});

describe("redeem", () => {
  it("refuses a request with no token — this is the whole point", async () => {
    expect(await store.redeem(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(await store.redeem("garbage")).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses a well-formed token that was never granted anything", async () => {
    expect(await store.redeem(issueToken())).toEqual({ ok: false, reason: "unknown" });
  });

  it("spends a credit and reports what is left", async () => {
    const token = issueToken();
    await store.grant(token, 2);
    expect(await store.redeem(token)).toEqual({ ok: true, remaining: 1 });
    expect(await store.redeem(token)).toEqual({ ok: true, remaining: 0 });
  });

  it("refuses once the balance is gone", async () => {
    const token = issueToken();
    await store.grant(token, 1);
    await store.redeem(token);
    expect(await store.redeem(token)).toEqual({ ok: false, reason: "empty" });
  });

  it("cannot be double-spent by concurrent requests", async () => {
    const token = issueToken();
    await store.grant(token, 3);

    const results = await Promise.all(Array.from({ length: 10 }, () => store.redeem(token)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(store.balance(token)).toBe(0);
  });

  it("keeps one token's balance away from another's", async () => {
    const mine = issueToken();
    const yours = issueToken();
    await store.grant(mine, 1);
    expect(await store.redeem(yours)).toEqual({ ok: false, reason: "unknown" });
    expect(store.balance(mine)).toBe(1);
  });
});

describe("refund", () => {
  it("gives the credit back when a book fails", async () => {
    const token = issueToken();
    await store.grant(token, 1);
    await store.redeem(token);
    expect(store.balance(token)).toBe(0);

    await store.refund(token);
    expect(store.balance(token)).toBe(1);
  });

  it("ignores a refund for a token it has never seen", async () => {
    await store.refund(issueToken());
    expect(store.accountCount).toBe(0);
  });
});

describe("the ledger file", () => {
  it("never stores a token in the clear", async () => {
    const token = issueToken();
    await store.grant(token, 1, "test grant");

    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain(token);
    expect(raw).toContain(hashToken(token));
  });

  it("survives a restart", async () => {
    const token = issueToken();
    await store.grant(token, 4);
    await store.redeem(token);

    expect(new CreditStore(file).balance(token)).toBe(3);
  });

  it("starts empty rather than permissive when the file is corrupt", () => {
    const corrupt = join(mkdtempSync(join(tmpdir(), "ht-bad-")), "credits.json");
    require("node:fs").writeFileSync(corrupt, "{ not json");
    const recovered = new CreditStore(corrupt);
    expect(recovered.accountCount).toBe(0);
    expect(recovered.balance(issueToken())).toBe(0);
  });
});

describe("grant", () => {
  it("accumulates across grants", async () => {
    const token = issueToken();
    await store.grant(token, 1);
    expect(await store.grant(token, 4)).toBe(5);
  });

  it("refuses a bad token or a nonsense amount", async () => {
    await expect(store.grant("nope", 1)).rejects.toThrow();
    await expect(store.grant(issueToken(), 0)).rejects.toThrow();
    await expect(store.grant(issueToken(), -3)).rejects.toThrow();
    await expect(store.grant(issueToken(), 1.5)).rejects.toThrow();
  });
});

describe("what a leaked ledger is worth to an attacker", () => {
  it("hands over no usable token", async () => {
    const token = issueToken();
    await store.grant(token, 10);

    // Everything an attacker gets from the file on disk.
    const stolen = JSON.parse(readFileSync(file, "utf8"));
    const [hash] = Object.keys(stolen.accounts);

    // The hash is not a token, and cannot be presented as one.
    expect(looksLikeToken(hash)).toBe(false);
    expect(await store.redeem(hash)).toEqual({ ok: false, reason: "missing" });
    expect(await store.redeem(`ht_${hash.slice(0, 48)}`)).toEqual({ ok: false, reason: "unknown" });
  });
});
