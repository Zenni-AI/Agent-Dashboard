// Screenshot a page of the site with headless Chromium (WebGL via SwiftShader).
// Usage: node dev/shot.mjs "<path?query>" out.png [width] [height]
//   node dev/shot.mjs "dev/harness.html?m=garage,solar&view=solar" /tmp/solar.png
//   node dev/shot.mjs "index.html#services" /tmp/site.png 1440 900
// Set WAIT=ms to keep rendering after ready (e.g. to let the intro play).
// Paths are relative to the pristine-world/ folder. Prints console errors and hotspot ids.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , target = 'dev/harness.html', out = 'shot.png', W = '1440', H = '810'] = process.argv;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:${port}/${target}`);
try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }); }
catch { logs.push('[shot] timed out waiting for window.__ready; capturing anyway'); }
await page.waitForTimeout(+(process.env.WAIT || 0));
await page.screenshot({ path: out, timeout: 180000 });
const info = await page.evaluate(() => ({ hotspots: window.__hotspots, errors: window.__errors })).catch(() => ({}));
console.log(JSON.stringify({ out, ...info, logs: logs.slice(0, 30) }, null, 1));
await browser.close();
server.close();
