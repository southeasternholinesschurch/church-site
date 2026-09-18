/**
 * Sign-up sheets — the PURE half.
 *
 * ONE MODEL, THREE PRESETS. A meal train, a volunteer list and a pitch-in are
 * the same thing: a list of SLOTS with a capacity, that people CLAIM. The kind
 * decides only how slots are made and what the form asks for. Everything below
 * — availability, seat claiming, when a sheet has closed, when a reminder is
 * due — is written once and shared by all three. Resist adding a branch on
 * `kind` here; if one seems necessary, it almost certainly belongs in the page.
 *
 * Deliberately imports no database, no `astro:` anything and nothing from
 * `node:` — this is a Workers project, and pulling in node types would let
 * `Buffer` typecheck everywhere and fail at runtime. Everything takes `now` as
 * an argument so the clock can be put wherever a test needs it, the same shape
 * lib/schedules.ts uses. The I/O lives in the pages and in schedule-runner.
 *
 * Explicit .ts on the relative imports: Vite is happy either way, plain Node's
 * ESM resolver is not, and this file is imported directly by the tests.
 */
import { countSegments } from './sms.ts';
import type { LocalNow } from './schedules.ts';

/* ------------------------------------------------------------- the kinds -- */

export type SignupKind = 'meal-train' | 'list' | 'dish';

/**
 * What staff pick from when creating a sheet. Blurbs rather than names alone:
 * "list" and "dish" mean nothing until somebody says what they are for, and
 * this is the one screen where the choice is hard to change later.
 */
export const SIGNUP_KINDS: { id: SignupKind; label: string; blurb: string }[] = [
  { id: 'meal-train', label: 'Meal train',
    blurb: 'One day each, across a span of days. For a family who is ill, '
         + 'or home with a new baby.' },
  { id: 'list', label: 'A list of names',
    blurb: 'An event or a job that needs volunteers. Add your name; that is all.' },
  { id: 'dish', label: 'Pitch-in or dinner',
    blurb: 'You name the parts — two mains, six sides, four desserts — and people '
         + 'sign up against them.' },
];

export const isSignupKind = (v: string): v is SignupKind =>
  v === 'meal-train' || v === 'list' || v === 'dish';

/** The one slot a plain list has. Named here so the label is not typed twice. */
export const LIST_SLOT_LABEL = 'Sign up';

/* ------------------------------------------------------------------ dates -- */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isIsoDate = (v: string | null | undefined): boolean => ISO.test((v ?? '').trim());

/**
 * `days` after an ISO date, as an ISO date.
 *
 * Noon UTC, never `new Date(iso)` — that is UTC midnight, which in
 * Indianapolis is the evening BEFORE, and is how this project once shipped an
 * off-by-one day on the public site. addDays in lib/roster.ts carries the same
 * note for the same reason.
 */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Tuesday, 14 October" — how a meal-train day reads on the public sheet. */
