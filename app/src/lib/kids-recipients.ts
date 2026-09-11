import { and, eq, inArray, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import * as schema from '../db/schema.ts';
import type { Db } from '../db';
import type { SendScope } from './permissions.ts';

/**
 * WHO A CHILDREN'S TEXT ACTUALLY REACHES — and why this is a SECOND builder.
 *
 * lib/recipients.ts reads `people`. Bus-ministry guardians are deliberately not
 * people rows, because putting them there would add non-members to the
 * congregation's list, the messaging counts and the attendance statistics. The
 * price of that decision is exactly this file: consent logic in two places.
 *
 * The price is only worth paying because consent is NOT duplicated with it.
 * Opt-out is applied across BOTH tables in one place — lib/consent.ts, from the
 * SMS webhook — and this builder treats an opt-out recorded in EITHER table as
 * final. If you are about to merge these two builders "to remove the
 * duplication", what you would actually remove is the reason the congregation's
 * counts are honest. Read §7.2 of handoff/SETUP.md step 16 first.
 */

export interface KidsRecipient {
  /** The GUARDIAN. They receive it, not the child. */
  name: string;
  phoneE164: string;
  childFirstName: string;
  /**
   * The member behind this guardian, when there is one — message_log.person_id
   * is a foreign key into `people`, and most guardians have no row there at
   * all. Null is the normal case and the log tolerates it by design.
   */
  personId: number | null;
}

export interface KidsAudience {
  recipients: KidsRecipient[];
  /** One per HANDSET. A parent of three children has three guardian rows, and
   *  siblings share a phone — sending three times would look broken and cost
   *  three times as much. */
  handsets: { phoneE164: string; people: KidsRecipient[] }[];
  excluded: { noNumber: number; optedOut: number; noConsent: number };
}

const EMPTY: KidsAudience = {
  recipients: [], handsets: [], excluded: { noNumber: 0, optedOut: 0, noConsent: 0 },
};

/**
 * Build the audience for a scope.
 *
 * `scope` comes from kidsSendScope and is NEVER widened here. A route a captain
 * does not hold simply is not in it, and the filtering happens on these rows on
 * the server — not on anything a form said.
 */
export async function buildKidsAudience(db: Db, scope: SendScope | null): Promise<KidsAudience> {
  if (scope === null) return { ...EMPTY };
  // An empty scope is a captain with the flag and no routes. Nobody, not
  // everybody — see kidsSendScope.
  if (scope !== 'all' && scope.length === 0) return { ...EMPTY };

  const child = alias(schema.people, 'child');
  const member = alias(schema.people, 'member');

  const rows = await db.select({
    guardianName: schema.kidGuardians.name,
    guardianPhone: schema.kidGuardians.phoneE164,
    guardianConsent: schema.kidGuardians.smsConsent,
    memberId: schema.kidGuardians.memberPersonId,
    memberPhone: member.phoneE164,
    memberConsent: member.smsConsent,
    childFirstName: child.firstName,
  }).from(schema.kidGuardians)
    // The child, for their name and to skip archived ones.
    .innerJoin(child, eq(child.id, schema.kidGuardians.personId))
    // Their Fairhaven Kids profile, which carries the route the scope filters on.
    .innerJoin(schema.kidProfiles, eq(schema.kidProfiles.personId, schema.kidGuardians.personId))
    /*
     * LEFT join, and this is the line the first attempt got wrong. An inner
     * join here would silently drop every guardian who is NOT a member — which
     * is nearly all of them, and precisely the families this whole feature
     * exists to reach.
     */
    .leftJoin(member, eq(member.id, schema.kidGuardians.memberPersonId))
    .where(and(
      eq(child.archived, false),
      scope === 'all' ? undefined : inArray(schema.kidProfiles.routeId, scope),
    ));

  /*
   * Every number opted out ANYWHERE, gathered before deciding anything.
   *
   * A guardian who is also a member has two rows, and the two can disagree if
   * one was updated by staff and the other was not. Opting out is absolute, so
   * an opt-out in either place wins — rather than trusting whichever record
   * this builder happened to pick as authoritative.
   */
  const optedOutNumbers = new Set<string>();
  const [outPeople, outGuardians] = await Promise.all([
    db.select({ n: schema.people.phoneE164 }).from(schema.people)
      .where(eq(schema.people.smsConsent, 'opted_out')),
    db.select({ n: schema.kidGuardians.phoneE164 }).from(schema.kidGuardians)
      .where(eq(schema.kidGuardians.smsConsent, 'opted_out')),
  ]);
  for (const r of [...outPeople, ...outGuardians]) if (r.n) optedOutNumbers.add(r.n);

  const excluded = { noNumber: 0, optedOut: 0, noConsent: 0 };
  const recipients: KidsRecipient[] = [];

  for (const r of rows) {
    /*
     * A linked guardian's contact details come from their MEMBER record.
     *
     * That is the whole reason member_person_id is a link rather than a copy —
     * it keeps them in step with the directory instead of going stale. Decided
     * here, in one place, and written down, because a parent receiving every
     * bus text twice is the bug that gets the system switched off.
     */
    const linked = r.memberId !== null && r.memberPhone !== null;
    const phone = linked ? r.memberPhone : r.guardianPhone;
    const consent = linked ? r.memberConsent : r.guardianConsent;

    if (!phone) { excluded.noNumber++; continue; }
    // Checked before anything can override it.
    if (optedOutNumbers.has(phone) || consent === 'opted_out') { excluded.optedOut++; continue; }
    if (consent !== 'opted_in') { excluded.noConsent++; continue; }

    recipients.push({
      name: r.guardianName, phoneE164: phone, childFirstName: r.childFirstName,
      personId: linked ? r.memberId : null,
    });
  }

  const byPhone = new Map<string, KidsRecipient[]>();
  for (const r of recipients) byPhone.set(r.phoneE164, [...(byPhone.get(r.phoneE164) ?? []), r]);
  const handsets = [...byPhone.entries()].map(([phoneE164, people]) => ({ phoneE164, people }));

  return { recipients, handsets, excluded };
}
