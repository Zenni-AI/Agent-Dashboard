import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { openDb } from '../src/db.js';
import { DesignStore } from '../src/designStore.js';
import { DesignService } from '../src/designs.js';
import { ImageStore } from '../src/images.js';
import { LeadStore } from '../src/leads.js';
import { Notifier } from '../src/notify.js';
import { MockProvider } from '../src/providers/mock.js';
import type { ImageProvider } from '../src/providers/index.js';
import { JobFailure } from '../src/queue.js';
import { StreetView } from '../src/streetview.js';
import { houseJpeg, tempDir, testConfig } from './helpers.js';

const teardown: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (teardown.length) await teardown.pop()!();
});

interface Harness {
  base: string;
  leads: LeadStore;
  store: DesignStore;
  service: DesignService;
  sms: URLSearchParams[];
  emails: Array<Record<string, any>>;
  dataDir: string;
}

const NOTIFY_CONFIG: Partial<Config> = {
  publicBaseUrl: 'https://lights.example.com',
  twilioAccountSid: 'AC123',
  twilioAuthToken: 'secret',
  twilioFrom: '+15550001111',
  emailFrom: 'Glow Pros <hello@example.com>',
  businessName: 'Glow Pros',
  businessPhone: '(555) 234-5678',
};

function build(config: Config, opts: { streetView?: StreetView; provider?: ImageProvider } = {}) {
  const images = new ImageStore(config.dataDir);
  const db = openDb(config.dataDir);
  const leads = new LeadStore(db);
  const store = new DesignStore(db);
  const sms: URLSearchParams[] = [];
  const emails: Array<Record<string, any>> = [];
  const twilio = (async (_url: string | URL, init?: RequestInit) => {
    sms.push(new URLSearchParams(init!.body as URLSearchParams));
    return Response.json({ sid: 'SM1' }, { status: 201 });
  }) as typeof fetch;
  const notifier = new Notifier(config, { fetchFn: twilio, mail: { sendMail: async (m) => void emails.push(m as Record<string, any>) } });
  const streetView = opts.streetView ?? new StreetView('');
  const provider = opts.provider ?? new MockProvider(config.mockDelayMs);
  const service = new DesignService({ config, leads, designs: store, images, streetView, provider, notifier });
  return { images, db, leads, store, service, notifier, streetView, provider, sms, emails };
}

async function start(overrides: Partial<Config> = {}, opts: { streetView?: StreetView; provider?: ImageProvider } = {}): Promise<Harness> {
  const tmp = tempDir();
  const config = testConfig({ dataDir: tmp.dir, ...NOTIFY_CONFIG, ...overrides });
  const parts = build(config, opts);
  await parts.images.init();
  const app = createApp({ config, leads: parts.leads, images: parts.images, streetView: parts.streetView, provider: parts.provider, notifier: parts.notifier, designs: parts.service });
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  teardown.push(async () => {
    await new Promise((r) => server.close(r));
    await parts.service.onIdle();
    parts.service.close();
    parts.db.close();
    tmp.cleanup();
  });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, ...parts, dataDir: tmp.dir };
}

async function leadForm(fields: Record<string, string> = {}, photo?: Buffer) {
  const form = new FormData();
  const all = { name: 'Jane Smith', email: 'jane@example.com', phone: '555-234-5678', address: '1 Main St, Springfield', consent: 'true', ...fields };
  for (const [k, v] of Object.entries(all)) form.set(k, v);
  if (photo) form.set('photo', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'house.jpg');
  return form;
}

