import type { APIRoute } from 'astro';

/**
 * "Publish the website now" — fires the Cloudflare deploy hook.
 *
 * Done SERVER-SIDE on purpose. The hook URL has no authentication of its own:
 * the long random ID in it IS the secret, so anyone holding the URL can
 * trigger a rebuild. Putting it in a link on a page would hand it to every
 * browser that loads the page. Here it stays a Worker secret and the browser
 * only ever sees the result.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'not signed in' }, 401);

  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host)
    return json({ error: 'bad origin' }, 403);

  const hook = locals.runtime.env.DEPLOY_HOOK_URL;
  if (!hook) return json({ error: 'The deploy hook is not configured yet.' }, 400);

  try {
    const res = await fetch(hook, { method: 'POST' });
    if (!res.ok) return json({ error: `Cloudflare returned ${res.status}` }, 502);
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
