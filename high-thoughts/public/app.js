import { extractSnippet, extractTitle, renderMarkdown } from "./markdown.js";
import {
  DEFAULT_OFFER_STATE,
  offerReason,
  recordDismissal,
  recordOffer,
  shouldOffer,
} from "./offer.js";
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);

const el = {
  form: $("catch-form"),
  thought: $("thought"),
  counter: $("counter"),
  mic: $("mic"),
  modes: $("modes"),
  go: $("go"),
  hint: $("hint"),
  screens: document.querySelectorAll(".screen"),
  tabs: $("tabs"),
  resultMode: $("result-mode"),
  resultOriginal: $("result-original"),
  resultBack: $("result-back"),
  resultDelete: $("result-delete"),
  ghost: $("ghost"),
  ghostText: $("ghost-text"),
  answer: $("answer"),
  again: $("again"),
  againRow: $("again-row"),
  log: $("log"),
  logEmpty: $("log-empty"),
  logCount: $("log-count"),
  markHint: $("mark-hint"),
  makeBook: $("make-book"),
  briefBack: $("brief-back"),
  briefGhost: $("brief-ghost"),
  briefBody: $("brief-body"),
  briefTitle: $("brief-title"),
  briefBuilding: $("brief-building"),
  briefLists: $("brief-lists"),
  briefGo: $("brief-go"),
  briefFix: $("brief-fix"),
  briefError: $("brief-error"),
  bookBack: $("book-back"),
  bookDelete: $("book-delete"),
  bookTag: $("book-tag"),
  writing: $("writing"),
  bookGhost: $("book-ghost"),
  bookGhostText: $("book-ghost-text"),
  readingList: $("reading-list"),
  bookBody: $("book-body"),
  selectToggle: $("select-toggle"),
  selectBook: $("select-book"),
  selectCancel: $("select-cancel"),
  books: $("books"),
  libraryCount: $("library-count"),
  libraryEmpty: $("library-empty"),
  offerVeil: $("offer-veil"),
  offerReason: $("offer-reason"),
  offerTitle: $("offer-title"),
  offerGo: $("offer-go"),
  offerNo: $("offer-no"),
};

const OFFER_KEY = "high-thoughts/offer/v1";

function loadOfferState() {
  try {
    return { ...DEFAULT_OFFER_STATE, ...JSON.parse(localStorage.getItem(OFFER_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_OFFER_STATE };
  }
}

function saveOfferState(next) {
  state.offer = next;
  try {
    localStorage.setItem(OFFER_KEY, JSON.stringify(next));
  } catch {
    // Nothing to do; the worst case is being asked once more than intended.
  }
}

const MODE_KEY = "high-thoughts/mode";

/** Fallback copy if /api/modes cannot be reached — the app still works offline-ish. */
const DEFAULT_MODES = [
  { id: "riff", label: "Riff", blurb: "Run with it. Further, weirder, sharper." },
  { id: "build", label: "Build", blurb: "What it'd actually take. First move included." },
  { id: "sober", label: "Sober", blurb: "The honest read. Bring it back here tomorrow." },
  { id: "deep", label: "Deep", blurb: "Follow it down. See where it lands." },
];

const state = {
  modes: DEFAULT_MODES,
  mode: localStorage.getItem(MODE_KEY) || "riff",
  screen: "catch",
  /** The thought open on the result screen. */
  current: null,
  /** Aborts the in-flight development when the user leaves or stops. */
  abort: null,
  /** Index of the turn currently on screen, so a tap knows what it is marking. */
  turnIndex: -1,
  /** The confirmed brief awaiting a textbook, and the book being read. */
  brief: null,
  briefChains: [],
  book: null,
  /** Log multi-select. */
  selecting: false,
  selected: new Set(),
  /** How often we have interrupted, and about what. */
  offer: null,
};

/* ── Screens ────────────────────────────────────────────────────────────── */

function show(name, { push = true } = {}) {
  // Leaving a running answer cancels it — nobody is reading it any more, and
  // the server stops billing for it the moment the socket closes.
  if (state.screen === "result" && name !== "result") stopStream();

  state.screen = name;
  for (const screen of el.screens) screen.hidden = screen.dataset.screen !== name;
  for (const tab of el.tabs.children) {
    tab.classList.toggle("active", tab.dataset.goto === name);
  }
  if (name === "log") renderLog();
  if (name === "library") renderLibrary();
  window.scrollTo(0, 0);

  if (push && location.hash !== `#${name}`) history.pushState({ name }, "", `#${name}`);
}

window.addEventListener("popstate", (event) => {
  show(event.state?.name ?? "catch", { push: false });
});

el.tabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-goto]");
  if (button) show(button.dataset.goto);
});

