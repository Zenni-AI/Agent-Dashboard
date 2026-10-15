/**
 * Simulates N visitors submitting the form at the same moment and waits for every preview.
 *
 *   npm run loadtest -- --url http://localhost:3000 --visitors 100 --photo ./house.jpg
 *
 * Each visitor gets its own X-Forwarded-For address, so start the server with TRUST_PROXY=1 or the
 * per-IP rate limit will (correctly) stop most of them. Point it at a server running IMAGE_PROVIDER=mock
 * unless you mean to pay for N real renders.
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
  const body = (await res.json()) as { jobId?: string; error?: string };
  if (!res.ok || !body.jobId) return { ok: false, ms: performance.now() - t0, why: `${res.status} ${body.error}` };
  while (performance.now() - t0 < 10 * 60_000) {
    await sleep(1500);
    const job = (await (await fetch(`${base}/api/jobs/${body.jobId}`, { headers })).json()) as { status: string; error?: { code: string } };
    if (job.status === 'done') return { ok: true, ms: performance.now() - t0 };
    if (job.status === 'failed') return { ok: false, ms: performance.now() - t0, why: job.error?.code };
  }
  return { ok: false, ms: performance.now() - t0, why: 'timeout' };
}

console.log(`Sending ${n} simultaneous visitors to ${base}…`);
const started = performance.now();
const results = await Promise.all(Array.from({ length: n }, (_, i) => visitor(i)));
const times = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => (times.length ? (times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))]! / 1000).toFixed(1) : '-');
const failures = results.filter((r) => !r.ok);
console.log(`\n${times.length}/${n} previews delivered in ${((performance.now() - started) / 1000).toFixed(1)}s`);
console.log(`time to preview  p50 ${pct(50)}s   p90 ${pct(90)}s   max ${pct(100)}s`);
if (failures.length) {
  const reasons = new Map<string, number>();
  for (const f of failures) reasons.set(String(f.why), (reasons.get(String(f.why)) ?? 0) + 1);
  console.log('failures:', Object.fromEntries(reasons));
  process.exitCode = 1;
}
