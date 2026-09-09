import { eq } from 'drizzle-orm';
import type { AstroCookies } from 'astro';
import { getDb, schema, nowIso } from '../db';

/**
 * The check-in kiosk's identity.
 *
 * DELIBERATELY NOT A SessionUser, and deliberately not a `staff` row with a
 * narrow role. SessionUser flows into every route in this app — every page
 * reads `locals.user` and assumes a trusted human — so a kiosk wearing one
 * would be a hallway tablet that needed every one of those checks to be right.
 * One missed check and a borrowed iPad opens the congregation's addresses.
 *
 * A distinct principal, in a distinct cookie, read by a distinct function, and
 * checked in its own middleware branch cannot inherit powers by accident. There
 * is no value of any field that turns a kiosk into staff, because they are not
 * the same shape.
 *
 * Same reasoning as memberSessions being its own table rather than a column on
 * `sessions`.
 */

const COOKIE = 'seh_kiosk';
/** A fixed tablet in a foyer should not need re-pairing every fortnight. */
const TTL_DAYS = 365;

/** Everything a kiosk is allowed to know about itself. Note what is absent:
 *  no person, no role, no email, nothing to widen. */
export interface KioskDevice { id: number; name: string }

/**
 * Who this tablet is, or null.
 *
 * Re-reads `active` from the database on EVERY request, exactly as readSession
 * does for staff. That is what makes "revoke it from your phone when the tablet
 * walks off" take effect on the next scan rather than in a year when the cookie
 * lapses. Do not cache this into a signed token.
 */
export async function readKioskDevice(
  env: { DB: D1Database }, cookies: AstroCookies,
): Promise<KioskDevice | null> {
  const token = cookies.get(COOKIE)?.value;
  if (!token) return null;

  const rows = await getDb(env).select({
    id: schema.kioskDevices.id,
    name: schema.kioskDevices.name,
    active: schema.kioskDevices.active,
  }).from(schema.kioskDevices)
    .where(eq(schema.kioskDevices.token, token)).limit(1);

  const d = rows[0];
  if (!d || !d.active) return null;
  return { id: d.id, name: d.name };
}

/** Pair this browser to a device, once, from a link the director opens on it. */
export function setKioskCookie(cookies: AstroCookies, token: string, secure: boolean): void {
  cookies.set(COOKIE, token, {
    httpOnly: true,      // never readable from page scripts
    sameSite: 'lax',
    secure,              // off only on http://localhost
    path: '/',
    maxAge: TTL_DAYS * 86400,
  });
}

export function clearKioskCookie(cookies: AstroCookies): void {
  cookies.delete(COOKIE, { path: '/' });
}

/** Written on a scan rather than on every request — it answers "is this tablet
 *  still being used?", which does not need second-by-second accuracy. */
export async function touchKiosk(env: { DB: D1Database }, id: number): Promise<void> {
  await getDb(env).update(schema.kioskDevices)
    .set({ lastSeenAt: nowIso() })
    .where(eq(schema.kioskDevices.id, id));
}