el.resultBack.addEventListener("click", () => history.back());

/* ── Modes ──────────────────────────────────────────────────────────────── */

function renderModes() {
  el.modes.replaceChildren(el.modes.querySelector("legend"));

  for (const mode of state.modes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode";
    button.dataset.mode = mode.id;
    button.setAttribute("aria-pressed", String(mode.id === state.mode));

    const label = document.createElement("strong");
    label.textContent = mode.label;
    const blurb = document.createElement("span");
    blurb.textContent = mode.blurb;

    button.append(label, blurb);
    button.addEventListener("click", () => selectMode(mode.id));
    el.modes.append(button);
  }
}

function selectMode(id) {
  state.mode = id;
  localStorage.setItem(MODE_KEY, id);
  for (const button of el.modes.querySelectorAll(".mode")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === id));
  }
}

function modeLabel(id) {
  return state.modes.find((mode) => mode.id === id)?.label ?? id;
}

async function loadModes() {
  try {
    const response = await fetch("/api/modes");
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.modes) && data.modes.length > 0) {
      state.modes = data.modes;
      if (!state.modes.some((mode) => mode.id === state.mode)) state.mode = state.modes[0].id;
      renderModes();
    }
  } catch {
    // The bundled defaults are already on screen.
  }
}

/* ── Catch ──────────────────────────────────────────────────────────────── */

const MAX_CHARS = Number(el.thought.getAttribute("maxlength")) || 4000;

function updateCounter() {
  const length = el.thought.value.length;
  // Silent until it is nearly a problem — a counter ticking from zero makes a
  // free-form dump feel like a form.
  el.counter.textContent = length > MAX_CHARS - 500 ? `${length} / ${MAX_CHARS}` : "";
  el.counter.classList.toggle("over", length >= MAX_CHARS);
}

el.thought.addEventListener("input", () => {
  updateCounter();
  el.hint.textContent = "";
});

el.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = el.thought.value.trim();
  if (!text) {
    el.hint.textContent = "Say something first.";
    el.thought.focus();
    return;
  }

  stopDictation();
  const thought = store.capture(text);
  el.thought.value = "";
  updateCounter();

  openThought(thought, { develop: state.mode });
});

/* ── Dictation ──────────────────────────────────────────────────────────── */

const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
let recogniser = null;
let dictationBase = "";

if (SpeechRecognition) {
  el.mic.hidden = false;
  el.mic.addEventListener("click", () => (recogniser ? stopDictation() : startDictation()));
}

function startDictation() {
  recogniser = new SpeechRecognition();
  recogniser.continuous = true;
  recogniser.interimResults = true;
  recogniser.lang = navigator.language || "en-US";

  dictationBase = el.thought.value.trim();

  recogniser.addEventListener("result", (event) => {
    let heard = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      heard += event.results[i][0].transcript;
    }
    // Interim results replace rather than append, so the box does not stutter
    // while the recogniser changes its mind about a word.
    el.thought.value = dictationBase ? `${dictationBase} ${heard}` : heard;
    updateCounter();

    if (event.results[event.results.length - 1].isFinal) {
      dictationBase = el.thought.value.trim();
    }
  });

  recogniser.addEventListener("error", (event) => {
    el.hint.textContent =
      event.error === "not-allowed"
        ? "Microphone blocked. Type it instead."
        : "Dictation dropped out. Type it instead.";
    stopDictation();
  });

  recogniser.addEventListener("end", stopDictation);

  try {
    recogniser.start();
    el.mic.setAttribute("aria-pressed", "true");
  } catch {
    stopDictation();
  }
}

