/**
 * The singing schedule kept in the app — the PURE half.
 *
 * Planned a quarter at a time, three or four times a year, which is how the
 * Google Sheet it replaces was used. Each Sunday has a morning cell and an
 * evening cell holding what was typed: names separated by commas, or a note
 * ("Fall Revival") where there are no singers. Reading a cell is roster.ts's
 * job, so the bulletin, the Monday reminder and the printout cannot disagree
 * about one.
 *
 * I/O is in singing-db.ts.
 */
// Explicit .ts: plain Node's ESM resolver needs it, and this file is tested directly.
import { slotFromCell, matchPeople, parseRosterDetailed, type MatchPerson } from './roster.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Noon UTC, so no timezone can tip a date. */
function at(iso: string): Date { return new Date(`${iso}T12:00:00Z`); }
const iso = (d: Date) => d.toISOString().slice(0, 10);

/* -------------------------------------------------------------- quarters -- */

export interface Quarter {
  /** "2026-Q4" — what goes in the URL. */
  key: string;
  start: string;
  end: string;
  /** "October – December 2026" — what goes at the top of the printout. */
  label: string;
}

export function quarterOf(date: string): Quarter {
  const d = at(isIso(date) ? date : '2000-01-01');
  return quarter(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) + 1);
}

function quarter(year: number, q: number): Quarter {
  const first = (q - 1) * 3;
  const start = new Date(Date.UTC(year, first, 1, 12));
  const end = new Date(Date.UTC(year, first + 3, 0, 12));
  return {
    key: `${year}-Q${q}`,
    start: iso(start),
    end: iso(end),
    label: `${MONTHS[first]} – ${MONTHS[first + 2]} ${year}`,
  };
}

/** "2026-Q4" -> the quarter, or null for anything else. */
export function quarterFromKey(key: string | null | undefined): Quarter | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 2000 || year > 2100) return null;
  return quarter(year, Number(m[2]));
}

export function shiftQuarter(q: Quarter, by: number): Quarter {
  const [y, n] = q.key.split('-Q').map(Number) as [number, number];
  const index = y * 4 + (n - 1) + by;
  return quarter(Math.floor(index / 4), (index % 4) + 1);
}

/** Every Sunday from `from` to `to`, both included. */
export function sundaysBetween(from: string, to: string): string[] {
  if (!isIso(from) || !isIso(to) || from > to) return [];
  const d = at(from);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  const out: string[] = [];
  while (iso(d) <= to) {
    out.push(iso(d));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

export function monthName(date: string): string {
  return MONTHS[at(date).getUTCMonth()] ?? '';
}

/* -------------------------------------------------------- what a cell says -- */

export type NameState = 'reminded' | 'quiet' | 'unknown' | 'note';

export interface CellName { text: string; state: NameState; reason?: string }

/**
 * Each name in a cell, and what the Monday reminder will do about it.
 *
 *   reminded  matched to one person who can be texted
 *   quiet     found, but will not be texted — no number, or not opted in
 *   unknown   nobody by that name, or more than one
 *   note      the cell is a note, not people
 *
 * Shown under the cell as the quarter is typed in, which is the whole point of
 * keeping the schedule here: the sheet could only tell you on Monday morning,
 * in the dashboard, after the reminder had already gone without them.
 */
export function cellNames(cell: string | null | undefined, people: MatchPerson[]): CellName[] {
  const slot = slotFromCell('', cell);
  if (!slot) return [];
  if (slot.note) return [{ text: slot.note, state: 'note' }];
  const { matched, unmatched, notes } = matchPeople(slot.names, people);
  return slot.names.map((name): CellName => {
    if (matched.some((m) => m.name === name)) return { text: name, state: 'reminded' };
    if (notes.includes(name)) return { text: name, state: 'note' };
    const u = unmatched.find((x) => x.name === name);
    const reason = u?.reason ?? 'no one by that name';
    const missing = reason === 'no one by that name' || reason.startsWith('more than one');
    return { text: name, state: missing ? 'unknown' : 'quiet', reason };
  });
}

/* ------------------------------------------------- copying the sheet in -- */

/**
 * The published sheet as the rows this app keeps — one per Sunday, a morning
 * and an evening cell.
 *
 * Read through parseRosterDetailed, the same parser the bulletin and the
 * reminder used on the sheet, and written back as text the same parser will
 * read identically: names joined by commas, a note kept as the note. So a
 * Sunday means the same thing the day after it is copied in as the day before.
 */
export function rowsFromSheet(csv: string): { sunday: string; morning: string | null; evening: string | null }[] {
  return parseRosterDetailed(csv).map((day) => {
    const text = (label: string) => {
      const slot = day.slots.find((s) => s.label === label);
      return slot ? (slot.note ?? slot.names.join(', ')) : null;
    };
    return { sunday: day.sunday, morning: text('Morning'), evening: text('Evening') };
  }).filter((r) => r.morning || r.evening);
}

/* --------------------------------------------------- who has sung lately -- */

export interface SingerTally { name: string; times: number; last: string }

/**
 * Who has sung, how often, and when last — newest first within the window.
 *
 * For planning the next quarter fairly: the people at the BOTTOM of this list
 * are the ones it has been longest since anybody asked. Counted by the name as
 * typed, case-insensitively, because a guest singer is not on People and still
 * sang.
 */
export function singerTally(
  rows: { sunday: string; morning: string | null; evening: string | null }[],
  from: string, to: string,
): SingerTally[] {
  const tally = new Map<string, SingerTally>();
  for (const r of rows) {
    if (r.sunday < from || r.sunday > to) continue;
    for (const cell of [r.morning, r.evening]) {
      const slot = slotFromCell('', cell);
      if (!slot || slot.note) continue;
      for (const name of slot.names) {
        const key = name.toLowerCase();
        const t = tally.get(key) ?? { name, times: 0, last: r.sunday };
        t.times++;
        if (r.sunday > t.last) t.last = r.sunday;
        tally.set(key, t);
      }
    }
  }
  return [...tally.values()].sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
}

/* --------------------------------------------------------------- printing -- */

/** The line at the foot of the printout, until somebody writes their own. */
export const DEFAULT_PRINT_NOTE =
  'Singers who get church texts are reminded the Monday before their Sunday. '
  + 'If you cannot sing on your Sunday, please let the pastor know as soon as you can.';

/**
 * How one Sunday prints.
 *
 * A NOTE ON ITS OWN SPANS THE ROW. "Fall Revival" in the morning with nothing
 * in the evening is not a morning item — it is what the whole day is — so it is
 * printed once across both columns instead of beside an empty cell that reads
 * like somebody forgot to fill it in.
 */
export type PrintRow =
  | { sunday: string; span: string }
  | { sunday: string; morning: { text: string; note: boolean } | null;
      evening: { text: string; note: boolean } | null };

export function printRow(r: { sunday: string; morning: string | null; evening: string | null }): PrintRow {
  const m = slotFromCell('Morning', r.morning);
  const e = slotFromCell('Evening', r.evening);
  if (m?.note && !e) return { sunday: r.sunday, span: m.note };
  if (e?.note && !m) return { sunday: r.sunday, span: e.note };
  const cell = (s: typeof m) => (s ? { text: s.note ?? s.names.join(', '), note: Boolean(s.note) } : null);
  return { sunday: r.sunday, morning: cell(m), evening: cell(e) };
}
