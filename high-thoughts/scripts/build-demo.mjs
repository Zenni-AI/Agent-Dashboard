/**
 * Assemble a single-file, self-contained demo of the app.
 *
 * Generated from the real `public/` sources rather than written by hand, so
 * the demo cannot quietly drift from what actually ships. The only thing it
 * replaces is the network: `fetch` is stubbed with canned model output, since
 * a demo has no API key and no server behind it.
 *
 *   node scripts/build-demo.mjs [outfile]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, "..", "public");
const out = resolve(process.argv[2] ?? join(HERE, "..", "demo.html"));

const read = (name) => readFileSync(join(PUB, name), "utf8");

/** Strip module syntax so the files can be concatenated into one script. */
function flatten(source) {
  return source
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm, "")
    .replace(/^import\s+\{[\s\S]*?\}\s+from\s+["'][^"']+["'];\n/gm, "")
    .replace(/^export\s+/gm, "");
}

const html = read("index.html");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"))
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .trim();

/*
 * The creations baked into the demo are real generations, kept verbatim.
 *
 * Base64 rather than inlined as string literals: a creation is a complete HTML
 * document, so it contains `</scr` + `ipt>` and every kind of quote, and
 * embedding one directly ends the surrounding script tag and breaks the page.
 * Base64 has no character that can escape its context.
 */
const creations = Object.fromEntries(
  ["flying-car", "alarm-clock", "cereal-box"].map((name) => [
    name,
    readFileSync(join(HERE, "demo-creations", `${name}.html`)).toString("base64"),
  ]),
);

/*
 * Order matters: app.js calls into all of them, and the store shim has to sit
 * between store.js and its first caller. Keyed by name rather than position,
 * because an index-based list silently drops a module the moment one is added.
 */
const MODULES = ["markdown.js", "preview.js", "store.js", "offer.js", "profile.js", "app.js"];

const flattened = Object.fromEntries(
  MODULES.map((name) => [
    name,
    `/* \u2500\u2500 ${name} ${"\u2500".repeat(Math.max(0, 60 - name.length))} */\n${flatten(read(name))}`,
  ]),
);

// app.js reaches the store through a namespace import; rebuild it by hand.
const storeShim = `
const store = {
  newId, list, get, capture, addTurn, remove, setMark, markMap, chainFor,
  historyFor, listBooks, getBook, saveBook, removeBook,
  addAnswer, clearAnswers, listCreations, getCreation, saveCreation,
  removeCreation, unfinishedCreations, exportAll,
};
`;

const ordered = MODULES.flatMap((name) =>
  name === "offer.js" ? [storeShim, flattened[name]] : [flattened[name]],
);

const script = [
  `const DEMO_CREATIONS_B64 = ${JSON.stringify(creations)};
const DEMO_CREATIONS = Object.fromEntries(
  Object.entries(DEMO_CREATIONS_B64).map(([name, b64]) => [
    name,
    // atob gives bytes, not characters — decode as UTF-8 or every \u00a3 and \u2014 breaks.
    new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))),
  ]),
);`,
  readFileSync(join(HERE, "demo-backend.js"), "utf8"),
  ...ordered,
].join("\n\n");

// Every module must survive into the bundle; a missing one fails silently at
// runtime, which is exactly how app.js was dropped when preview.js was added.
for (const name of MODULES) {
  if (!script.includes(`\u2500\u2500 ${name} `)) throw new Error(`demo build lost ${name}`);
}

writeFileSync(
  out,
  `<title>High Thoughts</title>
<style>
${read("styles.css")}
${readFileSync(join(HERE, "demo-frame.css"), "utf8")}
</style>

<div class="demo-note" id="demo-note">
  <strong>Live demo.</strong> The real app — every screen, every interaction,
  real creations. The questions and the builds are ones the app actually
  produced earlier; there's no API key behind this page.
  <button type="button" id="demo-note-close" aria-label="Dismiss">Got it</button>
</div>

${body}

<script type="module">
${script}

const note = document.getElementById("demo-note");
document.getElementById("demo-note-close").addEventListener("click", () => {
  note.hidden = true;
});
</script>
`,
  "utf8",
);

console.log(`wrote ${out} (${(script.length / 1024).toFixed(0)} KB of script)`);
