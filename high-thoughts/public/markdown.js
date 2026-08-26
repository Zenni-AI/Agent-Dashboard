/**
 * The smallest markdown renderer that covers what the model is allowed to emit:
 * one `#` title, `##` section headings, paragraphs, numbered and bulleted
 * lists, `**bold**` and `*italic*`.
 *
 * It is hand-rolled rather than pulled from a library for one reason that
 * matters and one that does not. The one that matters: everything is escaped
 * before any tag is produced, so a model response can never inject markup into
 * the page. The one that does not: no build step, no dependency, no bundle.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** Inline spans. Runs on already-escaped text, so it can only ever add tags. */
function inline(escaped) {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderMarkdown(source) {
  const lines = String(source).replace(/\r\n/g, "\n").split("\n");
  const out = [];

  /** @type {null | {tag: "ol" | "ul", items: string[]}} */
  let list = null;
  /** @type {string[]} */
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(escapeHtml(paragraph.join(" ")))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join("");
    out.push(`<${list.tag}>${items}</${list.tag}>`);
    list = null;
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inline(escapeHtml(heading[2].trim()))}</h${level}>`);
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      if (list?.tag !== "ol") {
        flushList();
        list = { tag: "ol", items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    const bulleted = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bulleted) {
      flushParagraph();
      if (list?.tag !== "ul") {
        flushList();
        list = { tag: "ul", items: [] };
      }
      list.items.push(bulleted[1]);
      continue;
    }

    // A plain line while a list is open continues the last item rather than
    // starting a paragraph mid-list — the model wraps long items.
    if (list && list.items.length > 0) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    paragraph.push(line.trim());
  }

  flushAll();
  return out.join("");
}

/**
 * The name the model gave the idea — its leading `# ` line.
 * Falls back to the opening of the raw thought, which is always present.
 */
export function extractTitle(answer, fallback) {
  const match = /^\s*#\s+(.+)$/m.exec(String(answer));
  const title = match?.[1]?.trim().replace(/^["'"]|["'"]$/g, "");
  if (title) return title;

  const words = String(fallback).trim().split(/\s+/).slice(0, 6).join(" ");
  return words || "Untitled";
}

/**
 * The first line of real prose, for the log's two-line preview.
 *
 * Headings are dropped line by line rather than block by block: every block of
 * a finished answer opens with its `## ` heading, so discarding whole blocks
 * discards the entire answer.
 */
export function extractSnippet(answer) {
  for (const raw of String(answer).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const clean = line
      .replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "")
      .replace(/[*`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean) return clean;
  }
  return "";
}