function stopDictation() {
  if (recogniser) {
    recogniser.onend = null;
    try {
      recogniser.stop();
    } catch {
      // Already stopped.
    }
    recogniser = null;
  }
  el.mic.setAttribute("aria-pressed", "false");
}

/* ── Result ─────────────────────────────────────────────────────────────── */

function openThought(thought, { develop = null } = {}) {
  state.current = thought;

  el.resultOriginal.textContent = thought.thought;
  el.answer.innerHTML = "";
  el.ghost.hidden = true;
  el.ghostText.textContent = "";
  el.again.hidden = true;
  el.markHint.hidden = true;
  state.turnIndex = -1;
  show("result");

  if (develop) {
    runDevelopment(develop);
    return;
  }

  // Re-opened from the log: show what is already there.
  const turns = thought.turns ?? [];
  const last = turns[turns.length - 1];
  if (last) {
    state.turnIndex = turns.length - 1;
    el.resultMode.textContent = modeLabel(last.mode);
    el.answer.innerHTML = renderMarkdown(last.text, {
      markable: true,
      marks: store.markMap(last),
    });
    el.markHint.hidden = false;
    renderAgain();
  } else {
    el.resultMode.textContent = "Not developed";
    el.answer.innerHTML =
      '<p class="failed">This one never got an answer — the connection dropped, or you left before it finished.</p>';
    renderAgain();
  }
}

function renderAgain() {
  const thought = state.current;
  if (!thought) return;

  const developed = (thought.turns ?? []).length > 0;
  const last = thought.turns?.[thought.turns.length - 1]?.mode;

  el.againRow.replaceChildren();

  const options = developed
    ? [
        { mode: last, label: "Push it further" },
        ...state.modes
          .filter((mode) => mode.id !== last)
          .map((mode) => ({ mode: mode.id, label: mode.label })),
      ]
    : state.modes.map((mode) => ({ mode: mode.id, label: mode.label }));

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => runDevelopment(option.mode));
    el.againRow.append(button);
  }

  el.again.querySelector(".again-label").textContent = developed
    ? "Not done with it?"
    : "Try it again:";
  el.again.hidden = false;
}

el.resultDelete.addEventListener("click", () => {
  const thought = state.current;
  if (!thought) return;
  if (!confirm("Delete this thought?")) return;
  stopStream();
  store.remove(thought.id);
  state.current = null;
  show("log");
});

/* ── Marking ────────────────────────────────────────────────────────────── */

/**
 * Tap a line to cycle it: neutral → keep → kill → neutral.
 *
 * Cycling on one tap rather than a long-press or a swipe, because both of
 * those fight the scroll gesture on a phone and this has to work half asleep.
 * The tap is only counted if the finger did not travel, so scrolling past a
 * paragraph never marks it.
 */
const NEXT_STATE = { keep: "kill", kill: null };

let touchOrigin = null;

el.answer.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.touches[0];
    touchOrigin = touch ? { x: touch.clientX, y: touch.clientY } : null;
  },
  { passive: true },
);

el.answer.addEventListener("click", (event) => {
  const line = event.target.closest("[data-mark]");
  if (!line || !el.answer.contains(line)) return;

  // A click that ended a scroll is not a tap.
  if (touchOrigin && event.detail === 0) return;
  touchOrigin = null;

  toggleMark(Number(line.dataset.mark), line);
});

function toggleMark(index, line) {
  const thought = state.current;
  const turn = thought?.turns?.[state.turnIndex];
  if (!turn || !Number.isInteger(index)) return;

  const current = turn.marks?.find((mark) => mark.index === index)?.state;
  // Not `?? "keep"` — NEXT_STATE.kill is deliberately null, and nullish
  // coalescing would swallow it and make the third tap re-keep the line.
  const next = Object.hasOwn(NEXT_STATE, current) ? NEXT_STATE[current] : "keep";

  const updated = store.setMark(thought.id, state.turnIndex, index, next, line.textContent.trim());
  if (updated) state.current = updated;

  line.classList.remove("mark-keep", "mark-kill");
  if (next) line.classList.add(`mark-${next}`);
}

/* ── Streaming ──────────────────────────────────────────────────────────── */

function stopStream() {
  if (state.abort) {
    state.abort.abort();
    state.abort = null;
  }
}

