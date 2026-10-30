import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../db';

export const prerender = false;

/**
 * PUBLIC: a hero frame's graphic, for the lobby screen.
 *
 * Looked up BY ID, and the R2 key comes from the row, never from the request —
 * so this route can only ever serve what was uploaded as a hero frame, never
 * a member portrait from the same bucket. It serves switched-off frames too:
 * the dashboard previews them, and a graphic is no more private for being off.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime.env;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1 || !env.PHOTOS) return new Response('Not found', { status: 404 });
  const [row] = await getDb(env).select({ key: schema.lobbyHeroes.imageKey })
    .from(schema.lobbyHeroes).where(eq(schema.lobbyHeroes.id, id)).limit(1);
  if (!row?.key.startsWith('lobby-hero/')) return new Response('Not found', { status: 404 });
  const obj = await env.PHOTOS.get(row.key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // The URL carries the key's tail, so a replaced graphic is a new URL.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
