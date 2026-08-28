import Anthropic from "@anthropic-ai/sdk";
import type { Mode } from "./modes.js";
import { buildDevelopPrompt } from "./prompts.js";
import type { Profile, StreamEvent, Turn } from "./types.js";

/**
 * Server-side refusal fallback. If a safety classifier declines the request,
 * the API re-runs it on a fallback model inside the same call instead of
 * handing the user a dead end. Someone standing outside at 1am with a half
 * thought does not get a second attempt — they put the phone away.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface DevelopOptions {
  client: Anthropic;
  model: string;
  thought: string;
  mode: Mode;
  history: Turn[];
  profile?: Profile | null;
  signal?: AbortSignal;
}

/**
 * Stream one development of one thought.
 *
 * Yields events rather than writing to the response so the transport stays in
 * server.ts and the whole path is testable without a socket. Thinking is
 * summarised rather than omitted: on a phone the alternative is a blank screen
 * for several seconds, and a ghost line saying what the model is chasing is
 * the difference between "working" and "broken".
 */
export async function* developThought(options: DevelopOptions): AsyncGenerator<StreamEvent> {
  const { client, model, thought, mode, history, profile, signal } = options;
  const { system, messages } = buildDevelopPrompt({ thought, mode, history, profile });

  yield { type: "start", mode: mode.id, model };

  const stream = client.beta.messages.stream(
    {
      model,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: mode.effort },
      system,
      messages,
    },
    signal ? { signal } : undefined,
  );

  try {
    for await (const event of stream) {
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
        message:
          "That one came back blank. Try saying it a different way, or start it somewhere else.",
        retryable: true,
      };
      return;
    }

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

/**
 * Say what went wrong in the user's terms, not the API's.
 *
 * `retryable` drives whether the phone offers the button again straight away
 * or tells them to wait, so it tracks whether trying again in five seconds
 * could plausibly work — not whether the error was the user's fault.
 */
/**
 * The API's own explanation, scrubbed.
 *
 * Never let anything key-shaped through: this string is sent to the phone, and
 * an upstream error that quoted a credential would put it on screen.
 */
function apiMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  const detail = body?.error?.message;
  const text = typeof detail === "string" && detail.length > 0 ? detail : error.message;
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300);
}

export function describeFailure(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof Anthropic.APIUserAbortError) {
    return { message: "Stopped.", retryable: true };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return { message: "The server's API key was rejected.", retryable: false };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { message: "The server's API key is not allowed to use this model.", retryable: false };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { message: "Too many thoughts at once. Give it a few seconds.", retryable: true };
  }
  if (error instanceof Anthropic.BadRequestError) {
    // A 400 is nearly always a configuration problem the operator can fix —
    // a missing workspace id, an unavailable model — and hiding it behind a
    // generic sentence turns a two-minute fix into an afternoon.
    return { message: `The API rejected that: ${apiMessage(error)}`, retryable: false };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { message: "Could not reach the model. Check your signal.", retryable: true };
  }
  if (error instanceof Anthropic.APIError) {
    return {
      message: "The model is having a moment. Try again.",
      retryable: error.status === undefined || error.status >= 500,
    };
  }
  return { message: "Something broke on the way back. Try again.", retryable: true };
}
