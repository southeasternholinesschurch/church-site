import type { APIRoute } from 'astro';
import { exchangeCode, findActiveStaff, markLogin } from '../../lib/auth';
import { createSession, purgeExpired } from '../../lib/session';
import { canAccess, homeFor } from '../../lib/permissions';

export const GET: APIRoute = async ({ locals, url, cookies, redirect }) => {
  const env = locals.runtime.env;
  const fail = (e: string) => redirect(`/login?error=${encodeURIComponent(e)}`, 302);

  // Google reports its own refusals here (e.g. the user cancelled).
  const googleError = url.searchParams.get('error');
  if (googleError) return fail(googleError === 'access_denied' ? 'cancelled' : googleError);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = cookies.get('seh_oauth_state')?.value;
  cookies.delete('seh_oauth_state', { path: '/' }); // single use, whatever happens

  if (!code) return fail('no code returned');
  // Rejecting a missing OR mismatched state is what stops an attacker
  // completing a sign-in in someone else's browser.
  if (!state || !expected || state !== expected) return fail('expired');

  const result = await exchangeCode(env, url, code);
  if (!result.ok || !result.email) return fail(result.reason ?? 'sign-in failed');

  const member = await findActiveStaff(env, result.email);
  // Deliberately does NOT name the address back. Whether a given email is on
  // the church's staff list is not something a stranger gets to probe for.
  if (!member) return fail('not-allowed');

  await purgeExpired(env);
  await createSession(env, cookies, member.id, url.protocol === 'https:');
  await markLogin(env, member.id);

  /*
   * Where they land.
   *
   * Only ever a path on this site — an open redirect here would let a login
   * link deposit someone on an attacker's page.
   *
   * And only ever a path THIS PERSON MAY HAVE. The middleware would refuse a
   * `next` they cannot reach and bounce them anyway, so this is not a security
   * check — it is so an [Kids Ministry] volunteer following a stale link lands on their
   * own section instead of watching the browser bounce through a page they
   * were never allowed to see. With no `next` at all they go to whichever
   * dashboard is theirs, which is the whole reason a volunteer's sign-in link
   * needs no special URL.
   */
  const next = url.searchParams.get('next');
  const onSite = next && next.startsWith('/') && !next.startsWith('//');
  const safe = onSite && canAccess(member.role, next) ? next : homeFor(member.role);
  return redirect(safe, 302);
};
