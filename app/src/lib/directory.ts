import { and, asc, eq, gt } from 'drizzle-orm';
import type { AstroCookies } from 'astro';
import { getDb, schema, nowIso } from '../db/index';
import { INVITE_LINK_TOKEN, DEFAULT_INVITE_MESSAGE, invalidTemplateReason, renderInvite }
  from './invite-template';

// Re-exported so call sites can keep importing everything invite-related from
// one place, while the testable half lives in its own module.
export { INVITE_LINK_TOKEN, DEFAULT_INVITE_MESSAGE, invalidTemplateReason, renderInvite };
import { randomToken } from './auth';

/**
 * THE MEMBER DIRECTORY — the only part of this project that shows real contact
 * details to people who are not staff.
 *
 * Everything about who appears lives in ONE function below. Not a filter
 * copied into each page, not a condition in a template: a second copy of this
 * rule is how a child ends up listed, because the copies drift and only one of
 * them gets fixed.
 */

/** Days a member stays signed in before needing a fresh invite. */
const MEMBER_SESSION_DAYS = 90;
/**
 * How long an invite link stays valid.
 *
 * The link is REUSABLE, not single-use: the same text gets tapped again weeks
 * later, from a new phone or after clearing a browser, and a dead link means a
 * phone call to the office. So the window carries the whole burden — 30 days,
 * after which it stops working and a fresh one has to be sent.
 *
 * The tradeoff, stated plainly: within that window the link is a bearer token.
 * Anyone it is forwarded to can open the directory. What keeps that bounded is
 * that eligibility is re-checked on EVERY redemption below — archive, revoke or
 * un-list somebody and their link dies immediately, used or not.
 */
const INVITE_DAYS = 30;
const COOKIE = 'seh_member';

export interface DirectoryPerson {
  id: number; firstName: string; lastName: string;
  phone: string | null; email: string | null;
  addressStreet: string | null; addressCity: string | null;
  addressState: string | null; addressZip: string | null;
  photoKey: string | null;
  birthday: string | null;
  anniversary: string | null;
}

/**
 * Who is in the directory. THE one definition.
 *
 * Three conditions, each of which alone would be enough to cause the harm this
 * page is designed to avoid:
 *   archived = false        — someone removed from the church is not listed
 *   adultChild = 'adult'    — NOT "!== child". Unknown is not adult, and
 *                             someone whose status nobody has confirmed must
 *                             never be published on the assumption they are
 *                             grown up.
 *   includeInDirectory      — consent, gathered in person and set by staff
 */
export async function listedAdults(env: { DB: D1Database }): Promise<DirectoryPerson[]> {
  const db = getDb(env);
  return db.select({
    id: schema.people.id,
    firstName: schema.people.firstName, lastName: schema.people.lastName,
    phone: schema.people.phone, email: schema.people.email,
    addressStreet: schema.people.addressStreet, addressCity: schema.people.addressCity,
    addressState: schema.people.addressState, addressZip: schema.people.addressZip,
    photoKey: schema.people.photoKey,
    birthday: schema.people.birthday,
    anniversary: schema.people.anniversary,
  }).from(schema.people)
    .where(and(
      eq(schema.people.archived, false),
      eq(schema.people.adultChild, 'adult'),
      eq(schema.people.includeInDirectory, true),
    ))
    .orderBy(asc(schema.people.lastName), asc(schema.people.firstName));
}

/* ------------------------------------------------------------- invites -- */

