import { extractSnippet, extractTitle, renderMarkdown } from "./markdown.js";
import {
  DEFAULT_OFFER_STATE,
  offerReason,
  recordDismissal,
  recordOffer,
  shouldOffer,
} from "./offer.js";
import { mountPreview, previewError, sanitizePrototype } from "./preview.js";
import { buildProfile, isUseful } from "./profile.js";
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
  talk: $("talk"),
  ivBack: $("iv-back"), ivCount: $("iv-count"), ivOriginal: $("iv-original"),
  ivGhost: $("iv-ghost"), ivBody: $("iv-body"), ivQuestion: $("iv-question"),
  ivForm: $("iv-form"), ivAnswer: $("iv-answer"), ivSkip: $("iv-skip"), ivError: $("iv-error"),
  crBack: $("cr-back"), crTag: $("cr-tag"), crStop: $("cr-stop"), crMaking: $("cr-making"),
  crGhost: $("cr-ghost"), crGhostText: $("cr-ghost-text"), crBar: $("cr-bar"),
  crPreview: $("cr-preview"), crFit: $("cr-fit"), crActions: $("cr-actions"),
  crImprove: $("cr-improve"), crDownload: $("cr-download"), crOpen: $("cr-open"),
  crImproveForm: $("cr-improve-form"), crFeedback: $("cr-feedback"),
  ideaBack: $("idea-back"), ideaDate: $("idea-date"), ideaDelete: $("idea-delete"),
  ideaTitle: $("idea-title"), ideaTimeline: $("idea-timeline"), ideaContinue: $("idea-continue"),
  exportAll: $("export-all"),
  libraryCount: $("library-count"),
  libraryEmpty: $("library-empty"),
  offerVeil: $("offer-veil"),
  offerReason: $("offer-reason"),
  offerTitle: $("offer-title"),
  offerGo: $("offer-go"),
  offerNo: $("offer-no"),
  paywall: $("paywall"),
  credits: $("credits-line"),
  codeOpen: $("code-open"),
  codeForm: $("code-form"),
  codeInput: $("code-input"),
  codeMsg: $("code-msg"),
};

/* ── Book credits ───────────────────────────────────────────────────────────
 *
 * A book costs real money to make, so the server will not make one without a
 * credit. The token is the bearer of that balance — kept on the phone, sent
 * only to our own API, and never shown after it is entered.
 */

const TOKEN_KEY = "high-thoughts/token/v1";

function bookToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

function setBookToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode. They can still spend it this session.
  }
  state.token = token;
}

/**
 * Ask for the free first creation.
 *
 * Only ever asked once per load, and the server is the one that decides —
 * it keeps a record of who has already had theirs. A "no" here is not an
 * error to show anybody: it means this phone needs a code, which the paywall
 * already says better than a toast would.
 */
let freeClaimAsked = false;

async function claimFreeCreation() {
  if (state.token || freeClaimAsked) return state.token;
  freeClaimAsked = true;

  try {
    const response = await fetch("/api/claim", { method: "POST" });
    if (!response.ok) return null;

    const data = await response.json().catch(() => ({}));
    if (typeof data.token !== "string") return null;

    setBookToken(data.token);
    state.credits = typeof data.credits === "number" ? data.credits : 1;
    return data.token;
  } catch {
    return null;
  }
}

/** Ask the server what is left. The phone is never the authority on this. */
async function refreshCredits() {
  const token = state.token;
  if (!token) {
    state.credits = 0;
    return 0;
  }
  try {
    const response = await fetch(`/api/credits?token=${encodeURIComponent(token)}`);
    const data = await response.json();
    state.credits = data.credits ?? 0;
  } catch {
    // Leave the last known figure; the server decides at spend time anyway.
  }
  return state.credits;
}

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
  /** The credit this phone holds, and what the server last said was left. */
  token: null,
  credits: 0,
  /** The interview in progress, and the creation on screen. */
  interview: null,
  creation: null,
  preview: null,
};

