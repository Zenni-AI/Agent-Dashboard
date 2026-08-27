import Anthropic from "@anthropic-ai/sdk";
import type { Brief } from "./brief.js";
import { describeFailure } from "./claude.js";
import type { StreamEvent } from "./types.js";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * The eight chapters, in order. Fixed rather than model-chosen so that every
 * textbook has the same spine — the person can find the numbers in the same
 * place every time, and the reader UI can build a contents list without
 * parsing anything clever.
 */
export const CHAPTERS = [
  "What you're actually building",
  "How it actually works",
  "Who has done this",
  "What you need to know first",
  "The numbers",
  "What kills it",
  "The first weekend",
  "Still open",
] as const;

const SYSTEM = `You write a short, dense, custom textbook for one person about the one thing they are trying to do.

You are given a brief describing where their idea currently stands — what they have decided, what they have rejected, what is still open. That brief is the specification. Write the book they need to move, not a general survey of the topic.

**Compression is the product.** Six to eight pages where every line earns its place, never forty pages of padding. If a sentence would survive being deleted, delete it. You are competing with the person's own attention at midnight, not with a textbook publisher.

**Ground it or leave it out.** Search for real prior art, real numbers, real specifications. Cite what you find inline as [1], [2] and list the sources under a final "Sources" heading with their titles and URLs. Where you cannot verify something, say plainly that it is an estimate, or that you could not confirm it. **Never invent a figure, a supplier, a part number, or a person who built one.** A document looks authoritative in a way a chat message does not — someone may act on this — so a confident wrong number here is worse than an admitted gap.

**Respect their decisions.** What the brief says they ruled out, you do not re-propose. What they have committed to, you build on rather than re-litigate. They already had that argument with themselves; do not restart it.

**Prerequisites are the safety architecture.** "What you need to know first" is not a reading list — it is what someone must understand before they touch this. Order it so each item depends only on the ones above it. Where the work involves anything that can injure someone — pressure, propellants, high voltage, structure under load, speed, chemistry, food safety — the specific hazard and the specific thing that prevents it go in this chapter, named, not softened into a general caution. Do not refuse the topic and do not water it down; the useful thing is telling them exactly what will hurt them and what competent people do about it.

**Never end on a wall.** The last chapter is the open questions — the threads worth pulling next. Leave the door open.

Format:
- Start with "# " and the book's title.
- Then each chapter as "## " with its exact given heading, in the given order.
- Prose in short paragraphs. Tables where numbers are being compared. Bold the load-bearing phrases.
- No preamble before the title. No closing note after the sources.`;

export interface TextbookOptions {
  client: Anthropic;
  model: string;
  brief: Brief;
  signal?: AbortSignal;
}

/**
 * Write the textbook, streaming as it goes.
 *
 * Runs at high effort with search on: this is the one call in the app the user
 * has paid for and is not watching in real time, so depth beats latency. Source
 * events are emitted as the model reads them, which gives the waiting screen
 * something true to show rather than a spinner.
 */
export async function* writeTextbook(options: TextbookOptions): AsyncGenerator<StreamEvent> {
  const { client, model, brief, signal } = options;

  yield { type: "start", mode: "textbook" as never, model };

  const stream = client.beta.messages.stream(
    {
      model,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      system: SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 12 }],
      messages: [{ role: "user", content: renderBrief(brief) }],
    },
    signal ? { signal } : undefined,
  );

  const seen = new Set<string>();

  try {
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "web_search_tool_result") {
        // A success `content` is a list of results; an error is a single object.
        const results = event.content_block.content;
        if (!Array.isArray(results)) continue;
        for (const result of results) {
          if (result.type !== "web_search_result" || seen.has(result.url)) continue;
          seen.add(result.url);
          yield { type: "source", title: result.title, url: result.url };
        }
        continue;
      }

      if (event.type !== "content_block_delta") continue;

      switch (event.delta.type) {
        case "thinking_delta":
          yield { type: "status", text: event.delta.thinking };
          break;
        case "text_delta":
          yield { type: "text", text: event.delta.text };
          break;
        default:
          break;
      }
    }

    const final = await stream.finalMessage();

    if (final.stop_reason === "refusal") {
      yield {
        type: "error",
        message: "This one came back empty. Try narrowing the idea and asking again.",
        retryable: true,
      };
      return;
    }

    yield {
      type: "done",
      stopReason: final.stop_reason,
      outputTokens: final.usage.output_tokens,
    };
  } catch (error) {
    yield { type: "error", ...describeFailure(error) };
  }
}

/** The brief, as the writer reads it. */
export function renderBrief(brief: Brief): string {
  const list = (label: string, items: string[]) =>
    items.length > 0 ? `${label}:\n${items.map((item) => `- ${item}`).join("\n")}` : null;

  return [
    `They are building: ${brief.building}`,
    `They call it: ${brief.title}`,
    list("Decided — build on these, do not re-argue them", brief.goingWith),
    list("Ruled out — do not propose these again", brief.ruledOut),
    list("Still open — these become the last chapter", brief.stillOpen),
    list("They would need to learn", brief.needToLearn),
    list("Search these subjects for prior art and real numbers", brief.searchConcepts),
    "",
    `Write the book. Chapters, in this exact order:\n${CHAPTERS.map((chapter) => `## ${chapter}`).join("\n")}`,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}
