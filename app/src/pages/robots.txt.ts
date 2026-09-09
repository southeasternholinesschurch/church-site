import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Crawling is ALLOWED. Indexing is refused by the header. That combination is
 * deliberate and the opposite is the common mistake.
 *
 * `X-Robots-Tag: noindex` (middleware.ts) is what actually keeps this app out
 * of search results — but a crawler only sees it if it is permitted to fetch
 * the page. `Disallow: /` blocks that fetch, and Google will still index a
 * disallowed URL it finds linked from somewhere else, showing a bare result,
 * having never read the noindex it was refused permission to look at.
 *
 * So: let them in, and tell them not to index. Do NOT add `Disallow: /` here.
 *
 * (A previous version of this file did exactly that. It was inert anyway —
 * Cloudflare injects its own managed `User-agent: * / Allow: /` block above
 * whatever a Worker returns, and where two groups match the same agent the
 * least restrictive rule wins. Right outcome, wrong reasoning.)
 */
export const GET: APIRoute = () =>
  new Response(
    [
      '# Crawling is allowed on purpose.',
      '# Indexing is refused by the X-Robots-Tag header on every response,',
      '# which a crawler can only see if it is allowed to fetch the page.',
      '# Do not add "Disallow: /" here — it would hide the noindex.',
      'User-agent: *',
      'Allow: /',
      '',
    ].join('\n'),
    {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=86400',
      },
    },
  );
