import type { ModeId } from "./modes.js";

/** One completed development of a thought, replayed as context on follow-ups. */
export interface Turn {
  mode: ModeId | string;
  text: string;
}

/** The validated shape of POST /api/develop. */
export interface DevelopRequest {
  thought: string;
  mode: ModeId;
  history: Turn[];
}

/** Events the server streams to the phone, one per SSE frame. */
export type StreamEvent =
  | { type: "start"; mode: ModeId; model: string }
  /** Summarised reasoning, shown as a ghost status line while the model works. */
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "done"; stopReason: string | null; outputTokens: number }
  | { type: "error"; message: string; retryable: boolean };
