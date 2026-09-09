/**
 * When a scheduled message is due, and what it says.
 *
 * Pure functions only — no database, no Twilio, no `Date.now()` reached for
 * behind your back. Everything takes `now` as an argument so the tests can put
 * the clock wherever they need it, including on a DST boundary and on 29
 * February. The runner in api/sms/run-due.ts does the I/O; this decides.
 */

export const CHURCH_TZ = 'America/Indiana/Indianapolis';

/**
 * Birthday texts are NOT a schedule kind.
 *
 * They were, briefly, and it was wrong: a birthday text is a standing
 * arrangement rather than something you sit down and set up, and putting it
 * here made it look like a yearly chore. It now lives in app_settings and runs
 * on its own — see lib/birthday-settings.ts. This screen is for scheduling a
 * text, and nothing else.
 */
export type ScheduleKind = 'once' | 'weekly';

export interface ScheduleRow {
  id: number;
  name: string;
  body: string;
  kind: string;
  groupId: number | null;
  /** JSON array of person ids, when the text goes to named individuals.
   *  Exclusive with groupId; null for both means everyone. */
  recipientIds: number[] | null;
  /** Local wall-clock 'YYYY-MM-DDTHH:MM' — for kind 'once'. */
  sendAt: string | null;
  /** 0 = Sunday — for kind 'weekly'. */
  weekday: number | null;
  /** 'HH:MM' local — for 'weekly'. */
  localTime: string | null;
  active: boolean;
  lastRunAt: string | null;
}

export interface LocalNow {
  /** 'YYYY-MM-DD' in the church's timezone. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Sunday. */
  weekday: number;
}

/**
 * Where the clock is, in Indianapolis.
 *
 * Derived from the formatter rather than from UTC arithmetic, because Indiana
 * observes DST and hard-coding an offset silently breaks twice a year. The
 * project has shipped a timezone bug of exactly this shape before — see
 * services.ts.
 */
export function localNow(now: Date, tz: string = CHURCH_TZ): LocalNow {
  const date = now.toLocaleDateString('en-CA', { timeZone: tz });
  const hhmm = now.toLocaleTimeString('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const [h, m] = hhmm.split(':').map(Number);
  // 'short' weekday rather than an index: getDay() on a reconstructed Date
  // would be the SERVER's day, which is the bug this function exists to avoid.
  const wd = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return { date, minutes: h * 60 + m, weekday };
}

/** 'HH:MM' → minutes since midnight, or null if it isn't a time. */
export function parseHhmm(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * How late a schedule may fire and still be worth sending.
 *
 * The cron runs every 5 minutes, so a window of 5 would drop a send whenever a
 * run is a few seconds late or one is missed entirely. An hour is generous
 * enough to survive a blip and short enough that nobody gets a "service starts
 * soon" text in the middle of the afternoon. Anything later is skipped rather
 * than sent, and skipping is recorded.
 */
export const GRACE_MINUTES = 60;

/**
 * Is this schedule due right now?
 *
 * Returns the local date it is due FOR — which is also what makes the queue key
 * unique per occurrence — or null when it is not due.
 *
 * Deliberately says nothing about whether it has ALREADY run. Duplicate
 * prevention lives entirely in the unique index on scheduled_messages.source_key,
 * so this stays a pure window check and the runner may re-expand a due schedule
 * on every cron tick inside the window. That is not wasted work, it is the
 * point: the audience is re-read each time, so a birthday typed into the
 * directory at 9:20 is still caught by the 9:25 tick, and someone added to a
 * group after the first tick still gets the text. Re-expanding cannot double-send
 * — the key is per person per occurrence and the database refuses the second row.
 *
 * `lastRunAt` is recorded for the staff list ("last ran…") and is not consulted
 * here. Gating on it was the earlier design and it silently dropped anyone whose
 * details arrived mid-window.
 */
export function dueOn(s: ScheduleRow, now: LocalNow): string | null {
  if (!s.active) return null;

  if (s.kind === 'once') {
    if (!s.sendAt) return null;
    const [date, time] = s.sendAt.split('T');
    const at = parseHhmm(time);
    if (!date || at === null) return null;
    // Only on its own day. A one-off whose day has passed is stale and is
    // never sent late — a reminder for a meeting that already happened is
    // worse than no reminder.
    if (date !== now.date) return null;
    if (now.minutes < at || now.minutes > at + GRACE_MINUTES) return null;
    return date;
  }

  const at = parseHhmm(s.localTime);
  if (at === null) return null;
  if (now.minutes < at || now.minutes > at + GRACE_MINUTES) return null;

  if (s.kind === 'weekly') {
    return s.weekday === now.weekday ? now.date : null;
  }
  return null;
}

/**
 * Whose birthday is it on `date`?
 *
 * Compares month and day as NUMBERS parsed out of the stored string, never via
 * `new Date(iso)` — that parses 'YYYY-MM-DD' as UTC midnight, which in
 * Indianapolis is the evening BEFORE, so half the church would be wished a
 * happy birthday a day early. celebrations.ts carries the same warning.
 *
 * 29 February is wished on the 28th in a common year, so leap-day birthdays are
 * not silently skipped three years in four.
 */
export function hasBirthdayOn(birthday: string | null | undefined, date: string): boolean {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec((birthday ?? '').trim());
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!b || !d) return false;
  const bm = Number(b[2]), bd = Number(b[3]);
  const dm = Number(d[2]), dd = Number(d[3]);
  if (bm === dm && bd === dd) return true;
  if (bm === 2 && bd === 29 && dm === 2 && dd === 28) return !isLeapYear(Number(d[1]));
  return false;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Fill {first} and {name} for one recipient.
 *
 * Unknown placeholders are LEFT ALONE. Silently deleting "{amount}" would send
 * a sentence with a hole in it; leaving it visible means the mistake is caught
 * in the preview, which is where mistakes are cheap.
 */
export function renderBody(template: string, person: { firstName?: string; lastName?: string }): string {
  const first = (person.firstName ?? '').trim();
  const last = (person.lastName ?? '').trim();
  return template
    .replace(/\{first\}/gi, first)
    .replace(/\{name\}/gi, [first, last].filter(Boolean).join(' '))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * The idempotency key for one person's copy of one occurrence.
 *
 * Carries the occurrence DATE, so a weekly rule sends again next week but never
 * twice this week, and the unique index on source_key enforces it in the
 * database rather than in whichever code path happens to run.
 */
export function queueKey(scheduleId: number, occurrenceDate: string, personId: number): string {
  return `sched:${scheduleId}:${occurrenceDate}:${personId}`;
}

/** Validation shared by the form and the API, so they cannot disagree. */
export function invalidScheduleReason(s: Partial<ScheduleRow>): string | null {
  if (!s.name?.trim()) return 'Give it a name so you can find it later.';
  if (!s.body?.trim()) return 'The message is empty.';
  if (s.kind === 'once') {
    const [date, time] = (s.sendAt ?? '').split('T');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return 'Pick a date.';
    if (parseHhmm(time) === null) return 'Pick a time.';
    return null;
  }
  if (s.kind === 'weekly') {
    if (s.weekday == null || s.weekday < 0 || s.weekday > 6) return 'Pick a day of the week.';
    if (parseHhmm(s.localTime) === null) return 'Pick a time.';
    return null;
  }
  return 'Unknown schedule type.';
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