/**
 * Ask the server for one development and paint it as it arrives.
 *
 * The text is re-rendered from the accumulated string on every animation
 * frame rather than appended per chunk: markdown is not resumable — a `**`
 * arriving in one chunk and its partner in the next has to be able to change
 * what came before it.
 */
async function runDevelopment(modeId) {
  const thought = state.current;
  if (!thought) return;

  stopStream();
  const abort = new AbortController();
  state.abort = abort;

  el.resultMode.textContent = modeLabel(modeId);
  el.again.hidden = true;
  el.ghost.hidden = false;
  el.ghostText.textContent = "catching it";
  el.answer.innerHTML = "";

  let answer = "";
  let frame = 0;

  const paint = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      el.answer.innerHTML = `${renderMarkdown(answer)}<span class="caret"></span>`;
    });
  };

  // The final render must be the last one. A frame scheduled by the last text
  // chunk can otherwise fire after it and paint the caret back on for good.
  const settle = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const fail = (message) => {
    settle();
    el.ghost.hidden = true;
    el.answer.innerHTML = answer
      ? `${renderMarkdown(answer)}<p class="failed">${message}</p>`
      : `<p class="failed">${message}</p>`;
    renderAgain();
  };

  try {
    const response = await fetch("/api/develop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        thought: thought.thought,
        mode: modeId,
        history: store.historyFor(thought),
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.json().catch(() => ({}));
      fail(detail.error ?? `The server said no (${response.status}).`);
      return;
    }

    for await (const event of readEvents(response.body, abort.signal)) {
      switch (event.type) {
        case "status":
          // The tail of the model's own reasoning, as a ghost line.
          el.ghostText.textContent = event.text.replace(/\s+/g, " ").trim().slice(-140);
          break;
        case "text":
          if (!answer) el.ghost.hidden = true;
          answer += event.text;
          paint();
          break;
        case "error":
          fail(event.message);
          return;
        case "done":
          settle();
          finish(thought, modeId, answer);
          return;
        default:
          break;
      }
    }

    // Stream ended without a `done` frame — the server went away mid-answer.
    settle();
    if (answer.trim()) finish(thought, modeId, answer);
    else fail("That cut out. Try again.");
  } catch (error) {
    settle();
    if (error.name === "AbortError") return;
    fail(navigator.onLine ? "Could not reach the app. Try again." : "You're offline — it's saved.");
  } finally {
    if (state.abort === abort) state.abort = null;
  }
}

function finish(thought, modeId, answer) {
  el.ghost.hidden = true;

  const updated = store.addTurn(thought.id, {
    mode: modeId,
    text: answer,
    title: extractTitle(answer, thought.thought),
    at: Date.now(),
  });

  if (updated) {
    state.current = updated;
    state.turnIndex = (updated.turns?.length ?? 1) - 1;
  }

  // Markable only now it is complete: indices shift while text is streaming,
  // so a line marked mid-write would be the wrong line a second later.
  el.answer.innerHTML = renderMarkdown(answer, { markable: true });
  el.markHint.hidden = false;
  renderAgain();

  // After the answer has landed, never during it.
  if (updated) maybeOffer(updated);
}

/** Parse the SSE body into JSON events, frame by frame. */
async function* readEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            yield JSON.parse(line.slice(5).trim());
          } catch {
            // A half-written frame at the tail; the next read completes it.
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/* ── The offer ──────────────────────────────────────────────────────────── */

el.offerGo.addEventListener("click", () => {
  closeOffer();
  if (state.current) requestBrief([state.current]);
});

el.offerNo.addEventListener("click", () => {
  saveOfferState(recordDismissal(state.offer));
  closeOffer();
});

// Tapping the dark surround is a dismissal like any other — but a tap inside
// the card must not close it.
el.offerVeil.addEventListener("click", (event) => {
  if (event.target === el.offerVeil) el.offerNo.click();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !el.offerVeil.hidden) el.offerNo.click();
});

/**
 * Offer the library, if this is a moment where the offer is true.
 *
 * Called only after an answer has finished — never mid-stream, and never on a
 * first pass. `shouldOffer` owns every rule about when to stay quiet; this
 * function only renders the result.
 */
