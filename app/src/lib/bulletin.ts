import type { Announcement, PrayerRequest } from '../db/schema';
// Explicit .ts, as in roster.ts: Vite is happy either way, but plain Node's
// ESM resolver needs it, and these functions are tested directly under Node.
import { CHURCH_TZ } from './services.ts';

/** Parsing is forgiving because these columns are hand-edited JSON: a broken
 *  value must degrade to an empty list, never take the bulletin page down. */
export function parseAnnouncements(raw: string | null): Announcement[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.heading === 'string') : [];
  } catch { return []; }
}

/** Same forgiving parse as the announcements, for the same reason. */
export function parsePrayerRequests(raw: string | null): PrayerRequest[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v)
      ? v.filter((x) => x && typeof x.text === 'string' && x.text.trim())
         .map((x) => ({ text: String(x.text).trim(), since: String(x.since ?? '') }))
      : [];
  } catch { return []; }
}

/**
 * How many Sundays a request has been carried.
 *
 * Shown to staff only. Nothing expires on its own — the point is to make a
 * long-standing request visible so somebody decides about it, not to have the
 * software quietly stop praying for someone.
 */
export function weeksCarried(since: string, serviceDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return 0;
  const a = new Date(`${since}T12:00:00Z`).getTime();
  const b = new Date(`${serviceDate}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 604800000));
}

/** The next Sunday on or after today, in CHURCH time — not the server's UTC. */
export function nextSunday(now = new Date()): string {
  const today = now.toLocaleDateString('en-CA', { timeZone: CHURCH_TZ });
  const d = new Date(`${today}T12:00:00Z`);
  const dow = d.getUTCDay();               // 0 = Sunday
  if (dow !== 0) d.setUTCDate(d.getUTCDate() + (7 - dow));
  return d.toISOString().slice(0, 10);
}

export function formatServiceDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}