/**
 * What the app knows about this person, rebuilt from the local log each time
 * it is needed. Cheap, always current, and never stored anywhere but here.
 */
function currentProfile() {
  const profile = buildProfile(store.list(), store.listBooks());
  return isUseful(profile) ? profile : null;
}

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
  if (name === "idea") renderIdea();
  // A creation keeps running in its frame; leaving the screen stops it.
  if (name !== "creation" && state.preview) { state.preview.stop(); state.preview = null; }
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

  startInterview(thought);
});

// The modes are still here for anyone who wants to think out loud first.
el.talk.addEventListener("click", () => {
  const text = el.thought.value.trim();
  if (!text) { el.hint.textContent = "Say something first."; el.thought.focus(); return; }
  stopDictation();
  const thought = store.capture(text);
  el.thought.value = "";
  updateCounter();
  openThought(thought, { develop: state.mode });
});

/* ── Interview ───────────────────────────────────────────────────────────
 *
 * The part that turns a wish into something buildable. One question on screen
 * at a time, because a form of four questions reads as homework and this has
 * to read as someone interested in your idea.
 */

el.ivBack.addEventListener("click", () => history.back());
el.ivSkip.addEventListener("click", () => beginCreation(state.interview?.thought));

el.ivForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const answer = el.ivAnswer.value.trim();
  if (!answer) { el.ivAnswer.focus(); return; }

  const iv = state.interview;
  const updated = store.addAnswer(iv.thought.id, iv.question, answer);
  if (updated) iv.thought = updated;

  el.ivAnswer.value = "";
  askNext(iv.thought);
});

function startInterview(thought) {
  state.interview = { thought, question: "", kind: "simulation" };
  el.ivOriginal.textContent = thought.thought;
  el.ivAnswer.value = "";
  el.ivError.textContent = "";
  el.ivBody.hidden = true;
  show("interview");
  askNext(thought);
}

async function askNext(thought) {
  el.ivBody.hidden = true;
  el.ivGhost.hidden = false;
  el.ivError.textContent = "";

  const answers = (thought.answers ?? []).map((a) => ({ question: a.question, answer: a.answer }));
  el.ivCount.textContent = answers.length === 0 ? "One sec" : `Question ${answers.length + 1} of 4 max`;

  try {
    const response = await fetch("/api/interview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thought: thought.thought, answers }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      el.ivGhost.hidden = true;
      el.ivError.textContent = data.error ?? `The server said no (${response.status}).`;
      return;
    }

    state.interview.kind = data.buildKind ?? "simulation";

    if (data.ready) { beginCreation(thought); return; }

    state.interview.question = data.question;
    el.ivQuestion.textContent = data.question;
    el.ivAnswer.placeholder = data.placeholder || "whatever comes out";
    el.ivGhost.hidden = true;
    el.ivBody.hidden = false;
    el.ivAnswer.focus();
  } catch {
    el.ivGhost.hidden = true;
    el.ivError.textContent = navigator.onLine
      ? "Could not reach the app. Try again."
      : "You're offline. Try when you have signal.";
  }
}

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
        profile: currentProfile(),
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
  if (state.current) startInterview(state.current);
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
  const hasBook = store.listCreations().some((make) => make.thoughtId === thought.id);
  if (!shouldOffer({ ...thought, hasBook }, state.offer)) return;

  el.offerReason.textContent = offerReason(thought);
  el.offerTitle.textContent =
    store.listCreations().length > 0 ? "Build this one too" : "Build it, don't just think it";

  el.offerVeil.hidden = false;
  saveOfferState(recordOffer(state.offer, thought.id));
}

function closeOffer() {
  el.offerVeil.hidden = true;
}

/* ── The brief ──────────────────────────────────────────────────────────── */

