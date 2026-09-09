import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
/* TYPE-only, so node never has to resolve the db module and this file stays
 * unit-testable in plain `node --experimental-strip-types`. Same reason
 * lib/bulletin.ts imports only types from there. The functions below take the
 * db handle the caller already has rather than building one from env. */
import type { Db } from '../db';

const nowIso = () => new Date().toISOString();

/**
 * Texting consent, across every table that holds a phone number.
 *
 * There are TWO such tables and there will not be a third without this file
 * changing: `people` (the congregation) and `kid_guardians` (bus-ministry
 * parents, who are deliberately not people — see §5.3 of the [Kids Ministry] brief and
 * the comment on kid_guardians in the schema).
 *
 * That split is the whole reason this module exists. Keeping bus families out
 * of the congregation's people list keeps the member list, the audience counts
 * and the attendance statistics honest — but it means consent is recorded in
 * two places, and a consent record that is only half-applied is worse than
 * none. A parent who texts STOP and keeps receiving texts has been ignored,
 * and the reply sits in the log looking handled.
 *
 * THE RULE: match by NUMBER, never by person. One handset, one decision. A
 * shared phone opts out everyone reachable on it, because one person asked and
 * one phone receives.
 */

export interface ConsentTargets {
  /** How many `people` rows carry this number. */
  people: number;
  /** How many `kid_guardians` rows carry it. */
  guardians: number;
}

/** Who this number reaches, before anything is changed. */
export async function findConsentTargets(
  db: Db, phoneE164: string,
): Promise<ConsentTargets> {
  if (!phoneE164) return { people: 0, guardians: 0 };
  const [p, g] = await Promise.all([
    db.select({ id: schema.people.id }).from(schema.people)
      .where(eq(schema.people.phoneE164, phoneE164)),
    db.select({ id: schema.kidGuardians.id }).from(schema.kidGuardians)
      .where(eq(schema.kidGuardians.phoneE164, phoneE164)),
  ]);
  return { people: p.length, guardians: g.length };
}

/**
 * Opt this NUMBER out, everywhere it appears.
 *
 * Unconditional on both tables rather than conditional on a prior lookup: the
 * cost of updating zero rows is nothing, and a branch here is a branch that can
 * be wrong. Opting out is the one operation that must never fail to happen.
 */
export async function applyOptOut(
  db: Db, phoneE164: string, source = 'sms-stop',
): Promise<void> {
  if (!phoneE164) return;
  const at = nowIso();
  await db.update(schema.people)
    .set({ smsConsent: 'opted_out', smsConsentSource: source, smsConsentAt: at, updatedAt: at })
    .where(eq(schema.people.phoneE164, phoneE164));
  await db.update(schema.kidGuardians)
    .set({ smsConsent: 'opted_out', smsConsentSource: source, smsConsentAt: at, updatedAt: at })
    .where(eq(schema.kidGuardians.phoneE164, phoneE164));
}

/** Opt this NUMBER in, everywhere it appears. Symmetric with the above. */
export async function applyOptIn(
  db: Db, phoneE164: string, source = 'sms-start',
): Promise<void> {
  if (!phoneE164) return;
  const at = nowIso();
  await db.update(schema.people)
    .set({ smsConsent: 'opted_in', smsConsentSource: source, smsConsentAt: at, updatedAt: at })
    .where(eq(schema.people.phoneE164, phoneE164));
  await db.update(schema.kidGuardians)
    .set({ smsConsent: 'opted_in', smsConsentSource: source, smsConsentAt: at, updatedAt: at })
    .where(eq(schema.kidGuardians.phoneE164, phoneE164));
}

/**
 * Whether a START from an unrecognised number should create a `people` row.
 *
 * The webhook has always created one, so that somebody who does the one thing
 * the sign asked is not silently dropped for want of a name. That is still
 * right — for a stranger.
 *
 * It is NOT right for a bus-ministry parent. They are already known, as a
 * guardian, and creating a person row for them would put them in the
 * congregation's people list, the messaging audience counts and the attendance
 * statistics — undoing, one text at a time, the entire reason guardians are
 * kept out of `people`. Their START is recorded against the guardian row,
 * which is where their consent belongs.
 *
 * Pure, and separated from the database work, because this is the decision
 * worth testing.
 */
export function shouldCreatePersonOnStart(t: ConsentTargets): boolean {
  return t.people === 0 && t.guardians === 0;
}
