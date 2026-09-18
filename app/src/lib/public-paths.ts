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
];

/** The whole decision. One function, one list, and a test that holds the pair
 *  `/signup/abc` and `/signups` apart. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}
