import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface NewLead {
  name: string;
  email: string;
  phone: string;
  address: string;
  placeId?: string;
  consent: boolean;
  ip?: string;
  userAgent?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
}

export interface Lead extends NewLead {
  id: string;
  createdAt: string;
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  renderCount: number;
  lastBeforeImage?: string;
  lastAfterImage?: string;
  lastSource?: 'streetview' | 'upload';
}

const COLUMNS = `id, created_at AS createdAt, name, email, phone, address, place_id AS placeId, consent,
  formatted_address AS formattedAddress, lat, lng, render_count AS renderCount,
  last_before_image AS lastBeforeImage, last_after_image AS lastAfterImage, last_source AS lastSource,
  utm_source AS utmSource, utm_medium AS utmMedium, utm_campaign AS utmCampaign, referrer, ip, user_agent AS userAgent`;

/**
 * Leads are written to SQLite the moment the form is submitted — before any image work — so a lead is
 * never lost because Street View or the AI failed. Optionally each lead is also POSTed to a webhook
 * (Zapier, Make, GoHighLevel, HubSpot workflow, …).
 */
export class LeadStore {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'leads.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        place_id TEXT,
        consent INTEGER NOT NULL,
        formatted_address TEXT,
        lat REAL,
        lng REAL,
        render_count INTEGER NOT NULL DEFAULT 0,
        last_before_image TEXT,
        last_after_image TEXT,
        last_source TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        referrer TEXT,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS leads_created ON leads (created_at);
    `);
  }

  create(lead: NewLead): Lead {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO leads (id, created_at, name, email, phone, address, place_id, consent, utm_source, utm_medium,
          utm_campaign, referrer, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        createdAt,
        lead.name,
        lead.email,
        lead.phone,
        lead.address,
        lead.placeId ?? null,
        lead.consent ? 1 : 0,
        lead.utmSource ?? null,
        lead.utmMedium ?? null,
        lead.utmCampaign ?? null,
        lead.referrer ?? null,
        lead.ip ?? null,
        lead.userAgent ?? null,
      );
    return this.get(id)!;
  }

  get(id: string): Lead | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM leads WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? toLead(row) : undefined;
  }

  /** Atomically reserves one render for the lead; returns false when they've used their allowance. */
  reserveRender(id: string, max: number): boolean {
    const r = this.db.prepare('UPDATE leads SET render_count = render_count + 1 WHERE id = ? AND render_count < ?').run(id, max);
    return Number(r.changes) === 1;
  }

  releaseRender(id: string) {
    this.db.prepare('UPDATE leads SET render_count = MAX(render_count - 1, 0) WHERE id = ?').run(id);
  }

  setLocation(id: string, loc: { formattedAddress: string; lat: number; lng: number }) {
    this.db.prepare('UPDATE leads SET formatted_address = ?, lat = ?, lng = ? WHERE id = ?').run(loc.formattedAddress, loc.lat, loc.lng, id);
  }

  setImages(id: string, before: string, after: string, source: 'streetview' | 'upload') {
    this.db
      .prepare('UPDATE leads SET last_before_image = ?, last_after_image = ?, last_source = ? WHERE id = ?')
      .run(before, after, source, id);
  }

  all(): Lead[] {
    return (this.db.prepare(`SELECT ${COLUMNS} FROM leads ORDER BY created_at DESC`).all() as Record<string, unknown>[]).map(toLead);
  }

  close() {
    this.db.close();
  }
}

function toLead(row: Record<string, unknown>): Lead {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== null) out[k] = v;
  out.consent = row.consent === 1;
  return out as unknown as Lead;
}

const CSV_FIELDS: Array<keyof Lead> = [
  'createdAt', 'name', 'email', 'phone', 'address', 'formattedAddress', 'consent', 'renderCount',
  'lastAfterImage', 'utmSource', 'utmMedium', 'utmCampaign', 'referrer', 'id',
];

export function leadsToCsv(leads: Lead[], imageBase: string): string {
  const cell = (v: unknown) => {
    let s = v === undefined || v === null ? '' : String(v);
    // Stop spreadsheet formula injection from user-typed fields.
    // E.164 phone numbers (+15551234567) are left alone; they can't execute.
    if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = leads.map((l) =>
    CSV_FIELDS.map((f) => cell(f === 'lastAfterImage' && l.lastAfterImage ? `${imageBase}/img/${l.lastAfterImage}` : l[f])).join(','),
  );
  return [CSV_FIELDS.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Fire-and-forget POST with a few retries; never throws. */
export async function sendWebhook(url: string, payload: unknown): Promise<void> {
  if (!url) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;
      console.warn(`[webhook] HTTP ${res.status} (attempt ${attempt})`);
    } catch (err) {
      console.warn(`[webhook] ${(err as Error).message} (attempt ${attempt})`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}
