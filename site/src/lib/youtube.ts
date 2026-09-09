/**
 * Client-side helper for the Livestream page. Calls the Cloudflare Pages
 * Function at /api/live-status (see functions/api/live-status.ts) rather
 * than hitting the YouTube API directly from the browser.
 */
export interface LiveStatus {
  live: boolean;
  configured: boolean;
  videoId?: string | null;
  error?: string;
}

/** Pull a video ID out of any common YouTube URL shape staff might paste. */
export function parseYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (u.pathname.startsWith('/watch')) return u.searchParams.get('v');
    if (u.pathname.startsWith('/live/')) return u.pathname.split('/live/')[1]?.split('/')[0] ?? null;
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/embed/')[1]?.split('/')[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

export async function checkLiveStatus(): Promise<LiveStatus> {
  try {
    /**
     * cache: 'no-store' is the whole reason polling works.
     *
     * The Worker deliberately sends `max-age=0, s-maxage=90`: the EDGE holds
     * the answer, the BROWSER never does. But Cloudflare's zone-level Browser
     * Cache TTL rewrites max-age on the way out — its default is 4 hours — so
     * production actually served `max-age=14400`. The 60s poll then never left
     * the machine: every request was answered from the browser's own HTTP
     * cache with whatever it learned the first time. A visitor who opened this
     * page before a service sat on the countdown for four hours while the
     * stream ran, and reloading did not help, because a reload still serves
     * subresource fetches from that cache. Found 2026-09-02, mid-broadcast:
     * Chrome (opened fresh) showed the stream, Safari (cached earlier) did not.
     *
     * Setting Browser Cache TTL to "Respect Existing Headers" also fixes it,
     * but this does not depend on a dashboard toggle nobody will remember.
     */
    const res = await fetch('/api/live-status', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return { live: false, configured: false, error: `status ${res.status}` };
    return (await res.json()) as LiveStatus;
  } catch (err) {
    return { live: false, configured: false, error: String(err) };
  }
}
