// Explicit .ts extension: Vite is happy either way, but plain Node's ESM
// resolver needs it, and these functions are tested directly under Node.
import { CHURCH_TZ } from './services.ts';

/**
 * The singing-schedule reminder — the PURE half.
 *
 * Deliberately imports no database. Parsing a sheet, reading a date and
 * deciding whether it is Monday morning in Fairhaven are all decidable from
 * their inputs, and keeping them free of bindings is what lets them be tested
 * directly rather than through a running Worker. Anything needing the database
 * lives in roster-db.ts.
 *
 * A published Google Sheet lists who sings on which Sunday. On the Monday of
 * that week, everyone named gets one text. The message is the same every week;
 * only the names and the date change.
 *
 * SHEET SHAPE — first column is the Sunday's date, every other column holds
 * names. That tolerates AM/PM columns, one combined column, or a third added
 * later, without the parser caring. A header row is skipped.
 *
 *   Sunday      | AM                      | PM
 *   2026-09-06  | Ada Aldridge, Tom Aldridge | Peter Kingsley
 */

/** The message. Deliberately one GSM-7 segment: a curly apostrophe or an em
 *  dash here would triple the cost of every reminder ever sent. */
export const SINGING_REMINDER =
  'Fairhaven Community - A reminder: You are singing this Sunday! We are praying '
  + 'for you as you prepare, that God will help you to sing with the anointing.';

export interface RosterEntry { sunday: string; names: string[] }

/** Minimal CSV reader — quoted fields, embedded commas, doubled quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Accepts what a person actually types: 2026-09-06, 9/6/2026, 09/06/26. */
export function parseSheetDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const [, mo, d, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** One column of one Sunday — "Morning", "Evening", or whatever the sheet calls it. */
export interface RosterSlot {
  label: string;
  names: string[];
  /** Set when the cell is a note ("Revival", "No service") rather than people. */
  note: string | null;
}
export interface RosterDay { sunday: string; slots: RosterSlot[] }

const splitNames = (cell: string) =>
  cell.split(/[,;/]| and /i).map((n) => n.trim()).filter(Boolean);

/**
 * What to call a column.
 *
 * Prefers the sheet's own header, because that is what the pastor reads when he
 * edits it, and normalises only the two spellings that matter for the
 * bulletin. A sheet with no header row still works: the first two columns are
 * assumed morning and evening, which is the shape every real week has had.
 */
function slotLabel(header: string, index: number): string {
  const h = (header ?? '').trim();
  if (/^(a\.?m\.?\b|morning)/i.test(h)) return 'Morning';
  if (/^(p\.?m\.?\b|evening|night)/i.test(h)) return 'Evening';
  if (h) return h;
  return index === 0 ? 'Morning' : index === 1 ? 'Evening' : `Service ${index + 1}`;
}

/**
 * The roster with its COLUMNS KEPT APART.
 *
 * parseRoster below flattens these into one list of names, which is right for
 * the Monday reminder — everyone singing that week gets the same text, and
 * which service they are on does not change it. The bulletin needs the
 * opposite: it prints who is singing in the morning and who is singing at
 * night, as two separate lines.
 */
export function parseRosterDetailed(csv: string): RosterDay[] {
  const rows = parseCsv(csv);
  // The header is whichever leading row does not start with a date. Sheets
  // sometimes carry a title row above the real header, so this takes the LAST
  // non-date row before the data rather than the first.
  let headers: string[] = [];
  for (const row of rows) {
    if (parseSheetDate(row[0] ?? '')) break;
    if (row.some((c) => c.trim())) headers = row;
  }

  const out: RosterDay[] = [];
  for (const row of rows) {
    const sunday = parseSheetDate(row[0] ?? '');
    if (!sunday) continue;                     // header row, or a blank line
    const slots: RosterSlot[] = [];
    row.slice(1).forEach((cell, i) => {
      const slot = slotFromCell(slotLabel(headers[i + 1] ?? '', i), cell);
      if (slot) slots.push(slot);
    });
    if (slots.length) out.push({ sunday, slots });
  }
  return out;
}

/**
 * One cell — of the sheet, or of the schedule kept in the app — as a slot.
 *
 * THE ONE PLACE A CELL IS READ. The sheet and the app's own schedule both come
 * through here, so moving the schedule off the sheet cannot change how a single
 * Sunday is understood by the bulletin, the reminder or the printout.
 */
export function slotFromCell(label: string, cell: string | null | undefined): RosterSlot | null {
  const text = (cell ?? '').trim();
  if (!text) return null;
  return {
    label,
    // A note is shown as written. Splitting "No evening service" on the
    // spaces would print three names that are not people.
    names: looksLikeNote(text) ? [] : splitNames(text),
    note: looksLikeNote(text) ? text : null,
  };
}

/**
 * The schedule as the app keeps it — a morning and an evening cell per Sunday —
 * in the same shape the sheet produced, oldest first.
 */
export function rosterFromRows(
  rows: { sunday: string; morning: string | null; evening: string | null }[],
): RosterDay[] {
  return [...rows]
    .filter((r) => parseSheetDate(r.sunday))
    .sort((a, b) => a.sunday.localeCompare(b.sunday))
    .map((r) => ({
      sunday: r.sunday,
      slots: [slotFromCell('Morning', r.morning), slotFromCell('Evening', r.evening)]
        .filter((s): s is RosterSlot => s !== null),
    }))
    .filter((d) => d.slots.length > 0);
}

/** Every name for each Sunday in one list — what the Monday reminder reads. */
export function flattenRoster(days: RosterDay[]): RosterEntry[] {
  return days
    .map(({ sunday, slots }) => ({ sunday, names: slots.flatMap((s) => s.names) }))
    .filter((e) => e.names.length > 0);
}

/**
 * The flat view, unchanged: every name for a Sunday, in one list.
 *
 * Kept as the Monday reminder's input so that adding the bulletin's needs did
 * not touch the code path that sends real texts.
 */
export function parseRoster(csv: string): RosterEntry[] {
  return flattenRoster(parseRosterDetailed(csv));
}

/** The Sunday `days` after an ISO date. Noon UTC, so no timezone can shift it. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface SingingForBulletin {
  /** This bulletin's own Sunday. */
  slots: RosterSlot[];
  /** The Sunday after it, for the smaller "next week" reminder. */
  next: { sunday: string; slots: RosterSlot[] } | null;
}