export async function createInvite(
  env: { DB: D1Database }, personId: number, by: string,
): Promise<string> {
  const db = getDb(env);

  // Re-sending REUSES the person's existing link rather than replacing it.
  //
  // This used to delete every earlier invite, which quietly broke the thing
  // reusable links are for: someone gets a second text, and the first one --
  // still sitting in their messages, still the one they actually tap -- has
  // been dead since the moment staff pressed the button again.
  //
  // Nothing is lost by keeping it. Revocation never depended on this delete:
  // revokeAccess drops the invites, drops their sessions AND marks the person
  // revoked, and redeemInvite re-checks that status on every single open. So
  // the only effect of replacing the token was breaking older texts.
  const [live] = await db.select({
    id: schema.directoryInvites.id, token: schema.directoryInvites.token,
  }).from(schema.directoryInvites)
    .where(and(eq(schema.directoryInvites.personId, personId),
               gt(schema.directoryInvites.expiresAt, Date.now())))
    .limit(1);

  if (live) {
    // Push the window out, so re-sending is also how staff extend a link that
    // is about to run out.
    await db.update(schema.directoryInvites)
      .set({ expiresAt: Date.now() + INVITE_DAYS * 86400_000 })
      .where(eq(schema.directoryInvites.id, live.id));
    await db.update(schema.people)
      .set({ directoryStatus: 'invited', updatedAt: nowIso() })
      .where(eq(schema.people.id, personId));
    return live.token;
  }

  // Clear out anything expired for this person before minting a replacement,
  // so the table does not accumulate dead rows.
  await db.delete(schema.directoryInvites)
    .where(eq(schema.directoryInvites.personId, personId));

  // 16 bytes = 128 bits, unguessable. Deliberately not 32: the token goes in a
  // text message, and the longer one pushed the invite over 160 characters
  // into a second segment — double the cost of every invite for entropy
  // nobody needs.
  const token = randomToken(16);
  await db.insert(schema.directoryInvites).values({
    personId, token,
    expiresAt: Date.now() + INVITE_DAYS * 86400_000,
    createdBy: by, createdAt: nowIso(),
  });
  await db.update(schema.people)
    .set({ directoryStatus: 'invited', updatedAt: nowIso() })
    .where(eq(schema.people.id, personId));
  return token;
}

export interface RedeemResult { ok: boolean; personId?: number; reason?: string }

/**
 * Spend an invite. Every failure returns the SAME wording to the visitor —
 * expired, already used, revoked and never-existed are indistinguishable from
 * outside, so a stranger cannot probe which tokens were ever real.
 */
export async function redeemInvite(env: { DB: D1Database }, token: string): Promise<RedeemResult> {
  const db = getDb(env);
  const rows = await db.select({
    id: schema.directoryInvites.id, personId: schema.directoryInvites.personId,
    expiresAt: schema.directoryInvites.expiresAt, usedAt: schema.directoryInvites.usedAt,
    adultChild: schema.people.adultChild, archived: schema.people.archived,
    included: schema.people.includeInDirectory, status: schema.people.directoryStatus,
  }).from(schema.directoryInvites)
    .innerJoin(schema.people, eq(schema.directoryInvites.personId, schema.people.id))
    .where(eq(schema.directoryInvites.token, token)).limit(1);

  const inv = rows[0];
  const no: RedeemResult = { ok: false, reason: 'This link is no longer valid.' };
  if (!inv) return no;
  // No used-once check on purpose — see INVITE_DAYS. usedAt is still recorded,
  // but as "first opened", which is what staff want to see, not a fuse.
  if (inv.expiresAt < Date.now()) return no;
  // Re-checked at redemption, not just at invite time: someone can be archived,
  // revoked or reclassified between the text being sent and the link being tapped.
  if (inv.archived || inv.adultChild !== 'adult' || !inv.included) return no;
  if (inv.status === 'revoked') return no;

  if (!inv.usedAt) {
    await db.update(schema.directoryInvites)
      .set({ usedAt: nowIso() }).where(eq(schema.directoryInvites.id, inv.id));
  }
  await db.update(schema.people)
    .set({ directoryStatus: 'active', updatedAt: nowIso() })
    .where(eq(schema.people.id, inv.personId));
  return { ok: true, personId: inv.personId };
}

/* ------------------------------------------------------ member sessions -- */

export async function createMemberSession(
  env: { DB: D1Database }, cookies: AstroCookies, personId: number, secure: boolean,
) {
  const db = getDb(env);
  const id = randomToken(32);
  await db.insert(schema.memberSessions).values({
    id, personId,
    expiresAt: Date.now() + MEMBER_SESSION_DAYS * 86400_000,
    createdAt: nowIso(),
  });
  cookies.set(COOKIE, id, {
    httpOnly: true, sameSite: 'lax', secure, path: '/',
    maxAge: MEMBER_SESSION_DAYS * 86400,
  });
}

