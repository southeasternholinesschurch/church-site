/**
 * Timezone-aware "next service" math for the Livestream countdown.
 *
 * Indianapolis observes Eastern Time with DST (America/Indiana/Indianapolis),
 * so a fixed UTC offset is wrong roughly half the year. Rather than pull in
 * a date library, we lean on the JS engine's built-in IANA tzdata via
 * `Intl.DateTimeFormat` — it's always current and needs no dependency to
 * keep updated.
 *
 * The approach (a standard technique, same idea date-fns-tz uses):
 * 1. Read the *current* wall-clock date/time in the target zone.
 * 2. For each configured service, walk forward day-by-day to find the next
 *    matching weekday.
 * 3. Convert that "Y-M-D + local HH:MM in this timezone" into a real UTC
 *    Date by guessing UTC-as-if-local, checking what wall time that guess
 *    actually renders as in the zone, and correcting by the difference.
 *    This self-corrects across the DST boundary automatically.
 */

export const CHURCH_TZ = 'America/Indiana/Indianapolis';

export interface ServiceTime {
  label: string;
  day: 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';
  /** 24-hour "HH:MM" in the church's local time. */
  time: string;
}

const WEEKDAYS: ServiceTime['day'][] = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
}

/** Convert a Y-M-D + local HH:MM *in `timeZone`* into a real UTC Date, DST-safe. */
function zonedWallTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number,
  timeZone: string
): Date {
  // Initial guess: treat the wall time as if it were UTC.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 2; i++) {
    const rendered = zonedParts(guess, timeZone);
    const renderedAsUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, 0);
    const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diffMs = desiredAsUtc - renderedAsUtc;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }
  return guess;
}

export interface NextService {
  label: string;
  date: Date;
}

/** Given the configured weekly services, find the soonest upcoming one after `now`. */
export function getNextService(services: ServiceTime[], now: Date = new Date()): NextService | null {
  if (services.length === 0) return null;
  const today = zonedParts(now, CHURCH_TZ);
  const todayIndex = WEEKDAYS.indexOf(today.weekday === 'Thu' ? 'Thursday'
    : (WEEKDAYS.find((w) => w.slice(0, 3) === today.weekday) ?? 'Sunday'));

  let best: NextService | null = null;

  for (const service of services) {
    const targetIndex = WEEKDAYS.indexOf(service.day);
    const [hh, mm] = service.time.split(':').map(Number);

    // Try today (offset 0) through next week (offset 7) to find the next
    // occurrence at/after `now`.
    for (let offset = 0; offset <= 7; offset++) {
      const dayIndex = (todayIndex + offset) % 7;
      if (dayIndex !== targetIndex) continue;

      // Compute the candidate Y-M-D by walking forward from today's zoned date.
      const candidateUtcNoon = new Date(Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0) + offset * 86400000);
      const candidateZoned = zonedParts(candidateUtcNoon, CHURCH_TZ);
      const occurrence = zonedWallTimeToUtc(candidateZoned.year, candidateZoned.month, candidateZoned.day, hh, mm, CHURCH_TZ);

      if (occurrence.getTime() >= now.getTime()) {
        if (!best || occurrence.getTime() < best.date.getTime()) {
          best = { label: service.label, date: occurrence };
        }
      }
      break;
    }
  }

  // Fallback: if nothing matched within a week (shouldn't happen with a
  // full weekly schedule), just find the earliest next-week occurrence.
  if (!best) {
    for (const service of services) {
      const [hh, mm] = service.time.split(':').map(Number);
      const targetIndex = WEEKDAYS.indexOf(service.day);
      const daysAhead = (targetIndex - todayIndex + 7) % 7 || 7;
      const candidateUtcNoon = new Date(Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0) + daysAhead * 86400000);
      const candidateZoned = zonedParts(candidateUtcNoon, CHURCH_TZ);
      const occurrence = zonedWallTimeToUtc(candidateZoned.year, candidateZoned.month, candidateZoned.day, hh, mm, CHURCH_TZ);
      if (!best || occurrence.getTime() < best.date.getTime()) {
        best = { label: service.label, date: occurrence };
      }
    }
  }

  return best;
}

/** Is `now` within `windowMinutes` after a service start (a reasonable "might be live" window)? */
export function isNearServiceStart(services: ServiceTime[], now: Date = new Date(), windowMinutes = 90): boolean {
  const today = zonedParts(now, CHURCH_TZ);
  for (const service of services) {
    if (WEEKDAYS[WEEKDAYS.indexOf(service.day)] !== service.day) continue;
    const [hh, mm] = service.time.split(':').map(Number);
    if (today.weekday !== service.day.slice(0, 3)) continue;
    const start = zonedWallTimeToUtc(today.year, today.month, today.day, hh, mm, CHURCH_TZ);
    const diffMin = (now.getTime() - start.getTime()) / 60000;
    if (diffMin >= 0 && diffMin <= windowMinutes) return true;
  }
  return false;
}
