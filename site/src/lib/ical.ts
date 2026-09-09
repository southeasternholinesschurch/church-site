import ical from 'node-ical';
import { CHURCH_TZ } from './format';
import { extractMinistryTags, type MinistryTag } from './ministry-tags';

/**
 * Events data pipeline — single source of truth is the pastor's "Church Public
 * Events" iCloud calendar (build brief §5). Both the homepage strip and the
 * full Events page call `getUpcomingEvents()` at BUILD TIME (this runs
 * inside .astro frontmatter, not in the browser).
 *
 * The two documented failure points (brief §5) are recurring events and
 * DST. See docs/README.md → "Testing the events feed" for the exact manual
 * test procedure — do not trust this silently, verify it against a real
 * weekly Wednesday entry and a date that crosses a DST boundary.
 */

export interface ChurchEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date | null;
  location?: string;
  description?: string;
  url?: string;
  /**
   * True for a date-only VEVENT (`DTSTART;VALUE=DATE`). Without this an
   * all-day entry renders as "12:00 AM", which reads as a real — and wrong —
   * start time.
   */
  allDay: boolean;
  /**
   * The last calendar day the event actually covers, INCLUSIVE.
   *
   * Not the same as `end`. For an all-day VEVENT, DTEND is *exclusive* — a
   * one-day all-day event on the 22nd has DTEND of the 23rd — so `end` would
   * make every all-day event look like it spans two days. For a timed event
   * ending exactly at midnight, `end` lands on the following day for the same
   * reason. `lastDay` resolves both.
   */
  lastDay: Date;
  /**
   * True when the event covers more than one calendar day.
   *
   * NOTE what this cannot tell you. iCalendar has no way to say "7pm each
   * night" — a VEVENT is one contiguous interval, and Apple Calendar only
   * offers a single start and end. So the church's September revival is
   * authored as one block from Tue 7pm to Sun 8pm, when the reality is 7pm
   * nightly plus normal service times on the Sunday. The span is real; the
   * continuity is an artifact. Display must therefore show the DAY RANGE and
   * the start time, never "7:00 PM – 8:00 PM", which would assert 121
   * unbroken hours. The genuine per-night detail comes from the event's Notes
   * (`description`) — see docs/README.md → "Multi-day events".
   */
  multiDay: boolean;
  /**
   * Ministries this event belongs to, from `#kids`-style tags in its Notes.
   *
   * The tags are stripped from `description` before it reaches any page, so a
   * visitor never reads the hashtag itself — see lib/ministry-tags.ts.
   */
  ministries: MinistryTag[];
}

/** Apple publishes `webcal://…` — that's just `https://` with a different scheme label. */
export function toHttpsUrl(feedUrl: string): string {
  return feedUrl.replace(/^webcal:\/\//i, 'https://');
}

/**
 * Fetch + expand the calendar feed into concrete event occurrences within
 * [windowStart, windowEnd]. Recurring events (RRULE) are expanded here,
 * honoring EXDATE (cancelled single occurrences) and RECURRENCE-ID
 * overrides (a single instance edited to a different time/title) — both
 * are easy to get wrong with a naive RRULE.between() call, so this is
 * intentionally explicit rather than clever.
 */
/**
 * Fetch and parse the feed, ONCE per build and with a hard time limit.
 *
 * `ical.async.fromURL` has neither, and both only bite on a bad day. A hung
 * iCloud does not fail — it simply never answers — so the build sits there
 * until Cloudflare's own timeout kills it, and the site quietly stops updating
 * with no obvious cause. Meanwhile the same feed was being fetched about seven
 * times per build (home, events, bulletin, and once per ministry), multiplying
 * both the wait and the chance of catching a bad moment.
 *
 * Failures still throw. Every caller already wraps this in a try/catch and
 * renders without events rather than taking the build down.
 */
const FEED_TIMEOUT_MS = 15_000;
type ParsedFeed = Awaited<ReturnType<typeof ical.async.parseICS>>;
const feedCache = new Map<string, Promise<ParsedFeed>>();

function fetchFeed(url: string): Promise<ParsedFeed> {
  const cached = feedCache.get(url);
  if (cached) return cached;

  const pending = (async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`calendar feed returned ${res.status}`);
    return ical.async.parseICS(await res.text());
  })();

  feedCache.set(url, pending);
  // A failure must not be cached as permanent for the rest of the build.
  pending.catch(() => feedCache.delete(url));
  return pending;
}