export interface MemberUser { personId: number; firstName: string; lastName: string }

/**
 * Read a member session, re-checking eligibility EVERY time.
 *
 * The check at invite time is not enough. Somebody revoked, archived, or
 * reclassified as a child on Monday must lose access on Monday — not in ninety
 * days when their session happens to expire.
 */
export async function readMemberSession(
  env: { DB: D1Database }, cookies: AstroCookies,
): Promise<MemberUser | null> {
  const token = cookies.get(COOKIE)?.value;
  if (!token) return null;

  const db = getDb(env);
  const rows = await db.select({
    personId: schema.people.id,
    firstName: schema.people.firstName, lastName: schema.people.lastName,
    archived: schema.people.archived, adultChild: schema.people.adultChild,
    included: schema.people.includeInDirectory, status: schema.people.directoryStatus,
  }).from(schema.memberSessions)
    .innerJoin(schema.people, eq(schema.memberSessions.personId, schema.people.id))
    .where(and(eq(schema.memberSessions.id, token),
               gt(schema.memberSessions.expiresAt, Date.now()))).limit(1);

  const r = rows[0];
  if (!r) return null;
  if (r.archived || r.adultChild !== 'adult' || !r.included || r.status === 'revoked') {
    await destroyMemberSession(env, cookies);
    return null;
  }
  return { personId: r.personId, firstName: r.firstName, lastName: r.lastName };
}

export async function destroyMemberSession(env: { DB: D1Database }, cookies: AstroCookies) {
  const token = cookies.get(COOKIE)?.value;
  if (token) {
    const db = getDb(env);
    await db.delete(schema.memberSessions).where(eq(schema.memberSessions.id, token));
  }
  cookies.delete(COOKIE, { path: '/' });
}

/** Revoking must end existing sessions, not merely prevent new ones. */
export async function revokeAccess(env: { DB: D1Database }, personId: number) {
  const db = getDb(env);
  await db.delete(schema.memberSessions).where(eq(schema.memberSessions.personId, personId));
  await db.delete(schema.directoryInvites).where(eq(schema.directoryInvites.personId, personId));
  await db.update(schema.people)
    .set({ directoryStatus: 'revoked', updatedAt: nowIso() })
    .where(eq(schema.people.id, personId));
}


/**
 * The invite text, which staff can reword — see /invites.
 *
 * `{link}` is where the person's private link goes. Everything about this is
 * built around that one placeholder being present: a reworded message that
 * loses it is not a slightly worse message, it is a text that tells somebody
 * about a directory and gives them no way in. So it is validated on save AND
 * defended on read.
 */
const INVITE_KEY = 'invite_message';



/**
 * The wording currently in force.
 *
 * Falls back to the default whenever the stored value is missing OR unusable.
 * Reading is not the moment to discover that somebody saved something broken —
 * by then a text is about to go out. A bad row degrades to the built-in
 * message rather than to no link at all.
 */
export async function getInviteTemplate(env: { DB: D1Database }): Promise<string> {
  try {
    const [row] = await getDb(env).select({ value: schema.appSettings.value })
      .from(schema.appSettings).where(eq(schema.appSettings.key, INVITE_KEY)).limit(1);
    if (row?.value && !invalidTemplateReason(row.value)) return row.value;
  } catch { /* fall through to the default */ }
  return DEFAULT_INVITE_MESSAGE;
}

/** Saves new wording. Refuses anything invalidTemplateReason objects to. */
export async function setInviteTemplate(
  env: { DB: D1Database }, template: string, by: string,
): Promise<string | null> {
  const reason = invalidTemplateReason(template);
  if (reason) return reason;
  const value = template.trim();
  await getDb(env).insert(schema.appSettings)
    .values({ key: INVITE_KEY, value, updatedAt: nowIso(), updatedBy: by })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: nowIso(), updatedBy: by },
    });
  return null;
}

/** Kept so the older call sites read the same; uses the default wording. */
export function inviteMessage(origin: string, token: string): string {
  return renderInvite(DEFAULT_INVITE_MESSAGE, origin, token);
}