async function submit(base: string, fields: Record<string, string> = {}, photo?: Buffer, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/leads`, { method: 'POST', body: await leadForm(fields, photo), headers });
  return { status: res.status, body: (await res.json()) as { designId?: string; error?: string; code?: string } };
}

async function waitForDesign(base: string, id: string, headers: Record<string, string> = {}) {
  for (let i = 0; i < 600; i++) {
    const view = await (await fetch(`${base}/api/designs/${id}`, { headers })).json();
    if (view.status === 'done' || view.status === 'failed') return view;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('design never finished');
}

const fakeStreetView = async () => {
  const jpeg = await houseJpeg(640, 480);
  return new StreetView('KEY', (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('/geocode/json'))
      return Response.json({ status: 'OK', results: [{ formatted_address: '1 Main St, Springfield, IL, USA', place_id: 'p1', geometry: { location: { lat: 40.0002, lng: -75 }, location_type: 'ROOFTOP' } }] });
    if (url.includes('/streetview/metadata')) return Response.json({ status: 'OK', pano_id: 'P', location: { lat: 40, lng: -75 } });
    return new Response(new Uint8Array(jpeg), { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch);
};

describe('address → Street View → three looks → text + email', () => {
  it('renders every theme from Street View and sends one text and one email', async () => {
    const h = await start({}, { streetView: await fakeStreetView() });
    const { status, body } = await submit(h.base);
    expect(status).toBe(202);
    expect(body.designId).toMatch(/^[a-f0-9]{32}$/);

    const view = await waitForDesign(h.base, body.designId!);
    expect(view).toMatchObject({ status: 'done', source: 'streetview', firstName: 'Jane', formattedAddress: '1 Main St, Springfield, IL, USA' });
    expect(view.renders.map((r: any) => [r.themeId, r.status])).toEqual([
      ['warm_white', 'done'],
      ['holiday', 'done'],
      ['multicolor', 'done'],
    ]);
    for (const url of [view.beforeUrl, ...view.renders.map((r: any) => r.afterUrl)]) {
      const img = await fetch(h.base + url);
      expect(img.status).toBe(200);
      expect((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).format).toBe('jpeg');
    }

    await h.service.onIdle();
    expect(h.sms).toHaveLength(1);
    const text = h.sms[0]!;
    expect(text.get('To')).toBe('+15552345678');
    expect(text.get('From')).toBe('+15550001111');
    expect(text.get('Body')).toContain(`https://lights.example.com/d/${body.designId}`);
    expect(text.get('Body')).toContain('Reply STOP');
    expect(text.get('MediaUrl')).toBe(`https://lights.example.com${view.renders[0].afterUrl}`);

    expect(h.emails).toHaveLength(1);
    const email = h.emails[0]!;
    expect(email.to).toBe('jane@example.com');
    expect(email.attachments).toHaveLength(3);
    expect(email.html).toContain(`https://lights.example.com/d/${body.designId}`);
    expect(email.html).toContain('cid:look2@design');

    expect(h.store.get(body.designId!)).toMatchObject({ smsStatus: 'sent', emailStatus: 'sent' });
    const after = await (await fetch(`${h.base}/api/designs/${body.designId}`)).json();
    expect(after.delivery).toEqual({ sms: 'sent', email: 'sent' });
    expect(h.leads.get(h.store.get(body.designId!)!.leadId)).toMatchObject({ lat: 40.0002, lng: -75 });
  });

  it('uses an uploaded photo instead of Street View', async () => {
    const h = await start();
    const { body } = await submit(h.base, {}, await houseJpeg());
    const view = await waitForDesign(h.base, body.designId!);
    expect(view.status).toBe('done');
    expect(view.source).toBe('upload');
  });

  it('sends what finished when one look fails, and nothing when all fail', async () => {
    const flaky: ImageProvider = {
      name: 'flaky',
      async render(req) {
        if (req.themeId === 'holiday') throw new JobFailure('render_blocked', 'nope');
        return new MockProvider(5).render(req);
      },
    };
    const h = await start({}, { provider: flaky });
    const { body } = await submit(h.base, {}, await houseJpeg());
    const view = await waitForDesign(h.base, body.designId!);
    expect(view.status).toBe('done');
    expect(view.renders.find((r: any) => r.themeId === 'holiday').status).toBe('failed');
    await h.service.onIdle();
    expect(h.emails[0]!.attachments).toHaveLength(2);

    const broken: ImageProvider = { name: 'broken', render: async () => Promise.reject(new JobFailure('render_blocked', 'nope')) };
    const h2 = await start({}, { provider: broken });
    const r2 = await submit(h2.base, {}, await houseJpeg());
    expect((await waitForDesign(h2.base, r2.body.designId!)).status).toBe('failed');
    await h2.service.onIdle();
    expect(h2.sms).toHaveLength(0);
    expect(h2.emails).toHaveLength(0);
  });

  it('skips texts and emails cleanly when they are not configured', async () => {
    const h = await start({ twilioAccountSid: '', emailFrom: '' });
    const { body } = await submit(h.base, {}, await houseJpeg());
    await waitForDesign(h.base, body.designId!);
    await h.service.onIdle();
    expect(h.sms).toHaveLength(0);
    expect(h.store.get(body.designId!)).toMatchObject({ smsStatus: 'disabled', emailStatus: 'disabled' });
  });
});

