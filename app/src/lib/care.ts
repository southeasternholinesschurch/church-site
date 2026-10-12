/**
 * Pastoral care — the PURE half.
 *
 * Who has stopped coming, what a guest card says, when to look again: all of
 * it decidable from its inputs, so none of it touches the database and all of
 * it is tested directly under Node (test/care.test.ts). The reads and writes
 * are in care-db.ts. Same split as roster.ts / roster-db.ts, for the same
 * reason.
 *
 * THE SHAPE OF THE THING, in one paragraph. There is a follow-up LIST
 * (care_items) and a care LOG (care_notes). Something lands on the list —
 * a regular who has stopped coming, a guest card, a reminder somebody set — and
 * stays there until a pastor deals with it. Dealing with it writes to the log:
 * "Called, she's had a fall, visit Thursday". The list is the question; the log
 * is the answer, and it is the log that becomes a person's history.
 */
// Explicit .ts extensions: plain Node's ESM resolver needs them, and this file
// is imported straight into the tests.
import { CHURCH_TZ } from './services.ts';
import { toE164 } from './sms.ts';

/* ------------------------------------------------------------- the log -- */

/**
 * What kind of contact a note records.
 *
 * Short on purpose. A long list turns writing a note into a classification
 * exercise, and the point of the kind is only to let a pastor see at a glance
 * whether somebody has been VISITED or merely texted. Everything else goes in
 * the words.
 */
export const CARE_KINDS = [
  { id: 'visit', label: 'Visit' },
  { id: 'hospital', label: 'Hospital visit' },
  { id: 'call', label: 'Phone call' },
  { id: 'text', label: 'Text message' },
  { id: 'card', label: 'Card or letter' },
  { id: 'note', label: 'Note' },
] as const;

export type CareKind = (typeof CARE_KINDS)[number]['id'];

export const isCareKind = (k: string): k is CareKind =>
  CARE_KINDS.some((c) => c.id === k);

export const careKindLabel = (k: string): string =>
  CARE_KINDS.find((c) => c.id === k)?.label ?? 'Note';

/* --------------------------------------------------------------- dates -- */

/** Today in the CHURCH's timezone — the Worker's own clock is UTC, and after
 *  7pm in Fairhaven that is already tomorrow. */
export function churchDate(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: CHURCH_TZ });
}

/**
 * The church-calendar day of a stored INSTANT (a created_at), not its UTC date.
 *
 * created_at is written in UTC, so slicing the first ten characters names the
 * wrong day for anything after 7 or 8pm in Fairhaven — a card filled in on a
 * Sunday night would read as Monday. Accepts SQLite's "YYYY-MM-DD HH:MM:SS",
 * which is also UTC, as well as ISO.
 */
