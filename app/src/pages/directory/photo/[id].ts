import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../db/index';
import { readMemberSession } from '../../../lib/directory';
import { readSession } from '../../../lib/session';
import { isKidsRole } from '../../../lib/permissions';
import { isDemoInstance } from '../../../lib/demo-instance';
import { demoAvatarSvg } from '../../../lib/demo-avatar';

/**
 * Serves a member's portrait.
 *
 * This route is the reason photos are not simply public files. It repeats the
 * directory's OWN check — a member session or a signed-in staff user — because
 * an unguarded image url is a directory leak that no amount of care on the
 * HTML page can undo. Same door, same key.
 *
 * It also refuses the photo of anyone not currently listed, so archiving or
 * un-listing somebody takes their face down along with their phone number.
 */
export const GET: APIRoute = async ({ params, locals, cookies }) => {
  const env = locals.runtime.env;
  const deny = new Response('Not found', { status: 404 });

  const member = await readMemberSession(env, cookies);
  /*
   * Same reason as the directory page: this path is public to the middleware,
   * so locals.user is never set here and must be read from the cookie.
   *
   * And because the middleware never ran, THE PERMISSION GATE NEVER RAN. An
   * Fairhaven Kids volunteer is staff — `readSession` returns them like anybody else —
   * so without the role check below they could walk /directory/photo/1..N and
   * collect a portrait of every adult in the congregation, which is precisely
   * what the kids roles exist to prevent. Children's photos are served by
   * /kids/photo/[id] instead, behind the gate where they belong.
   */
  const session = await readSession(env, cookies);
  const staff = session !== null && !isKidsRole(session.role);
  const onDemo = isDemoInstance(env);
  if (!member && !staff && !onDemo) return deny;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return deny;

  /*
   * The demo has no R2 bucket and needs none: the portrait is drawn from the
   * person's id on the way out. Deliberately illustrated rather than
   * photorealistic — see lib/demo-avatar.
   *
   * Still behind the same door as a real photograph, so the route has one
   * access rule rather than two.
   */
  if (onDemo) {
    return new Response(demoAvatarSvg(id), {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        // Deterministic, so it can be cached hard.
        'cache-control': 'public, max-age=86400',
      },
    });
  }

  if (!env.PHOTOS) return deny;

  const [p] = await getDb(env).select({
    photoKey: schema.people.photoKey, archived: schema.people.archived,
    adultChild: schema.people.adultChild, included: schema.people.includeInDirectory,
  }).from(schema.people).where(eq(schema.people.id, id)).limit(1);

  if (!p?.photoKey) return deny;
  // The listing rules gate MEMBERS, not staff. Staff need to see the photo on
  // a profile they are still editing — before the person is marked for the
  // directory at all — and they already have the whole people table anyway.
  if (!staff && (p.archived || p.adultChild !== 'adult' || !p.included)) return deny;

  const obj = await env.PHOTOS.get(p.photoKey);
  if (!obj) return deny;

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // Private, not shared: an intermediary must never hold a member's photo.
      // The key is random per upload, so a long private cache is still correct
      // when the photo is replaced.
      'cache-control': 'private, max-age=86400',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
};
