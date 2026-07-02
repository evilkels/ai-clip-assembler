/**
 * Shared display formatters. Single home for the time / size / date strings
 * that were previously re-implemented across routes and components.
 */

/** `m:ss.s` clock for clip and timeline durations/timestamps (e.g. `1:05.3`).
 *  Negative input is clamped to zero. */
export function formatClock(sec: number): string {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = (safe - m * 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

/** `m:ss.t` timecode with zero-padded seconds and a single floored tenths
 *  digit (e.g. `1:05.3`), used by the Version scrubber. */
export function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/** Local date-time `YYYY-MM-DD HH:MM`, or `—` when missing/invalid. */
export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Human-readable byte size (e.g. `24 MB`), or `—` when missing/zero. */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
