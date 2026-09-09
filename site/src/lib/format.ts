/**
 * Display formatting shared across pages.
 */

/** Everything with a real clock time renders in the church's own timezone. */
export const CHURCH_TZ = 'America/Indiana/Indianapolis';

/**
 * Which timezone to format an event in.
 *
 * A timed event is an instant, so it renders in the church's timezone —
 * 7pm Wednesday is 7pm Wednesday for the person reading it.
 *
 * An all-day event is a calendar date with no time and no zone. `ical.ts`
 * re-anchors those to UTC midnight (see `anchorAllDay` there), so formatting
 * them with `timeZone: 'UTC'` returns the intended day, identically on any
 * build machine. Formatting them in the church timezone instead is what put
 * the Revival on the wrong day: the UTC-built instant fell back across
 * midnight and rendered as the day before.
 *
 * Every place that formats a ChurchEvent must go through this.
 */
export function eventTimeZone(allDay: boolean): string {
  return allDay ? 'UTC' : CHURCH_TZ;
}

interface EventLike {
  start: Date;
  lastDay: Date;
  allDay: boolean;
  multiDay: boolean;
  /** The event's Notes. When present it is the authoritative schedule. */
  description?: string;
}

/**
 * The "when" line under an event title.
 *
 *   single, timed     "Tuesday · 1:00 PM"
 *   single, all-day   "Tuesday · All day"
 *   multi-day, timed  "Tue 22 – Sun 27 Sep · from 7:00 PM"
 *   multi-day, spans  "Wed 30 Sep – Fri 2 Oct · from 7:00 PM"
 *
 * Deliberately "from 7:00 PM" and never "7:00 PM – 8:00 PM" on a multi-day
 * event. Apple Calendar can only store one start and one end, so the church's
 * revival is authored as a single block from Tuesday 7pm to Sunday 8pm —
 * rendering that as a closed range would tell a visitor the event runs for 121
 * unbroken hours. The span is true, the continuity is not.
 *
 * And when a multi-day event HAS Notes, the derived start time is dropped
 * entirely:
 *
 *   multi-day, timed, with notes   "Tue 22 – Sun 27 Sep"
 *
 * because the Notes are the real schedule and the derived time can contradict
 * them. The revival starts at 7pm on weeknights but 10am on the Sunday, so
 * "from 7:00 PM" sitting directly above "Sunday 10 AM and 5:30 PM" is exactly
 * the confusion this whole approach exists to avoid. Without Notes the start
 * time is still the best available hint, so it stays.
 */
export function eventWhen(e: EventLike, opts: { withDate?: boolean } = {}): string {
  const tz = eventTimeZone(e.allDay);
  const d = (date: Date, opts: Intl.DateTimeFormatOptions) =>
    date.toLocaleDateString('en-US', { ...opts, timeZone: tz });

  const time = e.allDay
    ? 'All day'
    : e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

  if (!e.multiDay) {
    /*
     * The date is OPT-IN because most callers already show it.
     *
     * EventCard renders a stacked date block beside this string, so repeating
     * "14 Sep" in words next to a large "SEP 14" reads as a mistake. The
     * bulletin has no such block — it is a plain definition list — so without
     * the date a single-day event says only "Sunday · 6:00 PM", which is fine
     * for This Week and useless under Coming Up, where the next few MONTHS are
     * listed and there is no way to tell which Sunday is meant.
     *
     * Day before month, matching the multi-day range format above.
     */
    const date = opts.withDate
      ? ` ${d(e.start, { day: 'numeric' })} ${d(e.start, { month: 'short' })}`
      : '';
    return `${d(e.start, { weekday: 'long' })}${date} · ${time}`;
  }

  const sameMonth = d(e.start, { month: 'short' }) === d(e.lastDay, { month: 'short' });
  const from = `${d(e.start, { weekday: 'short' })} ${d(e.start, { day: 'numeric' })}${
    sameMonth ? '' : ` ${d(e.start, { month: 'short' })}`
  }`;
  const to = `${d(e.lastDay, { weekday: 'short' })} ${d(e.lastDay, { day: 'numeric' })} ${d(e.lastDay, { month: 'short' })}`;
  const range = `${from} – ${to}`;

  if (e.allDay) return `${range} · All day`;
  // Notes, where present, are the authoritative schedule — don't argue with them
  return e.description?.trim() ? range : `${range} · from ${time}`;
}

/**
 * The stacked date block. Multi-day events inside one month show the day span
 * ("22–27"); one crossing a month boundary falls back to the start date, since
 * "30–2" under a single month label would be a lie — `eventWhen` carries the
 * full range in words either way.
 */
export function eventDateBlock(e: EventLike): { month: string; day: string; isRange: boolean } {
  const tz = eventTimeZone(e.allDay);
  const month = e.start.toLocaleDateString('en-US', { month: 'short', timeZone: tz }).toUpperCase();
  const startDay = e.start.toLocaleDateString('en-US', { day: 'numeric', timeZone: tz });
  if (!e.multiDay) return { month, day: startDay, isRange: false };

  const endMonth = e.lastDay.toLocaleDateString('en-US', { month: 'short', timeZone: tz }).toUpperCase();
  if (endMonth !== month) return { month, day: startDay, isRange: false };

  const endDay = e.lastDay.toLocaleDateString('en-US', { day: 'numeric', timeZone: tz });
  return { month, day: `${startDay}–${endDay}`, isRange: true };
}

/**
 * "17:30" → { time: "5:30", suffix: "pm" }; "10:00" → { time: "10", suffix: "am" }.
 *
 * Service times are stored 24-hour in site.yaml so they sort and compare
 * correctly, but nobody reads "17:30 pm" on a church website.
 */
export function clockLabel(t: string): { time: string; suffix: 'am' | 'pm' } {
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { time: m === 0 ? String(h12) : `${h12}:${String(m).padStart(2, '0')}`, suffix };
}

/**
 * "10:00" → "10:00 am", "17:30" → "5:30 pm" — the one-line form, for prose
 * and lists. clockLabel drops ":00" because the big numeral display reads
 * better without it; in running text the minutes belong.
 */
export function clockText(t: string): string {
  const { time, suffix } = clockLabel(t);
  return `${time.includes(':') ? time : `${time}:00`} ${suffix}`;
}