export function dayLabel(iso: string): string {
  const m = ISO.exec((iso ?? '').trim());
  if (!m) return iso ?? '';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/**
 * "Tue 14 Oct" — how a day reads inside a TEXT MESSAGE.
 *
 * Short on purpose: the reminder has to stay inside one GSM-7 segment, and the
 * long form above costs a dozen characters that buy nothing on a phone.
 */
export function shortWhen(iso: string): string {
  const m = ISO.exec((iso ?? '').trim());
  if (!m) return iso ?? '';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS_SHORT[d.getUTCDay()]} ${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}`;
}

/**
 * A meal train of more than two months is a mistake, not a plan.
 *
 * The real case this guards is a typo in the year — 2026 to 2036 generates
 * three and a half thousand rows, and nothing between the form and the database
 * would object.
 */
export const MAX_GENERATED_DAYS = 60;

/** Returns why a date range cannot be filled in, or null when it can. */
export function invalidRangeReason(start: string, end: string): string | null {
  if (!isIsoDate(start) || !isIsoDate(end)) return 'Pick a first and a last day.';
  if (end < start) return 'The last day is before the first one.';
  const span = Math.round(
    (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400_000) + 1;
  if (span > MAX_GENERATED_DAYS) {
    return `That is ${span} days. Meal trains run a week or two — `
         + `${MAX_GENERATED_DAYS} is as far as this will go, in case a year was mistyped.`;
  }
  return null;
}

/** Every date from start to end inclusive. Empty when the range is no good. */
export function daysInRange(start: string, end: string): string[] {
  if (invalidRangeReason(start, end)) return [];
  const out: string[] = [];
  for (let d = start; d <= end; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/**
 * The days a *Fill in the days* press should ADD.
 *
 * Only what is missing. Re-running must never disturb a day somebody has
 * already claimed — which is the whole reason this takes the existing dates
 * rather than returning a fresh list for the page to replace things with.
 */
export function daysToAdd(existing: (string | null)[], start: string, end: string): string[] {
  const have = new Set(existing.filter((d): d is string => !!d));
  return daysInRange(start, end).filter((d) => !have.has(d));
}

/**
 * What pressing *Set the days* should actually do to the sheet.
 *
 * Adding was the easy half and the only half this did at first — press it again
 * with a wider range and the new days appear. The pastor found the other half:
 * NARROW the range and the days you dropped stayed on the sheet, still
 * collectable, with nothing to say they were meant to be gone.
 *
 * So the two date boxes describe the span of the meal train, and this makes the
 * sheet match them. With one exception, which is the whole reason this returns
 * three lists instead of doing the obvious thing:
 *
 *   A DAY SOMEBODY HAS CLAIMED IS NEVER REMOVED. Not silently, and not at all.
 *   Somebody has told a family they are bringing Tuesday; the family has
 *   stopped planning for Tuesday. A mistyped date must not quietly undo that.
 *   It is kept, and the caller says out loud that it was kept, exactly as
 *   clearing a dish row somebody has signed up for is refused rather than
 *   obeyed.
 *
 * UNDATED SLOTS ARE LEFT ALONE ENTIRELY. They are not part of a date range and
 * this function has no opinion about them — which matters because a meal-train
 * row whose date staff cleared by hand would otherwise fall outside every
 * range and be swept away by a press of a button about something else.
 */
export interface DayPlan {
  /** Dates in the range with no slot yet. */
  add: string[];
  /** Slot ids outside the range that nobody has signed up for. */
  remove: number[];
  /** Dates outside the range that are kept anyway, because people are on them. */
  keep: string[];
}

export function planDays(
  existing: { id: number; onDate: string | null; taken: number }[],
  start: string, end: string,
): DayPlan {
  if (invalidRangeReason(start, end)) return { add: [], remove: [], keep: [] };

  const dated = existing.filter((e) => isIsoDate(e.onDate));
  const add = daysToAdd(dated.map((e) => e.onDate), start, end);

  const remove: number[] = [];
  const keep: string[] = [];
  for (const e of dated) {
    const d = e.onDate!.trim();
    if (d >= start && d <= end) continue;
    if (e.taken > 0) keep.push(d);
    else remove.push(e.id);
  }
  return { add, remove, keep: keep.sort() };
}

/* --------------------------------------------------------- availability -- */

export interface Availability {
  full: boolean;
  /** Seats left, or null when the slot has no limit. */
  open: number | null;
  /** What the public sheet says beside the names. */
  text: string;
}

/**
 * How a slot reads. `capacity === null` means NO LIMIT — not zero, and not a
 * large number standing in for unlimited, both of which read as a cap somebody
 * forgot to set.
 */
export function availability(capacity: number | null, taken: number): Availability {
  if (capacity === null) {
    return { full: false, open: null, text: taken === 0 ? 'Available' : 'Room for more' };
  }
  const open = Math.max(0, capacity - taken);
  if (open === 0) return { full: true, open: 0, text: 'Full' };
  if (taken === 0) return { full: false, open, text: 'Available' };
  return { full: false, open, text: open === 1 ? '1 still open.' : `${open} still open.` };
}

export interface SlotStatus {
  /** What the row says beside (or instead of) its label. */
  text: string;
  /** Whether the names belong stacked underneath rather than in that line. */
  stacked: boolean;
}

/**
 * What one row of the public sheet SAYS, and where the names go.
 *
 * Written after looking at a full sheet and not being able to tell it was full.
 * A row that can no longer be signed up for loses its form, so the only thing
 * left saying anything is this line — and it was showing a comma-joined list of
 * names, which reads as information rather than as an answer to "can I still
 * take this?".
 *
 * Three rules, and each exists because the other two get a case wrong:
 *
 *   A PLACE FOR ONE PERSON answers with the name. "Tuesday - Ada Aldridge" is
 *   complete; "Tuesday - Full" beside it would be noise, and the name is the
 *   thing a family actually wants to know.
 *
 *   A PLACE FOR SEVERAL answers with the count — "Full", "2 still open." — and
 *   the names go underneath where four of them can be read. Four names crammed
 *   into a right-hand column is where this started.
 *
 *   A CLOSED SHEET NEVER ADVERTISES PLACES. "5 still open." under a banner
 *   saying the sign-up has closed is the software contradicting itself, so a
 *   shut row reports what happened rather than what is free.
 */
export function slotStatus(
  capacity: number | null, names: string[], closed: boolean,
): SlotStatus {
  const a = availability(capacity, names.length);
  if (capacity === 1) {
    return { text: names[0] ?? (closed ? 'Nobody signed up' : a.text), stacked: false };
  }
  if (!names.length) return { text: closed ? 'Nobody signed up' : a.text, stacked: false };
  return {
    text: closed
      ? (names.length === 1 ? '1 signed up' : `${names.length} signed up`)
      : a.text,
    stacked: true,
  };
}

/**
 * The seat number to try for, or null when the slot is full.
 *
 * THE RETURN VALUE IS A GUESS, and must be treated as one. Two phones reading
 * the same rows get the same answer; what keeps them apart is the unique index
 * on (slot_id, seat) and an insert that does nothing on conflict. If the insert
 * returns no row, somebody was quicker — re-read and either try again or say
 * plainly that the slot has just filled. Never count and then trust the count.
 *
 * The lowest FREE seat rather than one past the highest, so removing somebody
 * from a full slot genuinely reopens the place they left.
 */
export function nextSeat(taken: number[], capacity: number | null): number | null {
  if (capacity !== null && taken.length >= capacity) return null;
  const used = new Set(taken);
  for (let s = 1; s <= taken.length + 1; s++) if (!used.has(s)) return s;
  return taken.length + 1;
}

/* ------------------------------------------------------------- open/shut -- */

export interface SheetTiming {
  status: string;
  closesOn: string | null;
  eventDate: string | null;
}

/**
 * Why this sheet is no longer collecting, or null while it still is.
 *
 * Three ways it shuts, and the last one is the point: a link in an old
 * bulletin, or on a card still sitting in a pew, must not go on collecting
 * meals for a family who stopped needing them a month ago. Nobody remembers to
 * press Close, so the dates do it.
 *
 * `today` is the church's date, passed in — a Worker's own date is UTC, and
 * after 8pm in Indianapolis that is already tomorrow.
 */
export function closedReason(
  sheet: SheetTiming, slotDates: (string | null)[], today: string,
): string | null {
  if (sheet.status === 'closed') return 'This sign-up has closed.';

  if (isIsoDate(sheet.closesOn) && sheet.closesOn! < today) {
    return 'This sign-up has closed.';
  }

  // The dates this sheet is ABOUT: the slots' own days when they have them,
  // and otherwise the event's date. A dish sheet has no dated slots, so the
  // dinner's date is what makes it stale.
  const dated = slotDates.filter((d): d is string => isIsoDate(d));
  const dates = dated.length ? dated : (isIsoDate(sheet.eventDate) ? [sheet.eventDate!] : []);
  if (dates.length && dates.every((d) => d < today)) {
    return 'This sign-up has closed.';
  }
  return null;
}

/* ------------------------------------------------------------- reminders -- */

/**
 * 09:00 church time the day before.
 *
 * The same hour the singing reminder uses, and chosen for the same reason:
 * early enough to be useful when somebody is planning their day, late enough
 * not to wake anyone.
 */
export const REMIND_HOUR = 9;

/**
 * Is the reminder for this date due right now?
 *
 * The window runs from 09:00 the day BEFORE to 09:00 ON the day — a grace
 * window in the shape of dueSunday() in lib/roster.ts, and it exists for the
 * same reason: a cron outage should mean a late reminder, not a silent one.
 * After that it is NOT sent. "You are bringing a meal tomorrow" arriving on the
 * evening of the day itself is worse than nothing, and the missed occurrence is
 * written as a `skipped` row so it is visible rather than invisible.
 *
 * Says nothing about whether it has ALREADY been sent. That is the unique index
 * on scheduled_messages.source_key and nothing else — which is what makes this
 * safe to call on every five-minute tick.
 */
export function reminderDue(onDate: string | null | undefined, now: LocalNow): boolean {
  if (!isIsoDate(onDate)) return false;
  const date = onDate!.trim();
  const eve = addDaysIso(date, -1);
  if (now.date === eve) return now.minutes >= REMIND_HOUR * 60;
  if (now.date === date) return now.minutes < REMIND_HOUR * 60;
  return false;
}

/** Past the grace window: no text, but a visible `skipped` row. */
export function reminderMissed(onDate: string | null | undefined, now: LocalNow): boolean {
  if (!isIsoDate(onDate)) return false;
  const date = onDate!.trim();
  if (now.date > date) return true;
  return now.date === date && now.minutes >= REMIND_HOUR * 60;
}

/**
 * The idempotency key for one reminder.
 *
 * A sign-up is for exactly ONE slot on ONE date, so its id is already a stable
 * occurrence identity — no date needs to ride along the way it does for a
 * weekly schedule. The UNIQUE index on scheduled_messages.source_key is the
 * only thing preventing a second text; not this string, and not any check in
 * the caller.
 */
export const reminderKey = (signupId: number) => `signup:${signupId}`;

/**
 * Deliberately ONE GSM-7 SEGMENT — no curly apostrophe, no em dash. A smart
 * quote here would silently make every reminder cost several times as much,
 * which is the trap the singing reminder and the birthday message both
 * document.
 */
export const DEFAULT_REMINDER_BODY =
  'Fairhaven Community - Reminder: you signed up to bring a meal tomorrow, {when}. Thank you!';

/** The name a text should use. "Alan Reeve" is a greeting; "Alan" is one. */
export const firstNameOf = (name: string): string =>
  (name ?? '').trim().split(/\s+/)[0] ?? '';

/**
 * Fill {first} and {when}.
 *
 * Unknown placeholders are LEFT ALONE, the same rule renderBody follows.
 * Silently deleting "{day}" would send a sentence with a hole in it; leaving it
 * visible means the mistake is caught in the preview, which is where mistakes
 * are cheap.
 */
export function renderReminder(
  template: string, v: { first?: string; when?: string },
): string {
  return (template ?? '')
    .replace(/\{first\}/gi, (v.first ?? '').trim())
    .replace(/\{when\}/gi, (v.when ?? '').trim())
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * What the wording costs, measured on a REALISTIC filled-in message rather
 * than on the template.
 *
 * "{first}" is seven characters and "Bartholomew" is eleven — validating the
 * template would approve a message that goes into a second segment for a third
 * of the church. Pessimistic on purpose: being wrong here is a bill, quietly,
 * on every reminder ever sent.
 *
 * The builder shows the count from this same function, so the screen and the
 * validator cannot disagree.
 */
export const sampleReminder = (template: string): string =>
  renderReminder(template, { first: 'Bartholomew', when: 'Wed 12 Nov' });

/** Returns a reason the wording was refused, or null when it is fine. */
export function invalidReminderReason(body: string): string | null {
  const text = (body ?? '').trim();
  if (!text) return 'The reminder is empty.';
  const seg = countSegments(sampleReminder(text));
  if (seg.encoding === 'UCS-2') {
    return 'There is a character in there a phone cannot send cheaply — usually a '
         + 'curly apostrophe or a long dash pasted in from Word. Retype it with a '
         + "plain ' and a plain -.";
  }
  if (seg.segments > 1) {
    return `That comes to ${seg.segments} messages once a name and a date are filled in, `
         + 'so every reminder is billed twice. Shorten it to about 150 characters.';
  }
  return null;
}

/**
 * The wording currently in force for a sheet.
 *
 * Falls back to the built-in default whenever the stored value is missing OR
 * unusable — the same shape as getInviteTemplate and getBirthdaySettings.
 * Reading is not the moment to discover somebody saved something broken; by
 * then a text is about to go out.
 */
export function reminderBodyFor(stored: string | null | undefined): string {
  const text = (stored ?? '').trim();
  if (text && !invalidReminderReason(text)) return text;
  return DEFAULT_REMINDER_BODY;
}

/* ------------------------------------------------------------- summaries -- */

/**
 * "5 of 7 days taken" — the one line the staff list shows per sheet.
 *
 * The pastor reads this list to know whether a meal train still needs filling, so
 * the number has to be true rather than roughly right. Two shapes, because one
 * would be wrong somewhere:
 *
 *   every slot holds one   → counted in DAYS, which is what a meal train is
 *   some slot holds more   → counted in PLACES, because "5 of 7 days" would be
 *                            a lie on a sheet asking for two meals a day
 *
 * A slot with no limit makes the total unknowable, so it says what it knows.
 */
export function sheetSummary(
  kind: SignupKind, slots: { capacity: number | null }[], taken: number,
): string {
  if (!slots.length) return 'Nothing to sign up for yet';

  const unlimited = slots.some((s) => s.capacity === null);
  const places = slots.reduce((n, s) => n + (s.capacity ?? 0), 0);
  const one = slots.every((s) => s.capacity === 1);

  if (unlimited) return taken === 1 ? '1 signed up' : `${taken} signed up`;
  if (kind === 'meal-train') {
    return one
      ? `${taken} of ${slots.length} days taken`
      : `${taken} of ${places} meals taken`;
  }
  if (kind === 'dish') return `${taken} of ${places} claimed`;
  return `${taken} of ${places} signed up`;
}
