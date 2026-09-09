/**
 * Minimal GitHub OAuth proxy for Decap CMS on Cloudflare Pages.
 *
 * Decap CMS's `github` backend expects an OAuth provider that (a) redirects
 * to GitHub's authorize screen, and (b) after the callback, hands the
 * access token back to the CMS popup window via `postMessage` in a very
 * specific string format. Netlify provides this for free via
 * "git-gateway"; Cloudflare Pages doesn't, so this ~80-line Worker is the
 * standard, documented substitute (this exact pattern is what most
 * Cloudflare-Pages-plus-Decap-CMS setups use).
 *
 * Flow:
 *   1. Decap opens a popup to  GET /auth
 *   2. We redirect to GitHub's OAuth authorize URL
 *   3. GitHub redirects back to GET /callback?code=...
 *   4. We exchange the code for an access token (server-side — the client
 *      secret never touches the browser) and postMessage it to the opener
 *
 * Required secrets (see wrangler.toml): GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET.
 */

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

const SCOPES = 'repo,user';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/auth') {
      const state = crypto.randomUUID();
      const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
      authorizeUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      authorizeUrl.searchParams.set('redirect_uri', `${url.origin}/callback`);
      authorizeUrl.searchParams.set('scope', SCOPES);
      authorizeUrl.searchParams.set('state', state);

      const response = Response.redirect(authorizeUrl.toString(), 302);
      // Stash state in a short-lived cookie to check on callback (basic CSRF guard).
      const headers = new Headers(response.headers);
      headers.append('Set-Cookie', `decap_oauth_state=${state}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`);
      return new Response(null, { status: 302, headers });
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookie = request.headers.get('Cookie') ?? '';
      const cookieState = cookie.match(/decap_oauth_state=([^;]+)/)?.[1];

      if (!code || !state || !cookieState || state !== cookieState) {
        return htmlMessage('error', 'Invalid or missing OAuth state — please try logging in again.');
      }

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/callback`,
        }),
      });

      const tokenData = (await tokenRes.json()) as { access_token?: string; error_description?: string };
      if (!tokenData.access_token) {
        return htmlMessage('error', tokenData.error_description ?? 'GitHub did not return an access token.');
      }

      return htmlMessage('success', JSON.stringify({ token: tokenData.access_token, provider: 'github' }));
    }

    return new Response('[Your Church Name] — Decap CMS OAuth proxy. Not a page for browsing.', { status: 404 });
  },
};

/** Decap CMS listens for a `message` event on the popup's opener with this exact string shape. */
function htmlMessage(kind: 'success' | 'error', payload: string): Response {
  const body = `<!doctype html><html><body>
<script>
  (function() {
    function receiveMessage() {
      window.opener.postMessage('authorization:github:${kind}:${payload.replace(/'/g, "\\'")}', '*');
      window.removeEventListener('message', receiveMessage, false);
    }
    window.addEventListener('message', receiveMessage, false);
    window.opener.postMessage('authorizing:github', '*');
  })();
</script>
</body></html>`;
  return new Response(body, { headers: { 'content-type': 'text/html' } });
}
