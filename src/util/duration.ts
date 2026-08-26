/**
 * YouTube returns durations as ISO 8601 (`PT4M13S`). Only the time portion is
 * ever populated for videos, but days are handled for completeness.
 */
const ISO_DURATION =
  /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function parseIsoDuration(iso: string): number {
  if (!iso) return 0;
  const match = ISO_DURATION.exec(iso.trim());
  if (!match) return 0;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

export function daysBetween(from: string | Date, to: string | Date): number {
  const a = from instanceof Date ? from : new Date(from);
  const b = to instanceof Date ? to : new Date(to);
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms)) return 0;
  return ms / 86_400_000;
}