describe('when Street View cannot find the house', () => {
  it('asks for a photo, then builds a new design from it, up to the per-lead limit', async () => {
    const h = await start();
    const { body } = await submit(h.base);
    const failed = await waitForDesign(h.base, body.designId!);
    expect(failed).toMatchObject({ status: 'failed', canUploadPhoto: true, error: { code: 'no_street_view' } });
    expect(failed.beforeUrl).toBeUndefined();

    const upload = async (designId: string) => {
      const f = new FormData();
      f.set('photo', new Blob([new Uint8Array(await houseJpeg())], { type: 'image/jpeg' }), 'house.jpg');
      return fetch(`${h.base}/api/designs/${designId}/photo`, { method: 'POST', body: f });
    };
    const res = await upload(body.designId!);
    expect(res.status).toBe(202);
    const second = (await res.json()).designId;
    const view = await waitForDesign(h.base, second);
    expect(view).toMatchObject({ status: 'done', source: 'upload', canUploadPhoto: false });

    expect((await upload(second)).status).toBe(429); // maxDesignsPerLead = 2
  });
});

describe('restarts', () => {
  it('finishes interrupted renders and still notifies after a restart', async () => {
    const tmp = tempDir();
    teardown.push(tmp.cleanup);
    const config = testConfig({ dataDir: tmp.dir, ...NOTIFY_CONFIG });

    // "Before the crash": a design whose renders were queued but never ran, and a finished design never notified.
    const before = build(config);
    await before.images.init();
    const lead = before.leads.create({ name: 'Sam Lee', email: 'sam@example.com', phone: '+15552345678', address: '9 Oak St', consent: true });
    const photo = await before.images.save(await houseJpeg());
    const interrupted = before.store.create(lead.id, ['warm_white', 'holiday', 'multicolor'], photo);
    const finished = before.store.create(lead.id, ['warm_white'], photo);
    before.store.setRender(finished.id, 'warm_white', { afterImage: photo });
    expect(before.store.settleIfComplete(finished.id)).toBe(true);
    before.service.close();
    before.db.close();

    const after = build(config);
    after.service.resume();
    await after.service.onIdle();
    expect(after.store.get(interrupted.id)!.status).toBe('done');
    expect(after.store.get(interrupted.id)!.renders.every((r) => r.status === 'done')).toBe(true);
    expect(after.sms).toHaveLength(2);
    expect(after.emails).toHaveLength(2);

    // Resuming again must not text anyone twice.
    after.service.resume();
    await after.service.onIdle();
    expect(after.sms).toHaveLength(2);
    after.service.close();
    after.db.close();
  });
});

