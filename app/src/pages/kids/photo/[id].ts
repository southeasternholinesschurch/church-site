import type { APIRoute } from 'astro';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../../db/index';
import { isDemoInstance } from '../../../lib/demo-instance';
import { demoAvatarSvg } from '../../../lib/demo-avatar';

/**
 * A child's photograph.
 *
 * SEPARATE from /directory/photo/[id], deliberately, and not a widening of it.
 *
 * That route sits under the /directory PUBLIC_PREFIX, which means the
 * middleware never runs for it and it has to repeat its own auth by hand — and
 * because an Fairhaven Kids volunteer is staff like anyone else, letting children
 * through there would also have let volunteers walk the ids for every adult
 * member's portrait. This path is under /kids, so the permission gate has
 * already decided who may be here before a line of this file executes.
 *
 * It serves CHILDREN ONLY. Even inside /kids, the id in the URL is a number
 * someone can change, and an adult's portrait is not this route's business.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime.env;
  const deny = new Response('Not found', { status: 404 });

  // The gate ran in the middleware, so anybody reaching this line is signed in
  // and allowed in /kids. Belt and braces, because a 404 here is cheap and a
  // leaked photograph is not.
  if (!locals.user) return deny;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return deny;

  const [p] = await getDb(env).select({
    photoKey: schema.people.photoKey,
  }).from(schema.people)
    .where(and(
      eq(schema.people.id, id),
      // A child, and not archived. Both checked in the QUERY rather than after
      // it, so there is one code path and no chance of reading the row and
      // forgetting to look at the flag.
      eq(schema.people.adultChild, 'child'),
      eq(schema.people.archived, false),
    )).limit(1);

  if (!p) return deny;

  /* The demo has no R2 bucket and needs none — the portrait is drawn from the
   * id on the way out, illustrated rather than photorealistic. Same treatment
   * as the directory's, so there is one answer to "what does a photo look like
   * on the demo". */
  if (isDemoInstance(env)) {
    return new Response(demoAvatarSvg(id), {
      headers: { 'content-type': 'image/svg+xml; charset=utf-8',
                 'cache-control': 'private, max-age=86400' },
    });
  }

  if (!env.PHOTOS || !p.photoKey) return deny;
  const obj = await env.PHOTOS.get(p.photoKey);
  if (!obj) return deny;

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // Private, never shared: no intermediary should hold a child's photograph.
      // The key is random per upload, so a long private cache stays correct
      // when the photo is replaced.
      'cache-control': 'private, max-age=86400',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
};