function maybeOffer(thought) {
  const hasBook = store.listBooks().some((book) => book.thoughtId === thought.id);
  if (!shouldOffer({ ...thought, hasBook }, state.offer)) return;

  el.offerReason.textContent = offerReason(thought);
  el.offerTitle.textContent =
    store.listBooks().length > 0 ? "Add this to your Journey" : "Start your Thought Journey";

  el.offerVeil.hidden = false;
  saveOfferState(recordOffer(state.offer, thought.id));
}

function closeOffer() {
  el.offerVeil.hidden = true;
}

/* ── The brief ──────────────────────────────────────────────────────────── */

el.makeBook.addEventListener("click", () => {
  if (state.current) requestBrief([state.current]);
});

el.briefBack.addEventListener("click", () => history.back());
el.briefFix.addEventListener("click", () => history.back());

/**
 * Read the selected chains and show the person what we understood.
 *
 * This screen exists to be checked. It is the last thing between them and a
 * generation they are paying for, and the moment they find out whether the app
 * was actually listening — so it shows the decisions as decisions, and a wrong
 * read is one tap away from being corrected instead of baked into a book.
 */
async function requestBrief(thoughts) {
  state.briefChains = thoughts;
  state.brief = null;

  el.briefBody.hidden = true;
  el.briefError.textContent = "";
  el.briefGhost.hidden = false;
  show("brief");

  try {
    const response = await fetch("/api/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chains: thoughts.map(store.chainFor) }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      el.briefGhost.hidden = true;
      el.briefError.textContent = data.error ?? `The server said no (${response.status}).`;
      return;
    }

    state.brief = data.brief;
    renderBrief(data.brief);
  } catch {
    el.briefGhost.hidden = true;
    el.briefError.textContent = navigator.onLine
      ? "Could not reach the app. Try again."
      : "You're offline. Try when you have signal.";
  }
}

function renderBrief(brief) {
  el.briefGhost.hidden = true;
  el.briefTitle.textContent = brief.title || "Your idea";
  el.briefBuilding.textContent = brief.building || "";

  el.briefLists.replaceChildren();

  // Unrelated thoughts make a bad single book. Say so rather than blending
  // them into mush the person pays for and then does not recognise.
  if (brief.looksLikeSeveral && brief.separateIdeas?.length > 1) {
    const warning = document.createElement("p");
    warning.className = "brief-split";
    warning.textContent = `These look like ${brief.separateIdeas.length} different ideas — ${brief.separateIdeas.join(", ")}. One book will cover them all at once. Going back and picking one will get you a better book.`;
    el.briefLists.append(warning);
  }

  const groups = [
    ["Going with", brief.goingWith, ""],
    ["Ruled out", brief.ruledOut, "ruled"],
    ["Still open", brief.stillOpen, "open"],
    ["You'd need to learn", brief.needToLearn, "open"],
  ];

  for (const [heading, items, variant] of groups) {
    if (!items?.length) continue;

    const group = document.createElement("div");
    group.className = `brief-group ${variant}`.trim();

    const title = document.createElement("h2");
    title.textContent = heading;

    const list = document.createElement("ul");
    for (const item of items) {
      const entry = document.createElement("li");
      entry.textContent = item;
      list.append(entry);
    }

    group.append(title, list);
    el.briefLists.append(group);
  }

  el.briefBody.hidden = false;
}

/* ── The textbook ───────────────────────────────────────────────────────── */

el.briefGo.addEventListener("click", () => {
  if (state.brief) startTextbook(state.brief);
});

el.bookBack.addEventListener("click", () => history.back());

el.bookDelete.addEventListener("click", () => {
  if (!state.book || !confirm("Delete this textbook?")) return;
  store.removeBook(state.book.id);
  state.book = null;
  show("log");
});

/**
 * Ask the server to start writing, then follow the job.
 *
 * The book is saved locally the instant the job starts, so closing the app
 * mid-write loses nothing — reopening it from the log re-attaches to the same
 * job and picks the text up wherever it got to.
 */