describe('input handling', () => {
  it('rejects invalid leads with a readable message', async () => {
    const h = await start();
    const { status, body } = await submit(h.base, { phone: '12' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/phone/i);
  });

  it('rejects files that are not images, before saving a lead', async () => {
    const h = await start();
    const { status, body } = await submit(h.base, {}, Buffer.from('<?php echo 1; ?>'));
    expect(status).toBe(400);
    expect(body.code).toBe('bad_image');
    expect(h.leads.all()).toHaveLength(0);
  });

  it('does not serve arbitrary files from /img', async () => {
    const h = await start();
    expect((await fetch(`${h.base}/img/..%2Fleads.db`)).status).toBe(404);
    expect((await fetch(`${h.base}/img/leads.db`)).status).toBe(404);
  });

  it('serves the shareable design page and 404s unknown designs', async () => {
    const h = await start();
    const page = await fetch(`${h.base}/d/${'a'.repeat(32)}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect((await fetch(`${h.base}/d/not-an-id`, { redirect: 'manual' })).status).toBe(302);
    expect((await fetch(`${h.base}/api/designs/${'a'.repeat(32)}`)).status).toBe(404);
    expect((await fetch(`${h.base}/api/designs/${'a'.repeat(32)}/photo`, { method: 'POST' })).status).toBe(404);
  });

  it('turns visitors away politely when the line is full', async () => {
    const h = await start({ maxQueueLength: 2, maxConcurrentGenerations: 1 });
    const { status, body } = await submit(h.base, {}, await houseJpeg());
    expect(status).toBe(503);
    expect(body.error).toMatch(/try again/i);
    expect(h.leads.all()).toHaveLength(1); // the lead is still kept
  });
});

describe('admin export', () => {
  it('requires the admin password', async () => {
    const h = await start();
    expect((await fetch(`${h.base}/admin/leads.csv`)).status).toBe(401);
    const wrong = `Basic ${Buffer.from('admin:nope').toString('base64')}`;
    expect((await fetch(`${h.base}/admin/leads.csv`, { headers: { authorization: wrong } })).status).toBe(401);
  });

  it('exports leads with a link to their design', async () => {
    const h = await start();
    const { body } = await submit(h.base, {}, await houseJpeg());
    const res = await fetch(`${h.base}/admin/leads.csv`, { headers: { authorization: `Basic ${Buffer.from('admin:hunter2').toString('base64')}` } });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('jane@example.com');
    expect(csv).toContain(`https://lights.example.com/d/${body.designId}`);
  });

  it('is disabled when no password is set', async () => {
    const h = await start({ adminPassword: '' });
    const res = await fetch(`${h.base}/admin/leads.csv`, { headers: { authorization: `Basic ${Buffer.from('admin:').toString('base64')}` } });
    expect(res.status).toBe(401);
  });
});

describe('under load', () => {
  it('rate-limits a single IP', async () => {
    const h = await start();
    const statuses = await Promise.all(Array.from({ length: 15 }, async (_, i) => (await submit(h.base, { email: `v${i}@example.com` })).status));
    expect(statuses.filter((s) => s === 202)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it('100 simultaneous visitors all get three looks, with AI concurrency capped', async () => {
    const h = await start({ maxConcurrentGenerations: 10, mockDelayMs: 20, trustProxy: 1 });
    const photo = await houseJpeg(400, 300);
    let peak = 0;
    const timer = setInterval(() => (peak = Math.max(peak, h.service.stats().rendering.running)), 2);
    const visitors = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const ip = { 'x-forwarded-for': `10.0.${i >> 8}.${i & 255}` };
        const { status, body } = await submit(h.base, { email: `v${i}@example.com` }, photo, ip);
        expect(status).toBe(202);
        return waitForDesign(h.base, body.designId!, ip);
      }),
    );
    clearInterval(timer);
    expect(visitors.every((v) => v.status === 'done' && v.renders.every((r: any) => r.status === 'done'))).toBe(true);
    expect(peak).toBeLessThanOrEqual(10);
    await h.service.onIdle();
    expect(h.sms).toHaveLength(100);
    expect(h.emails).toHaveLength(100);
  }, 60_000);
});