export function dayOf(instant: string | null | undefined): string {
  if (!instant) return '';
  const iso = /[TZ]/.test(instant) ? instant : `${instant.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? instant.slice(0, 10) : churchDate(d);
}

const isIso = (s: string | null | undefined): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Noon UTC, so no timezone can tip the date either way. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

/**
 * The week a date belongs to, named by the Sunday it starts on.
 *
 * Sunday-first because that is how a church week runs: Wednesday night belongs
 * to the Sunday before it, not the one after.
 */
export function weekOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -d.getUTCDay());
}

/** "Sun, Sep 14" — for lists and for texts, where the year is noise. */
export function shortDate(iso: string): string {
  if (!isIso(iso)) return iso;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/* ------------------------------------------- regulars who have stopped -- */

/**
 * Who counts as a regular who has stopped coming.
 *
 * The same loose rule the attendance Trends fold uses — at least 3 of the 8
 * weeks before, then none of the last 4 — with two differences, both of which
 * are why this is not simply that table with buttons on it:
 *
 *   1. IT COUNTS WEEKS, NOT SERVICES. Trends counts services of one kind. Over
 *      every service, "the last four" is barely more than one week once Sunday
 *      school, both Sunday services and Wednesday are taken, and a single
 *      missed Sunday would put a family on a pastor's call list. A week counts
 *      as attended if they came to ANY service in it — someone who moved from
 *      the morning to the evening has not stopped coming.
 *
 *   2. A WEEK ONLY COUNTS IF ATTENDANCE WAS TAKEN IN IT. If the volunteer was
 *      away and nobody ticked the register, that week did not happen as far as
 *      this is concerned. Otherwise one forgotten Sunday would mark the entire
 *      congregation absent, and the list would be the whole church.
 *
 * Loose on purpose, like Trends: a fortnight's holiday does not land here,
 * someone who quietly stopped in March does.
 */
export const MISSING_RECENT_WEEKS = 4;
export const MISSING_PRIOR_WEEKS = 8;
export const MISSING_MIN_PRIOR = 3;

export interface Presence { personId: number; date: string }

export interface MissingPerson {
  personId: number;
  /** The last service date they were at. */
  lastSeen: string;
  /** Weeks attended in the prior window. */
  weeksBefore: number;
  /** How many weeks the prior window actually had. Fewer than 8 early on. */
  priorWeeks: number;
  /** Service weeks since — the "5 weeks" a pastor reads. */
  weeksAway: number;
}

/**
 * The weeks attendance was taken in, newest first.
 *
 * `serviceDates` must already be filtered to congregation services that have
 * at least one person ticked — that filter is the "a week only counts if
 * attendance was taken" rule, and it lives in the query, where the data is.
 */
export function serviceWeeks(serviceDates: string[]): string[] {
  return [...new Set(serviceDates.filter(isIso).map(weekOf))].sort().reverse();
}

export function findMissing(serviceDates: string[], presence: Presence[]): MissingPerson[] {
  const weeks = serviceWeeks(serviceDates);
  const recent = new Set(weeks.slice(0, MISSING_RECENT_WEEKS));
  const prior = new Set(weeks.slice(MISSING_RECENT_WEEKS, MISSING_RECENT_WEEKS + MISSING_PRIOR_WEEKS));
  // Not enough history to say anything yet. Without this, the first month of
  // taking attendance would report everybody who missed the first Sunday.
  if (recent.size < MISSING_RECENT_WEEKS || prior.size < MISSING_RECENT_WEEKS) return [];

  const seen = new Map<number, { weeks: Set<string>; last: string }>();
  for (const p of presence) {
    if (!isIso(p.date)) continue;
    let e = seen.get(p.personId);
    if (!e) { e = { weeks: new Set(), last: p.date }; seen.set(p.personId, e); }
    e.weeks.add(weekOf(p.date));
    if (p.date > e.last) e.last = p.date;
  }

  const out: MissingPerson[] = [];
  for (const [personId, e] of seen) {
    let before = 0;
    let lately = false;
    for (const w of e.weeks) {
      if (recent.has(w)) lately = true;
      else if (prior.has(w)) before++;
    }
    if (lately || before < MISSING_MIN_PRIOR) continue;
    const idx = weeks.indexOf(weekOf(e.last));
    out.push({
      personId, lastSeen: e.last, weeksBefore: before, priorWeeks: prior.size,
      weeksAway: idx < 0 ? weeks.length : idx,
    });
  }
  // The most faithful first: someone who came every week and stopped is the
  // more surprising absence. Then whoever has been away longest.
  return out.sort((a, b) => b.weeksBefore - a.weeksBefore || a.lastSeen.localeCompare(b.lastSeen));
}

/**
 * The guard against listing one absence twice.
 *
 * Keyed on the LAST DATE SEEN, not just the person. Recomputing the list on
 * every visit to the page cannot add them again — the key is the same — and a
 * pastor who closes the item ("spoke to her, she's been ill") is not nagged
 * about the same absence next week. If they come back and later stop again,
 * the date is different, and they are rightly listed again.
 */
export const missingKey = (personId: number, lastSeen: string) => `missing:${personId}:${lastSeen}`;

export function parseMissingKey(key: string | null | undefined): { personId: number; lastSeen: string } | null {
  const m = /^missing:(\d+):(\d{4}-\d{2}-\d{2})$/.exec(key ?? '');
  return m ? { personId: Number(m[1]), lastSeen: m[2]! } : null;
}

export function missingReason(m: Pick<MissingPerson, 'lastSeen' | 'weeksBefore' | 'priorWeeks'>): string {
  return `Last here ${shortDate(m.lastSeen)} · came ${m.weeksBefore} of the ${m.priorWeeks} weeks before`;
}

/* ------------------------------------------------------------ the list -- */

/**
 * The order a pastor works down the list in.
 *
 * Guests first: a card answered within a day or two is a welcome, a card
 * answered in a fortnight is an apology. Then reminders, because somebody
 * chose that day on purpose. Then the regulars who have stopped coming, who
 * have usually been gone a month already and are not made worse by Thursday.
 */
const RANK: Record<string, number> = { guest: 0, reminder: 1, missing: 2 };

export function sortQueue<T extends { kind: string; dueOn: string; createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9)
    || a.dueOn.localeCompare(b.dueOn)
    || a.createdAt.localeCompare(b.createdAt));
}

/**
 * "What next?" after a contact is logged.
 *
 * 'done' closes the follow-up. Anything else closes it AND opens a reminder for
 * that day, so each item on the list has a clean beginning and end and the
 * history lives in the notes. Four weeks rather than a calendar month, so a
 * pastor who visits on Thursdays is reminded on a Thursday.
 */
export const NEXT_STEPS = [
  { id: 'done', label: 'Nothing more for now' },
  { id: 'week', label: 'Check again in a week', days: 7 },
  { id: 'fortnight', label: 'In two weeks', days: 14 },
  { id: 'month', label: 'In four weeks', days: 28 },
  { id: 'date', label: 'On a date' },
] as const;

/** The day to look again, or null for "done". A bad custom date is null too —
 *  better to close the item than to open a reminder for a day that is not one. */
export function nextDate(today: string, step: string, custom?: string | null): string | null {
  const preset = NEXT_STEPS.find((s) => s.id === step);
  if (!preset || preset.id === 'done') return null;
  if (preset.id === 'date') {
    if (!isIso(custom) || custom <= today) return null;
    return custom;
  }
  return addDays(today, preset.days);
}

/* --------------------------------------------------------- guest cards -- */

/**
 * What a guest can ask for. The ids are stored; the words on the public form
 * are the site's own (editable at /website/copy), and these short forms are
 * what the pastor reads in the list and in the alert text.
 */
export const GUEST_WANTS = [
  { id: 'visit', short: 'a visit' },
  { id: 'call', short: 'a call' },
  { id: 'kids', short: 'kids & youth info' },
  { id: 'faith', short: 'to talk about faith' },
] as const;

const WANT_IDS = new Set<string>(GUEST_WANTS.map((w) => w.id));

/** Stored as JSON text; anything unreadable is "asked for nothing". */
export function parseWants(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.map(String).filter((w) => WANT_IDS.has(w)) : [];
  } catch { return []; }
}

export function wantsText(wants: string[]): string {
  const words = GUEST_WANTS.filter((w) => wants.includes(w.id)).map((w) => w.short);
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** What arrives from the public form, before anything is believed. */
export interface GuestForm {
  first?: string; last?: string; phone?: string; email?: string;
  kind?: string; visitDate?: string; firstTime?: boolean; wants?: string[];
  message?: string; party?: string; heard?: string; sms?: boolean;
  /** The honeypot: a field no human can see. Anything in it is a bot. */
  website?: string;
}

export interface GuestDraft {
  firstName: string; lastName: string | null;
  phone: string | null; phoneE164: string | null; email: string | null;
  kind: 'here' | 'planning'; visitDate: string | null; firstTime: boolean;
  wants: string[]; message: string | null; party: string | null; heardFrom: string | null;
  smsConsent: 'opted_in' | null;
}

export type GuestProblem = 'spam' | 'name' | 'email' | 'phone' | 'contact' | 'date';

const LINKS = /https?:\/\/|www\.|<a\s|\[url|\.ru\b/i;

const clean = (v: string | undefined, max: number): string | null => {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Read a card, or say why not.
 *
 * 'spam' is a verdict the caller acts on SILENTLY — the visitor is shown the
 * thank-you page and nothing is stored — because a bot told it was refused
 * learns what to change. Every other problem goes back to a person who can fix
 * it.
 *
 * Deliberately forgiving everywhere else. This is filled in on a phone in a
 * pew; refusing a card because a surname is missing turns a welcome into a
 * form-filling exercise, and an incomplete card is still a person to greet.
 */
export function readGuestCard(f: GuestForm, today: string):
  { ok: true; card: GuestDraft } | { ok: false; problem: GuestProblem } {
  if ((f.website ?? '').trim()) return { ok: false, problem: 'spam' };
  const fields = [f.first, f.last, f.phone, f.email, f.message, f.party, f.heard];
  // People filling in a welcome card do not paste links. Bots do little else.
  if (fields.some((v) => v && LINKS.test(v))) return { ok: false, problem: 'spam' };

  const firstName = clean(f.first, 60);
  if (!firstName) return { ok: false, problem: 'name' };

  const email = clean(f.email, 120)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, problem: 'email' };

  const phone = clean(f.phone, 40);
  const phoneE164 = phone ? toE164(phone) : null;
  if (phone && !phoneE164) return { ok: false, problem: 'phone' };

  const wants = [...new Set((f.wants ?? []).filter((w) => WANT_IDS.has(w)))];
  // Asking to be visited or called with no way to be reached is a card that
  // cannot be answered. Better to say so while they are still holding the phone.
  if ((wants.includes('visit') || wants.includes('call')) && !phone && !email) {
    return { ok: false, problem: 'contact' };
  }

  const kind = f.kind === 'planning' ? 'planning' : 'here';
  let visitDate: string | null = today;
  if (kind === 'planning') {
    const d = clean(f.visitDate, 10);
    // "Not sure yet" is a real answer and stays null. A date in the past, or a
    // year out, is a slip of the thumb and is sent back rather than kept.
    if (d && (!isIso(d) || d < today || daysBetween(today, d) > 180)) return { ok: false, problem: 'date' };
    visitDate = d && isIso(d) ? d : null;
  }

  return {
    ok: true,
    card: {
      firstName,
      lastName: clean(f.last, 60),
      phone, phoneE164, email,
      kind, visitDate,
      firstTime: Boolean(f.firstTime),
      wants,
      message: clean(f.message, 2000),
      party: clean(f.party, 200),
      heardFrom: clean(f.heard, 80),
      // The tick-box is the consent, and it means nothing without a number.
      smsConsent: f.sms && phoneE164 ? 'opted_in' : null,
    },
  };
}

export const guestKey = (id: number) => `guest:${id}`;

export function guestName(c: { firstName: string; lastName: string | null }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ');
}

/** The line under their name on the follow-up list. */
export function guestReason(c: Pick<GuestDraft, 'kind' | 'visitDate' | 'firstTime' | 'wants'>): string {
  const parts: string[] = [];
  if (c.kind === 'planning') {
    parts.push(c.visitDate ? `Planning to visit ${shortDate(c.visitDate)}` : 'Planning a visit');
  } else {
    parts.push(c.visitDate ? `Visited ${shortDate(c.visitDate)}` : 'Visited');
    if (c.firstTime) parts.push('first time');
  }
  if (c.wants.length) parts.push(`wants ${wantsText(c.wants)}`);
  return parts.join(' · ');
}

/**
 * Smart punctuation to plain, for a text message.
 *
 * One curly apostrophe in a name typed on an iPhone moves the whole message
 * from GSM-7 to UCS-2 and triples what it costs — the trap the singing
 * reminder and the birthday texts both document.
 */
export function gsmSafe(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ');
}

/** The text a pastor gets when a card arrives. Short enough for one segment
 *  for an ordinary name, and it says enough to decide whether to look now. */
export function guestAlertBody(c: Pick<GuestDraft, 'firstName' | 'lastName' | 'kind' | 'visitDate' | 'firstTime' | 'wants'>, link: string): string {
  const who = guestName(c);
  const head = c.kind === 'planning'
    ? `Planned visit: ${who}${c.visitDate ? `, ${shortDate(c.visitDate)}` : ''}`
    : `New guest card: ${who}${c.firstTime ? ' (first time)' : ''}`;
  const wants = c.wants.length ? ` - wants ${wantsText(c.wants)}` : '';
  return gsmSafe(`${head}${wants}. ${link}`);
}

/* ------------------------------------------------------------ settings -- */

/**
 * Who gets the pastors' texts, and which ones.
 *
 * Recipients are PEOPLE, not staff accounts: a staff row is a Google address,
 * and a text needs a number and a consent decision, which live on `people`.
 * Stored as JSON in app_settings, the same shape as a schedule's named
 * recipients — a corrupt value means nobody, never everybody.
 */
export interface CareSettings {
  digestOn: boolean;
  /** 'HH:MM', church time, on Mondays. */
  digestTime: string;
  alertOn: boolean;
  recipientIds: number[];
}

export const DEFAULT_DIGEST_TIME = '08:00';

export function parseIdList(raw: string | null | undefined): number[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    if (!Array.isArray(v)) return [];
    return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  } catch { return []; }
}
