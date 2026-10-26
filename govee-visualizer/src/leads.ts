import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

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
  /** Most recent design, for the CSV export. */
  latestDesignId?: string;
}

const COLUMNS = `id, created_at AS createdAt, name, email, phone, address, place_id AS placeId, consent,
  formatted_address AS formattedAddress, lat, lng, utm_source AS utmSource, utm_medium AS utmMedium,
  utm_campaign AS utmCampaign, referrer, ip, user_agent AS userAgent,
  (SELECT d.id FROM designs d WHERE d.lead_id = leads.id ORDER BY d.created_at DESC LIMIT 1) AS latestDesignId`;

/**
 * Leads are written the moment the form is submitted — before any image work — so a lead is never lost
 * because Street View or the AI failed.
 */
export class LeadStore {
  constructor(private readonly db: DatabaseSync) {}

  create(lead: NewLead): Lead {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO leads (id, created_at, name, email, phone, address, place_id, consent, utm_source, utm_medium,
          utm_campaign, referrer, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        new Date().toISOString(),
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

  setLocation(id: string, loc: { formattedAddress: string; lat: number; lng: number }) {
    this.db.prepare('UPDATE leads SET formatted_address = ?, lat = ?, lng = ? WHERE id = ?').run(loc.formattedAddress, loc.lat, loc.lng, id);
  }

  all(): Lead[] {
    return (this.db.prepare(`SELECT ${COLUMNS} FROM leads ORDER BY created_at DESC`).all() as Record<string, unknown>[]).map(toLead);
  }
}

function toLead(row: Record<string, unknown>): Lead {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== null) out[k] = v;
  out.consent = row.consent === 1;
  return out as unknown as Lead;
}

const CSV_FIELDS = [
  'createdAt', 'name', 'email', 'phone', 'address', 'formattedAddress', 'consent', 'designLink',
  'utmSource', 'utmMedium', 'utmCampaign', 'referrer', 'id',
] as const;

export function leadsToCsv(leads: Lead[], siteBase: string): string {
  const cell = (v: unknown) => {
    let s = v === undefined || v === null ? '' : String(v);
    // Stop spreadsheet formula injection from user-typed fields.
    // E.164 phone numbers (+15551234567) are left alone; they can't execute.
    if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = leads.map((l) =>
    CSV_FIELDS.map((f) => cell(f === 'designLink' ? (l.latestDesignId ? `${siteBase}/d/${l.latestDesignId}` : '') : l[f])).join(','),
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
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}
