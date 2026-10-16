// Offline shell. Static files are network-first with a cache fallback, so a new
// deploy shows up on the next load and the HTML never runs against stale code.
// /api responses are never cached here: scores must not be stale.
const CACHE = 'blaze-shell-v2';
const SHELL = ['/', '/styles.css', '/app.js', '/theme.js', '/lib/service.js', '/lib/predict.js', '/lib/demo.js', '/lib/format.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    try {
      const fresh = await fetch(e.request);
      if (fresh.ok) c.put(e.request, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === 'navigate') return c.match('/');
      throw err;
    }
  }));
});
