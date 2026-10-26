import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type DesignStatus = 'locating' | 'rendering' | 'done' | 'failed';
export type RenderStatus = 'queued' | 'done' | 'failed';

export interface DesignRender {
  themeId: string;
  status: RenderStatus;
  afterImage?: string;
  errorCode?: string;
}

export interface Design {
  id: string;
  leadId: string;
  createdAt: string;
  source: 'streetview' | 'upload';
  status: DesignStatus;
  beforeImage?: string;
  formattedAddress?: string;
  errorCode?: string;
  errorMessage?: string;
  notifiedAt?: string;
  smsStatus?: string;
  emailStatus?: string;
  renders: DesignRender[];
}

/** Design ids are 128 random bits: the link texted to the visitor is the only way to view it. */
export const DESIGN_ID = /^[a-f0-9]{32}$/;

const now = () => new Date().toISOString();

function compact<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (v !== null) out[k] = v;
  return out as T;
}

export class DesignStore {
  constructor(private readonly db: DatabaseSync) {}

  /** A design starts with one queued render per theme. With a photo it skips straight to rendering. */
  create(leadId: string, themeIds: string[], photo?: string): Design {
    const id = randomBytes(16).toString('hex');
    const ts = now();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO designs (id, lead_id, created_at, source, status, before_image) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, leadId, ts, photo ? 'upload' : 'streetview', photo ? 'rendering' : 'locating', photo ?? null);
      const insert = this.db.prepare("INSERT INTO design_renders (design_id, theme_id, status, updated_at) VALUES (?, ?, 'queued', ?)");
      for (const themeId of themeIds) insert.run(id, themeId, ts);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.get(id)!;
  }

  get(id: string): Design | undefined {
    const row = this.db
      .prepare(
        `SELECT id, lead_id AS leadId, created_at AS createdAt, source, status, before_image AS beforeImage,
          formatted_address AS formattedAddress, error_code AS errorCode, error_message AS errorMessage,
          notified_at AS notifiedAt, sms_status AS smsStatus, email_status AS emailStatus
         FROM designs WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const renders = (
      this.db
        .prepare(
          'SELECT theme_id AS themeId, status, after_image AS afterImage, error_code AS errorCode FROM design_renders WHERE design_id = ? ORDER BY rowid',
        )
        .all(id) as Record<string, unknown>[]
    ).map((r) => compact<DesignRender>(r));
    return { ...compact<Omit<Design, 'renders'>>(row), renders };
  }

  countForLead(leadId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM designs WHERE lead_id = ?').get(leadId) as { n: number }).n);
  }

  setLocated(id: string, beforeImage: string, formattedAddress: string) {
    this.db
      .prepare("UPDATE designs SET status = 'rendering', before_image = ?, formatted_address = ? WHERE id = ? AND status = 'locating'")
      .run(beforeImage, formattedAddress, id);
  }

  /** Marks the whole design failed (e.g. no Street View) along with any renders still waiting. */
  setFailed(id: string, code: string, message: string) {
    this.db.prepare("UPDATE designs SET status = 'failed', error_code = ?, error_message = ? WHERE id = ?").run(code, message, id);
    this.db
      .prepare("UPDATE design_renders SET status = 'failed', error_code = ?, updated_at = ? WHERE design_id = ? AND status = 'queued'")
      .run(code, now(), id);
  }

  setRender(designId: string, themeId: string, result: { afterImage: string } | { errorCode: string }) {
    if ('afterImage' in result) {
      this.db
        .prepare("UPDATE design_renders SET status = 'done', after_image = ?, error_code = NULL, updated_at = ? WHERE design_id = ? AND theme_id = ?")
        .run(result.afterImage, now(), designId, themeId);
    } else {
      this.db
        .prepare("UPDATE design_renders SET status = 'failed', error_code = ?, updated_at = ? WHERE design_id = ? AND theme_id = ?")
        .run(result.errorCode, now(), designId, themeId);
    }
  }

  /**
   * Once no render is still queued, moves the design to done (if any render succeeded) or failed.
   * Returns true only for the call that made the transition, so completion is handled exactly once.
   */
  settleIfComplete(id: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE designs SET status = CASE
            WHEN EXISTS (SELECT 1 FROM design_renders WHERE design_id = designs.id AND status = 'done') THEN 'done' ELSE 'failed' END,
          error_code = CASE
            WHEN EXISTS (SELECT 1 FROM design_renders WHERE design_id = designs.id AND status = 'done') THEN NULL ELSE 'render_failed' END
         WHERE id = ? AND status = 'rendering'
           AND NOT EXISTS (SELECT 1 FROM design_renders WHERE design_id = designs.id AND status = 'queued')`,
      )
      .run(id);
    return Number(r.changes) === 1;
  }

  /** At-most-once guard for notifications: true for the single caller that gets to send them. */
  claimNotification(id: string): boolean {
    const r = this.db.prepare('UPDATE designs SET notified_at = ? WHERE id = ? AND notified_at IS NULL').run(now(), id);
    return Number(r.changes) === 1;
  }

  setNotifyStatus(id: string, sms: string, email: string) {
    this.db.prepare('UPDATE designs SET sms_status = ?, email_status = ? WHERE id = ?').run(sms, email, id);
  }

  /** Work left unfinished by a previous process, for resuming at startup. */
  unfinished() {
    const locating = (this.db.prepare("SELECT id FROM designs WHERE status = 'locating' ORDER BY created_at").all() as Array<{ id: string }>).map((r) => r.id);
    const renders = this.db
      .prepare(
        `SELECT r.design_id AS designId, r.theme_id AS themeId FROM design_renders r JOIN designs d ON d.id = r.design_id
         WHERE r.status = 'queued' AND d.status = 'rendering' ORDER BY d.created_at`,
      )
      .all() as Array<{ designId: string; themeId: string }>;
    const unnotified = (
      this.db.prepare("SELECT id FROM designs WHERE status = 'done' AND notified_at IS NULL ORDER BY created_at").all() as Array<{ id: string }>
    ).map((r) => r.id);
    // Designs whose last render settled just before a crash, before the design itself was marked done.
    const rendering = (this.db.prepare("SELECT id FROM designs WHERE status = 'rendering'").all() as Array<{ id: string }>).map((r) => r.id);
    return { locating, renders, unnotified, rendering };
  }
}
