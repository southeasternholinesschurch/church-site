/**
 * The server half of the lobby feed: the site's events, and QR codes.
 *
 * Events live in the site's build (see site/src/pages/events.json.ts), not in
 * this database, so the feed fetches them. The fetch is short and remembered:
 * the TV polls every couple of minutes, and the file only changes when the
 * site rebuilds, so one fetch per isolate per ten minutes is plenty — and if
 * the site cannot be reached, the last good copy is used, then nothing. The
 * screen must never go blank because the website hiccupped.
 */
import { FALLBACK_SERVICE_TIMES, type LobbyEvent, type LobbySermon, type ServiceTime } from './lobby.ts';

export interface SiteEvents {
  churchName: string;
  address: string;
  serviceTimes: ServiceTime[];
  events: LobbyEvent[];
  /** The giving form (Zeffy), from the site's Settings. */
  giveUrl: string;
  /** The latest Sunday-morning sermon on the site. */
  sermon: LobbySermon | null;
}

/** Only a sermon with a title, a date and a page on our own site: its link
 *  becomes a QR code on a wall. */
function sermonFrom(raw: unknown): LobbySermon | null {
  const v = raw as Partial<LobbySermon> | null;
  if (!v || typeof v.title !== 'string' || !v.title.trim()) return null;
  if (typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
  if (typeof v.url !== 'string' || !v.url.startsWith(`${SITE_ORIGIN}/`)) return null;
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  return { title: v.title.trim(), speaker: str(v.speaker), scripture: str(v.scripture), date: v.date, url: v.url,
    hasTranscript: v.hasTranscript === true };
}

export const SITE_ORIGIN = 'https://yourchurch.org';
const EVENTS_URL = `${SITE_ORIGIN}/events.json`;
const FRESH_MS = 10 * 60_000;
const TIMEOUT_MS = 4000;

let memo: { at: number; url: string; data: SiteEvents } | null = null;

const FALLBACK: SiteEvents = {
  churchName: 'Fairhaven Community Church',
  address: '412 Meadowbrook Road, Fairhaven, IN 46140',
  serviceTimes: FALLBACK_SERVICE_TIMES,
  events: [],
  // site.yaml's zeffyUrl, kept so the Give scene still works if the site is down.
  giveUrl: 'https://www.zeffy.com/en-US/donation-form/your-form',
  sermon: null,
};

/** `LOBBY_EVENTS_URL` points local development at a local copy. */
export async function siteEvents(env: Env): Promise<SiteEvents> {
  const url = env.LOBBY_EVENTS_URL || EVENTS_URL;
  if (memo && memo.url === url && Date.now() - memo.at < FRESH_MS) return memo.data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`events.json ${res.status}`);
    const raw = await res.json() as Partial<SiteEvents>;
    const data: SiteEvents = {
      churchName: raw.churchName || FALLBACK.churchName,
      address: raw.address || FALLBACK.address,
      serviceTimes: Array.isArray(raw.serviceTimes) && raw.serviceTimes.length
        ? raw.serviceTimes : FALLBACK.serviceTimes,
      events: Array.isArray(raw.events) ? raw.events : [],
      giveUrl: typeof raw.giveUrl === 'string' && /^https:\/\//.test(raw.giveUrl) ? raw.giveUrl : FALLBACK.giveUrl,
      sermon: sermonFrom(raw.sermon),
    };
    memo = { at: Date.now(), url, data };
    return data;
  } catch {
    return memo?.url === url ? memo.data : FALLBACK;
  }
}
