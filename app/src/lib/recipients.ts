import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { estimateCost } from './sms';

/**
 * Who a send actually goes to, and why anyone was left out.
 *
 * The excluded counts are returned alongside the recipients on purpose. "Send
 * to everyone" reaching 70 of 118 people is the single most important fact
 * about this feature, and it should be visible on the compose screen rather
 * than discovered when somebody complains they never heard.
 */
export interface Recipient {
  personId: number;
  name: string;
  phoneE164: string;
}

export interface Audience {
  recipients: Recipient[];
  /** One per HANDSET. Two people sharing a mobile is one message, not two. */
  handsets: { phoneE164: string; people: Recipient[] }[];
  excluded: { noNumber: number; optedOut: number; noConsent: number };
}

/**
 * WHY THIS READS `people` AND NOT GUARDIANS — decided, do not unify.
 *
 * Bus-ministry parents live in `kid_guardians`, not `people`, because putting
 * them in `people` would add non-members to the congregation's people list,
 * these audience counts, and the attendance statistics. The cost is that this
 * builder cannot reach a single bus family, and the children's section will
 * need a SECOND builder of its own reading `kid_guardians`.
 *
 * That duplication is deliberate and was chosen over the alternative (making
 * guardians `people` rows with an exclusion flag), which would have meant
 * re-examining every query in the app that assumes `people` means "the
 * congregation".
 *
 * The duplication is only tolerable because consent is NOT duplicated with it:
 * both builders must honour the same opt-out, and opt-out is applied across
 * both tables in ONE place — lib/consent.ts, called from the SMS webhook. If
 * you are about to unify these two builders "to remove the duplication", the
 * thing you would actually be removing is the reason the counts are honest.
 * Read §7.2 of SETUP.md step 20 (the kids ministry) first.
 *
 * The other builder is lib/kids-recipients.ts. It carries the same warning.
 */
export async function buildAudience(
  env: { DB: D1Database }, groupId: number | null,
): Promise<Audience> {
  const db = getDb(env);

  const base = groupId
    ? db.select({
        id: schema.people.id, firstName: schema.people.firstName,
        lastName: schema.people.lastName, phoneE164: schema.people.phoneE164,
        smsConsent: schema.people.smsConsent,
      }).from(schema.people)
        .innerJoin(schema.peopleGroups, eq(schema.peopleGroups.personId, schema.people.id))
        .where(and(eq(schema.people.archived, false), eq(schema.peopleGroups.groupId, groupId)))
    : db.select({
        id: schema.people.id, firstName: schema.people.firstName,
        lastName: schema.people.lastName, phoneE164: schema.people.phoneE164,
        smsConsent: schema.people.smsConsent,
      }).from(schema.people).where(eq(schema.people.archived, false));

  const rows = await base;

  const excluded = { noNumber: 0, optedOut: 0, noConsent: 0 };
  const recipients: Recipient[] = [];

  for (const r of rows) {
    if (!r.phoneE164) { excluded.noNumber++; continue; }
    // Opted out is absolute and checked before anything else can override it.
    if (r.smsConsent === 'opted_out') { excluded.optedOut++; continue; }
    if (r.smsConsent !== 'opted_in') { excluded.noConsent++; continue; }
    recipients.push({ personId: r.id, name: `${r.firstName} ${r.lastName}`, phoneE164: r.phoneE164 });
  }

  // Collapse to handsets. Luke and Nora Kingsley share a mobile; sending twice
  // to one phone looks broken and costs twice as much.
  const byPhone = new Map<string, Recipient[]>();
  for (const r of recipients) byPhone.set(r.phoneE164, [...(byPhone.get(r.phoneE164) ?? []), r]);
  const handsets = [...byPhone.entries()].map(([phoneE164, people]) => ({ phoneE164, people }));

  return { recipients, handsets, excluded };
}

/** What a send will cost, given the message and the audience. */
export function estimateSend(segments: number, handsetCount: number) {
  return { messages: handsetCount, segments: segments * handsetCount,
           usd: estimateCost(segments * handsetCount) };
}

/** Messages sent this calendar month, for the running cost readout. */
export async function monthToDate(env: { DB: D1Database }) {
  const db = getDb(env);
  const start = new Date();
  const monthStart = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const rows = await db.select({
    messages: sql<number>`count(*)`,
    segments: sql<number>`coalesce(sum(segments), 0)`,
  }).from(schema.messageLog)
    .where(and(eq(schema.messageLog.direction, 'out'),
               sql`created_at >= ${monthStart}`, isNotNull(schema.messageLog.twilioSid)));
  const r = rows[0] ?? { messages: 0, segments: 0 };
  return { ...r, usd: estimateCost(r.segments) };
}
