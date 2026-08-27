import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODES } from "./modes.js";
import type { MarkedLine, ThoughtChain } from "./types.js";

/**
 * The brief: what the log agent hands the textbook agent.
 *
 * Structured rather than prose because it is machine-consumed twice — once to
 * render the confirmation screen, once as the spine of the textbook — and
 * because the confirmation screen needs the decisions as separate lists it can
 * lay out, not a paragraph it has to parse back apart.
 */
export const BriefSchema = z.object({
  title: z
    .string()
    .describe("Four words or fewer naming the idea. A name, not a description. No quotes."),
  building: z
    .string()
    .describe("One sentence a stranger would understand: what this person is actually making."),
  goingWith: z
    .array(z.string())
    .describe(
      "Decisions they have landed on, each a short phrase. Only what the log supports — a line they kept, or a direction they returned to and built on. Empty if they have not decided anything yet.",
    ),
  ruledOut: z
    .array(z.string())
    .describe(
      "Directions they have rejected. A killed line is a rejection. So is a direction that was raised and then abandoned for something else. Empty if nothing was ruled out.",
    ),
  stillOpen: z
    .array(z.string())
    .describe("Questions the log raises and never settles. These become the book's open threads."),
  needToLearn: z
    .array(z.string())
    .describe(
      "Skills or bodies of knowledge this person would need before they could do this, ordered so each one depends only on the ones before it. Name the actual subject, not 'research X'.",
    ),
  searchConcepts: z
    .array(z.string())
    .describe(
      "Two to five searchable subject terms for finding real prior art and reference material. The underlying subject, not their phrasing — 'pulsejet engine design', not 'rocket car thing'.",
    ),
  looksLikeSeveral: z
    .boolean()
    .describe("True only if the selected thoughts are genuinely unrelated ideas, not one idea."),
  separateIdeas: z
    .array(z.string())
    .describe("If looksLikeSeveral, name each distinct idea. Otherwise empty."),
});

export type Brief = z.infer<typeof BriefSchema>;

const SYSTEM = `You read a person's thinking log and work out where the idea actually stands right now.

You are not writing anything for them to read as prose. You are producing the working summary that a second writer will build a custom textbook from, and a confirmation screen they will check before paying for it. Both jobs need the same thing: an accurate picture of the idea in its CURRENT form.

The log is chronological. That is the whole difficulty:

- **People contradict themselves.** They say one thing early and the opposite later. The later one wins. Never list both sides of a reversal as though both are live.
- **Enthusiasm is not a decision.** The model riffing about something, or the person pulling a thread once, is not a commitment. A decision is something they kept, returned to, or built further work on top of.
- **A killed line is a real rejection.** Where lines are marked kept or killed, those marks are the strongest signal in the log and they override anything you infer from the prose. Kept means they want it. Killed means they do not.
- **Never invent a decision.** If they have not settled something, it belongs in what is still open. An empty decision list is a correct and useful answer. Putting words in their mouth is the one failure that makes the confirmation screen useless, because they will read it and know you were guessing.

Write every field in their register, not in business language. "Salt flats, not a track" — not "venue selection finalised".`;

export interface BriefOptions {
  client: Anthropic;
  model: string;
  chains: ThoughtChain[];
  signal?: AbortSignal;
}

/**
 * Read one or more thought chains and return where the idea stands.
 *
 * Deliberately not streamed and deliberately cheap: this runs before the user
 * has committed to anything, its output is a handful of short lists, and the
 * value is in reading carefully rather than at length.
 */
export async function readTheLog(options: BriefOptions): Promise<Brief> {
  const { client, model, chains, signal } = options;

  const response = await client.messages.parse(
    {
      model,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: zodOutputFormat(BriefSchema),
      },
      system: SYSTEM,
      messages: [{ role: "user", content: renderChains(chains) }],
    },
    signal ? { signal } : undefined,
  );

  const brief = response.parsed_output;
  if (!brief) {
    throw new Error("The log could not be read.");
  }
  return brief;
}

/**
 * Flatten the log into something readable in one pass.
 *
 * Marked lines are pulled out and restated under each turn rather than left
 * inline, because the mark is the highest-signal thing in the log and burying
 * it mid-paragraph is how it gets missed.
 */
export function renderChains(chains: ThoughtChain[]): string {
  const parts: string[] = [];

  chains.forEach((chain, index) => {
    if (chains.length > 1) parts.push(`===== THOUGHT ${index + 1} OF ${chains.length} =====`);
    parts.push(`The original thought, as they typed it:\n${chain.thought}`);

    chain.turns.forEach((turn, turnIndex) => {
      const label = MODES[turn.mode as keyof typeof MODES]?.label ?? turn.mode;
      parts.push(`--- Pass ${turnIndex + 1} (${label}) ---\n${turn.text}`);

      const marks = turn.marks ?? [];
      if (marks.length > 0) parts.push(renderMarks(marks));
    });
  });

  parts.push(
    "Where does this idea stand right now? Later passes override earlier ones. Marked lines override everything.",
  );

  return parts.join("\n\n");
}

function renderMarks(marks: MarkedLine[]): string {
  const kept = marks.filter((mark) => mark.state === "keep").map((mark) => `  KEPT: ${mark.text}`);
  const killed = marks
    .filter((mark) => mark.state === "kill")
    .map((mark) => `  KILLED: ${mark.text}`);

  return ["They marked these lines by hand:", ...kept, ...killed].join("\n");
}
