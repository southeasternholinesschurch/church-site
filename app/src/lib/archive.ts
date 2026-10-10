import { inArray } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
/* TYPE-only, so node never has to resolve the db module and this file stays
 * unit-testable in plain `node --experimental-strip-types` — the same reason
 * lib/consent.ts and lib/bulletin.ts import only types from there. The
 * functions below take the db handle the caller already has. */
import type { Db } from '../db';

const nowIso = () => new Date().toISOString();

/**
 * Taking somebody off the lists, and putting them back.
 *
 * ARCHIVED, NEVER DELETED. Tables reference `people.id` with ON DELETE
 * CASCADE — attendance, group membership, directory invites and sessions. A
 * hard delete would take a term's attendance figures with it, silently, and
 * there would be nothing left to notice it by. (Fairhaven Kids children are not here:
 * they have their own list, `kids`, with its own archived flag.) Archiving takes somebody out of every list,
 * every register and every messaging audience while leaving the history intact
 * and the whole thing reversible. `schema.people.archived` carries the same
 * rule; this is the one place that acts on it.
 *
 * BOTH TAKE AN ARRAY so archiving one person and archiving a family are the
 * same code path. The batch flow on /people is the reason this file exists: a
 * bulk write is exactly the thing that should not have a second implementation
 * quietly disagreeing with the single one.
 *
 * Which is what had already happened. Before this file there were two writes —
 * the check-in screen's, which also cleared `includeInDirectory`, and the kids
 * page's, which did not. So an archived adult left the directory and an
 * archived child did not, and nobody had decided that; it was just two places
 * written months apart. Clearing it is the correct behaviour and now the only
 * behaviour.
 */
export async function archivePeople(db: Db, ids: number[]): Promise<void> {
  for (const part of chunks(ids)) {
    await db.update(schema.people)
      .set({ archived: true, includeInDirectory: false, updatedAt: nowIso() })
      .where(inArray(schema.people.id, part));
  }
}

/**
 * The undo.
 *
 * It deliberately does NOT restore `includeInDirectory`. Being in the printed
 * directory is a consent decision the person made, and this function has no way
 * to know whether it was true before they were archived. Guessing "yes" would
 * put somebody's address back in front of the congregation on the strength of a
 * mis-tap being corrected. Staff tick the box again on the person's own page,
 * where it says what it means.
 */
export async function restorePeople(db: Db, ids: number[]): Promise<void> {
  for (const part of chunks(ids)) {
    await db.update(schema.people)
      .set({ archived: false, updatedAt: nowIso() })
      .where(inArray(schema.people.id, part));
  }
}

/**
 * D1 refuses a statement with more than 100 bound values. "Select all shown"
 * can tick 500 people, and `id in (...)` binds one value per id, so a bulk write
 * that does not split itself fails outright on a big selection. 90 leaves room
 * for the few other values a statement binds. An empty list yields no chunks,
 * which is also the guard against issuing `in ()` at all.
 */
export const ID_CHUNK = 90;
export function chunks<T>(xs: T[], size: number = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Form values to a clean list of ids.
 *
 * This stands between a form post and a write that can touch a hundred rows at
 * once, so it is strict on purpose: only a plain positive integer survives.
 * Anything else — an empty string, a file, `'0'`, `'-4'`, `'1.5'`, a number
 * with SQL after it — is DROPPED rather than coerced, because every coercion
 * available here turns a nonsense value into a real person's id. `Number('')`
 * is 0 and `parseInt('1; DROP')` is 1; a parser that shrugs is how the wrong
 * family gets archived.
 *
 * Deduped, because a checkbox column and a hidden field can both carry the same
 * id through the confirm step, and order is kept so the confirmation lists
 * people in the order they were ticked.
 */
export function parsePersonIds(values: FormDataEntryValue[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    if (typeof value !== 'string') continue;       // a File is not an id
    if (!/^[0-9]+$/.test(value.trim())) continue;  // digits, and nothing else
    const id = Number(value.trim());
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
