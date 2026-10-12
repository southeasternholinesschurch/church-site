/**
 * The Monday digest — the PURE half.
 *
 * One text to the pastors on Monday morning, and a page it links to. The text
 * carries the numbers a pastor would otherwise open four screens to find — last
 * week's attendance, who is waiting for a call, the week's birthdays, who is
 * singing — and the page carries the names.
 *
 * Everything here decides from its inputs: which week was "last week", whose
 * birthday falls in the next seven days, what the text says and that it fits.
 * The gathering is in digest-db.ts.
 */
// Explicit .ts: plain Node's ESM resolver needs it, and this file is tested directly.
import { addDays, gsmSafe, shortDate } from './care.ts';

/* ----------------------------------------------------------------- weeks -- */

/**
 * The week the digest reports on: Monday to Sunday, ending on the last Sunday
 * BEFORE today. On a Monday that is yesterday. Read on a Sunday afternoon it is
 * the week before, because today's evening service has not happened yet.
 */
export function reportWeek(today: string): { start: string; end: string } {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();   // 0 = Sunday
  const end = addDays(today, -(dow === 0 ? 7 : dow));
  return { start: addDays(end, -6), end };
}

/** The coming Sunday: today if it is Sunday, otherwise the next one. */
export function comingSunday(today: string): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, dow === 0 ? 0 : 7 - dow);
}

/* ---------------------------------------------------------- celebrations -- */

export interface Celebrant {
  personId: number; name: string;
  birthday: string | null; anniversary: string | null;
}
export interface Celebration { personId: number; name: string; date: string; kind: 'birthday' | 'anniversary' }

const md = (iso: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  return m ? { month: Number(m[2]), day: Number(m[3]) } : null;
};

/**
 * Birthdays and anniversaries in the seven days from `today`.
 *
 * Month and day are compared as NUMBERS out of the stored string — never
 * through new Date(), which reads 'YYYY-MM-DD' as UTC midnight and lands every
 * date the evening before in Fairhaven. A 29 February birthday is kept on
 * the 28th in a common year, the same rule the birthday texts follow, so it is
 * not skipped three years in four.
 */
export function celebrationsBetween(people: Celebrant[], today: string, days = 7): Celebration[] {
  const out: Celebration[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const d = md(date)!;
    const year = Number(date.slice(0, 4));
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    for (const p of people) {
      for (const kind of ['birthday', 'anniversary'] as const) {
        const v = md(p[kind]);
        if (!v) continue;
        const onDay = (v.month === d.month && v.day === d.day)
          || (!leap && v.month === 2 && v.day === 29 && d.month === 2 && d.day === 28);
        if (onDay) out.push({ personId: p.personId, name: p.name, date, kind });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------- the text -- */

export interface ServiceCount { kind: string; label: string; date: string; total: number; average: number | null }

export interface DigestData {
  week: { start: string; end: string };
  services: ServiceCount[];
  care: { guest: number; missing: number; reminder: number };
  /** Cards that arrived during the report week. */
  newGuests: number;
  /** Planned visits for the coming week. */
  expected: number;
  celebrations: Celebration[];
  singing: { sunday: string; morning: string | null; evening: string | null } | null;
  /** Open sign-up slots still wanting people in the coming week. */
  openSlots: number;
}

/** "AM", "PM", "Wed" — the shortest names a pastor will still read at a glance. */
const SHORT: Record<string, string> = {
  'sunday-morning': 'Sun AM', 'sunday-evening': 'Sun PM', 'sunday-school': 'S.School',
  wednesday: 'Wed', other: 'Other',
};

/**
 * The text itself.
 *
 * Kept to two segments for an ordinary week: it is a summary with a link, not
 * the report. Every part that has nothing to say is left out rather than
 * printed as a zero, so a quiet week is a short text. Plain GSM-7 throughout —
 * a smart apostrophe in one singer's name would otherwise triple the cost.
 */
export function digestText(d: DigestData, link: string): string {
  const parts: string[] = [];
  parts.push(`SHC week of ${shortDate(d.week.start).replace(/^\w+, /, '')}`);

  if (d.services.length) {
    const s = d.services.map((x) => {
      const avg = x.average !== null && x.average !== x.total ? ` (avg ${x.average})` : '';
      return `${SHORT[x.kind] ?? x.label} ${x.total}${avg}`;
    }).join(', ');
    parts.push(s);
  } else {
    parts.push('no attendance taken');
  }

  const follow = [
    d.care.guest && `${d.care.guest} guest${d.care.guest === 1 ? '' : 's'}`,
    d.care.missing && `${d.care.missing} not been in`,
    d.care.reminder && `${d.care.reminder} reminder${d.care.reminder === 1 ? '' : 's'}`,
  ].filter(Boolean);
  if (follow.length) parts.push(`Follow up: ${follow.join(', ')}`);
  if (d.expected) parts.push(`${d.expected} planning to visit`);

  const bdays = d.celebrations.filter((c) => c.kind === 'birthday').length;
  const annivs = d.celebrations.filter((c) => c.kind === 'anniversary').length;
  const cel = [bdays && `${bdays} birthday${bdays === 1 ? '' : 's'}`,
               annivs && `${annivs} anniversar${annivs === 1 ? 'y' : 'ies'}`].filter(Boolean);
  if (cel.length) parts.push(`${cel.join(', ')} this week`);

  if (d.singing && (d.singing.morning || d.singing.evening)) {
    parts.push(`Singing Sun: ${d.singing.morning ?? '-'} / ${d.singing.evening ?? '-'}`);
  }
  if (d.openSlots) parts.push(`${d.openSlots} sign-up slot${d.openSlots === 1 ? '' : 's'} open`);

  return gsmSafe(`${parts.join('. ')}. ${link}`);
}

/** One digest per person per Monday — the unique index on source_key is the
 *  guard, this string only names it. */
export const digestKey = (date: string, personId: number) => `digest:${date}:${personId}`;
