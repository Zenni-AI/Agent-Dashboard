import { extractSnippet, extractTitle, renderMarkdown } from "./markdown.js";
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
};

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
  show("result");

  if (develop) {
    runDevelopment(develop);
    return;
  }

  // Re-opened from the log: show what is already there.
  const turns = thought.turns ?? [];
  const last = turns[turns.length - 1];
  if (last) {
    el.resultMode.textContent = modeLabel(last.mode);
    el.answer.innerHTML = renderMarkdown(last.text);
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
  el.answer.innerHTML = renderMarkdown(answer);

  const updated = store.addTurn(thought.id, {
    mode: modeId,
    text: answer,
    title: extractTitle(answer, thought.thought),
    at: Date.now(),
  });

  if (updated) state.current = updated;
  renderAgain();
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

function renderLog() {
  const thoughts = store.list();

  el.logEmpty.hidden = thoughts.length > 0;
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

    button.append(title, meta, snippet);
    button.addEventListener("click", () => openThought(thought));

    const item = document.createElement("li");
    item.append(button);
    el.log.append(item);
  }
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

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
