import { BriefSchema, type Brief } from "./brief.js";
import { isModeId, MODES } from "./modes.js";
import type { DevelopRequest, MarkedLine, ThoughtChain, Turn } from "./types.js";

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

export interface ChainOptions {
  maxThoughtChars: number;
  maxHistoryTurns: number;
  /** Thoughts a single textbook may be built from. */
  maxChains: number;
}

/**
 * Validate the chains a brief is being requested for.
 *
 * The phone sends its own localStorage back to us, so this sees everything an
 * older build wrote, a hand-edited entry, and the occasional 40-thought
 * selection. Undeveloped chains are dropped rather than rejected: there is
 * nothing to read in a thought that never got an answer.
 */
export function validateChainsRequest(body: unknown, options: ChainOptions): ThoughtChain[] {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Expected a JSON object.");
  }

  const raw = (body as Record<string, unknown>).chains;
  if (!Array.isArray(raw)) throw new ValidationError("No thoughts selected.");

  const chains: ThoughtChain[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.thought !== "string") continue;

    const thought = candidate.thought.trim().slice(0, options.maxThoughtChars);
    if (thought.length === 0) continue;

    const turns = normaliseTurns(candidate.turns, options.maxHistoryTurns);
    if (turns.length === 0) continue;

    chains.push({ thought, turns });
    if (chains.length >= options.maxChains) break;
  }

  if (chains.length === 0) {
    throw new ValidationError("Nothing to read yet — develop a thought first.");
  }

  return chains;
}

function normaliseTurns(value: unknown, max: number): Turn[] {
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
      marks: normaliseMarks(candidate.marks),
    });
  }

  return turns.slice(-max);
}

function normaliseMarks(value: unknown): MarkedLine[] {
  if (!Array.isArray(value)) return [];

  const marks: MarkedLine[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    if (candidate.state !== "keep" && candidate.state !== "kill") continue;
    if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) continue;

    marks.push({
      index: Number.isInteger(candidate.index) ? (candidate.index as number) : marks.length,
      state: candidate.state,
      text: candidate.text.trim().slice(0, 600),
    });
  }

  return marks;
}

/** The brief the phone hands back when the person confirms it. */
export function validateBrief(body: unknown): Brief {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Expected a JSON object.");
  }

  const parsed = BriefSchema.safeParse((body as Record<string, unknown>).brief);
  if (!parsed.success) throw new ValidationError("That brief is not one we produced.");

  return parsed.data;
}
