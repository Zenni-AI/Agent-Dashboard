/**
 * Showing a creation without letting it near anything.
 *
 * A prototype is HTML *and JavaScript* written by a model, and it has to run to
 * be worth anything. It runs a few pixels away from every idea this person has
 * ever had, sitting in localStorage on this origin. So the frame gets exactly
 * the privileges it needs to draw and move, and nothing else.
 *
 * Four independent walls, because any one of them can be wrong:
 *
 *   1. `sandbox="allow-scripts"` and nothing more. `allow-same-origin` is the
 *      one flag that must never appear beside it — together they let the frame
 *      reach into this document and delete its own sandbox attribute.
 *   2. An opaque origin, which srcdoc + (1) produces. The frame's localStorage,
 *      cookies and IndexedDB are not ours and cannot reach ours.
 *   3. A Content-Security-Policy injected into the frame itself. This is the
 *      wall the sandbox does NOT provide: without `connect-src 'none'` a
 *      sandboxed frame can still fetch() anything it likes, which is how a
 *      page that has read something interesting would send it away.
 *   4. External references stripped before the document is ever constructed,
 *      so a blocked request is never even attempted.
 *
 * We also never listen to the frame except through one validated, numbers-only
 * channel (see `onFit`), and we never put its HTML anywhere but `srcdoc`.
 */

/** Everything the frame is allowed to do. Deliberately one token long. */
const SANDBOX = "allow-scripts";

/**
 * `default-src 'none'` denies anything not named below. The inline allowances
 * exist because the whole document is inline by construction; `connect-src`,
 * `form-action`, `frame-src` and `base-uri` are the ones that close
 * exfiltration, navigation and nested frames.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

/** Anything that would pull bytes from off-origin, or take us somewhere. */
const EXTERNAL = [
  // <script src="…"> — the supply-chain hole.
  /<script\b[^>]*\bsrc\s*=\s*(["'])(?:(?!\1).)*\1[^>]*>\s*<\/script\s*>/gi,
  /<script\b[^>]*\bsrc\s*=\s*[^\s>]+[^>]*>\s*<\/script\s*>/gi,
  // <link rel=stylesheet|preload|…> — fonts and CSS phone home too.
  /<link\b[^>]*>/gi,
  // <base> would re-point every relative URL in the document.
  /<base\b[^>]*>/gi,
  // Nested frames of any kind.
  /<iframe\b[\s\S]*?<\/iframe\s*>/gi,
  /<(iframe|frame|embed|object|applet)\b[^>]*>/gi,
  // A meta refresh is navigation by another name.
  /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi,
  // Their own CSP, so ours is the only one and the result is predictable.
  /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
];

/**
 * Strip what must never load, and report what was found.
 *
 * The CSP would block these anyway. Removing them first means the frame never
 * attempts the request, so nothing leaks through a DNS lookup, and the console
 * stays legible for the person debugging their own creation.
 */
export function sanitizePrototype(html) {
  let out = String(html ?? "");
  const removed = [];

  for (const pattern of EXTERNAL) {
    out = out.replace(pattern, (match) => {
      removed.push(match.slice(0, 80));
      return "";
    });
  }

  // Models sometimes wrap the document in a markdown fence.
  out = out.replace(/^\s*```+\s*html?\s*/i, "").replace(/```+\s*$/, "").trim();

  return { html: injectCsp(out), removed };
}

/** Put our policy first, before anything it governs. */
function injectCsp(html) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (head) => `${head}\n${meta}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>${meta}</head>`);
  }
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

/**
 * A tiny probe appended to the document, which measures whether any text has
 * been drawn outside its container — the one generator defect we see often
 * enough to catch automatically.
 *
 * It reports a single number. Nothing it sends is ever executed, inserted into
 * the DOM, or trusted for anything beyond showing a "looks clipped" hint.
 */
const FIT_PROBE = `<script>(function(){
  try {
    function clipped(){
      var n = 0, w = document.documentElement.clientWidth;
      document.querySelectorAll('svg text, svg tspan').forEach(function(t){
        var svg = t.ownerSVGElement; if (!svg) return;
        var b; try { b = t.getBBox(); } catch (e) { return; }
        var vb = svg.viewBox && svg.viewBox.baseVal;
        if (!vb || !vb.width) return;
        if (b.x < vb.x - 1 || b.x + b.width > vb.x + vb.width + 1) n++;
      });
      document.querySelectorAll('body *').forEach(function(el){
        if (el.scrollWidth > w + 2 && getComputedStyle(el).overflowX === 'visible') n++;
      });
      return n;
    }
    function report(){ parent.postMessage({ source: 'high-thoughts-preview', overflow: clipped() }, '*'); }
    if (document.readyState === 'complete') setTimeout(report, 900);
    else addEventListener('load', function(){ setTimeout(report, 900); });
  } catch (e) {}
})();<\/script>`;

/**
 * Put a creation on screen.
 *
 * `onFit` receives a count of elements that appear to be drawn outside their
 * container. The message is accepted only from this exact frame and only as a
 * number; everything else is discarded.
 */
export function mountPreview(container, html, { onFit = null } = {}) {
  const { html: safe, removed } = sanitizePrototype(html);

  container.replaceChildren();

  const frame = document.createElement("iframe");
  frame.className = "preview-frame";
  frame.setAttribute("sandbox", SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  // Deny every powerful feature outright, in case a future browser would
  // otherwise inherit one from this page.
  frame.setAttribute(
    "allow",
    "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; usb 'none'; midi 'none'; display-capture 'none'",
  );
  frame.setAttribute("title", "Your creation");
  frame.setAttribute("loading", "eager");

  let listener = null;
  if (onFit) {
    listener = (event) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== "high-thoughts-preview") return;
      const overflow = Number(data.overflow);
      if (Number.isFinite(overflow)) onFit(overflow);
    };
    window.addEventListener("message", listener);
  }

  frame.srcdoc = onFit ? safe + FIT_PROBE : safe;
  container.append(frame);

  return {
    frame,
    removed,
    /** Take it off screen and stop whatever it is doing. */
    stop() {
      if (listener) window.removeEventListener("message", listener);
      frame.remove();
    },
  };
}

/** What to show when there is nothing safe to show. */
export function previewError(container, message) {
  container.replaceChildren();
  const box = document.createElement("p");
  box.className = "preview-failed";
  box.textContent = message;
  container.append(box);
}
