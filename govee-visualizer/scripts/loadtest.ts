/**
 * Simulates N visitors submitting the form at the same moment and waits until each has all of their looks.
 *
 *   npm run loadtest -- --url http://localhost:3000 --visitors 100 --photo ./house.jpg
 *
 * Each visitor gets its own X-Forwarded-For address, so start the server with TRUST_PROXY=1 or the
 * per-IP rate limit will (correctly) stop most of them. Point it at a server running IMAGE_PROVIDER=mock
 * unless you mean to pay for N × (number of themes) real renders. Leave Twilio/SMTP unset too, or every
 * simulated visitor gets texted and emailed.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    visitors: { type: 'string', default: '100' },
    photo: { type: 'string' },
  },
});
const base = values.url!.replace(/\/+$/, '');
const n = Number(values.visitors);
const photo = values.photo
  ? await readFile(values.photo)
  : await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#9ab' } }).jpeg().toBuffer();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function visitor(i: number) {
  const headers = { 'x-forwarded-for': `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` };
  const t0 = performance.now();
  const form = new FormData();
  form.set('name', `Load Test ${i}`);
  form.set('email', `loadtest+${i}@example.com`);
  form.set('phone', '555-234-5678');
  form.set('address', `${i} Test St, Springfield`);
  form.set('consent', 'true');
  form.set('photo', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'house.jpg');
  const res = await fetch(`${base}/api/leads`, { method: 'POST', body: form, headers });
  const body = (await res.json()) as { designId?: string; error?: string };
  if (!res.ok || !body.designId) return { ok: false, ms: performance.now() - t0, why: `${res.status} ${body.error}` };
  let firstLook: number | undefined;
  while (performance.now() - t0 < 10 * 60_000) {
    await sleep(1500);
    const design = (await (await fetch(`${base}/api/designs/${body.designId}`, { headers })).json()) as {
      status: string;
      error?: { code: string };
      renders: Array<{ status: string }>;
    };
    if (firstLook === undefined && design.renders.some((r) => r.status === 'done')) firstLook = performance.now() - t0;
    if (design.status === 'done' && design.renders.every((r) => r.status === 'done')) return { ok: true, ms: performance.now() - t0, firstLook };
    if (design.status === 'done') return { ok: false, ms: performance.now() - t0, why: 'some looks failed' };
    if (design.status === 'failed') return { ok: false, ms: performance.now() - t0, why: design.error?.code };
  }
  return { ok: false, ms: performance.now() - t0, why: 'timeout' };
}

console.log(`Sending ${n} simultaneous visitors to ${base}…`);
const started = performance.now();
const results = await Promise.all(Array.from({ length: n }, (_, i) => visitor(i)));
const sorted = (xs: number[]) => xs.sort((a, b) => a - b);
const times = sorted(results.filter((r) => r.ok).map((r) => r.ms));
const firsts = sorted(results.flatMap((r) => ('firstLook' in r && r.firstLook !== undefined ? [r.firstLook] : [])));
const pctOf = (xs: number[]) => (p: number) => (xs.length ? (xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]! / 1000).toFixed(1) : '-');
const pct = pctOf(times);
const firstPct = pctOf(firsts);
const failures = results.filter((r) => !r.ok);
console.log(`\n${times.length}/${n} visitors got all their looks in ${((performance.now() - started) / 1000).toFixed(1)}s`);
console.log(`time to first look p50 ${firstPct(50)}s   p90 ${firstPct(90)}s   max ${firstPct(100)}s`);
console.log(`time to all looks  p50 ${pct(50)}s   p90 ${pct(90)}s   max ${pct(100)}s`);
if (failures.length) {
  const reasons = new Map<string, number>();
  for (const f of failures) reasons.set(String(f.why), (reasons.get(String(f.why)) ?? 0) + 1);
  console.log('failures:', Object.fromEntries(reasons));
  process.exitCode = 1;
}
