// @ts-nocheck — the client is plain ES modules, shipped to the browser unbuilt.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFER_STATE,
  isInvested,
  offerReason,
  recordDismissal,
  recordOffer,
  shouldOffer,
} from "../public/offer.js";

const turn = (marks = 0) => ({
  mode: "riff",
  text: "answer",
  marks: Array.from({ length: marks }, (_, index) => ({ index, state: "keep", text: "x" })),
});

const thought = (overrides = {}) => ({ id: "t1", title: "Reverse Tuesday", turns: [turn()], ...overrides });

describe("isInvested", () => {
  it("counts coming back and developing it again", () => {
    expect(isInvested(thought({ turns: [turn(), turn()] }))).toBe(true);
  });

  it("counts marking lines, even on a single pass", () => {
    expect(isInvested(thought({ turns: [turn(3)] }))).toBe(true);
  });

  it("is not satisfied by one pass with a stray mark", () => {
    expect(isInvested(thought({ turns: [turn(1)] }))).toBe(false);
    expect(isInvested(thought())).toBe(false);
  });

  it("survives a thought with no turns at all", () => {
    expect(isInvested({ id: "t1" })).toBe(false);
    expect(isInvested(null)).toBe(false);
  });
});

describe("shouldOffer", () => {
  const invested = thought({ turns: [turn(), turn()] });

  it("offers once the person is invested", () => {
    expect(shouldOffer(invested, DEFAULT_OFFER_STATE)).toBe(true);
  });

  it("never offers on a first answer — the flow is the product", () => {
    expect(shouldOffer(thought(), DEFAULT_OFFER_STATE)).toBe(false);
  });

  it("never asks twice about the same idea", () => {
    const after = recordOffer(DEFAULT_OFFER_STATE, "t1");
    expect(shouldOffer(invested, after)).toBe(false);
  });

  it("stops asking entirely after two declines", () => {
    let state = { ...DEFAULT_OFFER_STATE, lastOfferAt: 0 };
    state = recordDismissal(recordDismissal(state));
    expect(shouldOffer({ ...invested, id: "fresh" }, state)).toBe(false);
  });

  it("still offers after a single decline, on a different idea", () => {
    const state = recordDismissal(DEFAULT_OFFER_STATE);
    expect(shouldOffer({ ...invested, id: "other" }, state)).toBe(true);
  });

  it("holds off during the cooldown so one night never brings two", () => {
    const now = 1_000_000_000;
    const state = recordOffer(DEFAULT_OFFER_STATE, "t1", now);
    expect(shouldOffer({ ...invested, id: "t2" }, state, now + 60_000)).toBe(false);
    expect(shouldOffer({ ...invested, id: "t2" }, state, now + 7 * 60 * 60 * 1000)).toBe(true);
  });

  it("does not sell a book to someone who already bought one for this idea", () => {
    expect(shouldOffer({ ...invested, hasBook: true }, DEFAULT_OFFER_STATE)).toBe(false);
  });

  it("ignores a thought with no id", () => {
    expect(shouldOffer({ turns: [turn(), turn()] }, DEFAULT_OFFER_STATE)).toBe(false);
  });
});

describe("recordOffer", () => {
  it("does not grow without bound", () => {
    let state = DEFAULT_OFFER_STATE;
    for (let i = 0; i < 260; i += 1) state = recordOffer(state, `t${i}`, i);
    expect(state.offered).toHaveLength(200);
    expect(state.offered.at(-1)).toBe("t259");
  });

  it("accepting is not a decline", () => {
    expect(recordOffer(DEFAULT_OFFER_STATE, "t1").dismissed).toBe(0);
  });
});

describe("offerReason", () => {
  it("names the idea and why we are asking now", () => {
    expect(offerReason(thought({ turns: [turn(), turn(), turn()] }))).toBe(
      "3 passes at Reverse Tuesday. That's the tell.",
    );
    expect(offerReason(thought({ turns: [turn(), turn()] }))).toBe("You came back to Reverse Tuesday.");
    expect(offerReason(thought({ turns: [turn(4)] }))).toBe("4 decisions on Reverse Tuesday already.");
  });

  it("falls back gracefully when the idea has no name yet", () => {
    expect(offerReason({ id: "t1", turns: [turn(3)] })).toMatch(/this one/);
  });
});
