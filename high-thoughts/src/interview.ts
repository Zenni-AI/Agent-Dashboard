import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * The part where it asks you how it flies.
 *
 * A thought arrives as a wish — "a flying car" — and a wish cannot be built.
 * What makes it buildable is the mechanism, and the person already has one in
 * their head, however stupid. They just did not say it, because nobody asked.
 *
 * So this asks. One question at a time, always about how the thing actually
 * works, never about markets or customers or whether it is a good idea. The
 * answer "a load of Coke bottles with Mentos dropped in" is a complete and
 * sufficient answer, and the prototype that follows should take it seriously.
 */
export const QuestionSchema = z.object({
  ready: z
    .boolean()
    .describe("True once you could build something specific and surprising. Rarely before two answers; never ask more than four questions total."),
  question: z
    .string()
    .describe(
      "The single sharpest unknown, as one short spoken question. Always about how the thing works, looks or behaves — never about markets, customers, money or whether it is a good idea. Empty when ready.",
    ),
  placeholder: z
    .string()
    .describe(
      "A ghost-text example answer, in their register, deliberately a bit stupid. This is how they learn the answer does not have to be clever. Empty when ready.",
    ),
  understanding: z
    .string()
    .describe("One line naming what you now think the thing is. Updates with every answer."),
  buildKind: z
    .enum(["app", "design", "simulation"])
    .describe(
      "What a prototype of this would be. app: software you could use. design: something to look at. simulation: a physical thing that has to move and obey numbers.",
    ),
});

export type Question = z.infer<typeof QuestionSchema>;

const SYSTEM = `Someone has had an idea and you are about to build them a working prototype of it. First you need to know how it works.

Ask one question at a time. The question is always about **mechanism, appearance or behaviour** — how does it fly, what happens when you press it, what does it look like when it's working, how big is it, what's it made of. Never ask about markets, customers, money, feasibility, or whether the idea is good. You are not evaluating it. You are building it.

Rules:
- **Take the stupid answer seriously.** "Coke bottles with Mentos in them" is a propulsion system. Your next question is how many bottles, or what holds them on — not whether that would work.
- **Never ask two things at once.** One question, one answer.
- **Ask the question whose answer most changes what you'd build.** If you don't know whether the thing is the size of a phone or a building, ask that before asking what colour it is.
- **The placeholder sets the tone.** Write it the way a person half-asleep would type, and let it be daft. It tells them a daft answer is allowed.
- **Stop early.** Two answers is usually enough to build something specific. Four is the hard ceiling. A prototype built from an unanswered question is still a prototype — you fill the gap with the funniest reasonable guess and say so.
- Be delighted, not polite. No "great question", no praise for the idea.

A question is one line. No preamble.`;

export interface InterviewTurn {
  question: string;
  answer: string;
}

export interface InterviewOptions {
  client: Anthropic;
  model: string;
  thought: string;
  answers: InterviewTurn[];
  signal?: AbortSignal;
}

/** Ask the next question, or declare the idea buildable. */
export async function nextQuestion(options: InterviewOptions): Promise<Question> {
  const { client, model, thought, answers, signal } = options;

  const transcript = answers
    .map((turn) => `You asked: ${turn.question}\nThey said: ${turn.answer}`)
    .join("\n\n");

  const response = await client.messages.parse(
    {
      model,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(QuestionSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `The idea, as they typed it:\n\n${thought}${
            transcript ? `\n\n---\n\n${transcript}` : ""
          }`,
        },
      ],
    },
    signal ? { signal } : undefined,
  );

  const question = response.parsed_output;
  if (!question) throw new Error("No question came back.");

  // Four is the ceiling, and the model is told so — but the ceiling has to
  // hold even when it forgets, or the person never gets their prototype.
  if (answers.length >= 4) return { ...question, ready: true, question: "", placeholder: "" };

  return question;
}
