// sw.js — navigation = network-first; static assets = stale-while-revalidate
const CACHE = 'polycode-v4';

// minimal core files (adjust as you like)
const CORE = [
  '/frontend/index.html',
  '/manifest.json',
  '/frontend/assets/icons/polycode-icon-192.png?v=3',
  '/frontend/assets/icons/polycode-icon-512.png?v=3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET
  if (url.origin !== self.location.origin || req.method !== 'GET') return;

  // 1) NAVIGATION: NETWORK-FIRST (fixes "goes back to previous page")
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // try real navigation from network
          const fresh = await fetch(req);
          return fresh;
        } catch (err) {
          // offline fallback to app shell
          const cachedShell = await caches.match('/frontend/index.html');
          return cachedShell || Response.error();
        }
      })()
    );
    return;
  }

  // 2) STATIC ASSETS: STALE-WHILE-REVALIDATE
  const ASSET_RE = /\.(?:html|css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i;
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        const fetchPromise = fetch(req).then((net) => {
          if (net && net.status === 200) cache.put(req, net.clone());
          return net;
        }).catch(() => undefined);
        return cached || fetchPromise || Response.error();
      })()
    );
  }
});
