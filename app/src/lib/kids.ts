/**
 * Fairhaven Kids logic that does not touch the database.
 *
 * Kept separate so it can be unit-tested in plain node — see test/kids.test.ts
 * and the note in lib/consent.ts about why these files import no db module.
 */

/** How long a behaviour note may be. Long enough for what happened and what
 *  was done about it; short enough that nobody writes an essay on a phone. */
export const MAX_NOTE = 1000;

export interface AgeClass { id: number; name: string; minAge: number | null; maxAge: number | null }

/**
 * How old someone born on `birthday` is on `today`. Both are 'YYYY-MM-DD' in
 * the church's own timezone; neither is an instant.
 *
 * Parsed by SPLITTING THE STRING, not with `new Date(iso)`. `new Date('2019-07-04')`
 * is parsed as UTC midnight, which is the previous evening in Fairhaven —
 * the bug that shipped on the public site once already and renders a day early.
 * Nothing here needs a Date at all: an age is arithmetic on three integers.
 */
export function ageOn(birthday: string | null, today: string): number | null {
  const b = parseYmd(birthday);
  const t = parseYmd(today);
  if (!b || !t) return null;
  let age = t.y - b.y;
  // Not had this year's birthday yet.
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age--;
  // A birthday in the future, or a typo'd year, is not an age.
  return age < 0 || age > 130 ? null : age;
}

function parseYmd(s: string | null): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/**
 * Which class this age falls in — a SUGGESTION only.
 *
 * A child's class is stored explicitly on their profile and never derived.
 * `people.birthday` is sparse (13 of 120 in the Breeze import had one) and
 * bus-ministry children mostly have none, so deriving would file every one of
 * them nowhere, silently. This exists so a profile can say "should probably be
 * in Ages 7-9" and a person can agree or not — which is also what makes the
 * yearly move-up something the director can see rather than remember.
 */
export function suggestClass(age: number | null, classes: AgeClass[]): AgeClass | null {
  if (age === null) return null;
  return classes.find((c) =>
    c.minAge !== null && c.maxAge !== null && age >= c.minAge && age <= c.maxAge) ?? null;
}

/** Whether a child is in the class their age suggests. Null when there is
 *  nothing to compare — no birthday, or no class yet. */
export function classMismatch(
  age: number | null, currentClassId: number | null, classes: AgeClass[],
): boolean | null {
  if (age === null || currentClassId === null) return null;
  const s = suggestClass(age, classes);
  if (!s) return null;
  return s.id !== currentClassId;
}

/**
 * When a note was written, in the church's own timezone.
 *
 * The stored value is a UTC instant (nowIso). Rendering it raw, or slicing the
 * first ten characters off it the way the ledger does for dates, is wrong here
 * in a way that matters: a note typed at 8.42pm on a Wednesday in Indiana is
 * stored as 00:42 on the Thursday in UTC, so a bus worker reading it twenty
 * minutes later would be told it happened tomorrow. Wednesday evening is when
 * Kids Club runs, which is exactly when these get written.
 *
 * Unparseable input returns an empty string rather than "Invalid Date" — a
 * broken timestamp should look like a missing one, not like a bug on screen in
 * front of a parent.
 */
export function noteStamp(iso: string, tz = 'America/Indiana/Indianapolis'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

/**
 * Which slice of the children an attendance page is showing.
 *
 * Remembered per account as a short string — 'all', 'class:3', 'route:2' — so a
 * teacher or bus captain picks once and the page opens on it from then on. It is
 * a convenience filter and nothing more: whatever the view, the server still
 * only lets a volunteer mark enrolled children.
 */
export type AttendanceView =
  | { kind: 'all' }
  | { kind: 'class'; id: number }
  | { kind: 'route'; id: number };

/** Anything that is not exactly one of the three shapes is "not chosen". */
export function parseView(raw: string | null | undefined): AttendanceView | null {
  if (!raw) return null;
  if (raw === 'all') return { kind: 'all' };
  const m = /^(class|route):([1-9]\d{0,8})$/.exec(raw);
  return m ? { kind: m[1] as 'class' | 'route', id: Number(m[2]) } : null;
}

export const formatView = (v: AttendanceView): string =>
  v.kind === 'all' ? 'all' : `${v.kind}:${v.id}`;

/* ---- "Calling" (is each child coming Sunday?) ----------------------------------------------------- */

export const COMING_ANSWERS = ['yes', 'maybe', 'no'] as const;
export type ComingAnswer = (typeof COMING_ANSWERS)[number];
export const isComingAnswer = (v: unknown): v is ComingAnswer =>
  typeof v === 'string' && (COMING_ANSWERS as readonly string[]).includes(v);

/**
 * The Sunday the calls are for: today if it IS Sunday, otherwise the next one.
 * It names the week an answer belongs to, so the tally resets by the date
 * changing and not by anything being cleared. Integer arithmetic on y/m/d,
 * never `new Date('YYYY-MM-DD')`, for the same timezone reason as ageOn.
 */
export function comingSunday(today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) return today;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dow = new Date(t).getUTCDay();            // 0 = Sunday
  const sun = new Date(t + ((7 - dow) % 7) * 86400000);
  return sun.toISOString().slice(0, 10);
}

/* ---- Driving order on a bus route ------------------------------------------------------------------ */

/** The most a stop number may be. Room for 10, 20, 30… with gaps on any route. */
export const MAX_STOP = 9999;

/**
 * A typed stop number, or null for "not placed". Blank, zero, negative,
 * fractional, too big or not a number at all is null rather than coerced, so a
 * stray keystroke unplaces a child instead of moving them somewhere odd.
 */
export function parseStop(raw: unknown): number | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!/^[0-9]{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_STOP ? n : null;
}

export interface RouteOrderable {
  routeStop: number | null;
  street: string | null;
  firstName: string;
  lastName: string;
}

/**
 * Sort for a bus route: by stop number, so the list reads in driving order;
 * children with no number go last. Within one stop (siblings), and among the
 * unplaced, a house's children stay together by address, then by first name.
 */
export function routeOrder(a: RouteOrderable, b: RouteOrderable): number {
  const sa = a.routeStop ?? Infinity, sb = b.routeStop ?? Infinity;
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ha = a.street ?? '￿', hb = b.street ?? '￿';
  if (ha !== hb) return ha < hb ? -1 : 1;
  return a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName);
}