el.makeBook.addEventListener("click", () => {
  if (state.current) startInterview(state.current);
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
      body: JSON.stringify({
        chains: thoughts.map(store.chainFor),
        profile: currentProfile(),
      }),
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
  el.paywall.hidden = true;
  el.briefGo.disabled = false;
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

/**
 * Say why the book did not start, at the moment they asked for it.
 *
 * Deliberately not a wall in front of the brief — the brief is free, and it is
 * where they find out we understood them. The charge lands only on the thing
 * that actually costs money to make.
 */
function showPaywall(reason) {
  el.paywall.textContent =
    reason === "empty"
      ? "That was your last book. Add another code in your Library to keep going."
      : "Books are paid for one at a time — each one is real research, and it costs real money to make. Add a code in your Library.";
  el.paywall.hidden = false;
  el.briefGo.disabled = true;
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
      headers: {
        "Content-Type": "application/json",
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body: JSON.stringify({ brief }),
    });

    const data = await response.json().catch(() => ({}));

    // Every book is charged for. No credit, no book.
    if (response.status === 402) {
      state.credits = 0;
      showPaywall(data.reason);
      return;
    }

    if (!response.ok || !data.id) {
      el.briefError.textContent = data.error ?? `The server said no (${response.status}).`;
      return;
    }

    if (typeof data.creditsLeft === "number") state.credits = data.creditsLeft;

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
    // Not when the paywall is up — showPaywall just disabled this deliberately,
    // and re-enabling it here would leave a button that looks ready to spend a
    // credit the person does not have.
    if (el.paywall.hidden) el.briefGo.disabled = false;
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

/* ── One idea, start to finish ────────────────────────────────────────────
 *
 * The Idea Library's point: not a list of outputs, but the life of one idea —
 * what you typed, what it asked, what you said back, and what got built. The
 * original text sits at the top, visually distinct, and is never rewritten.
 */

el.ideaBack.addEventListener("click", () => history.back());
el.ideaContinue.addEventListener("click", () => {
  if (state.current) startInterview(state.current);
});

el.ideaDelete.addEventListener("click", () => {
  const thought = state.current;
  if (!thought || !confirm("Delete this idea and everything made from it?")) return;
  for (const make of store.listCreations(thought.id)) store.removeCreation(make.id);
  store.remove(thought.id);
  state.current = null;
  show("library");
});

function openIdea(thought) {
  state.current = thought;
  show("idea");
}

function renderIdea() {
  const thought = state.current;
  if (!thought) { show("library"); return; }

  el.ideaTitle.textContent = thought.title || extractTitle("", thought.thought);
  el.ideaDate.textContent = when(thought.createdAt);
  el.ideaTimeline.replaceChildren();

  const rail = document.createElement("div");
  rail.className = "tl";

  // Always first, always verbatim.
  rail.append(item("said", "What you said", (body) => {
    body.textContent = thought.thought;
  }));

  for (const answer of thought.answers ?? []) {
    rail.append(item("asked", "It asked", (body) => {
      const q = document.createElement("p");
      q.className = "tl-q";
      q.textContent = answer.question;
      const a = document.createElement("p");
      a.className = "tl-a";
      a.textContent = answer.answer;
      body.append(q, a);
    }));
  }

  for (const turn of thought.turns ?? []) {
    rail.append(item("asked", modeLabel(turn.mode), (body) => {
      const p = document.createElement("p");
      p.className = "tl-a";
      p.textContent = extractSnippet(turn.text) || "—";
      body.append(p);
    }));
  }

  const makes = store.listCreations(thought.id).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  makes.forEach((make, index) => {
    rail.append(item("made", index === 0 ? "It built" : `Version ${make.version ?? index + 1}`, (body) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tl-make";

      // A live thumbnail, under the same sandbox as the full preview.
      const host = document.createElement("span");
      host.className = "tl-thumb";
      if (make.html) {
        const { html } = sanitizePrototype(make.html);
        const thumb = document.createElement("iframe");
        thumb.setAttribute("sandbox", "allow-scripts");
        thumb.setAttribute("referrerpolicy", "no-referrer");
        thumb.setAttribute("tabindex", "-1");
        thumb.setAttribute("aria-hidden", "true");
        thumb.srcdoc = html;
        // Scale so the frame's 390px width fills whatever the card is wide.
        requestAnimationFrame(() => {
          const scale = host.clientWidth / 390;
          thumb.style.transform = `scale(${scale})`;
        });
        host.append(thumb);
      }
      button.append(host);

      const cap = document.createElement("span");
      cap.className = "cap";
      cap.innerHTML = make.status === "making"
        ? "<em>still building — tap to watch</em>"
        : make.feedback
          ? `after you said: <em>${escapeForCap(make.feedback)}</em>`
          : "tap to open it";
      button.append(cap);
      button.addEventListener("click", () => openCreation(make));
      body.append(button);
    }));
  });

  if (makes.length === 0) {
    rail.append(item("made", "Nothing built yet", (body) => {
      const p = document.createElement("p");
      p.className = "tl-a";
      p.textContent = "Keep going with this and it'll ask you a couple of questions, then build it.";
      body.append(p);
    }));
  }

  el.ideaTimeline.append(rail);
}

function item(kind, when, fill) {
  const wrap = document.createElement("div");
  wrap.className = `tl-item ${kind}`;
  const label = document.createElement("span");
  label.className = "tl-when";
  label.textContent = when;
  const body = document.createElement("div");
  body.className = "tl-body";
  fill(body);
  wrap.append(label, body);
  return wrap;
}

/** Captions are built with innerHTML for the <em>, so their text is escaped. */
function escapeForCap(text) {
  const div = document.createElement("div");
  div.textContent = text.slice(0, 90);
  return div.innerHTML;
}

/* ── Creation ─────────────────────────────────────────────────────────────
 *
 * Generation is a job: it runs on the server whether or not this phone is
 * still listening, and the record is written the moment it starts, so closing
 * the app loses nothing. Re-opening re-attaches to the same stream.
 */

el.crBack.addEventListener("click", () => history.back());

el.crStop.addEventListener("click", () => {
  if (state.preview) { state.preview.stop(); state.preview = null; }
  previewError(el.crPreview, "Stopped. Open it again to run it.");
  el.crStop.hidden = true;
});

el.crImprove.addEventListener("click", () => {
  el.crImproveForm.hidden = !el.crImproveForm.hidden;
  if (!el.crImproveForm.hidden) el.crFeedback.focus();
});

el.crImproveForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const feedback = el.crFeedback.value.trim();
  const make = state.creation;
  if (!make) return;
  el.crFeedback.value = "";
  el.crImproveForm.hidden = true;
  const thought = store.get(make.thoughtId);
  if (thought) beginCreation(thought, { feedback, version: (make.version ?? 1) + 1 });
});

