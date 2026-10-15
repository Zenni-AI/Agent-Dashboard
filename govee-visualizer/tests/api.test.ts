import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { ImageStore } from '../src/images.js';
import { LeadStore } from '../src/leads.js';
import { MockProvider } from '../src/providers/mock.js';
import { StreetView } from '../src/streetview.js';
import { houseJpeg, tempDir, testConfig } from './helpers.js';

const teardown: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (teardown.length) await teardown.pop()!();
});

async function start(overrides: Partial<Config> = {}, streetView = new StreetView('')) {
  const tmp = tempDir();
  const config = testConfig({ dataDir: tmp.dir, ...overrides });
  const images = new ImageStore(config.dataDir);
  await images.init();
  const leads = new LeadStore(config.dataDir);
  const { app, queue } = createApp({ config, leads, images, streetView, provider: new MockProvider(config.mockDelayMs) });
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  teardown.push(async () => {
    await new Promise((r) => server.close(r));
    queue.close();
    leads.close();
    tmp.cleanup();
  });
  return { base, leads, queue };
}

async function leadForm(fields: Record<string, string> = {}, photo?: Buffer) {
  const form = new FormData();
  const all = { name: 'Jane Smith', email: 'jane@example.com', phone: '555-234-5678', address: '1 Main St, Springfield', consent: 'true', theme: 'christmas', ...fields };
  for (const [k, v] of Object.entries(all)) form.set(k, v);
  if (photo) form.set('photo', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'house.jpg');
  return form;
}

async function waitForJob(base: string, jobId: string, headers: Record<string, string> = {}) {
  for (let i = 0; i < 400; i++) {
    const job = await (await fetch(`${base}/api/jobs/${jobId}`, { headers })).json();
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}

describe('lead → preview flow', () => {
  it('saves the lead, renders an uploaded photo and serves both images', async () => {
    const { base, leads } = await start();
    const res = await fetch(`${base}/api/leads`, { method: 'POST', body: await leadForm({}, await houseJpeg()) });
    expect(res.status).toBe(202);
    const { leadId, jobId, rendersRemaining } = await res.json();
    expect(rendersRemaining).toBe(2);

    const lead = leads.get(leadId)!;
    expect(lead).toMatchObject({ name: 'Jane Smith', email: 'jane@example.com', phone: '+15552345678', consent: true });

    const job = await waitForJob(base, jobId);
    expect(job.status).toBe('done');
    expect(job.result.source).toBe('upload');
    expect(job.result.themeId).toBe('christmas');
    for (const url of [job.result.beforeUrl, job.result.afterUrl]) {
      const img = await fetch(base + url);
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/jpeg');
      const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
      expect(meta.format).toBe('jpeg');
    }
    expect(leads.get(leadId)!.lastAfterImage).toBe(job.result.afterUrl.replace('/img/', ''));
  });

  it('re-renders with a new theme reusing the last photo, up to the per-lead limit', async () => {
    const { base } = await start();
    const first = await (await fetch(`${base}/api/leads`, { method: 'POST', body: await leadForm({}, await houseJpeg()) })).json();
    const firstJob = await waitForJob(base, first.jobId);

    const again = (theme: string) => {
      const f = new FormData();
      f.set('theme', theme);
      f.set('reuse', 'last');
      return fetch(`${base}/api/leads/${first.leadId}/renders`, { method: 'POST', body: f });
    };
    const second = await again('halloween');
    expect(second.status).toBe(202);
    const secondJob = await waitForJob(base, (await second.json()).jobId);
    expect(secondJob.status).toBe('done');
    expect(secondJob.result.beforeUrl).toBe(firstJob.result.beforeUrl);
    expect(secondJob.result.themeId).toBe('halloween');

    await waitForJob(base, (await (await again('rainbow')).json()).jobId);
    const fourth = await again('patriotic');
    expect(fourth.status).toBe(429);
  });

  it('asks for a photo when Street View is not configured, without charging a render', async () => {
    const { base, leads } = await start();
    const res = await (await fetch(`${base}/api/leads`, { method: 'POST', body: await leadForm() })).json();
    const job = await waitForJob(base, res.jobId);
    expect(job.status).toBe('failed');
    expect(job.error.code).toBe('no_street_view');
    expect(leads.get(res.leadId)!.renderCount).toBe(0);
  });

  it('uses Street View when no photo is uploaded', async () => {
    const jpeg = await houseJpeg(640, 480);
    const fake = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/geocode/json'))
        return Response.json({ status: 'OK', results: [{ formatted_address: '1 Main St, Springfield, IL, USA', place_id: 'p1', geometry: { location: { lat: 40.0005, lng: -75 }, location_type: 'ROOFTOP' } }] });
      if (url.includes('/streetview/metadata')) return Response.json({ status: 'OK', pano_id: 'P', location: { lat: 40, lng: -75 } });
      return new Response(new Uint8Array(jpeg), { headers: { 'content-type': 'image/jpeg' } });
    }) as typeof fetch;
    const { base, leads } = await start({}, new StreetView('KEY', fake));
    const res = await (await fetch(`${base}/api/leads`, { method: 'POST', body: await leadForm() })).json();
    const job = await waitForJob(base, res.jobId);
    expect(job.status).toBe('done');
    expect(job.result.source).toBe('streetview');
    expect(job.result.formattedAddress).toBe('1 Main St, Springfield, IL, USA');
    expect(leads.get(res.leadId)).toMatchObject({ lat: 40.0005, lng: -75, lastSource: 'streetview' });
  });
});

