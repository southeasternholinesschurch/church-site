/**
 * The month's birthdays and anniversaries, for the bulletin.
 *
 * Split pure-from-DB like lib/roster: everything below the fetch is a plain
 * function over rows, so the date handling — which is where this would go
 * wrong — is testable without a database.
 */

export interface CelebrantRow {
  firstName: string; lastName: string;
  birthday: string | null; anniversary: string | null;
  /** Children appear under birthdays only — see isCelebrant below. */
  adultChild?: string;
}

export interface Celebration { day: number; name: string }

export interface Celebrations { month: string; birthdays: Celebration[]; anniversaries: Celebration[] }

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

/**
 * Month and day out of a 'YYYY-MM-DD' string, by parsing rather than by Date().
 *
 * new Date('1980-01-01') is UTC midnight, which in Fairhaven is the evening
 * BEFORE — every date lands a day early, and a birthday list that is silently
 * off by one is worse than no list at all. The same reasoning as the directory
 * page; both parse the string directly.
 */
export function monthDay(iso: string | null | undefined): { month: number; day: number } | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) return null;
  const month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/** The month a bulletin belongs to, taken from its own service date. */
export function monthOf(serviceDate: string): number | null {
  return monthDay(serviceDate)?.month ?? null;
}

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? '';
}

/**
 * Everyone celebrating in the bulletin's month.
 *
 * A couple with the same anniversary appears as two entries, which is correct:
 * the directory holds people, not households, and inferring who is married to
 * whom from a shared date would be a guess. the pastor can word the heading however
 * he likes; the data stays honest.
 */
export function celebrationsFor(rows: CelebrantRow[], serviceDate: string): Celebrations | null {
  const month = monthOf(serviceDate);
  if (!month) return null;

  const pick = (key: 'birthday' | 'anniversary'): Celebration[] =>
    rows
      // An anniversary on a child's record is a data-entry slip, not a wedding.
      .filter((r) => key === 'birthday' || r.adultChild !== 'child')
      .map((r) => ({ md: monthDay(r[key]), r }))
      .filter((x): x is { md: { month: number; day: number }; r: CelebrantRow } =>
        x.md !== null && x.md.month === month)
      .map(({ md, r }) => ({ day: md.day, name: `${r.firstName} ${r.lastName}`.trim() }))
      // By day, then by name, so the same month always renders the same way and
      // two people sharing a date do not swap places between builds.
      .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));

  return { month: monthName(month), birthdays: pick('birthday'), anniversaries: pick('anniversary') };
}

/**
 * Who the bulletin's celebration list is drawn from.
 *
 * Two different rules, deliberately, and NOT the directory's rule:
 *
 *   adults   — must be listed in the directory. Coming off the directory takes
 *              them off the bulletin at the same moment, one switch.
 *   children — included, at the pastor's instruction (2026-09-01), even though they
 *              are never in the directory.
 *
 * The second is why this lives here rather than reusing listedAdults(). A
 * child must NEVER have includeInDirectory set true — that flag is guarded at
 * the write precisely because a child in the directory is the failure the
 * whole design exists to prevent. So the bulletin selects them by age instead,
 * and the directory is untouched.
 */
export function isCelebrant(p: {
  archived: boolean; adultChild: string; includeInDirectory: boolean;
}): boolean {
  if (p.archived) return false;
  if (p.adultChild === 'child') return true;
  return p.adultChild === 'adult' && p.includeInDirectory;
}
