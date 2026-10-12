/**
 * Sign-up sheets — the database half of what the bulletin carries. The rule
 * itself (what counts as open, the order, the wording) is pure and tested, in
 * bulletinSignups in lib/signups.ts.
 */
import { eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '../db';
import { bulletinSignups, type BulletinSignup } from './signups';
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
