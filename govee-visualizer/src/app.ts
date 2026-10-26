import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import type { Config } from './config.js';
import { DESIGN_ID } from './designStore.js';
import type { DesignService } from './designs.js';
import { normalizePhoto, type ImageStore } from './images.js';
import { leadsToCsv, sendWebhook, type LeadStore } from './leads.js';
import type { Notifier } from './notify.js';
import type { ImageProvider } from './providers/index.js';
import { JobFailure, QueueFullError } from './queue.js';
import type { StreetView } from './streetview.js';
import { THEMES } from './themes.js';
import { firstIssue, leadSchema } from './validation.js';

export interface AppDeps {
  config: Config;
  leads: LeadStore;
  images: ImageStore;
  streetView: StreetView;
  provider: ImageProvider;
  notifier: Notifier;
  designs: DesignService;
}

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createApp(deps: AppDeps) {
  const { config, leads, images, designs } = deps;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Google Maps JS (address autocomplete) loads its code and data from these hosts.
          scriptSrc: ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
          connectSrc: ["'self'", 'https://*.googleapis.com', 'https://maps.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.ggpht.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 30, fieldSize: 4096 },
  });

  const limiter = (windowMs: number, limit: number) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please wait a few minutes and try again.' },
    });

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      provider: deps.provider.name,
      streetView: deps.streetView.enabled,
      sms: deps.notifier.smsEnabled,
      email: deps.notifier.emailEnabled,
      queues: designs.stats(),
    });
  });

  app.get('/api/config', (_req, res) => {
    res.set('cache-control', 'public, max-age=300');
    res.json({
      mapsBrowserKey: config.googleMapsBrowserKey,
      addressRegions: config.addressRegions,
      streetView: deps.streetView.enabled,
      businessName: config.businessName,
      businessPhone: config.businessPhone,
      ctaUrl: config.ctaUrl,
      privacyUrl: config.privacyUrl,
      sms: deps.notifier.smsEnabled,
      email: deps.notifier.emailEnabled,
      demoMode: deps.provider.name === 'mock',
      themes: THEMES.map(({ id, label, swatch }) => ({ id, label, swatch })),
    });
  });

  /** Saves the upload (if any) as a normalised JPEG and returns its image id. */
  async function savePhoto(req: Request): Promise<string | undefined> {
    if (!req.file) return undefined;
    return images.save(await normalizePhoto(req.file.buffer));
  }

  function queueFull(res: Response, err: QueueFullError) {
    res.status(503).set('retry-after', '30').json({ error: err.message });
  }

  app.post('/api/leads', limiter(15 * 60_000, 10), upload.single('photo'), async (req, res) => {
    const parsed = leadSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstIssue(parsed.error) });
      return;
    }
    const d = parsed.data;
    // Validate the photo before recording the lead so a bad file gets a clear error and a clean retry.
    const photo = await savePhoto(req);
    const lead = leads.create({
      name: d.name,
      email: d.email,
      phone: d.phone,
      address: d.address,
      consent: true,
      ...(d.placeId ? { placeId: d.placeId } : {}),
      ...(d.utmSource ? { utmSource: d.utmSource } : {}),
      ...(d.utmMedium ? { utmMedium: d.utmMedium } : {}),
      ...(d.utmCampaign ? { utmCampaign: d.utmCampaign } : {}),
      ...(d.referrer ? { referrer: d.referrer } : {}),
      ...(req.ip ? { ip: req.ip } : {}),
      userAgent: (req.get('user-agent') ?? '').slice(0, 300),
    });
    const { ip: _ip, userAgent: _ua, latestDesignId: _d, ...publicLead } = lead;
    void sendWebhook(config.leadWebhookUrl, { event: 'lead.created', ...publicLead });

    try {
      const design = designs.start(lead, photo);
      res.status(202).json({ designId: design.id });
    } catch (err) {
      // The lead is saved either way; the business can still follow up.
      if (err instanceof QueueFullError) return queueFull(res, err);
      throw err;
    }
  });

  app.get('/api/designs/:id', limiter(60_000, 600), (req, res) => {
    const id = String(req.params.id);
    const view = DESIGN_ID.test(id) ? designs.view(id) : undefined;
    if (!view) {
      res.status(404).json({ error: 'We couldn’t find this design.' });
      return;
    }
    res.set('cache-control', 'no-store').json(view);
  });

  /** "Not your house?" — start a new design for the same lead from an uploaded photo. */
  app.post('/api/designs/:id/photo', limiter(15 * 60_000, 20), upload.single('photo'), async (req, res) => {
    const id = String(req.params.id);
    const leadId = DESIGN_ID.test(id) ? designs.leadIdOf(id) : undefined;
    const lead = leadId ? leads.get(leadId) : undefined;
    if (!lead) {
      res.status(404).json({ error: 'We couldn’t find this design. Please fill in the form again.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Please choose a photo of your house.' });
      return;
    }
    if (!designs.canCreateAnother(lead.id)) {
      res.status(429).json({ error: 'You’ve used all your free designs. We’ll be in touch with a quote!' });
      return;
    }
    const photo = (await savePhoto(req))!;
    try {
      res.status(202).json({ designId: designs.start(lead, photo).id });
    } catch (err) {
      if (err instanceof QueueFullError) return queueFull(res, err);
      throw err;
    }
  });

  // Shareable design page (the link we text and email). Same single-page app.
  app.get('/d/:id', (req, res) => {
    if (!DESIGN_ID.test(String(req.params.id))) {
      res.redirect('/');
      return;
    }
    res.set('cache-control', 'no-cache').set('x-robots-tag', 'noindex').sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.get('/img/:file', (req, res) => {
    const file = images.pathFor(String(req.params.file));
    if (!file) {
      res.status(404).end();
      return;
    }
    res.sendFile(file, { maxAge: '365d', immutable: true }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  app.get('/admin/leads.csv', (req, res) => {
    if (!config.adminPassword || !checkBasicAuth(req.get('authorization'), config.adminPassword)) {
      res.set('www-authenticate', 'Basic realm="leads", charset="UTF-8"').status(401).send('Authentication required');
      return;
    }
    const base = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    res
      .set('content-type', 'text/csv; charset=utf-8')
      .set('content-disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`)
      .set('cache-control', 'no-store')
      .send(leadsToCsv(leads.all(), base));
  });

  app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof JobFailure) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large (15 MB max).' : 'Invalid upload.',
      });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}

function checkBasicAuth(header: string | undefined, password: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const supplied = decoded.slice(decoded.indexOf(':') + 1);
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(password).digest();
  return timingSafeEqual(a, b);
}