/**
 * What the bulletin should print about singing.
 *
 * Keyed off the bulletin's OWN service date, never off today — the same rule
 * the birthdays follow, so a bulletin written on Thursday and printed on
 * Sunday says the same thing both days, and last month's bulletin still shows
 * last month's singers.
 *
 * Returns null when the sheet has nothing for that Sunday at all, so the
 * section can be left out rather than printed empty.
 */
export function singersFor(days: RosterDay[], serviceDate: string): SingingForBulletin | null {
  const today = days.find((d) => d.sunday === serviceDate);
  const nextSunday = addDays(serviceDate, 7);
  const after = days.find((d) => d.sunday === nextSunday);
  if (!today && !after) return null;
  return {
    slots: today?.slots ?? [],
    next: after ? { sunday: nextSunday, slots: after.slots } : null,
  };
}

/**
 * Some Sundays carry a note where the names go — "Revival", "No service",
 * "TBA". Nobody should be texted, and nothing should be reported as a failure.
 *
 * This is checked ONLY for entries that failed to match a person, never
 * before. That ordering matters: a real member called "Faith" or "Christian"
 * must still be found first.
 *
 * The patterns are deliberately NARROW. A bare "Camp" was in an earlier
 * version and swallowed the surname Camp — which would only bite when a name
 * was slightly misspelled, exactly when a report is most needed. Anything
 * ambiguous is therefore left OUT: "Missions" alone gets reported as an
 * unmatched name rather than silently discarded. Reporting a note as a
 * problem is a nuisance; discarding a person as a note means someone is never
 * told they are singing.
 */
const NOTE_PATTERNS = [
  // Anchored to the whole cell — these mean nothing else.
  /^none$/i, /^n\/?a$/i, /^-+$/, /^open$/i, /^t\.?b\.?[ad]\.?$/i,
  // Distinctive enough to match anywhere in the cell.
  /revival/i, /no (service|singing)/i, /\bcancel(l?ed)?\b/i, /singspiration/i,
  /guest speaker/i, /business meeting/i, /homecoming/i, /communion/i,
  /christmas program/i, /missions? service/i,
  // Added after auditing the real schedule — these are the shapes the pastor's
  // sheet actually uses for a Sunday with no singers.
  /\bservice\b/i, /\bchorus\b/i, /\bvbs\b/i, /family day/i, /youth[- ]led/i,
];
export const looksLikeNote = (s: string) => NOTE_PATTERNS.some((re) => re.test(s.trim()));

