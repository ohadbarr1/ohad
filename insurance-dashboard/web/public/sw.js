/* fox service worker. The shell opens offline and instantly on a return visit; data shows the last copy at once and refreshes behind it.
   Pages and /data: network first, the cached copy when offline. /assets (hashed, immutable): cache first.
   To switch it off for every visitor, deploy a sw.js whose install step calls self.registration.unregister(). */
const SHELL = 'fox-shell-v1', ASSETS = 'fox-assets-v1', DATA = 'fox-data-v2';
const KEEP = [SHELL, ASSETS, DATA];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); return r; }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(ASSETS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  if (url.pathname.startsWith('/data/')) {
    // figures are network first: a new release never shows last week's numbers; the cached copy serves only when offline
    e.respondWith(caches.open(DATA).then((c) => fetch(req).then((r) => { if (r.ok && !(r.headers.get('content-type') || '').includes('text/html')) c.put(req, r.clone()); return r; }).catch(() => c.match(req).then((hit) => hit || Response.error()))));
  }
});