export async function getEventsInRange(
  feedUrl: string,
  windowStart: Date,
  windowEnd: Date
): Promise<ChurchEvent[]> {
  const url = toHttpsUrl(feedUrl);
  const data = await fetchFeed(url);

  const events: ChurchEvent[] = [];

  for (const component of Object.values(data)) {
    if (!component || component.type !== 'VEVENT') continue;
    const vevent = component as ical.VEvent;

    if (!vevent.rrule) {
      // Simple, non-recurring event — include if it falls in range.
      const start = vevent.start as unknown as Date;
      if (start >= windowStart && start <= windowEnd) {
        events.push(toChurchEvent(vevent, start));
      }
      continue;
    }

    // Recurring event: expand occurrences in range, then apply per-instance
    // overrides/cancellations.
    const occurrences: Date[] = vevent.rrule.between(windowStart, windowEnd, true);
    const exceptionDates = new Set(
      Object.keys(vevent.exdate ?? {}).map((k) => new Date(k).toISOString())
    );

    for (const occurrenceStart of occurrences) {
      if (exceptionDates.has(occurrenceStart.toISOString())) continue;

      // A `recurrences` map (keyed by ISO date string of the *original*
      // occurrence) means this one instance was individually edited —
      // e.g. one Wednesday's Prayer & Praise moved to a different room.
      const overrideKey = Object.keys(vevent.recurrences ?? {}).find(
        (k) => new Date(k).getTime() === occurrenceStart.getTime()
      );
      if (overrideKey && vevent.recurrences?.[overrideKey]) {
        const overridden = vevent.recurrences[overrideKey];
        events.push(toChurchEvent(overridden, overridden.start as unknown as Date));
      } else {
        events.push(toChurchEvent(vevent, occurrenceStart));
      }
    }
  }

  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Any iCal property can arrive as `{ params, val }` rather than a bare
 * string once it carries parameters. Unwrap defensively so a parameterised
 * SUMMARY or DESCRIPTION never renders as "[object Object]" in body copy.
 */
function text(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { val?: unknown }).val === 'string') {
    return (raw as { val: string }).val;
  }
  return undefined;
}

/**
 * A VEVENT's URL is not reliably a string — see `text()` — and it is not
 * reliably a *web* address either. the pastor's first real event was created from
 * a Messages thread, so Apple attached `messages://open?message-guid=…`: a
 * deep link that does nothing for a visitor and needlessly publishes an
 * internal GUID. So: unwrap, then accept only http/https. Anything else
 * yields no link at all.
 */
function safeEventUrl(raw: unknown): string | undefined {
  const val = text(raw);
  if (!val) return undefined;
  try {
    const { protocol } = new URL(val);
    return protocol === 'http:' || protocol === 'https:' ? val : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An all-day VEVENT (`DTSTART;VALUE=DATE:20260922`) is a CALENDAR DATE, not an
 * instant — it has no time and no timezone. node-ical still has to return a
 * Date, and it builds one at **local midnight of the machine doing the parse**.
 * So the same feed yields a different instant depending on where the build ran:
 *
 *   the pastor's Mac (Indianapolis) -> 2026-09-22T04:00:00Z
 *   Cloudflare's builder (UTC) -> 2026-09-22T00:00:00Z
 *
 * Formatting either one in the church's timezone is what shipped the Revival
 * as "Monday Sep 21" on the live site while it rendered "Tuesday Sep 22"
 * locally. A calendar date must never be timezone-converted.
 *
 * The fix: read back the Y/M/D the parser actually meant (its LOCAL
 * components, which equal the intended date under any build timezone) and
 * re-anchor at UTC midnight. Consumers then format all-day dates with
 * `timeZone: 'UTC'` — see `eventTimeZone()` in lib/format.ts — and the output
 * is identical wherever it is built.
 *
 * Timed events are genuine instants and are left completely alone.
 */
function anchorAllDay(start: Date): Date {
  return new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
}

/** The calendar date an instant falls on, in a given zone, as "YYYY-MM-DD". */
function ymdInZone(d: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which compares correctly as a string
  return d.toLocaleDateString('en-CA', { timeZone });
}

function toChurchEvent(vevent: ical.VEvent, start: Date): ChurchEvent {
  const durationMs =
    vevent.end && vevent.start
      ? (vevent.end as unknown as Date).getTime() - (vevent.start as unknown as Date).getTime()
      : null;
  // node-ical sets datetype to 'date' (not 'date-time') for DTSTART;VALUE=DATE
  const allDay = (vevent as unknown as { datetype?: string }).datetype === 'date';
  const rawEnd = durationMs !== null ? new Date(start.getTime() + durationMs) : null;

  const s = allDay ? anchorAllDay(start) : start;
  const end = rawEnd && allDay ? anchorAllDay(rawEnd) : rawEnd;

  // Work out the inclusive final day. DTEND is exclusive for all-day events,
  // and a timed event finishing exactly at midnight belongs to the day before.
  let lastDay = s;
  if (end && end.getTime() > s.getTime()) {
    lastDay = allDay ? new Date(end.getTime() - 86400000) : new Date(end.getTime() - 1);
  }

  const tz = allDay ? 'UTC' : CHURCH_TZ;
  // Notes carry two things: the human schedule, and any ministry tags. Split
  // them here so every consumer gets clean text and a ready list.
  const { tags, text: notes } = extractMinistryTags(text(vevent.description));
  return {
    uid: vevent.uid ?? `${vevent.summary}-${s.toISOString()}`,
    title: text(vevent.summary) ?? 'Untitled event',
    start: s,
    end,
    lastDay,
    multiDay: ymdInZone(lastDay, tz) !== ymdInZone(s, tz),
    location: text(vevent.location),
    description: notes,
    url: safeEventUrl((vevent as unknown as { url?: unknown }).url),
    allDay,
    ministries: tags,
  };
}

/** Convenience wrapper: next N days of events, for the homepage strip. */
export async function getUpcomingEvents(feedUrl: string, days = 30): Promise<ChurchEvent[]> {
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  return getEventsInRange(feedUrl, now, end);
}
