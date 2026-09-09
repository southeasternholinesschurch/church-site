import type { APIRoute } from 'astro';
import { destroySession } from '../../lib/session';

/** POST only: a GET would let any image tag on any page sign staff out. */
export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
  await destroySession(locals.runtime.env, cookies);
  return redirect('/login?signed-out=1', 302);
};