/* ------------------------------------------------------------ matching -- */

/** A person as the matcher needs them — the columns, and nothing else. */
export interface MatchPerson {
  id: number; firstName: string; lastName: string;
  phoneE164: string | null; smsConsent: string;
}

export interface Matched { name: string; personId: number; phoneE164: string }
export interface RosterMatch {
  matched: Matched[];
  /** Entries that were never people — "Revival", "No service". Nobody is
   *  texted and nothing is reported as broken; the note is surfaced so the
   *  week reads as deliberate rather than as an empty failure. */
  notes: string[];
  /** Named on the roster but not confidently identified, or with no number /
   *  no consent. These are REPORTED, never quietly dropped — a silent miss
   *  means somebody turns up on Sunday not knowing they were meant to sing. */
  unmatched: { name: string; reason: string }[];
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Names on the schedule, matched to people who can be texted.
 *
 * PURE, and the one rule. The Monday reminder runs it (through roster-db's
 * matchNames, which only fetches the people first), and so does the schedule
 * editor — which is how the editor can say, while the quarter is being typed
 * in, exactly who will and will not get the reminder.
 */
export function matchPeople(names: string[], people: MatchPerson[]): RosterMatch {
  const byFull = new Map<string, MatchPerson[]>();
  for (const p of people) {
    const key = normName(`${p.firstName} ${p.lastName}`);
    byFull.set(key, [...(byFull.get(key) ?? []), p]);
  }

  const matched: Matched[] = [];
  const unmatched: { name: string; reason: string }[] = [];
  const notes: string[] = [];

  for (const raw of names) {
    // "Aldridge, Ada" and "Ada Aldridge" are the same person written two ways.
    const flipped = raw.includes(',')
      ? raw.split(',').map((s) => s.trim()).reverse().join(' ') : raw;
    const hits = byFull.get(normName(flipped)) ?? [];

    if (hits.length === 0) {
      // Checked only now, after failing to find a person — so a member whose
      // name happens to contain one of these words is still found first.
      if (looksLikeNote(raw)) { notes.push(raw); continue; }
      unmatched.push({ name: raw, reason: 'no one by that name' });
      continue;
    }
    // Two people with identical names is not something to resolve by guessing.
    if (hits.length > 1) { unmatched.push({ name: raw, reason: 'more than one person has that name' }); continue; }

    const p = hits[0]!;
    if (!p.phoneE164) { unmatched.push({ name: raw, reason: 'no phone number on file' }); continue; }
    if (p.smsConsent === 'opted_out') { unmatched.push({ name: raw, reason: 'has opted out of texts' }); continue; }
    if (p.smsConsent !== 'opted_in') { unmatched.push({ name: raw, reason: 'not opted in to texts' }); continue; }

    matched.push({ name: raw, personId: p.id, phoneE164: p.phoneE164 });
  }
  return { matched, unmatched, notes };
}

/* --------------------------------------------------------------- timing -- */

/** Date parts in the CHURCH's timezone, never the Worker's UTC. */
function churchParts(now: Date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHURCH_TZ, weekday: 'short', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, hour: Number(p.hour) };
}

export const SEND_HOUR = 9;   // 9am, the pastor's choice

/**
 * Is now the moment to send, and for which Sunday?
 *
 * Monday from 09:00, and Tuesday as a grace day. The grace day exists because
 * a cron outage on Monday would otherwise mean nobody is told at all, silently
 * — worse than a reminder arriving a day late. Anything later than that is not
 * sent: a reminder on Thursday for the coming Sunday is confusing rather than
 * useful, and it surfaces in the dashboard instead.
 */
export function dueSunday(now = new Date()): { sunday: string; late: boolean } | null {
  const { date, weekday, hour } = churchParts(now);
  const isMon = weekday === 'Mon', isTue = weekday === 'Tue';
  if (!isMon && !isTue) return null;
  if (hour < SEND_HOUR) return null;

  // The Sunday at the END of this week: 6 days after Monday, 5 after Tuesday.
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (isMon ? 6 : 5));
  return { sunday: d.toISOString().slice(0, 10), late: isTue };
}

/** One reminder per person per Sunday, ever. The unique constraint on
 *  source_key is what actually enforces it — not this string. */
export const reminderKey = (sunday: string, personId: number) => `singing:${sunday}:${personId}`;
