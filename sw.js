/* Sambal 2.0 service worker
 * - Pre-caches the app shell (index.html) so the site opens offline.
 * - Navigations: network first (so updates show up), cached copy when offline.
 * - Google Fonts + same-origin files: cached as they are used.
 * Bump CACHE_VERSION whenever you publish a new index.html to force a clean refresh.
 */
const CACHE_VERSION = 'v1';
const CACHE = 'sambal2-' + CACHE_VERSION;
const SCOPE = self.registration.scope;
const SHELL = [SCOPE, SCOPE + 'index.html'];
const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Plus+Jakarta+Sans:wght@600;800&display=swap';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // App shell (required)
    await Promise.all(SHELL.map(async (u) => {
      try { await cache.add(new Request(u, { cache: 'reload' })); } catch (e) {}
    }));
    // Fonts (best effort): save the CSS and the font files it points to
    try {
      const res = await fetch(FONT_CSS);
      if (res.ok) {
        await cache.put(FONT_CSS, res.clone());
        const css = await res.text();
        const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
        await Promise.all(urls.map(async (u) => {
          try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch (e) {}
        }));
      }
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('sambal2-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page loads: network first, fall back to the saved page
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && url.origin === location.origin) {
          const cache = await caches.open(CACHE);
          cache.put(SCOPE + 'index.html', fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match(SCOPE + 'index.html')) ||
               (await cache.match(SCOPE)) ||
               new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Fonts and same-origin files: cached copy first, refreshed in the background
  if (url.origin === location.origin || FONT_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const refresh = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { event.waitUntil(refresh); return hit; }
      return (await refresh) || new Response('', { status: 504 });
    })());
  }
  // Everything else (WhatsApp, Google Drive links, etc.) goes straight to the network.
});
