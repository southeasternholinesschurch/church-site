import { defineMiddleware } from 'astro:middleware';
import { readSession, type SessionUser } from './lib/session';
import { demoUser, isDemoInstance } from './lib/demo-instance';
import { canAccess, homeFor } from './lib/permissions';
import { readKioskDevice } from './lib/kiosk';

/**
 * Everything is private except the login flow.
 *
 * Deny by default and name the exceptions — the opposite (listing the pages to
 * protect) means a route added later is public until someone remembers. This
 * app holds the congregation's contact details; forgetting is not an
 * acceptable failure mode.
 */
const PUBLIC_PREFIXES = [
  '/login', '/auth/', '/_astro/', '/favicon',
  // Must be readable WITHOUT a session, or a crawler is redirected to /login
  // and never sees the disallow it came for.
  '/robots.txt',
  // Twilio's callback. It cannot carry a session, so it is public — and it
  // validates Twilio's HMAC signature itself before touching anything. That
  // check is the ONLY thing protecting it; do not add another public path here
  // without an equivalent.
  '/api/sms/webhook',
  // Called by the reminder cron Worker, which has no session. Guarded by a
  // shared secret it checks itself.
  '/api/sms/run-due',
  // Read-only bulletin feed for the public site's build. Returns published
  // bulletins only, which are public documents by nature.
  '/api/bulletin/current',
  // The member directory is NOT staff-only — members are not staff. It runs
  // its own check (readMemberSession) and shows nothing without one, so it
  // must bypass the staff gate rather than be protected by it.
  '/directory',
];

/**
 * Security response headers, applied to everything this middleware returns.
 *
 * The CSP is REPORT-ONLY. Violations show in the browser console and nothing
 * is blocked, so a policy that is subtly wrong cannot lock staff out of the
 * dashboard on a Sunday morning.
 * TO ENFORCE: change CSP_HEADER below to 'content-security-policy'. Do that
 * after clicking through the dashboard, the bulletin editor, and the directory
 * with DevTools open.
 *
 * 'unsafe-inline' for script is not laziness: the app uses inline `is:inline`
 * blocks and inline onsubmit confirm handlers, and an inline event handler
 * cannot carry a nonce. Removing it means refactoring those first.
 */
const CSP_HEADER = 'content-security-policy-report-only';
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Nothing here should ever be framed by another site.
  "frame-ancestors 'self'",
  // Every form in this app posts to this app.
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  // Google Fonts CSS for the directory's Instrument Serif.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Member photos are same-origin: they come through /directory/photo/[id],
  // never straight from R2.
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
].join('; ');

function harden(response: Response): Response {
  // Responses handed back by the assets binding can have immutable headers, so
  // copy rather than mutate in place — a throw here would take down the page.
  const res = new Response(response.body, response);
  res.headers.set(CSP_HEADER, CSP);
  res.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  /*
   * Nothing in this app belongs in a search index — not the staff pages, not
   * the directory, and least of all the public demo, whose invented
   * congregation would otherwise be indexed under the church's own domain.
   *
   * As a HEADER rather than only a meta tag: the meta tags already on the
   * pages cover HTML a crawler renders, and nothing else. The generated
   * portraits are SVG and /api/bulletin/current is JSON; neither can carry a
   * meta tag, and both are directly linkable.
   */
  res.headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  return res;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const env = context.locals.runtime?.env as
    { DB: D1Database; DEMO_INSTANCE?: string; DEMO_ROLE?: string } | undefined;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return harden(await next());

  // No binding means the app is misconfigured, not that the visitor is allowed.
  if (!env?.DB) return harden(new Response('Database not configured', { status: 500 }));

  /*
   * THE CHECK-IN KIOSK — its own branch, before any of the staff machinery.
   *
   * A shared tablet in a hallway with children around it. It gets a principal
   * of its own and it NEVER gets `locals.user`: every page in this app reads
   * that field and assumes a trusted human, so a kiosk satisfying that read
   * would be one missed check away from opening the congregation's addresses.
   * That is why this returns here rather than falling through to the staff
   * session below — there is no path from this branch into the rest of the app.
   *
   * Not in PUBLIC_PREFIXES either: public would mean anybody on the internet
   * could mark children present. It is a third state — neither public nor
   * staff — which is exactly what §6.3 asks for.
   */
  if (pathname === '/kiosk' || pathname.startsWith('/kiosk/')) {
    /*
     * There is no exception here, and deliberately so. Pairing happens on
     * /kids/kiosk — a director signs in on the tablet, presses one button, and
     * that button both writes the kiosk cookie and ends their staff session. So
     * a device is paired by somebody who already has the right to, standing at
     * the tablet, and no pairing secret is ever typed or put in a URL where it
     * could be shoulder-read or land in a history.
     */
    const device = await readKioskDevice(env, context.cookies);
    if (!device) {
      // Deliberately says nothing about what this address is for. A tablet that
      // has been revoked, and a stranger who guessed the URL, get the same
      // answer.
      return harden(new Response('This device is not set up for check-in.', {
        status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' },
      }));
    }
    context.locals.kiosk = device;
    return harden(await next());
  }

  /*
   * The public demo deployment has no sign-in at all — the whole point is that
   * a pastor considering this can click through it without an account.
   *
   * Safe only because it is a SEPARATE Worker with a SEPARATE database holding
   * nothing but invented people, and because sending a text is blocked at the
   * point of sending rather than hidden in the interface. Never set
   * DEMO_INSTANCE on the real app.
   */
  const user: SessionUser | null = isDemoInstance(env)
    ? demoUser(env)
    : await readSession(env, context.cookies);
  if (!user) {
    const to = encodeURIComponent(pathname + context.url.search);
    // Hardened too: the redirect to /login is a response like any other, and
    // leaving it bare is how a header ends up "applied everywhere" except the
    // one path an unauthenticated visitor actually receives.
    return harden(context.redirect(`/login?next=${to}`, 302));
  }

  /*
   * The permission gate. Everything above this line asks WHO you are; this is
   * the first thing in the app that asks what you may have.
   *
   * It runs here, in the middleware, rather than on each page — because the
   * failure mode of a per-page check is a page that forgets, and the failure
   * mode of this is a volunteer complaining they cannot reach something. Only
   * one of those is recoverable. See lib/permissions.ts for the rule itself.
   *
   * `role` was re-read from the database by readSession moments ago, never
   * from the cookie, so changing someone's role or deactivating them takes
   * effect on their very next click.
   */
  if (!canAccess(user.role, pathname)) {
    /*
     * A refused FETCH gets a 403, not a redirect. Sending a 302 to an HTML
     * page in answer to a POST from a script produces a "success" the caller
     * cannot distinguish from the real thing — and the API routes are exactly
     * where a refusal most needs to be unambiguous.
     */
    if (pathname.startsWith('/api/')) {
      return harden(new Response(JSON.stringify({ error: 'not allowed' }),
        { status: 403, headers: { 'content-type': 'application/json' } }));
    }
    /*
     * A person gets sent to the part of the app they DO have, not shown a
     * refusal. A volunteer typing /people has usually just tapped a stale
     * bookmark; "you are not allowed" is a fact about somebody else's
     * permissions that they do not need, and the same reasoning /staff has
     * used since it was written.
     */
    return harden(context.redirect(homeFor(user.role), 302));
  }

  context.locals.user = user;
  return harden(await next());
});
