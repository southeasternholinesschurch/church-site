import type { APIRoute } from 'astro';
import { currentBulletin } from '../../../lib/bulletin-feed';
import { siteEvents, SITE_ORIGIN } from '../../../lib/lobby-feed';
import { qrFor } from '../../../lib/qr';
import { heroesForFeed } from '../../../lib/lobby-heroes-db';
import { getLobbyCopy, getLobbySettings } from '../../../lib/lobby-copy-db';
import { photosForFeed } from '../../../lib/lobby-photos-db';
import { lobbyStamp } from '../../../lib/lobby-stamp-db';
import { getDb } from '../../../db';
import type { LobbyFeed } from '../../../lib/lobby';

export const prerender = false;

/**
 * PUBLIC, read-only: what the lobby screen shows. An EXACT public path — see
 * PUBLIC_EXACT in lib/public-paths.ts.
 *
 * It is the public bulletin plus the site's events, and nothing else. NOT a
 * filtered copy of anything: the pastor decided (2026-10-22) that birthdays and
 * prayer requests belong on the screen, because they are already public in
 * /api/bulletin/current — so the bulletin comes from the very same function,
 * and whatever is private there is private here.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const env = locals.runtime.env;

  // The screen sends the stamp of what it already shows; if nothing has
  // changed, say so and build nothing (lib/lobby-stamp-db.ts says why). A
  // failed stamp is a full feed, never a stale screen.
  const stamp = await lobbyStamp(getDb(env)).catch(() => '');
  if (stamp && url.searchParams.get('since') === stamp) {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  const [bulletin, site, heroes, copy, settings, photos] = await Promise.all([
    // A failed query is a 503, not an empty bulletin: the page keeps showing
    // its last good copy on an error, but would faithfully show "nothing" if
    // told there was nothing.
    currentBulletin(env, url.origin).catch(() => undefined),
    siteEvents(env),
    // Hero frames are an extra, never a reason to lose the bulletin.
    heroesForFeed(getDb(env)).catch(() => []),
    // The screen's own words as changed on the Lobby tab (defaults if none).
    getLobbyCopy(getDb(env)),
    getLobbySettings(getDb(env)),
    // Uploaded photographs; the built-in ones need no lookup.
    photosForFeed(getDb(env)).catch(() => []),
  ]);
  if (bulletin === undefined) return new Response('unavailable', { status: 503 });

  const links = {
    site: SITE_ORIGIN.replace(/^https:\/\//, ''),
    livestream: `${SITE_ORIGIN}/livestream`,
    events: `${SITE_ORIGIN}/events`,
    visit: `${SITE_ORIGIN}/visit`,
    give: site.giveUrl,
    // The guest card: the same page the pew NFC tags open.
    guest: `${SITE_ORIGIN}/welcome`,
  };
  const urls = new Set([links.livestream, links.events, links.visit, links.give, links.guest,
    ...(bulletin?.signups ?? []).map((s) => s.url), ...(site.sermon ? [site.sermon.url] : [])]);

  const feed: LobbyFeed = {
    generatedAt: new Date().toISOString(),
    stamp,
    churchName: site.churchName,
    address: site.address,
    serviceTimes: site.serviceTimes,
    bulletin,
    events: site.events,
    sermon: site.sermon,
    links,
    qr: Object.fromEntries([...urls].map((u) => [u, qrFor(u)])),
    heroes,
    copy,
    settings,
    photos,
  };
  return new Response(JSON.stringify(feed), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  });
};
