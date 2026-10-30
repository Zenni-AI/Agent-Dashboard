/**
 * The four things a half-formed idea can want from you.
 *
 * A thought arriving at 2am does not want the same treatment every time.
 * Sometimes it wants fuel, sometimes it wants a plan, sometimes it wants
 * someone honest, sometimes it wants to be followed all the way down. The
 * mode is the only dial in the app, and it is the whole product.
 */
export const MODE_IDS = ["riff", "build", "sober", "deep"] as const;

export type ModeId = (typeof MODE_IDS)[number];

export interface Mode {
  id: ModeId;
  /** Shown on the button. */
  label: string;
  /** One line under the button, in the user's language, not the model's. */
  blurb: string;
  /**
   * Reasoning effort for this mode. Riffing wants speed — the value is in
   * the associative leap, which does not get better with deliberation.
   * Sober and deep want the model to actually stop and think.
   */
  effort: "low" | "medium" | "high";
  /** The section headings the model must emit, in order. */
  sections: string[];
  /** Mode-specific half of the system prompt. */
  instruction: string;
}

export const MODES: Record<ModeId, Mode> = {
  riff: {
    id: "riff",
    label: "Riff",
    blurb: "Run with it. Further, weirder, sharper.",
    effort: "low",
    sections: ["The idea", "Take it further", "The weird one", "Keep this bit"],
    instruction: `The thought wants fuel, not judgement. Take it seriously and take it further.

Under "The idea": say back what they actually landed on, in one or two lines, sharper than they said it. This is the version they wish they had typed.

Under "Take it further": three escalations, each on its own line, each one bigger or stranger than the last. Number them. Every one must be a real extension of their idea, not a different idea wearing its clothes.

Under "The weird one": the version that would make someone laugh and then go quiet. Commit to it. Do not hedge it with "of course, this would never work".

Under "Keep this bit": the single sentence worth remembering tomorrow when the rest has evaporated.`,
  },

  build: {
    id: "build",
    label: "Build",
    blurb: "What it'd actually take. First move included.",
    effort: "medium",
    sections: ["What it is", "How it works", "The first move", "What kills it"],
    instruction: `The thought wants to become a thing that exists. Be concrete or be quiet.

Under "What it is": one sentence a stranger would understand, then who it is for.

Under "How it works": the actual mechanism. Name the real parts — the tools, the platforms, the physical objects, the money. If it needs a supplier, say what kind. If it needs software, say what it is built on. No "leverage", no "platform", no "solution".

Under "The first move": one thing they could do in a single sitting, starting from a phone. Not "do research". Something with an end state you could point at — a message sent, a page bought, a jig cut, a list of ten names. Say how long it takes.

Under "What kills it": the specific failure that is most likely, and the cheapest test that would reveal it before they spend real money.`,
  },

  sober: {
    id: "sober",
    label: "Sober",
    blurb: "The honest read. Bring it back here tomorrow.",
    effort: "high",
    sections: ["What you said", "Does this exist", "The honest read", "Verdict"],
    instruction: `The thought wants a straight answer. Give it the read a friend gives, not the one a pitch deck gives.

Under "What you said": the idea in plain words, stripped of the energy it was delivered with. Neutral. This is the test — if it still sounds good flat, it might be good.

Under "Does this exist": say whether something like this already exists and name it if it does. Existing is not fatal; say what the gap is, or say plainly that the space is full. If you genuinely do not know, say you do not know rather than inventing a competitor.

Under "The honest read": what is actually good here, and what is actually wrong. Both. The good part first and only if it is real. Do not soften the wrong part.

Under "Verdict": open with exactly one of these three, on its own line — **Worth it.** / **Worth a night.** / **Let it go.** Then one sentence of why. "Worth a night" means it is fun and finite and will not become a business. Choose. Do not decline to choose.`,
  },

  deep: {
    id: "deep",
    label: "Deep",
    blurb: "Follow it down. See where it lands.",
    effort: "high",
    sections: [
      "The thought under the thought",
      "Follow it down",
      "Where it lands",
      "The uncomfortable part",
    ],
    instruction: `The thought is not really about what it says it is about. Find out what it is about.

Under "The thought under the thought": the actual question they are circling. Say it once, cleanly. Do not psychoanalyse the person — read the idea.

Under "Follow it down": take it three or four steps past where they stopped. Each step should follow from the last so they can feel the floor giving way. Real reasoning, not a list of adjacent topics.

Under "Where it lands": the position you end up at, stated as a claim someone could disagree with. Take a side.

Under "The uncomfortable part": the consequence of that position that is genuinely hard to sit with. Do not resolve it. Leave it open.`,
  },
};

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && (MODE_IDS as readonly string[]).includes(value);
}

export function resolveMode(value: unknown): Mode {
  return isModeId(value) ? MODES[value] : MODES.riff;
}

/** The mode list the client renders. The instructions stay on the server. */
export function publicModes(): Array<Pick<Mode, "id" | "label" | "blurb">> {
  return MODE_IDS.map((id) => {
    const mode = MODES[id];
    return { id: mode.id, label: mode.label, blurb: mode.blurb };
  });
}
