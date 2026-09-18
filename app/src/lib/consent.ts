import { and, eq, inArray } from 'drizzle-orm';
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
 * There are THREE such tables and there will not be a fourth without this file
 * changing: `people` (the congregation), `kid_guardians` (bus-ministry parents,
 * who are deliberately not people — see §5.3 of the Fairhaven Kids brief and the
 * comment on kid_guardians in the schema), and `signups` (whoever typed a
 * number into a sign-up sheet to be reminded the day before their day).
 *
 * This file said TWO until the sign-up sheets were built, and that sentence was
 * the only thing standing between a working opt-out and a broken one. If a
 * fourth table is ever given a phone column, it is added here in the same
 * commit — not afterwards.
 *
 * That split is the whole reason this module exists. Keeping bus families out
 * of the congregation's people list keeps the member list, the audience counts
 * and the attendance statistics honest — but it means consent is recorded in
 * several places, and a consent record that is only half-applied is worse than
 * none. A parent who texts STOP and keeps receiving texts has been ignored,
 * and the reply sits in the log looking handled.
 *
 * THE RULE: match by NUMBER, never by person. One handset, one decision. A
 * shared phone opts out everyone reachable on it, because one person asked and
 * one phone receives.
 *
 * An opt-out also CANCELS WHAT IS ALREADY QUEUED for that number — see the note
 * in applyOptOut. Stopping the app from deciding to text somebody again is only
 * half of honouring a STOP if a message is already waiting in the queue.
 */

export interface ConsentTargets {
  /** How many `people` rows carry this number. */
  people: number;
  /** How many `kid_guardians` rows carry it. */
  guardians: number;
  /** How many sign-up sheet rows carry it. */
  signups: number;
}

/** Who this number reaches, before anything is changed. */
export async function findConsentTargets(
  db: Db, phoneE164: string,
): Promise<ConsentTargets> {
  if (!phoneE164) return { people: 0, guardians: 0, signups: 0 };
  const [p, g, s] = await Promise.all([
    db.select({ id: schema.people.id }).from(schema.people)
      .where(eq(schema.people.phoneE164, phoneE164)),
    db.select({ id: schema.kidGuardians.id }).from(schema.kidGuardians)
      .where(eq(schema.kidGuardians.phoneE164, phoneE164)),
    db.select({ id: schema.signups.id }).from(schema.signups)
      .where(eq(schema.signups.phoneE164, phoneE164)),
  ]);
  return { people: p.length, guardians: g.length, signups: s.length };
}

export type ConsentState = 'opted_in' | 'opted_out' | 'unknown';

/**
 * What every table says about these numbers. ONE definition of the rule.
 *
 * AN OPT-OUT ANYWHERE WINS. One handset, one decision — a number that appears
 * as a member, as a guardian and on a sign-up sheet has one answer, and if any
 * of the three says the person asked not to be texted, nothing else on it
 * matters.
 *
 * Batched rather than one call per recipient, because the caller that needs it
 * most is the reminder expansion, which runs every five minutes over a whole
 * meal train. Three queries, however many numbers.
 *
 * A number with no row anywhere comes back 'unknown' — absent from the map,
 * which `get` reports as undefined; callers must treat that as "not opted in",
 * never as permission. Only 'opted_in' is permission.
 */
export async function consentByNumbers(
  db: Db, numbers: string[],
): Promise<Map<string, ConsentState>> {
  const out = new Map<string, ConsentState>();
  const wanted = [...new Set(numbers.filter(Boolean))];
  if (!wanted.length) return out;

  const note = (phone: string | null, consent: string | null) => {
    if (!phone) return;
    const prior = out.get(phone);
    if (prior === 'opted_out') return;                   // nothing overrides it
    if (consent === 'opted_out') { out.set(phone, 'opted_out'); return; }
    if (consent === 'opted_in') { out.set(phone, 'opted_in'); return; }
    if (!prior) out.set(phone, 'unknown');
  };

  const [p, g, s] = await Promise.all([
    db.select({ phone: schema.people.phoneE164, consent: schema.people.smsConsent })
      .from(schema.people).where(inArray(schema.people.phoneE164, wanted)),
    db.select({ phone: schema.kidGuardians.phoneE164, consent: schema.kidGuardians.smsConsent })
      .from(schema.kidGuardians).where(inArray(schema.kidGuardians.phoneE164, wanted)),
    db.select({ phone: schema.signups.phoneE164, consent: schema.signups.smsConsent })
      .from(schema.signups).where(inArray(schema.signups.phoneE164, wanted)),
  ]);
  // `note` refuses to be overwritten once it has seen an opt-out, so the order
  // of these three cannot change the answer.
  for (const r of [...p, ...g, ...s]) note(r.phone, r.consent);
  return out;
}

