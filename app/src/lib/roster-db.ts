import { eq, and, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index';
import { looksLikeNote } from './roster';

/** The half of the roster logic that needs the database. The pure half —
 *  parsing, dates, timing — is in roster.ts and is tested directly. */


export interface Matched { name: string; personId: number; phoneE164: string }
export interface RosterMatch {
  matched: Matched[];
  /** Entries that were never people — "Revival", "No service". Nobody is
   *  texted and nothing is reported as broken; the note is surfaced so the
   *  week reads as deliberate rather than as an empty failure. */
  notes: string[];
  /** Named on the roster but not confidently identified, or with no number /
   *  no consent. These are REPORTED, never quietly dropped — a silent miss
   *  means somebody turns up on Sunday not knowing they were meant to sing. */
  unmatched: { name: string; reason: string }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

export async function matchNames(env: { DB: D1Database }, names: string[]): Promise<RosterMatch> {
  const db = getDb(env);
  const people = await db.select({
    id: schema.people.id, firstName: schema.people.firstName, lastName: schema.people.lastName,
    phoneE164: schema.people.phoneE164, smsConsent: schema.people.smsConsent,
  }).from(schema.people).where(eq(schema.people.archived, false));

  const byFull = new Map<string, typeof people>();
  for (const p of people) {
    const key = norm(`${p.firstName} ${p.lastName}`);
    byFull.set(key, [...(byFull.get(key) ?? []), p]);
  }

  const matched: Matched[] = [];
  const unmatched: { name: string; reason: string }[] = [];
  const notes: string[] = [];

  for (const raw of names) {
    // "Aldridge, Ada" and "Ada Aldridge" are the same person written two ways.
    const flipped = raw.includes(',')
      ? raw.split(',').map((s) => s.trim()).reverse().join(' ') : raw;
    const hits = byFull.get(norm(flipped)) ?? [];

    if (hits.length === 0) {
      // Checked only now, after failing to find a person — so a member whose
      // name happens to contain one of these words is still found first.
      if (looksLikeNote(raw)) { notes.push(raw); continue; }
      unmatched.push({ name: raw, reason: 'no one by that name' });
      continue;
    }
    // Two people with identical names is not something to resolve by guessing.
    if (hits.length > 1) { unmatched.push({ name: raw, reason: 'more than one person has that name' }); continue; }

    const p = hits[0]!;
    if (!p.phoneE164) { unmatched.push({ name: raw, reason: 'no phone number on file' }); continue; }
    if (p.smsConsent === 'opted_out') { unmatched.push({ name: raw, reason: 'has opted out of texts' }); continue; }
    if (p.smsConsent !== 'opted_in') { unmatched.push({ name: raw, reason: 'not opted in to texts' }); continue; }

    matched.push({ name: raw, personId: p.id, phoneE164: p.phoneE164 });
  }
  return { matched, unmatched, notes };
}


export async function alreadySent(env: { DB: D1Database }, key: string): Promise<boolean> {
  const db = getDb(env);
  const r = await db.select({ id: schema.scheduledMessages.id })
    .from(schema.scheduledMessages)
    .where(and(eq(schema.scheduledMessages.sourceKey, key),
               sql`status in ('sent','skipped')`)).limit(1);
  return Boolean(r[0]);
}
