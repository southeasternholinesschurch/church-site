import { eq, lt } from 'drizzle-orm';
import type { AstroCookies } from 'astro';
import { getDb, schema, nowIso } from '../db';
import { randomToken } from './auth';

/**
 * Sessions are a random opaque token in the database. The cookie carries the
 * token and nothing else — no email, no role, no signed payload. Two reasons:
 * a token that means nothing on its own leaks nothing if it is captured from a
 * log, and revoking access is a DELETE that takes effect on the next request
 * rather than waiting for a signed token to expire.
 */

const COOKIE = 'seh_session';
const TTL_DAYS = 14;

import type { Role } from './permissions';

export interface SessionUser {
  id: number; email: string; name: string | null; role: Role;
  /**
   * May send [Kids Ministry] texts. A capability rather than a role (§7.1), and read
   * here so it gets the same free property `role` and `active` already have:
   * re-read from the database on every request, so taking somebody's send
   * rights away lands on their next click rather than in a fortnight.
   */
  kidsCanText: boolean;
}

export async function createSession(
  env: { DB: D1Database }, cookies: AstroCookies, staffId: number, secure: boolean,
): Promise<void> {
  const db = getDb(env);
  const id = randomToken(32);
  const expiresAt = Date.now() + TTL_DAYS * 86400_000;

  await db.insert(schema.sessions).values({ id, staffId, expiresAt, createdAt: nowIso() });

  cookies.set(COOKIE, id, {
    httpOnly: true,       // never readable from page scripts
    sameSite: 'lax',      // survives the return trip from Google, blocks cross-site POSTs
    secure,               // off only on http://localhost, where there is no TLS to require
    path: '/',
    maxAge: TTL_DAYS * 86400,
  });
}

export async function readSession(
  env: { DB: D1Database }, cookies: AstroCookies,
): Promise<SessionUser | null> {
  const token = cookies.get(COOKIE)?.value;
  if (!token) return null;

  const db = getDb(env);
  const rows = await db.select({
    expiresAt: schema.sessions.expiresAt,
    id: schema.staff.id, email: schema.staff.email,
    name: schema.staff.name, role: schema.staff.role, active: schema.staff.active,
    kidsCanText: schema.staff.kidsCanText,
  })
    .from(schema.sessions)
    .innerJoin(schema.staff, eq(schema.sessions.staffId, schema.staff.id))
    .where(eq(schema.sessions.id, token)).limit(1);

  const r = rows[0];
  if (!r) return null;
  if (r.expiresAt < Date.now()) { await destroySession(env, cookies); return null; }
  // Re-checked on EVERY request, not just at login: deactivating someone has to
  // lock them out now, not in a fortnight when their session lapses.
  if (!r.active) { await destroySession(env, cookies); return null; }

  return { id: r.id, email: r.email, name: r.name, role: r.role, kidsCanText: r.kidsCanText };
}

export async function destroySession(env: { DB: D1Database }, cookies: AstroCookies): Promise<void> {
  const token = cookies.get(COOKIE)?.value;
  if (token) {
    const db = getDb(env);
    await db.delete(schema.sessions).where(eq(schema.sessions.id, token));
  }
  cookies.delete(COOKIE, { path: '/' });
}

/** Housekeeping so the table does not grow forever. Cheap; runs on login. */
export async function purgeExpired(env: { DB: D1Database }): Promise<void> {
  const db = getDb(env);
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, Date.now()));
}
