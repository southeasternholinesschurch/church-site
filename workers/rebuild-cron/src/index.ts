/**
 * Daily scheduled rebuild (build brief §1, §5).
 *
 * This Worker does exactly one thing: on its cron schedule, POST to the
 * site's Cloudflare "Deploy Hook" URL, which tells Cloudflare to rebuild
 * and redeploy the site — picking up any calendar edits since the last
 * build. (The site is deployed via Cloudflare's "Workers Builds" git
 * integration, not classic Pages, but Deploy Hooks work the same way:
 * Settings → Deploy hooks on the site's Cloudflare project.)
 *
 * The SAME deploy hook URL is also the "manual publish now" link (build
 * brief §1) — the pastor bookmarks it directly to his phone home screen and
 * taps it any time for an immediate rebuild. No auth beyond the URL
 * itself is needed; that's the standard, documented way Cloudflare deploy
 * hooks work — the long random ID in the URL IS the secret, so keep it
 * private (this Worker also keeps it out of source control, stored only
 * as a secret binding).
 */

export interface Env {
  DEPLOY_HOOK_URL: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(triggerRebuild(env));
  },
  // Also reachable manually over HTTP for a quick "did this actually work"
  // check — see docs/README.md → "Testing the rebuild plumbing".
  async fetch(_request: Request, env: Env): Promise<Response> {
    const result = await triggerRebuild(env);
    return new Response(result, { status: result.startsWith('ok') ? 200 : 500 });
  },
};

async function triggerRebuild(env: Env): Promise<string> {
  if (!env.DEPLOY_HOOK_URL) return 'error: DEPLOY_HOOK_URL secret not set';
  try {
    const res = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' });
    return res.ok ? `ok: deploy hook returned ${res.status}` : `error: deploy hook returned ${res.status}`;
  } catch (err) {
    return `error: ${String(err)}`;
  }
}
