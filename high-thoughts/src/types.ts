import type { ModeId } from "./modes.js";

/**
 * A line the person marked by hand while reading an answer.
 *
 * This is the highest-signal thing in the whole log. Everything else the log
 * reader does is inference from prose; a mark is the person saying outright
 * "this one" or "not this one".
 */
export interface MarkedLine {
  /** Index of the paragraph or list item within the rendered answer. */
  index: number;
  state: "keep" | "kill";
  /** The line's text, sent so the server never has to re-render to know it. */
  text: string;
}

/** One completed development of a thought, replayed as context on follow-ups. */
export interface Turn {
  mode: ModeId | string;
  text: string;
  marks?: MarkedLine[];
}

/** One thought and everything that has happened to it. */
export interface ThoughtChain {
  thought: string;
  turns: Turn[];
}

/**
 * What the app has worked out about this person, derived on their phone from
 * their own log and sent with each request. The server never stores it.
 */
export interface Profile {
  thoughtCount: number;
  subjects: string[];
  returning: Array<{ title: string; passes: number }>;
  keeps: string[];
  kills: string[];
  favouriteMode: string | null;
  books: string[];
}

/** The validated shape of POST /api/develop. */
export interface DevelopRequest {
  thought: string;
  mode: ModeId;
  history: Turn[];
  profile: Profile | null;
}

/** Events the server streams to the phone, one per SSE frame. */
export type StreamEvent =
  | { type: "start"; mode: ModeId; model: string }
  /** Summarised reasoning, shown as a ghost status line while the model works. */
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  /** A source the textbook writer consulted, surfaced as it is read. */
  | { type: "source"; title: string; url: string }
  | {
      type: "done";
      stopReason: string | null;
      outputTokens: number;
      inputTokens: number;
      cachedTokens: number;
    }
  | { type: "error"; message: string; retryable: boolean };
