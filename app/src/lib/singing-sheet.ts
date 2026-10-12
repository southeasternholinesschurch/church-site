/**
 * Reading the singing schedule for the bulletin.
 *
 * From wherever the schedule lives — the app's own table once anything has
 * been saved on /singing, the published Google Sheet until then. singing-db.ts
 * decides which; this only asks it.
 *
 * NEVER THROWS, and never returns a partial answer. A schedule that cannot be
 * read — a sheet that is slow, moved or unshared — yields null, and the
 * bulletin simply prints no singing section. The bulletin is handed out on
 * paper on a Sunday morning; it must not depend on anything being reachable at
 * the moment somebody hits print.
 */
import { singersFor, type SingingForBulletin } from './roster';
import { rosterDays } from './singing-db';

export async function singingForBulletin(
  env: { DB: D1Database; REMINDER_SHEET_CSV_URL?: string }, serviceDate: string,
): Promise<SingingForBulletin | null> {
  const days = await rosterDays(env);
  return days ? singersFor(days, serviceDate) : null;
}
