// sw.js — navigation network-first; assets stale-while-revalidate
const CACHE = 'polycode-v6';
const CORE = [
  '/manifest.json',
  '/frontend/index.html',
  '/frontend/assets/icons/polycode-icon-192.png?v=2',
  '/frontend/assets/icons/polycode-icon-512.png?v=2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== 'GET') return;

  // Navigations: network-first (fixes “stuck on previous page”)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(req); }
      catch { return (await caches.match('/frontend/index.html')) || Response.error(); }
    })());
    return;
  }

  // Static assets: stale-while-revalidate
  const ASSET = /\.(?:html|css|js|png|jpg|jpeg|svg|webp|woff2?)$/i;
  if (ASSET.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const net = fetch(req).then(r => { if (r && r.status === 200) cache.put(req, r.clone()); return r; })
                            .catch(() => undefined);
      return cached || net || Response.error();
    })());
  }
});
