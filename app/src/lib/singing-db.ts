/**
 * The singing schedule — the half that reads and writes.
 *
 * WHERE THE SCHEDULE LIVES. Until something is saved on /singing, the bulletin
 * and the Monday reminder go on reading the published Google Sheet exactly as
 * before. The first row saved here moves them both: an empty table means "still
 * on the sheet", a table with anything in it means "the schedule lives here".
 * One switch, and it cannot be half-thrown — the two are never merged, because
 * a Sunday that is in the app AND on the sheet would have two answers.
 */
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../db';
import {
  parseRosterDetailed, rosterFromRows, type MatchPerson, type RosterDay,
} from './roster';
import { DEFAULT_PRINT_NOTE, rowsFromSheet } from './singing';

type Env = { DB: D1Database; REMINDER_SHEET_CSV_URL?: string };

export type ScheduleSource = 'app' | 'sheet' | 'none';

/** Short: this sits on the path of a page somebody is waiting for. */
const SHEET_TIMEOUT_MS = 6000;

export async function scheduleSource(env: Env): Promise<ScheduleSource> {
  try {
    const [row] = await getDb(env).select({ n: sql<number>`count(*)` }).from(schema.singingSchedule);
    if (Number(row?.n ?? 0) > 0) return 'app';
  } catch {
    // The table not existing yet (a deploy ahead of its migration) is the
    // sheet still being the schedule, not an error to show anybody.
  }
  return env.REMINDER_SHEET_CSV_URL ? 'sheet' : 'none';
}

/**
 * The whole schedule, from wherever it lives, in the sheet's shape.
 *
 * NEVER THROWS, and never returns a partial answer — the same promise
 * singing-sheet.ts made for the sheet alone. null means "cannot say", and every
 * caller treats it as "print no singing section / send no reminder".
 */
export async function rosterDays(env: Env): Promise<RosterDay[] | null> {
  try {
    const source = await scheduleSource(env);
    if (source === 'app') {
      const rows = await getDb(env).select().from(schema.singingSchedule)
        .orderBy(asc(schema.singingSchedule.sunday));
      return rosterFromRows(rows);
    }
    if (source === 'sheet') {
      const csv = await fetchSheet(env.REMINDER_SHEET_CSV_URL!);
      return csv === null ? null : parseRosterDetailed(csv);
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchSheet(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      // Edits to the sheet must show up. A cached copy would make this quietly
      // wrong rather than visibly broken.
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(SHEET_TIMEOUT_MS),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** The rows for one stretch of Sundays, as typed. */
export async function scheduleRows(env: Env, from: string, to: string) {
  return getDb(env).select().from(schema.singingSchedule)
    .where(and(gte(schema.singingSchedule.sunday, from), lte(schema.singingSchedule.sunday, to)))
    .orderBy(asc(schema.singingSchedule.sunday));
}

export async function allScheduleRows(env: Env) {
  return getDb(env).select().from(schema.singingSchedule).orderBy(asc(schema.singingSchedule.sunday));
}

/**
 * Save a stretch of Sundays as typed.
 *
 * A Sunday with both cells empty is deleted rather than kept as an empty row —
 * an empty row would still count as "the schedule lives here", and clearing the
 * last Sunday by mistake should not be what decides that.
 */
export async function saveSchedule(
  env: Env, rows: { sunday: string; morning: string; evening: string }[], by: string,
): Promise<number> {
  const db = getDb(env);
  let changed = 0;
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.sunday)) continue;
    const morning = r.morning.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
    const evening = r.evening.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
    if (!morning && !evening) {
      const gone = await db.delete(schema.singingSchedule)
        .where(eq(schema.singingSchedule.sunday, r.sunday)).returning({ s: schema.singingSchedule.sunday });
      changed += gone.length;
      continue;
    }
    const [before] = await db.select().from(schema.singingSchedule)
      .where(eq(schema.singingSchedule.sunday, r.sunday)).limit(1);
    if (before && before.morning === morning && before.evening === evening) continue;
    await db.insert(schema.singingSchedule)
      .values({ sunday: r.sunday, morning, evening, updatedAt: nowIso(), updatedBy: by })
      .onConflictDoUpdate({ target: schema.singingSchedule.sunday,
                            set: { morning, evening, updatedAt: nowIso(), updatedBy: by } });
    changed++;
  }
  return changed;
}

/**
 * Copy the Google Sheet in, once, so nothing has to be retyped.
 *
 * FILLS BLANKS ONLY — the rule every import in this app follows. A Sunday
 * already saved here is left exactly as it is, so pressing this twice, or after
 * editing a week here, cannot undo anybody's work. Each cell is copied as the
 * sheet had it: names joined back up, a note kept as the note.
 */
export async function importFromSheet(env: Env, by: string):
  Promise<{ added: number; skipped: number } | { error: string }> {
  if (!env.REMINDER_SHEET_CSV_URL) return { error: 'No Google Sheet is connected, so there is nothing to copy in.' };
  const csv = await fetchSheet(env.REMINDER_SHEET_CSV_URL);
  if (csv === null) return { error: 'The Google Sheet could not be read just now. Try again in a minute.' };
  const db = getDb(env);
  let added = 0, skipped = 0;
  for (const r of rowsFromSheet(csv)) {
    const ins = await db.insert(schema.singingSchedule)
      .values({ ...r, updatedAt: nowIso(), updatedBy: `${by} (from the sheet)` })
      .onConflictDoNothing().returning({ s: schema.singingSchedule.sunday });
    if (ins[0]) added++; else skipped++;
  }
  return { added, skipped };
}

/** Everyone a name could be matched to — the same people the reminder reads. */
export async function matchablePeople(env: Env): Promise<(MatchPerson & { archived?: boolean })[]> {
  return getDb(env).select({
    id: schema.people.id, firstName: schema.people.firstName, lastName: schema.people.lastName,
    phoneE164: schema.people.phoneE164, smsConsent: schema.people.smsConsent,
  }).from(schema.people).where(eq(schema.people.archived, false))
    .orderBy(asc(schema.people.lastName), asc(schema.people.firstName));
}

/* --------------------------------------------------------- the print note -- */

const NOTE_KEY = 'singing_print_note';

export async function getPrintNote(env: Env): Promise<string> {
  try {
    const [row] = await getDb(env).select().from(schema.appSettings)
      .where(eq(schema.appSettings.key, NOTE_KEY)).limit(1);
    // An empty saved value is a deliberate "print nothing", not a missing one.
    return row ? row.value : DEFAULT_PRINT_NOTE;
  } catch {
    return DEFAULT_PRINT_NOTE;
  }
}

export async function setPrintNote(env: Env, note: string, by: string): Promise<void> {
  const value = note.replace(/\s+/g, ' ').trim().slice(0, 400);
  await getDb(env).insert(schema.appSettings)
    .values({ key: NOTE_KEY, value, updatedAt: nowIso(), updatedBy: by })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: nowIso(), updatedBy: by } });
}
