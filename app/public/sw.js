/**
 * The directory's service worker — deliberately almost inert.
 *
 * It exists so the directory can be INSTALLED to a home screen, not so it can
 * work offline, and that distinction is the whole design. This app's pages are
 * the congregation's contact details. A cached page is a copy of them written
 * to the device, where nothing here can revoke it — and revocation has to bite
 * on the very next open (see readMemberSession, which re-checks eligibility on
 * every request). So the HTML always comes from the network.
 *
 * Cached: icons and fonts. Nothing else. Not HTML, not /directory/photo/*, not
 * API responses. Before adding a rule here, ask whether the thing it caches
 * would be safe to find on a lost phone.
 *
 * Registered from the directory's own pages with `{ scope: '/directory' }` —
 * this file sits at the root only because a worker cannot claim a scope above
 * itself. It does not control the staff app.
 */
const CACHE = 'seh-directory-v1';

const PRECACHE = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/fonts/texta-regular.woff2',
  '/fonts/texta-bold.woff2',
];

const cacheable = (url) =>
  url.origin === self.location.origin && (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/favicon')
  );

self.addEventListener('install', (event) => {
  // One at a time, not cache.addAll: addAll rejects the entire install if any
  // single file 404s, and a missing icon must not be the reason the directory
  // cannot be added to a home screen.
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Not calling respondWith leaves the request entirely alone — the browser
  // fetches it as if no worker existed. That is the right default here.
  if (event.request.method !== 'GET' || !cacheable(url)) return;

  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    })),
  );
});