/** One number. What the sign-up form asks before it offers a reminder. */
export async function numberConsent(db: Db, phoneE164: string): Promise<ConsentState> {
  if (!phoneE164) return 'unknown';
  return (await consentByNumbers(db, [phoneE164])).get(phoneE164) ?? 'unknown';
}

/**
 * Opt this NUMBER out, everywhere it appears.
 *
 * Unconditional on every table rather than conditional on a prior lookup: the
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
  /*
   * The sign-up sheets. `remind` is cleared as well as the consent recorded,
   * and that second field is the one that actually stops the text: the reminder
   * expansion reads `remind`, so leaving it set would mean a correctly recorded
   * opt-out and a text arriving anyway the next morning. There is no
   * `updated_at` on this table — a sign-up is a moment, not a record that is
   * kept in step.
   */
  await db.update(schema.signups)
    .set({ smsConsent: 'opted_out', smsConsentSource: source, smsConsentAt: at, remind: false })
    .where(eq(schema.signups.phoneE164, phoneE164));

  /*
   * AND ANYTHING ALREADY QUEUED FOR THIS NUMBER IS CANCELLED.
   *
   * The four updates above stop the app DECIDING to text this number again.
   * They do nothing about a message already sitting in the queue — a reminder
   * expanded at 9am and a STOP at 9:02 would leave a correctly recorded
   * opt-out and a text still waiting to go out on the next drain. Twilio
   * blocks delivery at the carrier level once somebody has replied STOP, so it
   * would probably not arrive; "probably not" is not the standard this file
   * holds itself to, and relying on a third party to enforce our own consent
   * record is exactly the shape of mistake the guardian bug was.
   *
   * Only ever turns a PENDING row into a skipped one. It cannot cause a send,
   * it cannot resurrect anything, and a `skipped` row with a reason is visible
   * in the dashboard rather than a message that silently vanished.
   */
  await db.update(schema.scheduledMessages)
    .set({ status: 'skipped', sentAt: at, note: 'Opted out before this was sent' })
    .where(and(eq(schema.scheduledMessages.phoneE164, phoneE164),
               eq(schema.scheduledMessages.status, 'pending')));
}

/**
 * Opt this NUMBER in, everywhere it appears. Symmetric with the above, with one
 * deliberate asymmetry: `remind` is NOT switched back on.
 *
 * Consent to be texted is not the same as having asked for a reminder about a
 * particular Tuesday. Somebody who texts START has told us they are willing to
 * hear from the church; they have not re-volunteered for a reminder they turned
 * off, possibly weeks ago, about a meal they may no longer be bringing. They
 * can tick the box again, and the office can set it for them.
 */
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
  await db.update(schema.signups)
    .set({ smsConsent: 'opted_in', smsConsentSource: source, smsConsentAt: at })
    .where(eq(schema.signups.phoneE164, phoneE164));
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
 * A SIGN-UP SHEET ROW IS NOT A REASON TO WITHHOLD ONE, and `signups` is
 * deliberately absent from the test below. A guardian is a standing record of a
 * human being, with a name, a relationship and children attached; a sign-up is
 * somebody who typed a name into a box once to bring a casserole on Tuesday.
 * Someone who then texts START is still a stranger to the church's records, and
 * the reasoning at the top of this comment applies to them in full: create
 * them, flagged, rather than drop an opt-in on the floor.
 *
 * Pure, and separated from the database work, because this is the decision
 * worth testing.
 */
export function shouldCreatePersonOnStart(t: ConsentTargets): boolean {
  return t.people === 0 && t.guardians === 0;
}
