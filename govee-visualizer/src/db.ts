import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * One SQLite file holds leads and their designs. Design progress lives here rather than only in memory
 * so a server restart resumes unfinished renders and still sends the visitor their text and email.
 */
export function openDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'leads.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

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
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      referrer TEXT,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS leads_created ON leads (created_at);

    CREATE TABLE IF NOT EXISTS designs (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES leads (id),
      created_at TEXT NOT NULL,
      source TEXT NOT NULL,          -- streetview | upload
      status TEXT NOT NULL,          -- locating | rendering | done | failed
      before_image TEXT,
      formatted_address TEXT,
      error_code TEXT,
      error_message TEXT,
      notified_at TEXT,
      sms_status TEXT,
      email_status TEXT
    );
    CREATE INDEX IF NOT EXISTS designs_lead ON designs (lead_id, created_at);
    CREATE INDEX IF NOT EXISTS designs_status ON designs (status);

    CREATE TABLE IF NOT EXISTS design_renders (
      design_id TEXT NOT NULL REFERENCES designs (id),
      theme_id TEXT NOT NULL,
      status TEXT NOT NULL,          -- queued | done | failed
      after_image TEXT,
      error_code TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (design_id, theme_id)
    );
  `);
  return db;
}
