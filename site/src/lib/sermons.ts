/**
 * Turning YouTube upload titles into service records.
 *
 * The channel is an archive of full service recordings, not a library of
 * individually-titled sermons. Every upload is named the same way:
 *
 *   "August 23, 2026 Sunday Morning Worship"
 *   "August 19, 2026 Wednesday Prayer and Praise"
 *   "August 16, 2026 Sunday School and Evening Worship"
 *
 * Two things follow, and both matter:
 *
 * 1. THE DATE MUST COME FROM THE TITLE, never from YouTube's publishedAt.
 *    Uploads lag the service by 1–8 days in the real data, so publishedAt
 *    misdates every entry — including putting some in the wrong week.
 *
 * 2. There is no sermon title, speaker, scripture or series anywhere in the
 *    channel metadata. Descriptions are boilerplate Restream text. So those
 *    stay OPTIONAL in the content schema: the archive is complete and useful
 *    without them, and any entry someone enriches by hand later renders
 *    richer automatically.
 */

/** Canonical buckets for filtering. The raw label is kept separately for display. */
export type ServiceType = 'sunday-morning' | 'sunday-evening' | 'wednesday' | 'other';

/**
 * Where a service falls within its own day.
 *
 * Sorting a series by date alone is not enough, because a church that preaches
 * morning and evening puts two parts of a run on ONE date — and two entries
 * with the same timestamp sort arbitrarily. That showed up immediately: the
 * Sunday morning message was labelled "Part 2 of 2" and the evening one
 * offered no "previous". Anything that orders a run must break the tie here.
 */
export const SERVICE_ORDER: Record<ServiceType, number> = {
  'sunday-morning': 0,
  'sunday-evening': 1,
  wednesday: 2,
  other: 3,
};

/** Chronological, oldest first — the order a series is meant to be followed. */
export function byServiceOrder(
  a: { date: Date; serviceType: ServiceType },
  b: { date: Date; serviceType: ServiceType },
): number {
  return a.date.getTime() - b.date.getTime()
    || SERVICE_ORDER[a.serviceType] - SERVICE_ORDER[b.serviceType];
}

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  'sunday-morning': 'Sunday Morning',
  'sunday-evening': 'Sunday Evening',
  wednesday: 'Wednesday',
  other: 'Other',
};

export interface ParsedServiceTitle {
  /** Calendar date of the SERVICE (not the upload), as YYYY-MM-DD. */
  date: string;
  /** The label exactly as written on the channel, e.g. "Sunday Morning Worship". */
  service: string;
  serviceType: ServiceType;
  /** Only from the pipe-separated format. */
  speaker?: string;
  /** Only from the pipe-separated format. */
  title?: string;
}

/**
 * TITLING CONVENTION for the YouTube channel
 * ------------------------------------------
 *   August 23, 2026 | Sunday Morning Worship | Pastor the pastor | The Narrow Gate
 *        date       |        service         |        speaker       |  sermon title
 *
 * Rules, in full:
 *   - Date and service are required, in that order, and always first.
 *   - Speaker and sermon title are optional, but keep the order.
 *   - Got a sermon title but no speaker? Put a dash in the speaker slot:
 *       August 23, 2026 | Sunday Morning Worship | - | The Narrow Gate
 *     Without it the title would be read as the speaker's name.
 *
 * The pipe is deliberate: it never occurs in ordinary prose, unlike a hyphen,
 * and it is far easier to type than an em dash. Anything with no pipes falls
 * back to the LEGACY format ("August 23, 2026 Sunday Morning Worship"), which
 * is what the existing uploads use — those keep working untouched.
 */

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// "August 23, 2026 Sunday Morning Worship" — comma optional, spacing loose.
const TITLE_RE = /^\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s*(.*)$/;

/**
 * Sort the raw label into a filterable bucket.
 *
 * Deliberately checks evening BEFORE morning: "Sunday School and Evening
 * Worship" contains neither the word "morning" nor a simple pattern, and an
 * order that tested "sunday" first would file every Sunday service as morning.
 */
export function classifyService(service: string): ServiceType {
  const s = service.toLowerCase();
  if (s.includes('wednesday')) return 'wednesday';
  if (s.includes('sunday')) {
    if (s.includes('evening') || s.includes('night')) return 'sunday-evening';
    if (s.includes('morning')) return 'sunday-morning';
    return 'sunday-morning';
  }
  return 'other';
}

/**
 * Parse an upload title. Returns null when the title doesn't lead with a date,
 * so the importer can report those rather than silently inventing a date —
 * a wrong date is worse than a skipped entry.
 */
/** "August 23, 2026" -> "2026-08-23". Null if it isn't a real date. */
function parseDatePart(part: string): string | null {
  const m = /^\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s*$/.exec(part);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A dash in a slot means "deliberately left empty" — see the convention above. */
function optional(part: string | undefined): string | undefined {
  const v = part?.trim();
  if (!v || v === '-' || v === '—' || v === '–') return undefined;
  return v;
}

/**
 * Parse an upload title in either the pipe-separated convention or the legacy
 * "date then service" form.
 *
 * Returns null when the title doesn't lead with a date, so the importer can
 * report it rather than silently inventing one — a wrong date is worse than a
 * skipped entry, and in an automated import nobody is reading the output.
 */
export function parseServiceTitle(title: string): ParsedServiceTitle | null {
  if (title.includes('|')) {
    const parts = title.split('|').map((p) => p.trim());
    const date = parseDatePart(parts[0] ?? '');
    if (!date) return null;
    const service = optional(parts[1]) ?? 'Service';
    return {
      date,
      service,
      serviceType: classifyService(service),
      speaker: optional(parts[2]),
      title: optional(parts[3]),
    };
  }

  // Legacy: "August 23, 2026 Sunday Morning Worship"
  const m = TITLE_RE.exec(title);
  if (!m) return null;
  const date = parseDatePart(`${m[1]} ${m[2]}, ${m[3]}`);
  if (!date) return null;
  const service = m[4].trim() || 'Service';
  return { date, service, serviceType: classifyService(service) };
}

/** ISO-8601 duration ("PT1H23M45S") to seconds. YouTube returns this shape. */
export function isoDurationToSeconds(iso: string): number {
  const m = /^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(s) || 0);
}

/** A slug that is stable across re-imports: date + service type. */
export function serviceSlug(p: ParsedServiceTitle): string {
  return `${p.date}-${p.serviceType}`;
}
