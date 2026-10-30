/**
 * Service orders: the running order of one service, printed three to a sheet
 * and cut into slips for whoever is leading a part (the pastor, 2026-10-25).
 *
 * Pure: the rules and the templates. The database half is in the pages; the
 * printout is pages/service-orders/[id]/print.astro.
 *
 * An order is a name, a date, an optional line under the name, and a list of
 * parts. Each part is a title, who is leading it, and a note (a song list, a
 * scripture, "keep it short tonight"). Stored as JSON in one column: the parts
 * are only ever read and written whole, and never searched.
 */

export interface OrderItem {
  title: string;
  /** Who is leading or overseeing it. */
  who: string;
  /** Anything else for that part: songs, a scripture, an instruction. */
  notes: string;
}

export const LIMITS = { name: 80, line: 120, title: 80, who: 80, notes: 400, items: 40 } as const;

/**
 * The usual Sunday order, as the pastor gave it. "Altar Service or Benediction" is
 * one part because it is one or the other, decided on the night: printed this
 * way it is right whichever happens.
 */
export const TRADITIONAL: readonly string[] = [
  'Opening Prayer',
  'Congregational Singing',
  'Testimony Time',
  'Prayer Time',
  'Offering',
  'Announcements',
  'Special Song',
  'Message',
  'Altar Service or Benediction',
];

/** One tap to add, on the editor. A part can still be called anything. */
export const QUICK_PARTS: readonly string[] = [
  'Welcome', 'Opening Prayer', 'Congregational Singing', 'Special Song', 'Choruses',
  'Testimony Time', 'Prayer Time', 'Scripture Reading', 'Offering', 'Announcements',
  'Message', 'Altar Service', 'Benediction', 'Closing Prayer',
];

/** The names offered when starting one; any name can be typed instead. */
export const SERVICE_NAMES: readonly string[] = [
  'Sunday Morning Worship', 'Sunday Evening Service', 'Wednesday Night Service',
  'Afternoon Service', 'Special Service',
];

export type OrderKind = 'traditional' | 'custom';

const clip = (v: unknown, n: number) =>
  (typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n').trim().slice(0, n);

/**
 * The parts as submitted by the editor, in page order: three parallel lists,
 * because each row's inputs share a name and FormData keeps document order.
 * A row with no title is dropped, whatever else it has: a leader with no part
 * would print as a line with nothing to say what it is.
 */
export function itemsFromForm(titles: unknown[], whos: unknown[], notes: unknown[]): OrderItem[] {
  const out: OrderItem[] = [];
  for (let i = 0; i < titles.length && out.length < LIMITS.items; i++) {
    const title = clip(titles[i], LIMITS.title).replace(/\n/g, ' ');
    if (!title) continue;
    out.push({
      title,
      who: clip(whos[i], LIMITS.who).replace(/\n/g, ' '),
      notes: clip(notes[i], LIMITS.notes),
    });
  }
  return out;
}

/** Stored JSON back to parts. Anything malformed is dropped, never thrown: an order must always open. */
export function parseItems(json: string | null | undefined): OrderItem[] {
  let raw: unknown;
  try { raw = JSON.parse(json ?? '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const rows = raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  return itemsFromForm(rows.map((r) => r.title), rows.map((r) => r.who), rows.map((r) => r.notes));
}

/** Is this service an evening one? Decides which singer goes on Special Song. */
export const isEvening = (name: string) => /evening|night|p\.?m\.?\b/i.test(name);

/**
 * A traditional order for a date, with what the app already knows filled in:
 * who is singing (from the singing schedule) and who is preaching (from that
 * Sunday's bulletin). Both are only suggestions in an editable box.
 */
export function traditionalItems(known: { singers?: string | null; preacher?: string | null } = {}): OrderItem[] {
  return TRADITIONAL.map((title) => ({
    title,
    who: title === 'Special Song' ? (known.singers ?? '')
      : title === 'Message' ? (known.preacher ?? '')
      : '',
    notes: '',
  }));
}

/** "Rachel & Ben" from the schedule's slot: a note ("Revival") stands as it is. */
export function singersText(slot: { names: string[]; note: string | null } | undefined): string {
  if (!slot) return '';
  if (slot.note) return slot.note;
  const n = slot.names;
  return n.length <= 2 ? n.join(' & ') : `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
}

/** "Sunday, October 25, 2026". Dates are church-local days, so formatted as UTC noon. */
export function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
