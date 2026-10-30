import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../../db';

export const prerender = false;

/**
 * PUBLIC: an uploaded lobby photograph, for the screen. By id only — the R2 key
 * comes from the row, never the request — exactly as /api/lobby/hero/{id}.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime.env;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1 || !env.PHOTOS) return new Response('Not found', { status: 404 });
  const [row] = await getDb(env).select({ key: schema.lobbyPhotos.imageKey })
    .from(schema.lobbyPhotos).where(eq(schema.lobbyPhotos.id, id)).limit(1);
  if (!row?.key.startsWith('lobby-photo/')) return new Response('Not found', { status: 404 });
  const obj = await env.PHOTOS.get(row.key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
