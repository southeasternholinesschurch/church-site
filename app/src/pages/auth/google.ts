import type { APIRoute } from 'astro';
import { authConfigured, authorizeUrl, randomToken } from '../../lib/auth';

/** Starts the sign-in. The `state` is the CSRF defence: it is minted here,
 *  parked in a short-lived cookie, and must come back matching. */
export const GET: APIRoute = async ({ locals, url, cookies, redirect }) => {
  const env = locals.runtime.env;
  if (!authConfigured(env)) return redirect('/login?error=unconfigured', 302);

  const state = randomToken(16);
  cookies.set('seh_oauth_state', state, {
    httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:',
    path: '/', maxAge: 600, // ten minutes is plenty to sign in
  });

  return redirect(authorizeUrl(env, url, state), 302);
};
