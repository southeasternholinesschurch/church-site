import type { APIRoute } from 'astro';
import { readBinary, siteEditingConfigured } from '../../../lib/site-content';

export const prerender = false;

/**
 * Serves a photograph out of the site's repository, so the dashboard can show
 * what it is about to replace.
 *
 * A proxy rather than a link, because the repository is private: a raw GitHub
 * URL would need the token, and the token must never reach a browser.
 *
 * The path is confined to the asset folders. Without that, this route would
 * happily serve any file in the repository to any signed-in person — including
 * the ones holding the congregation's data.
 */
const ALLOWED = [
  'site/src/assets/photos/', 'site/src/assets/staff/',
  'site/src/assets/series/', 'site/src/assets/sermons/',
  'site/src/assets/brand/',
  'site/public/uploads/',
];

export const GET: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return new Response('not signed in', { status: 401 });
  const env = locals.runtime.env;
  if (!siteEditingConfigured(env)) return new Response('not configured', { status: 503 });

  const raw = params.path ?? '';
  // uploads/ lives under public/, everything else under src/assets/.
  const path = raw.startsWith('uploads/') ? `site/public/${raw}` : `site/src/assets/${raw}`;
  if (path.includes('..') || path.includes('%') || !ALLOWED.some((p) => path.startsWith(p))) {
    return new Response('not an image path', { status: 400 });
  }

  const file = await readBinary(env, path);
  if (!file) return new Response('not found', { status: 404 });

  return new Response(file.bytes, {
    headers: {
      'content-type': file.type,
      // Private to this staff member, and the content at a path can change when
      // a photo is replaced — so a short cache, never a shared one.
      'cache-control': 'private, max-age=60',
    },
  });
};
