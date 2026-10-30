/**
 * When to offer the library, and — more importantly — when to shut up.
 *
 * The flow is the product. A modal that interrupts someone mid-idea costs more
 * than the book earns, so this only fires when the person has already shown
 * this particular idea matters to them, and it never fires twice for the same
 * thought. Everything here is pure so the rules can be tested without a DOM;
 * the app only ever asks it a yes/no question.
 */

/** Developments of one thought before it counts as "they came back to it". */
const RETURNED = 2;

/** Marked lines before it counts as "they are making decisions about this". */
const DECIDING = 3;

/** Quiet hours after any offer, so one night never brings two. */
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Declines before we stop asking, permanently. */
const ENOUGH = 2;

export const DEFAULT_OFFER_STATE = {
  /** Thought ids already offered — one offer per idea, ever. */
  offered: [],
  dismissed: 0,
  lastOfferAt: 0,
};

/**
 * Has this person shown they care about this specific idea?
 *
 * Two independent tells, either of which is enough: they came back and
 * developed it again, or they started marking lines. Both mean the same thing —
 * this one did not evaporate like the others.
 */
export function isInvested(thought) {
  const turns = thought?.turns ?? [];
  if (turns.length >= RETURNED) return true;

  const marks = turns.reduce((total, turn) => total + (turn.marks?.length ?? 0), 0);
  return marks >= DECIDING;
}

/**
 * Whether to interrupt with the library offer.
 *
 * Deliberately conservative. A "no" here costs one deferred sale; a "yes" at
 * the wrong moment costs the session, and the session is where the value is.
 */
export function shouldOffer(thought, state = DEFAULT_OFFER_STATE, now = Date.now()) {
  if (!thought?.id) return false;

  // They already bought a book for this one — nothing left to sell here.
  if (thought.hasBook) return false;

  // One ask per idea, forever.
  if (state.offered?.includes(thought.id)) return false;

  // Told us no twice. Stop asking; the quiet button on the result screen stays.
  if ((state.dismissed ?? 0) >= ENOUGH) return false;

  if (now - (state.lastOfferAt ?? 0) < COOLDOWN_MS) return false;

  return isInvested(thought);
}

/** The state after an offer is shown. */
export function recordOffer(state, thoughtId, now = Date.now()) {
  return {
    ...state,
    offered: [...(state.offered ?? []), thoughtId].slice(-200),
    lastOfferAt: now,
  };
}

/** The state after the person says no. Accepting is not counted as a decline. */
export function recordDismissal(state) {
  return { ...state, dismissed: (state.dismissed ?? 0) + 1 };
}

/**
 * The line that opens the modal, naming why we are asking now.
 *
 * Specific beats generic: a modal that says "you have come back to Reverse
 * Tuesday three times" gets read, and one that says "unlock premium" gets
 * dismissed without being seen.
 */
export function offerReason(thought) {
  const turns = thought?.turns ?? [];
  const marks = turns.reduce((total, turn) => total + (turn.marks?.length ?? 0), 0);
  const name = thought?.title || "this one";

  if (turns.length >= 3) return `${turns.length} passes at ${name}. That's the tell.`;
  if (turns.length >= RETURNED) return `You came back to ${name}.`;
  return `${marks} decisions on ${name} already.`;
}
