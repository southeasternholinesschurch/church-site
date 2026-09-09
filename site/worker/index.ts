/**
 * The site's only dynamic route: GET /api/live-status.
 *
 * Everything else on example.org is a static file built by
 * `astro build` and served straight from dist/ by the ASSETS binding. This
 * Worker exists for the one question that cannot be answered at build time:
 * is the church streaming right now?
 *
 * WHY A WORKER AND NOT A BROWSER FETCH
 * The API key stays server-side. A referrer-restricted key in client JS would
 * also "work", but every visitor would then spend quota directly, with no
 * shared cache to bound it.
 *
 * WHY NOT search?eventType=live
 * That is the obvious call and it is a trap. It costs 100 quota units against
 * a 10,000/day allowance — 100 calls a day for the whole project, shared with
 * the nightly sermon importer. Reading the uploads playlist and then the video
 * records costs 1 + 1 = 2 units for the same answer, which is what makes
 * polling affordable at all. Search is also served from YouTube's index, which
 * lags a live broadcast by a minute or more; liveStreamingDetails flips
 * immediately, so the cheap path is the accurate one too.
 *
 * NEVER THROWS. Every failure — missing key, YouTube down, malformed
 * response — returns { live: false } with a reason. The Livestream page falls
 * back to the countdown and the channel link, so a broken API degrades to the
 * page we would have shipped anyway. It must never take the page down.
 */

interface Env {
  ASSETS: Fetcher;
  /** Cloudflare secret. Absent → { configured: false }, countdown shown. */
  YOUTUBE_API_KEY?: string;
  /** Optional override; the channel is public and rarely changes. */
  YOUTUBE_CHANNEL_ID?: string;
}

/** Kept identical to LiveStatus in src/lib/youtube.ts — the page's contract. */
interface LiveStatus {
  live: boolean;
  configured: boolean;
  videoId?: string | null;
  error?: string;
}

/**
 * `caches.default` is Cloudflare's per-datacenter cache. It is not part of the
 * DOM's CacheStorage, and this project's tsconfig includes the DOM lib because
 * the rest of src/ is browser code — so the two disagree about what `caches`
 * is. Narrowed for this file rather than widening the whole project's types.
 */
declare const caches: CacheStorage & { default: Cache };

const DEFAULT_CHANNEL_ID = 'UC…YOUR_CHANNEL_ID';

/**
 * A channel's uploads playlist is its ID with the "UC" prefix swapped for
 * "UU". This is a documented, stable property of YouTube IDs — it saves a
 * channels.list call (and one more quota unit) on every request.
 */
function uploadsPlaylistId(channelId: string): string {
  return channelId.startsWith('UC') ? `UU${channelId.slice(2)}` : channelId;
}

/**
 * Long enough that quota can't run away, short enough that nobody sits on a
 * countdown while the service is already going out. At 2 units a miss, a
 * three-hour Sunday costs ~72 units.
 */
const CACHE_SECONDS = 90;

/**
 * s-maxage, not max-age — the distinction is load-bearing.
 *
 * The EDGE should hold this for 90s: that is what stops quota scaling with
 * visitors. The BROWSER must not, because the page polls every 60s and a
 * browser-cached copy would be served straight back out of the client's own
 * HTTP cache without the request ever leaving the machine. Polling would run
 * on schedule and learn nothing, and the page would sit on a countdown
 * through a service that had already started.
 *
 * max-age=0 sends the poll to the edge every time; s-maxage=90 means the edge
 * usually answers it for free.
 */
function json(body: LiveStatus, seconds = CACHE_SECONDS): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=0, s-maxage=${seconds}`,
    },
  });
}

async function fetchJson(url: URL, signal: AbortSignal): Promise<any> {
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`youtube api ${res.status}`);
  return res.json();
}

async function liveStatus(env: Env): Promise<LiveStatus> {
  const key = env.YOUTUBE_API_KEY;
  if (!key) return { live: false, configured: false };

  const channelId = env.YOUTUBE_CHANNEL_ID || DEFAULT_CHANNEL_ID;

  // YouTube is a third party on the request path. Bound it, or a hung call
  // holds the page's fetch open until the browser gives up.
  //
  // 8s, not the 4s this first had: two sequential calls run ~0.4s on a warm
  // connection but ~4.5s cold, and cold is exactly the state the first
  // request of a service morning is in. A 4s budget aborted that request
  // every time — the feature would have looked fine in testing and never
  // fired in production. The cache means this is paid about once a minute,
  // so the ceiling can afford to be generous.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);

  try {
    // 1 unit — the most recent uploads. A broadcast joins this list as it
    // starts, which is why five is plenty: anything live is at the top.
    const listUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    listUrl.searchParams.set('part', 'contentDetails');
    listUrl.searchParams.set('playlistId', uploadsPlaylistId(channelId));
    listUrl.searchParams.set('maxResults', '5');
    listUrl.searchParams.set('key', key);

    const list = await fetchJson(listUrl, abort.signal);
    const ids: string[] = (list.items ?? [])
      .map((i: any) => i?.contentDetails?.videoId)
      .filter(Boolean);
    if (!ids.length) return { live: false, configured: true };

    // 1 unit — the authoritative record for each.
    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.searchParams.set('part', 'snippet,liveStreamingDetails');
    videosUrl.searchParams.set('id', ids.join(','));
    videosUrl.searchParams.set('key', key);

    const videos = await fetchJson(videosUrl, abort.signal);

    // Two independent signals, because each has a blind spot:
    // liveBroadcastContent is the plain answer but is snippet data and can
    // trail by a few seconds, while a started-but-not-ended broadcast is
    // definitional. Either one counts.
    const live = (videos.items ?? []).find((v: any) => {
      const d = v?.liveStreamingDetails;
      return v?.snippet?.liveBroadcastContent === 'live'
        || Boolean(d?.actualStartTime && !d?.actualEndTime);
    });

    return live
      ? { live: true, configured: true, videoId: live.id }
      : { live: false, configured: true };
  } catch (err) {
    return { live: false, configured: true, error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // NO www REDIRECT HERE. It was tried and it is impossible: static assets
    // are matched BEFORE this Worker runs, so a request for a page on www is
    // served from dist/ and never reaches this code. The canonical tag in
    // BaseLayout does the job instead, and a Cloudflare Redirect Rule can do
    // the 301 properly if it is ever wanted — that runs at the edge, ahead of
    // asset matching.

    // Anything that isn't the API route is a static file. Assets are matched
    // before the Worker runs, so in practice this only sees /api/* and paths
    // with no file behind them — both of which ASSETS handles correctly
    // (the latter as the 404 page).
    if (url.pathname !== '/api/live-status') {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    // Edge cache, explicitly. A Worker response is not cached just because it
    // carries cache-control, and without this the quota would scale with
    // visitors rather than with time.
    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/api/live-status`, { method: 'GET' });

    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const status = await liveStatus(env);
    const response = json(status);

    // Don't cache a transient failure for a minute and a half.
    if (!status.error) ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  },
};
