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

/**
 * Mark one line of one answer as kept or killed.
 *
 * Marks live on the turn rather than the thought because a line's index only
 * means anything against the answer it came from. Setting a line to the state
 * it already has clears it, which is what makes one tap able to cycle.
 */
export function setMark(id, turnIndex, index, state, text) {
  const thoughts = read();
  const thought = thoughts.find((candidate) => candidate.id === id);
  const turn = thought?.turns?.[turnIndex];
  if (!turn) return null;

  const marks = (turn.marks ?? []).filter((mark) => mark.index !== index);
  if (state) marks.push({ index, state, text });

  turn.marks = marks.sort((a, b) => a.index - b.index);
  write(thoughts);
  return thought;
}

/** Marks for one turn as an index → state map, which is what the renderer wants. */
export function markMap(turn) {
  const map = {};
  for (const mark of turn?.marks ?? []) map[mark.index] = mark.state;
  return map;
}

/** The shape the server reads: a thought plus its answers and marks. */
export function chainFor(thought) {
  return {
    thought: thought.thought,
    turns: (thought.turns ?? []).map((turn) => ({
      mode: turn.mode,
      text: turn.text,
      marks: turn.marks ?? [],
    })),
  };
}

/* ── Textbooks ──────────────────────────────────────────────────────────── */

const BOOKS_KEY = "high-thoughts/books/v1";

function readBooks() {
  try {
    const raw = localStorage.getItem(BOOKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBooks(books) {
  try {
    localStorage.setItem(BOOKS_KEY, JSON.stringify(books.slice(0, 60)));
  } catch {
    // Out of quota. The book is still on screen; it just will not be there
    // tomorrow. Better than losing the screen you are reading.
  }
}

export function listBooks() {
  return readBooks().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function getBook(id) {
  return readBooks().find((book) => book.id === id) ?? null;
}

/** Saved as soon as it starts, so a dropped connection never loses the book. */
export function saveBook(book) {
  const books = readBooks().filter((existing) => existing.id !== book.id);
  writeBooks([book, ...books]);
  return book;
}

export function removeBook(id) {
  writeBooks(readBooks().filter((book) => book.id !== id));
}

/** The turns the server replays as context, trimmed to what it accepts. */
export function historyFor(thought, max = 6) {
  return (thought.turns ?? []).slice(-max).map((turn) => ({ mode: turn.mode, text: turn.text }));
}