describe('input handling', () => {
  it('rejects invalid leads with a readable message', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/leads`, { method: 'POST', body: await leadForm({ phone: '12' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/phone/i);
  });

  it('rejects files that are not images, before saving a lead', async () => {
    const { base, leads } = await start();
    const res = await fetch(`${base}/api/leads`, { method: 'POST', body: await leadForm({}, Buffer.from('<?php echo 1; ?>')) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('bad_image');
    expect(leads.all()).toHaveLength(0);
  });

  it('does not serve arbitrary files from /img', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/img/..%2Fleads.db`)).status).toBe(404);
    expect((await fetch(`${base}/img/leads.db`)).status).toBe(404);
  });

  it('404s unknown leads and jobs', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/leads/not-a-uuid/renders`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}/api/jobs/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
  });
});

describe('admin export', () => {
  it('requires the admin password', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/admin/leads.csv`)).status).toBe(401);
    const wrong = `Basic ${Buffer.from('admin:nope').toString('base64')}`;
    expect((await fetch(`${base}/admin/leads.csv`, { headers: { authorization: wrong } })).status).toBe(401);
  });

  it('exports leads as CSV', async () => {
    const { base } = await start();
    await fetch(`${base}/api/leads`, { method: 'POST', body: await leadForm() });
    const res = await fetch(`${base}/admin/leads.csv`, { headers: { authorization: `Basic ${Buffer.from('admin:hunter2').toString('base64')}` } });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv.split('\r\n')[0]).toContain('email');
    expect(csv).toContain('jane@example.com');
  });

  it('is disabled when no password is set', async () => {
    const { base } = await start({ adminPassword: '' });
    const res = await fetch(`${base}/admin/leads.csv`, { headers: { authorization: `Basic ${Buffer.from('admin:').toString('base64')}` } });
    expect(res.status).toBe(401);
  });
});

describe('under load', () => {
  it('serves 100 simultaneous visitors with bounded provider concurrency', async () => {
    const { base, queue } = await start({ maxConcurrentGenerations: 10, mockDelayMs: 30 });
    const photo = await houseJpeg(400, 300);
    const results = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const res = await fetch(`${base}/api/leads`, {
          method: 'POST',
          body: await leadForm({ email: `v${i}@example.com` }, photo),
          headers: { 'x-forwarded-for': `10.0.${i >> 8}.${i & 255}` },
        });
        return res.status;
      }),
    );
    // Without TRUST_PROXY the forwarded header is ignored, so the per-IP limit (10) applies.
    expect(results.filter((s) => s === 202)).toHaveLength(10);
    expect(results.filter((s) => s === 429)).toHaveLength(90);
    await queue.onIdle();
  });

  it('with trust proxy, 100 distinct visitors all get previews', async () => {
    const { base, queue } = await start({ maxConcurrentGenerations: 10, mockDelayMs: 30, trustProxy: 1 });
    const photo = await houseJpeg(400, 300);
    let peak = 0;
    const timer = setInterval(() => (peak = Math.max(peak, queue.stats().running)), 2);
    const jobs = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const res = await fetch(`${base}/api/leads`, {
          method: 'POST',
          body: await leadForm({ email: `v${i}@example.com` }, photo),
          headers: { 'x-forwarded-for': `10.0.${i >> 8}.${i & 255}` },
        });
        expect(res.status).toBe(202);
        return { id: (await res.json()).jobId as string, ip: `10.0.${i >> 8}.${i & 255}` };
      }),
    );
    const finished = await Promise.all(jobs.map(({ id, ip }) => waitForJob(base, id, { 'x-forwarded-for': ip })));
    clearInterval(timer);
    expect(finished.every((j) => j.status === 'done')).toBe(true);
    expect(peak).toBeLessThanOrEqual(10);
  }, 60_000);
});
