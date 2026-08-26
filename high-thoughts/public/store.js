/**
 * Every thought lives in this browser and nowhere else.
 *
 * That is a product decision as much as a technical one: these are people's
 * half-formed ideas, and an app that quietly kept a copy of them on a server
 * is a different, worse app. The server sees a thought only for as long as it
 * takes to answer it, and never writes it down.
 */

const KEY = "high-thoughts/v1";
const LIMIT = 300;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isThought) : [];
  } catch {
    // Private mode, a full quota, or a hand-edited entry. An empty log is a
    // survivable outcome; a page that will not open is not.
    return [];
  }
}

function isThought(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.id === "string" &&
    typeof value.thought === "string"
  );
}

function write(thoughts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(thoughts.slice(0, LIMIT)));
    return true;
  } catch {
    return false;
  }
}

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Newest first — the log is read from the top. */
export function list() {
  return read().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function get(id) {
  return read().find((thought) => thought.id === id) ?? null;
}

/**
 * A thought is saved the moment it is captured, before the model is called,
 * so that a dropped connection loses the answer but never the idea. Its
 * `turns` array is empty until a development completes.
 */
export function capture(text) {
  const thought = {
    id: newId(),
    thought: text,
    title: "",
    createdAt: Date.now(),
    turns: [],
  };
  write([thought, ...read()]);
  return thought;
}

export function addTurn(id, turn) {
  const thoughts = read();
  const thought = thoughts.find((candidate) => candidate.id === id);
  if (!thought) return null;

  thought.turns = [...(thought.turns ?? []), turn];
  if (!thought.title && turn.title) thought.title = turn.title;

  write(thoughts);
  return thought;
}

export function remove(id) {
  write(read().filter((thought) => thought.id !== id));
}

/** The turns the server replays as context, trimmed to what it accepts. */
export function historyFor(thought, max = 6) {
  return (thought.turns ?? []).slice(-max).map((turn) => ({ mode: turn.mode, text: turn.text }));
}
