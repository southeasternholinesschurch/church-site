import { eq, and, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index';
import { matchPeople, type Matched, type RosterMatch } from './roster';

/** The half of the roster logic that needs the database. The pure half —
 *  parsing, dates, timing, and the matching rule itself — is in roster.ts and
 *  is tested directly; the schedule editor runs that same rule. */
export type { Matched, RosterMatch };

/** Who on the roster can be texted — the people read fresh, the rule pure. */
export async function matchNames(env: { DB: D1Database }, names: string[]): Promise<RosterMatch> {
  const db = getDb(env);
  const people = await db.select({
    id: schema.people.id, firstName: schema.people.firstName, lastName: schema.people.lastName,
    phoneE164: schema.people.phoneE164, smsConsent: schema.people.smsConsent,
  }).from(schema.people).where(eq(schema.people.archived, false));
  return matchPeople(names, people);
}


export async function alreadySent(env: { DB: D1Database }, key: string): Promise<boolean> {
  const db = getDb(env);
  const r = await db.select({ id: schema.scheduledMessages.id })
    .from(schema.scheduledMessages)
    .where(and(eq(schema.scheduledMessages.sourceKey, key),
               sql`status in ('sent','skipped')`)).limit(1);
  return Boolean(r[0]);
}
