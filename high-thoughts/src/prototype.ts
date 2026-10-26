import Anthropic from "@anthropic-ai/sdk";
import { describeFailure } from "./claude.js";
import type { InterviewTurn } from "./interview.js";
import type { StreamEvent } from "./types.js";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * The thing you actually get: your idea, built, on a page that moves.
 *
 * One self-contained HTML file, whatever the idea was. Software becomes
 * something you can click. A physical object becomes a simulation that obeys
 * numbers. A look becomes a thing to look at. Same pipeline, because the
 * difference between them is what the page contains, not what it is.
 *
 * The hard rule running through the prompt is that this must not come out
 * looking like an engineering drawing. A technical diagram is a correct
 * answer to the wrong question — nobody shows their friend a schematic.
 */
const SYSTEM = `You build the prototype. Someone told you an idea, you asked how it works, and now you make the thing.

You output **one complete, self-contained HTML document** and nothing else. No explanation before it, no notes after it. Start at \`<!doctype html>\`.

## What it has to be

**It has to move.** A still picture is a failure. Something animates on load, something responds to a tap or a drag. If the idea is physical, the mechanism runs. If it is software, the buttons work. If it is a look, it reacts to the pointer.

**It has to be fun to look at.** This is the whole brief. Think of the drawing someone does on a napkin to explain their stupid idea at 1am — loose, confident, labelled in their own words, slightly wrong in a way that makes it clearer. Chunky shapes, bold colour, a bit of wobble.

Do NOT produce a technical drawing. No dimension lines, no leader arrows with measurements, no grey engineering schematic, no grid paper, no exploded assembly view, no graph where a picture would do. Nobody shows their friend a schematic. If it looks like a CAD export or a physics textbook figure, you have built the wrong thing.

**It has to be theirs.** Label the parts with the words THEY used. If they said "a whole bunch of Coke bottles", the label on screen says A WHOLE BUNCH OF COKE BOTTLES. Never translate their words into engineering vocabulary.

**The numbers are the punchline, not the spec.** Where real physics or real money applies, work it out properly and put the result on screen as one brutal, funny line — "you are 34,800 bottles short", "this costs £1.2M in Mentos". Never a table of specifications. Where you had to guess a number, say so in the same breath, lightly.

**It has to work on a phone**, held in one hand, and it has to work offline: everything inline, no external scripts, fonts or images. SVG and canvas for the drawing. If something is impossible to draw well, draw the funniest honest approximation and label it as such.

## Shape of the page

- Big title: their idea, named.
- One line under it saying what you're looking at.
- The prototype itself, taking most of the screen.
- Controls where they help — a slider, a button that fires the thing, a toggle. Label them in plain words ("MORE MENTOS"), not ("mentos_count").
- At the bottom, in small text: the one or two things you had to assume.

Dark background, bright ink, high contrast. It will be read in the dark.

Never apologise for the idea, never evaluate whether it is a good idea, never add a disclaimer about feasibility. You were asked to build it. Build it.`;

export interface PrototypeOptions {
  client: Anthropic;
  model: string;
  thought: string;
  answers: InterviewTurn[];
  kind: "app" | "design" | "simulation";
  signal?: AbortSignal;
}

/** Stream the prototype's HTML, tag first, as the model writes it. */
export async function* streamPrototype(options: PrototypeOptions): AsyncGenerator<StreamEvent> {
  const { client, model, thought, answers, kind, signal } = options;

  yield { type: "start", mode: "prototype" as never, model };

  const stream = client.beta.messages.stream(
    {
      model,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      system: SYSTEM,
      messages: [{ role: "user", content: renderOrder(thought, answers, kind) }],
    },
    signal ? { signal } : undefined,
  );

  try {
    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "thinking_delta") {
        yield { type: "status", text: event.delta.thinking };
      } else if (event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      yield { type: "error", message: "That one wouldn't build. Try describing it differently.", retryable: true };
      return;
    }

    console.log(`prototype done: ${final.usage.input_tokens} in, ${final.usage.output_tokens} out`);

    yield {
      type: "done",
      stopReason: final.stop_reason,
      outputTokens: final.usage.output_tokens,
      inputTokens: final.usage.input_tokens,
      cachedTokens: final.usage.cache_read_input_tokens ?? 0,
    };
  } catch (error) {
    yield { type: "error", ...describeFailure(error) };
  }
}

const KIND_NOTE: Record<PrototypeOptions["kind"], string> = {
  app: "This is software. The prototype is a working version of it — the buttons do what they say, with made-up data where it needs data.",
  design: "This is something to look at. The prototype is the thing itself, rendered, reacting to touch.",
  simulation: "This is a physical thing. The prototype is a simulation that actually runs the mechanism and obeys real numbers — and tells them the truth about those numbers, as a joke rather than a lecture.",
};

export function renderOrder(thought: string, answers: InterviewTurn[], kind: PrototypeOptions["kind"]): string {
  const transcript = answers
    .map((turn) => `  You asked: ${turn.question}\n  They said: ${turn.answer}`)
    .join("\n\n");

  return [
    `The idea, exactly as they typed it:\n\n${thought}`,
    answers.length > 0 ? `How it works, in their words:\n\n${transcript}` : null,
    KIND_NOTE[kind],
    "Build it. Output the HTML document and nothing else.",
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n---\n\n");
}
