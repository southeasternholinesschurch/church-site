/**
 * Fairhaven Bucks.
 *
 * Play money a child earns for turning up and for doing well, and spends at the
 * prize table. It has no cash value and no relationship to real currency.
 *
 * Pure, and importing only a TYPE from the db, so it can be unit-tested in
 * plain node — same reason as lib/consent.ts and lib/kids.ts.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import type { Db } from '../db';

/** What a child gets for being at a meeting, until the pastor changes it. */
export const DEFAULT_PER_VISIT = 5;

/** The app_settings key. One place, so the reader and the writer agree. */
export const KEY_PER_VISIT = 'kid_bucks_per_visit';

/**
 * The most a single entry may move a balance.
 *
 * Not a security boundary — every volunteer here is trusted — but a typed
 * amount is a typed amount, and "50" with a stuck key is 500. A cap turns a
 * slip into a refusal instead of a child with a balance nobody can explain.
 */
export const MAX_AMOUNT = 500;

/**
 * A balance is a SUM, never a stored column.
 *
 * Two teachers awarding at the same moment would lose one of the writes to a
 * mutable balance; a child disputing their total could not be answered; and a
 * mistake could not be undone except by inventing a number to overwrite with.
 */
export const balanceOf = (entries: { delta: number }[]): number =>
  entries.reduce((n, e) => n + e.delta, 0);

/**
 * An amount somebody typed.
 *
 * Always POSITIVE. Direction comes from which button was pressed, not from
 * whether a minus sign was typed — otherwise "-5" in the spend box is a
 * five-buck award, and nobody would notice for weeks.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > MAX_AMOUNT) return null;
  return n;
}

/**
 * The per-visit credit as stored.
 *
 * Degrades to the built-in default rather than to silence, exactly as the
 * invite template and the birthday settings do: reading is not the moment to
 * discover somebody saved something broken, and a credit of NaN would quietly
 * stop every child earning anything.
 *
 * Zero IS allowed and means "no automatic credit" — a legitimate setting if
 * the pastor decides attendance alone should not earn.
 */
export function parsePerVisit(stored: string | null | undefined): number {
  const s = String(stored ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) return DEFAULT_PER_VISIT;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= MAX_AMOUNT ? n : DEFAULT_PER_VISIT;
}

export const REASON_LABEL: Record<string, string> = {
  attendance: 'Came to Fairhaven Kids',
  award: 'Awarded',
  spend: 'Spent',
  correction: 'Correction',
};

/** How much a visit earns right now. */
export async function getPerVisit(db: Db): Promise<number> {
  try {
    const rows = await db.select().from(schema.appSettings)
      .where(eq(schema.appSettings.key, KEY_PER_VISIT)).limit(1);
    return parsePerVisit(rows[0]?.value);
  } catch {
    // A settings table that cannot be read must not stop a register being
    // taken. The built-in default is a working answer.
    return DEFAULT_PER_VISIT;
  }
}
