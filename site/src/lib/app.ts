/**
 * Where the staff app lives.
 *
 * The public site is static and has no database, so anything a visitor sends
 * that the church should keep — a guest card — is posted straight to the app,
 * which answers with a redirect back here. bulletin.astro and directory.astro
 * name the same origin for the same reason.
 */
export const APP_ORIGIN = 'https://app.yourchurch.org';

/** The guest card's endpoint. Public on the app side — see lib/public-paths.ts there. */
export const GUEST_CARD_URL = `${APP_ORIGIN}/api/guest-card`;
