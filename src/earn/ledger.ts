import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { round, safeDivide } from "../util/stats.js";
import type { Ledger, LedgerEntry, LedgerSummary } from "./types.js";

/**
 * The ledger is the agent's memory and the person's tax record, in one small
 * JSON file. Every dollar in, every expense out, every hour worked, per play.
 * The daily brief is re-planned from it: a play that is paying below its band
 * gets less time tomorrow, one that is beating it gets more.
 */

export const DEFAULT_LEDGER_PATH = ".litix/earn-ledger.json";

/** Conservative share of net self-employment income to set aside for tax. */
export const TAX_RESERVE_RATE = 0.28;

export async function loadLedger(path = DEFAULT_LEDGER_PATH): Promise<Ledger> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    return {
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      ...(parsed.targetUsd !== undefined ? { targetUsd: parsed.targetUsd } : {}),
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { createdAt: new Date().toISOString(), entries: [] };
    }
    throw error;
  }
}

export async function saveLedger(ledger: Ledger, path = DEFAULT_LEDGER_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

export function addEntry(ledger: Ledger, entry: LedgerEntry): Ledger {
  validateEntry(entry);
  return { ...ledger, entries: [...ledger.entries, entry] };
}

export function validateEntry(entry: LedgerEntry): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    throw new Error(`Ledger date must be YYYY-MM-DD, got "${entry.date}".`);
  }
  if (!entry.playId) throw new Error("Ledger entry needs a playId.");
  if (!Number.isFinite(entry.grossUsd) || entry.grossUsd < 0) {
    throw new Error("grossUsd must be a non-negative number.");
  }
  if (!Number.isFinite(entry.hours) || entry.hours < 0) {
    throw new Error("hours must be a non-negative number.");
  }
  if (!Number.isFinite(entry.expensesUsd) || entry.expensesUsd < 0) {
    throw new Error("expensesUsd must be a non-negative number.");
  }
}

export function summarizeLedger(ledger: Ledger, today = new Date()): LedgerSummary {
  const grossUsd = round(ledger.entries.reduce((s, e) => s + e.grossUsd, 0), 2);
  const expensesUsd = round(ledger.entries.reduce((s, e) => s + e.expensesUsd, 0), 2);
  const hours = round(ledger.entries.reduce((s, e) => s + e.hours, 0), 2);
  const netUsd = round(grossUsd - expensesUsd, 2);

  const byPlayMap = new Map<string, { netUsd: number; hours: number }>();
  for (const entry of ledger.entries) {
    const current = byPlayMap.get(entry.playId) ?? { netUsd: 0, hours: 0 };
    current.netUsd += entry.grossUsd - entry.expensesUsd;
    current.hours += entry.hours;
    byPlayMap.set(entry.playId, current);
  }
  const byPlay = [...byPlayMap.entries()]
    .map(([playId, v]) => ({
      playId,
      netUsd: round(v.netUsd, 2),
      hours: round(v.hours, 2),
      netPerHour: round(safeDivide(v.netUsd, v.hours, 0), 2),
    }))
    .sort((a, b) => b.netPerHour - a.netPerHour);

  const firstDate = ledger.entries
    .map((e) => e.date)
    .sort()[0];
  const daysActive = firstDate
    ? Math.max(1, Math.ceil((today.getTime() - new Date(`${firstDate}T00:00:00Z`).getTime()) / 86_400_000))
    : 0;

  return {
    grossUsd,
    expensesUsd,
    netUsd,
    hours,
    netPerHour: round(safeDivide(netUsd, hours, 0), 2),
    netPerDay: round(safeDivide(netUsd, daysActive, 0), 2),
    byPlay,
    taxReserveUsd: round(Math.max(0, netUsd) * TAX_RESERVE_RATE, 2),
    daysActive,
  };
}

/** Today's date as the ledger stores it. */
export function isoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