async function startTextbook(brief) {
  el.briefError.textContent = "";
  el.briefGo.disabled = true;

  try {
    const response = await fetch("/api/textbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
      el.briefError.textContent = data.error ?? `The server said no (${response.status}).`;
      return;
    }

    const book = store.saveBook({
      id: data.id,
      thoughtId: state.briefChains[0]?.id ?? null,
      title: brief.title,
      building: brief.building,
      text: "",
      sources: [],
      status: "writing",
      createdAt: Date.now(),
    });

    openBook(book, { follow: true });
  } catch {
    el.briefError.textContent = "Could not reach the app. Try again.";
  } finally {
    el.briefGo.disabled = false;
  }
}

function openBook(book, { follow = false } = {}) {
  state.book = book;

  el.bookTag.textContent = book.status === "writing" ? "Writing" : "Textbook";
  el.readingList.replaceChildren();
  el.bookGhostText.textContent = "starting";
  el.writing.hidden = !(follow || book.status === "writing");
  el.bookBody.innerHTML = book.text ? renderMarkdown(book.text) : "";
  show("book");

  if (follow || book.status === "writing") followTextbook(book);
}

/** Attach to a job's stream. Replays from the start, so re-attaching is free. */
async function followTextbook(book) {
  stopStream();
  const abort = new AbortController();
  state.abort = abort;

  let text = "";
  const sources = [];
  let frame = 0;

  const paint = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      el.bookBody.innerHTML = `${renderMarkdown(text)}<span class="caret"></span>`;
    });
  };

  const settle = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const save = (status) => {
    const saved = store.saveBook({ ...book, text, sources, status });
    if (state.book?.id === book.id) state.book = saved;
    if (state.screen === "library") renderLibrary();
    return saved;
  };

  try {
    const response = await fetch(`/api/textbook/${encodeURIComponent(book.id)}`, {
      signal: abort.signal,
    });

    if (!response.ok || !response.body) {
      settle();
      el.writing.hidden = true;
      el.bookBody.innerHTML = book.text
        ? renderMarkdown(book.text)
        : '<p class="failed">That book expired before it finished. Make it again.</p>';
      return;
    }

    for await (const event of readEvents(response.body, abort.signal)) {
      switch (event.type) {
        case "status":
          el.bookGhostText.textContent = event.text.replace(/\s+/g, " ").trim().slice(-140);
          break;
        case "source": {
          sources.push({ title: event.title, url: event.url });
          const item = document.createElement("li");
          item.textContent = event.title;
          el.readingList.append(item);
          break;
        }
        case "text":
          text += event.text;
          paint();
          break;
        case "error":
          settle();
          el.writing.hidden = true;
          el.bookBody.innerHTML = `${text ? renderMarkdown(text) : ""}<p class="failed">${event.message}</p>`;
          save("failed");
          return;
        case "done":
          settle();
          el.writing.hidden = true;
          el.bookTag.textContent = "Textbook";
          el.bookBody.innerHTML = renderMarkdown(text);
          save("done");
          return;
        default:
          break;
      }
    }

    // The stream ended without a verdict — the server went away mid-book.
    settle();
    el.writing.hidden = true;
    if (text.trim()) {
      el.bookBody.innerHTML = renderMarkdown(text);
      save("done");
    } else {
      el.bookBody.innerHTML = '<p class="failed">That cut out. Try again.</p>';
    }
  } catch (error) {
    settle();
    if (error.name === "AbortError") {
      // Left the screen mid-write. The job keeps running on the server.
      if (text.trim()) save("writing");
      return;
    }
    el.writing.hidden = true;
    el.bookBody.innerHTML = `${text ? renderMarkdown(text) : ""}<p class="failed">Lost the connection. Open it again to pick it back up.</p>`;
    save("writing");
  } finally {
    if (state.abort === abort) state.abort = null;
  }
}

