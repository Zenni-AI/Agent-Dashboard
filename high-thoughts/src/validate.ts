import { isModeId, MODES } from "./modes.js";
import type { DevelopRequest, Turn } from "./types.js";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface ValidateOptions {
  maxThoughtChars: number;
  maxHistoryTurns: number;
}

/**
 * Turn an untrusted JSON body into a request we are willing to bill for.
 *
 * Everything the phone sends is untrusted, including the history — it lives in
 * the browser's own storage, so a stale or hand-edited entry is expected, not
 * exceptional. Unknown modes fall back to riff rather than failing, but an
 * empty or oversized thought is rejected outright: both mean the request would
 * cost money and return nothing worth reading.
 */
export function validateDevelopRequest(body: unknown, options: ValidateOptions): DevelopRequest {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Expected a JSON object.");
  }

  const raw = body as Record<string, unknown>;

  if (typeof raw.thought !== "string") {
    throw new ValidationError("A thought is required.");
  }

  const thought = raw.thought.trim();
  if (thought.length === 0) {
    throw new ValidationError("The thought is empty.");
  }
  if (thought.length > options.maxThoughtChars) {
    throw new ValidationError(
      `That is ${thought.length} characters. Keep it under ${options.maxThoughtChars}.`,
    );
  }

  const mode = isModeId(raw.mode) ? raw.mode : MODES.riff.id;

  return { thought, mode, history: normaliseHistory(raw.history, options.maxHistoryTurns) };
}

function normaliseHistory(value: unknown, max: number): Turn[] {
  if (!Array.isArray(value)) return [];

  const turns: Turn[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.text !== "string") continue;

    const text = candidate.text.trim();
    if (text.length === 0) continue;

    turns.push({
      mode: isModeId(candidate.mode) ? candidate.mode : MODES.riff.id,
      text,
    });
  }

  // Keep the most recent turns — the oldest are the ones already superseded.
  return turns.slice(-max);
}
