import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Config } from './config.js';
import type { Design, DesignStore } from './designStore.js';
import type { ImageStore } from './images.js';
import { sendWebhook, type Lead, type LeadStore } from './leads.js';
import type { Notifier } from './notify.js';
import { renderWithRetry, type ImageProvider } from './providers/index.js';
import { JobFailure, JobQueue, QueueFullError } from './queue.js';
import type { StreetView } from './streetview.js';
import { buildPrompt, getTheme, THEMES } from './themes.js';

export interface DesignDeps {
  config: Config;
  leads: LeadStore;
  designs: DesignStore;
  images: ImageStore;
  streetView: StreetView;
  provider: ImageProvider;
  notifier: Notifier;
}

interface RenderTask {
  designId: string;
  themeId: string;
}

/** What the browser sees for a design. */
export interface DesignView {
  id: string;
  status: Design['status'];
  source: Design['source'];
  firstName: string;
  formattedAddress?: string;
  beforeUrl?: string;
  error?: { code: string; message: string };
  /** 1-based place in line of this design's next waiting render; 0 once rendering has started. */
  position: number;
  canUploadPhoto: boolean;
  /** Text/email outcome once known: sent | failed | disabled. Absent while still sending. */
  delivery?: { sms: string; email: string };
  renders: Array<{ themeId: string; label: string; swatch: string; status: string; afterUrl?: string }>;
}

const NO_STREET_VIEW = 'Upload a photo of the front of your house and we’ll light it up.';

/**
 * Turns a lead into a design:
 *
 *   locate (Street View) ─► one AI render per theme, in parallel ─► text + email the visitor
 *
 * All progress is stored in SQLite as it happens. The visitor can watch on the page or close it: the
 * work finishes either way and they get the results on their phone. After a restart, unfinished work
 * is picked up again by resume().
 */
export class DesignService {
  private readonly locateQueue: JobQueue<string, void>;
  private readonly renderQueue: JobQueue<RenderTask, void>;
  /** designId:themeId -> job id, to report queue position. */
  private readonly renderJobs = new Map<string, string>();
  private readonly notifying = new Set<Promise<void>>();

  constructor(private readonly deps: DesignDeps) {
    // Google Maps calls are quick and generously rate-limited; only the AI renders need a tight cap.
    this.locateQueue = new JobQueue((designId) => this.locate(designId), { concurrency: 20, maxQueued: Infinity });
    this.renderQueue = new JobQueue((task) => this.render(task), {
      concurrency: deps.config.maxConcurrentGenerations,
      maxQueued: Infinity,
    });
  }

  /** Throws QueueFullError when the waiting line is already too long to promise a timely preview. */
  private assertCapacity() {
    const { queued } = this.renderQueue.stats();
    if (queued + THEMES.length > this.deps.config.maxQueueLength) throw new QueueFullError();
  }

  start(lead: Lead, photo?: string): Design {
    this.assertCapacity();
    const design = this.deps.designs.create(lead.id, THEMES.map((t) => t.id), photo);
    if (photo) this.enqueueRenders(design.id);
    else if (!this.deps.streetView.enabled) this.deps.designs.setFailed(design.id, 'no_street_view', NO_STREET_VIEW);
    else this.locateQueue.enqueue(design.id);
    return this.deps.designs.get(design.id)!;
  }

  leadIdOf(designId: string): string | undefined {
    return this.deps.designs.get(designId)?.leadId;
  }

  canCreateAnother(leadId: string): boolean {
    return this.deps.designs.countForLead(leadId) < this.deps.config.maxDesignsPerLead;
  }

  view(id: string): DesignView | undefined {
    const d = this.deps.designs.get(id);
    if (!d) return undefined;
    const lead = this.deps.leads.get(d.leadId);
    // Place in line = the best place among this design's waiting renders; 0 once any is being rendered.
    const waiting = d.renders
      .filter((r) => r.status === 'queued')
      .map((r) => this.renderJobs.get(`${d.id}:${r.themeId}`))
      .map((jobId) => (jobId ? this.renderQueue.get(jobId) : undefined));
    const places = waiting.map((j) => j?.position ?? 0).filter((p) => p > 0);
    const position = waiting.some((j) => j?.status === 'running') || !places.length ? 0 : Math.min(...places);
    return {
      id: d.id,
      status: d.status,
      source: d.source,
      firstName: lead ? lead.name.trim().split(/\s+/)[0]! : '',
      position: d.status === 'rendering' ? position : 0,
      canUploadPhoto: lead ? this.canCreateAnother(lead.id) : false,
      ...(d.smsStatus && d.emailStatus ? { delivery: { sms: d.smsStatus, email: d.emailStatus } } : {}),
      ...(d.formattedAddress ? { formattedAddress: d.formattedAddress } : {}),
      ...(d.beforeImage ? { beforeUrl: `/img/${d.beforeImage}` } : {}),
      ...(d.status === 'failed'
        ? { error: { code: d.errorCode ?? 'render_failed', message: d.errorMessage ?? 'We couldn’t finish your design. Please try again.' } }
        : {}),
      renders: d.renders.map((r) => {
        const theme = getTheme(r.themeId);
        return {
          themeId: r.themeId,
          label: theme?.label ?? r.themeId,
          swatch: theme?.swatch ?? '#888',
          status: r.status,
          ...(r.afterImage ? { afterUrl: `/img/${r.afterImage}` } : {}),
        };
      }),
    };
  }

