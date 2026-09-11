import { eq } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../db';

/**
 * Google sign-in for staff.
 *
 * WHY GOOGLE AND NOT EMAILED LINKS: the domain now publishes SPF `-all` and
 * DMARC `p=reject` (nothing may send as yourchurch.org), so a login
 * link would need that reopened. Google needs no mail at all.
 *
 * THE CRITICAL DISTINCTION: Google will happily authenticate anyone on earth.
 * A successful sign-in proves who someone IS, not that they are allowed in.
 * Authorisation is the `staff` allowlist, checked on every callback and again
 * on every request through the session. Nobody self-registers.
 */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export interface AuthEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export const authConfigured = (env: AuthEnv) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export function redirectUri(url: URL) {
  return `${url.origin}/auth/callback`;
}

/** Opaque, unguessable, and used once — for the OAuth `state` and for session ids. */
export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function authorizeUrl(env: AuthEnv, url: URL, state: string): string {
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
  u.searchParams.set('redirect_uri', redirectUri(url));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', state);
  // Force the account chooser: shared church machines are normal, and silently
  // reusing whoever signed in last is exactly wrong for a members database.
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

interface IdClaims { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean | string; name?: string }

/**
 * The id_token arrives over a direct TLS connection to Google, in response to
 * a request carrying our client secret — so the transport authenticates it and
 * a JWKS signature check adds nothing here. The CLAIMS still get validated:
 * an unchecked `aud` would accept a token minted for a different application.
 */
function decodeIdToken(idToken: string): IdClaims | null {
  const part = idToken.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as IdClaims;
  } catch { return null; }
}

export interface ExchangeResult {
  ok: boolean;
  email?: string;
  name?: string;
  reason?: string;
}

export async function exchangeCode(env: AuthEnv, url: URL, code: string): Promise<ExchangeResult> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(url),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return { ok: false, reason: `google returned ${res.status}` };

  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) return { ok: false, reason: 'no id_token in response' };

  const c = decodeIdToken(data.id_token);
  if (!c) return { ok: false, reason: 'id_token could not be read' };

  if (c.aud !== env.GOOGLE_CLIENT_ID) return { ok: false, reason: 'token was issued for another application' };
  if (c.iss !== 'accounts.google.com' && c.iss !== 'https://accounts.google.com')
    return { ok: false, reason: 'unexpected issuer' };
  if (typeof c.exp === 'number' && c.exp * 1000 < Date.now()) return { ok: false, reason: 'token expired' };
  // A Google account can carry an unverified address; treating it as identity
  // would let someone claim a staff member's email without owning it.
  if (c.email_verified !== true && c.email_verified !== 'true')
    return { ok: false, reason: 'that Google account has an unverified email address' };
  if (!c.email) return { ok: false, reason: 'no email on the account' };

  return { ok: true, email: c.email.toLowerCase(), name: c.name };
}

/** Authorisation: is this verified address on the allowlist and still active? */
export async function findActiveStaff(env: AuthEnv, email: string) {
  const db = getDb(env);
  const rows = await db.select().from(schema.staff)
    .where(eq(schema.staff.email, email.toLowerCase())).limit(1);
  const s = rows[0];
  return s && s.active ? s : null;
}

export async function markLogin(env: AuthEnv, staffId: number) {
  const db = getDb(env);
  await db.update(schema.staff).set({ lastLoginAt: nowIso() })
    .where(eq(schema.staff.id, staffId));
}
