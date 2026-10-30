/**
 * Which paths are reachable WITHOUT a staff session.
 *
 * Lifted out of the middleware for one reason, and it is worth stating plainly
 * because the reason is a near-miss rather than tidiness:
 *
 *   The sign-up sheets are public at `/signup/{token}` and the staff builder
 *   that creates them lives at `/signups`. The list is matched with
 *   `startsWith`, so the entry MUST carry its trailing slash — `'/signup/'`
 *   does not match `/signups`, but `'/signup'` would, and would hand the whole
 *   back end to the internet. Two characters between a link somebody can share
 *   and an open door.
 *
 * A prefix list inside the middleware could not be tested without standing up
 * a request. This can, and test/signups.test.ts asserts exactly that pair.
 *
 * Pure: no `astro:` imports, no database, nothing to mock.
 */

/**
 * Deny by default and name the exceptions — the opposite (listing the pages to
 * protect) means a route added later is public until someone remembers. This
 * app holds the congregation's contact details; forgetting is not an
 * acceptable failure mode.
 */
export const PUBLIC_PREFIXES = [
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
  /*
   * A sign-up sheet, reached by the link in the bulletin or a text.
   *
   * THE TRAILING SLASH IS LOAD-BEARING. See the note at the top of this file.
   * The page itself gives nothing away without a real token: an unknown token,
   * a draft sheet and a deleted one all render the same wording, so it cannot
   * be used to probe which tokens were ever real.
   */
  '/signup/',
  /*
   * The guest card on the public website posts here — the pew card at
   * /welcome and "let us know you're coming" on Plan Your Visit. A visitor has
   * no session and never will.
   *
   * EXACT, and it only ever WRITES: it stores a card and answers with a
   * redirect back to the website. It reads nothing back out, so there is
   * nothing here a stranger could use to see who else has visited. Spam is
   * handled inside it (a honeypot, links refused, a per-connection hourly cap).
   */
  '/api/guest-card',
  /*
   * A lobby hero frame's GRAPHIC, by id, for the foyer TV.
   *
   * THE TRAILING SLASH IS LOAD-BEARING, as with '/signup/': the staff route
   * that creates and edits frames is '/api/lobby/heroes', and `'/api/lobby/hero'`
   * without the slash would publish it. The route only reads: it looks the frame
   * up by id and serves the key on that row. test/lobby.test.ts holds the pair.
   */
  '/api/lobby/hero/',
  /*
   * An uploaded lobby photograph, by id. Same rule, same reason: the trailing
   * slash keeps the staff route '/api/lobby/photos' private.
   */
  '/api/lobby/photo/',
];

/**
 * Paths public ONLY EXACTLY — never as a prefix.
 *
 * The lobby screen on the foyer TV, and the feed it polls. Public because
 * everything on it already is: the published bulletin (the same data as
 * /api/bulletin/current), the site's events, and photographs. No pairing yet —
 * see handoff/PLAN-lobby-screen.md, "Access".
 *
 * EXACT because a staff "Lobby" remote is planned, and its natural home is
 * /lobby/remote. As a prefix, `'/lobby'` would make that page public the day it
 * is written — and `/lobbyanything` with it. A trailing slash is allowed, since
 * a TV browser may add one; nothing else is. test/lobby.test.ts holds this.
 */
export const PUBLIC_EXACT = ['/lobby', '/api/lobby/feed'];

/** The whole decision. One function, two lists, and tests that hold the pairs
 *  `/signup/abc` and `/signups`, and `/lobby` and `/lobby/remote`, apart. */
export function isPublicPath(pathname: string): boolean {
  const exact = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return PUBLIC_EXACT.includes(exact) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Where the public website lives, for the guest card to send people back to.
 *
 * A fixed list rather than whatever the form says: a redirect target taken from
 * the request is an open redirect, which is a phishing tool with the church's
 * name on it. localhost is there so the site and the app can be run side by
 * side in development.
 */
export const SITE_ORIGINS = [
  'https://yourchurch.org',
  'https://www.yourchurch.org',
  'http://localhost:4321',
];

/** The site to send a visitor back to: the one they came from, if it is ours. */
export function siteOriginFor(origin: string | null, referer: string | null): string {
  const from = origin && origin !== 'null' ? origin : referer ? safeOrigin(referer) : null;
  return from && SITE_ORIGINS.includes(from) ? from : SITE_ORIGINS[0]!;
}

function safeOrigin(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}