  /** Re-queues work a previous process didn't finish, and settles / notifies anything left hanging. */
  resume() {
    const { locating, renders, unnotified, rendering } = this.deps.designs.unfinished();
    for (const id of locating) this.locateQueue.enqueue(id);
    for (const task of renders) this.enqueueRender(task);
    const queuedDesigns = new Set(renders.map((r) => r.designId));
    for (const id of rendering) if (!queuedDesigns.has(id) && this.deps.designs.settleIfComplete(id)) this.notify(id);
    for (const id of unnotified) this.notify(id);
    const total = locating.length + renders.length + unnotified.length;
    if (total) console.log(`Resumed ${locating.length} lookups, ${renders.length} renders, ${unnotified.length} notifications`);
  }

  stats() {
    return { locating: this.locateQueue.stats(), rendering: this.renderQueue.stats() };
  }

  async onIdle() {
    await this.locateQueue.onIdle();
    await this.renderQueue.onIdle();
    while (this.notifying.size) await Promise.all([...this.notifying]);
  }

  close() {
    this.locateQueue.close();
    this.renderQueue.close();
  }

  /**
   * Each visitor's first look jumps ahead of everyone's second and third, so in a rush every visitor
   * sees something quickly instead of the last one waiting for everybody else's full set.
   */
  private enqueueRenders(designId: string) {
    const d = this.deps.designs.get(designId)!;
    const queued = d.renders.filter((r) => r.status === 'queued');
    const first = queued.length === d.renders.length;
    queued.forEach((r, i) => this.enqueueRender({ designId, themeId: r.themeId }, first && i === 0));
  }

  private enqueueRender(task: RenderTask, priority = false) {
    const job = this.renderQueue.enqueue(task, { priority });
    this.renderJobs.set(`${task.designId}:${task.themeId}`, job.id);
  }

  private async locate(designId: string) {
    const { designs, leads, images, streetView } = this.deps;
    const design = designs.get(designId);
    const lead = design && leads.get(design.leadId);
    if (!design || !lead || design.status !== 'locating') return;
    try {
      const house = await streetView.fetchHouseImage(lead.address, lead.placeId);
      const before = await images.save(house.jpeg);
      leads.setLocation(lead.id, { formattedAddress: house.geocode.formattedAddress, lat: house.geocode.lat, lng: house.geocode.lng });
      designs.setLocated(designId, before, house.geocode.formattedAddress);
      this.enqueueRenders(designId);
    } catch (err) {
      if (err instanceof JobFailure) designs.setFailed(designId, err.code, err.message);
      else {
        console.error(`[design ${designId}] locate failed`, err);
        designs.setFailed(designId, 'locate_failed', 'We had trouble finding your house. Upload a photo of it and we’ll light it up.');
      }
    }
  }

  private async render({ designId, themeId }: RenderTask) {
    const { designs, images, provider, config } = this.deps;
    try {
      const design = designs.get(designId);
      const theme = getTheme(themeId);
      const beforePath = design?.beforeImage && images.pathFor(design.beforeImage);
      if (!design || !theme || !beforePath) throw new Error(`design ${designId} not renderable`);
      const raw = await renderWithRetry(
        provider,
        { image: await readFile(beforePath), prompt: buildPrompt(theme, config.lightSpacingInches), themeId },
        { timeoutMs: config.generationTimeoutMs },
      );
      const after = await images.save(await sharp(raw).jpeg({ quality: 86, mozjpeg: true }).toBuffer());
      designs.setRender(designId, themeId, { afterImage: after });
    } catch (err) {
      if (!(err instanceof JobFailure)) console.error(`[design ${designId}/${themeId}] render failed`, err);
      designs.setRender(designId, themeId, { errorCode: err instanceof JobFailure ? err.code : 'render_failed' });
    } finally {
      this.renderJobs.delete(`${designId}:${themeId}`);
      if (designs.settleIfComplete(designId)) this.notify(designId);
    }
  }

  private notify(designId: string) {
    const p = this.sendNotifications(designId)
      .catch((err) => console.error(`[design ${designId}] notification error`, err))
      .finally(() => this.notifying.delete(p));
    this.notifying.add(p);
  }

  private async sendNotifications(designId: string) {
    const { designs, leads, images, notifier, config } = this.deps;
    const d = designs.get(designId);
    const lead = d && leads.get(d.leadId);
    if (!d || !lead || d.status !== 'done') return;
    if (!designs.claimNotification(designId)) return;

    const base = config.publicBaseUrl;
    const looks = d.renders.flatMap((r) => {
      const imagePath = r.afterImage && images.pathFor(r.afterImage);
      return imagePath ? [{ label: getTheme(r.themeId)?.label ?? r.themeId, imagePath, imageUrl: `${base}/img/${r.afterImage}` }] : [];
    });
    const designUrl = `${base}/d/${d.id}`;
    const status = await notifier.sendDesign({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      designUrl,
      looks,
      ...(d.formattedAddress ? { address: d.formattedAddress } : {}),
    });
    designs.setNotifyStatus(designId, status.sms, status.email);
    console.log(`[design ${designId}] done: ${looks.length} looks, sms ${status.sms}, email ${status.email}`);

    await sendWebhook(config.leadWebhookUrl, {
      event: 'design.completed',
      leadId: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      address: d.formattedAddress ?? lead.address,
      designUrl,
      beforeUrl: d.beforeImage ? `${base}/img/${d.beforeImage}` : undefined,
      looks: looks.map(({ label, imageUrl }) => ({ label, imageUrl })),
      smsStatus: status.sms,
      emailStatus: status.email,
    });
  }
}
