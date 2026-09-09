/**
 * Service kinds, in the order they occur in a week.
 *
 * `services.kind` is plain TEXT with no CHECK constraint (see
 * 0000_initial_schema.sql), which is why adding the two Fairhaven Kids kinds needed no
 * migration — the same reason widening `staff.role` needed none.
 *
 * The `sekids` ones are SEPARATE SERVICES, not a flag on the existing Sunday
 * school. The church's Sunday school is all ages and the Wednesday service is
 * the adult one; `unique(date, kind)` means a children's register sharing
 * either kind would collide with the service the congregation is already in.
 */
export const SERVICE_KINDS = [
  { id: 'sunday-morning', label: 'Sunday Morning' },
  { id: 'sunday-school', label: 'Sunday School' },
  { id: 'sunday-evening', label: 'Sunday Evening' },
  { id: 'wednesday', label: 'Wednesday' },
  { id: 'other', label: 'Other' },
  { id: 'kids-sunday', label: 'Fairhaven Kids · Sunday', kids: true },
  { id: 'kids-wednesday', label: 'Fairhaven Kids Club · Wednesday', kids: true },
] as const;

export type ServiceKind = (typeof SERVICE_KINDS)[number]['id'];

/**
 * The congregation's own services — everything the ATTENDANCE screens should
 * show.
 *
 * Fairhaven Kids runs twice a week. Left in the general list, two extra services a
 * week would fill /attendance's 25-row "recent services" table within about
 * three months and push Sunday mornings off the bottom of the one screen the pastor
 * actually reads. They are taken on the Fairhaven Kids register instead, and counted
 * there.
 */
export const CHURCH_SERVICE_KINDS = SERVICE_KINDS.filter((k) => !('sekids' in k));
/* Left to infer rather than annotated `string[]`: drizzle's `kind` column is a
 * literal union, and widening these to plain strings makes notInArray reject
 * them. */
export const KIDS_KIND_IDS = SERVICE_KINDS.filter((k) => 'sekids' in k).map((k) => k.id);

export const kindLabel = (k: string) =>
  SERVICE_KINDS.find((s) => s.id === k)?.label ?? k;

/** Whether a service belongs to the children's ministry rather than the
 *  congregation's own calendar. */
export const isKidsKind = (k: string): boolean => (KIDS_KIND_IDS as readonly string[]).includes(k);

/**
 * Today in the CHURCH's timezone, not the server's. A Worker runs in UTC, so
 * after 7pm Indianapolis time `new Date()` is already tomorrow — which would
 * file a Wednesday evening service under Thursday. The public site shipped
 * exactly this bug once already.
 */
export const CHURCH_TZ = 'America/Indiana/Indianapolis';
export function churchToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: CHURCH_TZ });
}

/** The service a volunteer most likely wants, given the day of the week. */
export function likelyKind(dateIso: string): ServiceKind {
  const dow = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  if (dow === 0) return 'sunday-morning';
  if (dow === 3) return 'wednesday';
  return 'other';
}

/**
 * The Fairhaven Kids service a volunteer most likely wants, given the day.
 *
 * Sunday classes and the Wednesday club; any other day has no children's
 * meeting, so it returns null rather than guessing. Uses the same noon-UTC
 * trick as likelyKind — `new Date('2026-09-06')` is midnight UTC, which is the
 * evening BEFORE in Indianapolis, and would name the wrong day.
 */
export function likelyKidsKind(dateIso: string): 'kids-sunday' | 'kids-wednesday' | null {
  const dow = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  if (dow === 0) return 'kids-sunday';
  if (dow === 3) return 'kids-wednesday';
  return null;
}

/** The Wednesday club is one register for everybody — no breakout classes. */
export const kindHasClasses = (kind: string): boolean => kind !== 'kids-wednesday';

export function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}