el.crDownload.addEventListener("click", () => {
  const make = state.creation;
  if (!make?.html) return;
  const name = `${(make.title || "creation").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
  const url = URL.createObjectURL(new Blob([make.html], { type: "text/html" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

el.crOpen.addEventListener("click", () => {
  const make = state.creation;
  if (!make?.html) return;
  // Same sandbox rules, full screen: a blob URL is its own opaque origin and
  // the CSP travels inside the document.
  const { html } = sanitizePrototype(make.html);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});

async function beginCreation(thought, { feedback = "", version = 1 } = {}) {
  if (!thought) return;

  const answers = (thought.answers ?? []).map((a) => ({ question: a.question, answer: a.answer }));
  const kind = state.interview?.kind ?? "simulation";

  el.crTag.textContent = "Building";
  el.crFit.hidden = true;
  el.crActions.hidden = true;
  el.crImproveForm.hidden = true;
  el.crStop.hidden = true;
  el.crPreview.replaceChildren();
  el.crMaking.hidden = false;
  el.crGhostText.textContent = "working out what to draw";
  el.crBar.style.width = "2%";
  show("creation");

  try {
    // First creation on this phone: see whether the server will stand it. It
    // says no if the free one has gone, and the paywall below handles that.
    if (!state.token) await claimFreeCreation();

    const response = await fetch("/api/creation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body: JSON.stringify({ thought: thought.thought, answers, kind, feedback }),
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 402) {
      el.crMaking.hidden = true;
      state.credits = 0;
      previewError(
        el.crPreview,
        data.reason === "empty"
          ? "That was your last creation. Add a code in your Library to make another."
          : "Creations are paid for one at a time — each one is really built. Add a code in your Library.",
      );
      return;
    }

    if (!response.ok || !data.id) {
      el.crMaking.hidden = true;
      previewError(el.crPreview, data.error ?? `The server said no (${response.status}).`);
      return;
    }

    if (typeof data.creditsLeft === "number") state.credits = data.creditsLeft;

    const make = store.saveCreation({
      id: data.id,
      thoughtId: thought.id,
      title: thought.title || thought.thought.slice(0, 40),
      kind,
      html: "",
      status: "making",
      version,
      feedback,
      createdAt: Date.now(),
    });

    state.creation = make;
    followCreation(make);
  } catch {
    el.crMaking.hidden = true;
    previewError(el.crPreview, "Could not reach the app. Try again.");
  }
}

/** Attach to a creation's job. Safe to call on one already finished. */
async function followCreation(make) {
  stopStream();
  const abort = new AbortController();
  state.abort = abort;

  let html = "";
  // The page is ~20 KB; this is only ever a sense of movement, never a claim.
  const expected = 20000;

  const save = (status) => {
    const saved = store.saveCreation({ ...make, html, status });
    if (state.creation?.id === make.id) state.creation = saved;
    return saved;
  };

  const finish = (text) => {
    el.crMaking.hidden = true;
    el.crTag.textContent = "Your creation";
    const saved = save("done");
    state.creation = saved;

    if (!saved.stored) {
      el.crFit.hidden = false;
      el.crFit.textContent = "This phone is out of storage, so this one is on screen but not saved. Save the file to keep it.";
    }

    state.preview = mountPreview(el.crPreview, text, {
      onFit: (overflow) => {
        if (overflow <= 0) return;
        el.crFit.hidden = false;
        el.crFit.textContent = `${overflow} bit${overflow === 1 ? "" : "s"} of text look clipped. "Make it better" will have another go.`;
      },
    });
    el.crStop.hidden = false;
    el.crActions.hidden = false;
  };

  try {
    const response = await fetch(`/api/creation/${encodeURIComponent(make.id)}`, { signal: abort.signal });
    if (!response.ok || !response.body) {
      el.crMaking.hidden = true;
      if (make.html) finish(make.html);
      else previewError(el.crPreview, "That creation expired before it finished. Build it again.");
      return;
    }

    for await (const event of readEvents(response.body, abort.signal)) {
      switch (event.type) {
        case "status":
          el.crGhostText.textContent = event.text.replace(/\s+/g, " ").trim().slice(-120);
          break;
        case "text":
          html += event.text;
          el.crBar.style.width = `${Math.min(96, (html.length / expected) * 100).toFixed(0)}%`;
          break;
        case "error":
          el.crMaking.hidden = true;
          previewError(el.crPreview, event.message);
          save("failed");
          return;
        case "done":
          el.crBar.style.width = "100%";
          finish(html);
          return;
        default:
          break;
      }
    }

    if (html.trim()) finish(html);
    else { el.crMaking.hidden = true; previewError(el.crPreview, "That cut out before anything arrived. Try again."); }
  } catch (error) {
    if (error.name === "AbortError") { if (html.trim()) save("making"); return; }
    el.crMaking.hidden = true;
    previewError(el.crPreview, "Lost the connection. Open it again to pick it back up.");
    save("making");
  } finally {
    if (state.abort === abort) state.abort = null;
  }
}

function openCreation(make) {
  state.creation = make;
  el.crFit.hidden = true;
  el.crImproveForm.hidden = true;
  el.crPreview.replaceChildren();
  show("creation");

  if (make.status === "making") {
    el.crMaking.hidden = false;
    el.crTag.textContent = "Building";
    followCreation(make);
    return;
  }

  el.crMaking.hidden = true;
  el.crTag.textContent = "Your creation";
  el.crActions.hidden = false;
  if (make.html) {
    state.preview = mountPreview(el.crPreview, make.html);
    el.crStop.hidden = false;
  } else {
    previewError(el.crPreview, "This one never finished. Build it again from the idea.");
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

el.codeOpen.addEventListener("click", () => {
  el.codeForm.hidden = false;
  el.codeOpen.hidden = true;
  el.codeInput.focus();
});

el.codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = el.codeInput.value.trim();
  el.codeMsg.textContent = "";

  if (!/^ht_[0-9a-f]{48}$/.test(code)) {
    el.codeMsg.textContent = "That doesn't look like a code. They start with ht_.";
    return;
  }

  // Check it against the server before storing — a code that buys nothing
  // should be rejected here, not at the moment they try to spend it.
  try {
    const response = await fetch(`/api/credits?token=${encodeURIComponent(code)}`);
    const data = await response.json();

    if (!data.known) {
      el.codeMsg.textContent = "We don't recognise that code.";
      return;
    }

    setBookToken(code);
    state.credits = data.credits ?? 0;
    el.codeInput.value = "";
    el.codeForm.hidden = true;
    el.codeOpen.hidden = false;
    renderLibrary();
  } catch {
    el.codeMsg.textContent = "Couldn't reach the app. Try again.";
  }
});

function renderCredits() {
  const count = state.credits;
  if (!state.token) {
    el.credits.textContent = "No books left. Each one is researched from scratch, so each one is paid for.";
    return;
  }
  el.credits.innerHTML =
    count > 0
      ? `<strong>${count}</strong> book${count === 1 ? "" : "s"} left to make.`
      : "No books left. Add a code to make another.";
}

/**
 * The Idea Library: every idea, with what came of it.
 *
 * Lists ideas rather than outputs, because the idea is the thing a person
 * recognises a month later — "remember this one?" — and the creations hang off
 * it. The original text is the preview, never a generated summary.
 */
function renderLibrary() {
  renderCredits();
  refreshCredits().then(renderCredits);

  const ideas = store.list();
  const makes = store.listCreations();

  el.libraryEmpty.hidden = ideas.length > 0;
  el.libraryCount.textContent =
    ideas.length === 0
      ? ""
      : `${ideas.length} idea${ideas.length === 1 ? "" : "s"} · ${makes.length} built · kept on this phone`;

  el.books.replaceChildren();

  for (const idea of ideas) {
    const mine = makes.filter((make) => make.thoughtId === idea.id);

    const button = document.createElement("button");
    button.type = "button";

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = idea.title || extractTitle("", idea.thought);

    const meta = document.createElement("span");
    meta.className = mine.length ? "meta" : "meta undeveloped";
    const bits = [when(idea.createdAt)];
    if (mine.length) bits.push(`${mine.length} built`);
    if (idea.answers?.length) bits.push(`${idea.answers.length} answered`);
    if (idea.turns?.length) bits.push(`${idea.turns.length} pass${idea.turns.length === 1 ? "" : "es"}`);
    meta.textContent = bits.join(" · ");

    const snippet = document.createElement("span");
    snippet.className = "snippet";
    snippet.textContent = idea.thought;

    button.append(title, meta, snippet);
    button.addEventListener("click", () => openIdea(idea));

    const row = document.createElement("li");
    row.append(button);
    el.books.append(row);
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

el.exportAll.addEventListener("click", () => {
  const payload = JSON.stringify(store.exportAll(), null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `high-thoughts-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

/* ── Boot ───────────────────────────────────────────────────────────────── */

state.offer = loadOfferState();
state.token = bookToken();
refreshCredits();
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