/* ── Log ────────────────────────────────────────────────────────────────── */

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function when(timestamp) {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const scales = [
    [60, "second", 1],
    [3600, "minute", 60],
    [86400, "hour", 3600],
    [604800, "day", 86400],
  ];
  for (const [limit, unit, divisor] of scales) {
    if (Math.abs(seconds) < limit) return RELATIVE.format(Math.round(seconds / divisor), unit);
  }
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

el.selectToggle.addEventListener("click", () => setSelecting(true));
el.selectCancel.addEventListener("click", () => setSelecting(false));

el.selectBook.addEventListener("click", () => {
  const chosen = store.list().filter((thought) => state.selected.has(thought.id));
  if (chosen.length === 0) return;
  setSelecting(false);
  requestBrief(chosen);
});

/**
 * Multi-select exists so a textbook can be built from several passes at the
 * same idea. Only developed thoughts are selectable — there is nothing to read
 * in one that never got an answer.
 */
function setSelecting(on) {
  state.selecting = on;
  state.selected.clear();
  el.selectToggle.hidden = on;
  el.selectCancel.hidden = !on;
  el.selectBook.hidden = !on;
  el.selectBook.disabled = true;
  el.selectBook.textContent = "Make a textbook";
  renderLog();
}

function toggleSelected(id, button) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);

  button.classList.toggle("selected", state.selected.has(id));
  button.querySelector(".tick").textContent = state.selected.has(id) ? "✓" : "";

  const count = state.selected.size;
  el.selectBook.disabled = count === 0;
  el.selectBook.textContent =
    count === 0 ? "Make a textbook" : `Make a textbook from ${count}`;
}

function renderLibrary() {
  const books = store.listBooks();
  const done = books.filter((book) => book.status === "done").length;

  el.libraryEmpty.hidden = books.length > 0;
  el.libraryCount.textContent =
    books.length === 0
      ? ""
      : `${books.length} ${books.length === 1 ? "book" : "books"}${done < books.length ? ` · ${books.length - done} still writing` : ""}`;

  el.books.replaceChildren();

  for (const book of books) {
    const button = document.createElement("button");
    button.type = "button";

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = book.title || "Untitled";

    const meta = document.createElement("span");
    meta.className = book.status === "writing" ? "meta undeveloped" : "meta";
    meta.textContent =
      book.status === "writing"
        ? `${when(book.createdAt)} · still writing`
        : `${when(book.createdAt)} · ${book.sources?.length ?? 0} sources`;

    const snippet = document.createElement("span");
    snippet.className = "snippet";
    snippet.textContent = book.building || extractSnippet(book.text ?? "");

    button.append(title, meta, snippet);
    button.addEventListener("click", () => openBook(book));

    const item = document.createElement("li");
    item.append(button);
    el.books.append(item);
  }
}

function renderLog() {
  const thoughts = store.list();

  el.logEmpty.hidden = thoughts.length > 0;
  el.selectToggle.hidden = state.selecting || !thoughts.some((entry) => entry.turns?.length);
  el.logCount.textContent =
    thoughts.length > 0 ? `${thoughts.length} caught, kept on this phone` : "";

  el.log.replaceChildren();

  for (const thought of thoughts) {
    const turns = thought.turns ?? [];
    const last = turns[turns.length - 1];

    const button = document.createElement("button");
    button.type = "button";

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = thought.title || extractTitle("", thought.thought);

    const meta = document.createElement("span");
    meta.className = "meta";
    if (last) {
      meta.textContent = `${when(thought.createdAt)} · ${modeLabel(last.mode)}${
        turns.length > 1 ? ` · ${turns.length} passes` : ""
      }`;
    } else {
      meta.className = "meta undeveloped";
      meta.textContent = `${when(thought.createdAt)} · never developed`;
    }

    const snippet = document.createElement("span");
    snippet.className = "snippet";
    snippet.textContent = last ? extractSnippet(last.text) : thought.thought;

    if (state.selecting) {
      const tick = document.createElement("span");
      tick.className = "tick";
      title.prepend(tick);
    }

    button.append(title, meta, snippet);

    if (state.selecting) {
      // An undeveloped thought has no answers to read, so it cannot contribute.
      button.disabled = !last;
      button.addEventListener("click", () => toggleSelected(thought.id, button));
    } else {
      button.addEventListener("click", () => openThought(thought));
    }

    const item = document.createElement("li");
    item.append(button);
    el.log.append(item);
  }
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

state.offer = loadOfferState();
renderModes();
loadModes();
updateCounter();
history.replaceState({ name: "catch" }, "", "#catch");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // No offline shell. Everything else still works.
    });
  });
}
