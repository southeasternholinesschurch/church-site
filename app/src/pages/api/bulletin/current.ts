import type { APIRoute } from 'astro';
import { currentBulletin } from '../../../lib/bulletin-feed';

export const prerender = false;

/**
 * PUBLIC, read-only. The site's build machine has no session, so this cannot
 * be behind the login — and it does not need to be: a bulletin is handed out
 * on paper to anyone who walks in.
 *
 * The query and its rules (published only, who appears under birthdays) live
 * in lib/bulletin-feed.ts, shared with the lobby screen's feed.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const bulletin = await currentBulletin(locals.runtime.env, url.origin);
  return json({ bulletin });
};

const json = (o: unknown) =>
  new Response(JSON.stringify(o), {
    headers: {
      'content-type': 'application/json',
      // Read at build time; a short cache stops a rebuild loop hammering it.
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
    },
  });
