/**
 * Sign-up sheets — the database half of what the bulletin carries. The rule
 * itself (what counts as open, the order, the wording) is pure and tested, in
 * bulletinSignups in lib/signups.ts.
 */
import { eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '../db';
import { bulletinSignups, closedReason, sheetSummary, type BulletinSignup } from './signups';
import { churchToday } from './services';

/**
 * The open sheets, linked from `origin` (the app's own, where /signup/ lives).
 * Never throws: a sign-up hiccup must not take the bulletin down, and an empty
 * list simply leaves the section out.
 */
export async function openSignupsForBulletin(db: Db, origin: string): Promise<BulletinSignup[]> {
  try {
    const sheets = await db.select({
      id: schema.signupSheets.id, token: schema.signupSheets.token,
      title: schema.signupSheets.title, intro: schema.signupSheets.intro,
      status: schema.signupSheets.status, closesOn: schema.signupSheets.closesOn,
      eventDate: schema.signupSheets.eventDate,
    }).from(schema.signupSheets).where(eq(schema.signupSheets.status, 'open'));
    if (!sheets.length) return [];

    const slots = await db.select({ sheetId: schema.signupSlots.sheetId, onDate: schema.signupSlots.onDate })
      .from(schema.signupSlots)
      .where(inArray(schema.signupSlots.sheetId, sheets.map((s) => s.id)));
    const dates = new Map<number, (string | null)[]>();
    for (const s of slots) dates.set(s.sheetId, [...(dates.get(s.sheetId) ?? []), s.onDate]);

    return bulletinSignups(sheets, dates, churchToday(), origin);
  } catch {
    return [];
  }
}

export interface SheetGlance { id: number; title: string; summary: string }

/**
 * What the Serving tab says about sign-ups: the sheets still collecting, with
 * how full each is, and how many drafts are waiting to be finished. The same
 * counting as the Sign-ups list, kept to the sheets that are not closed.
 * Never throws; null means "cannot say", and the card says only that.
 */
export async function signupGlance(db: Db): Promise<{ open: SheetGlance[]; drafts: number } | null> {
  try {
    const sheets = await db.select().from(schema.signupSheets)
      .where(inArray(schema.signupSheets.status, ['open', 'draft']));
    const ids = sheets.map((s) => s.id);
    const slots = ids.length
      ? await db.select({ sheetId: schema.signupSlots.sheetId, onDate: schema.signupSlots.onDate,
          capacity: schema.signupSlots.capacity })
          .from(schema.signupSlots).where(inArray(schema.signupSlots.sheetId, ids))
      : [];
    const taken = ids.length
      ? await db.select({ sheetId: schema.signups.sheetId })
          .from(schema.signups).where(inArray(schema.signups.sheetId, ids))
      : [];
    const today = churchToday();
    const open = sheets
      .filter((s) => s.status === 'open')
      .map((s) => ({ s, mine: slots.filter((x) => x.sheetId === s.id) }))
      .filter(({ s, mine }) => !closedReason(s, mine.map((x) => x.onDate), today))
      .sort((a, b) => b.s.id - a.s.id)
      .map(({ s, mine }) => ({
        id: s.id, title: s.title,
        summary: sheetSummary(s.kind, mine, taken.filter((x) => x.sheetId === s.id).length),
      }));
    return { open, drafts: sheets.filter((s) => s.status === 'draft').length };
  } catch {
    return null;
  }
}
