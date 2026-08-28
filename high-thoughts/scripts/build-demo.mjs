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

// Order matters: app.js calls into all of them.
const modules = ["markdown.js", "store.js", "offer.js", "profile.js", "app.js"].map((name) =>
  `/* ── ${name} ${"─".repeat(Math.max(0, 60 - name.length))} */\n${flatten(read(name))}`,
);

// app.js reaches the store through a namespace import; rebuild it by hand.
const storeShim = `
const store = {
  newId, list, get, capture, addTurn, remove, setMark, markMap, chainFor,
  historyFor, listBooks, getBook, saveBook, removeBook,
};
`;

const script = [
  readFileSync(join(HERE, "demo-backend.js"), "utf8"),
  modules[0],
  modules[1],
  storeShim,
  modules[2],
  modules[3],
  modules[4],
].join("\n\n");

writeFileSync(
  out,
  `<title>High Thoughts</title>
<style>
${read("styles.css")}
${readFileSync(join(HERE, "demo-frame.css"), "utf8")}
</style>

<div class="demo-note" id="demo-note">
  <strong>Live demo.</strong> The real app — every screen, every interaction.
  Model answers are canned, since there's no API key behind it.
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
