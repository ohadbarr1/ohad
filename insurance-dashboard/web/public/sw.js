/* fox service worker. The shell opens offline and instantly on a return visit; data shows the last copy at once and refreshes behind it.
   Pages: network first (revalidated, 3 s timeout), the cached shell when offline or slow. /data: network first, the cached copy when offline.
   /assets (hashed, immutable): cache first.
   Cache contract: an HTML response is only ever stored as the shell ('/'); a JS/CSS/JSON request never stores (or serves from cache)
   an HTML body. A missing hashed asset is a 404 from the server (firebase.json rewrites extensionless paths only), so a stale lazy chunk
   fails loudly and the app reloads once (vite:preloadError, src/lib/reload.ts) instead of executing the HTML shell as script.
   To switch it off for every visitor, deploy a sw.js whose install step calls self.registration.unregister(). */
const SHELL = 'fox-shell-v2', ASSETS = 'fox-assets-v2', DATA = 'fox-data-v2';  // v2: drops v1 caches that may hold HTML under asset keys
const KEEP = [SHELL, ASSETS, DATA];
const NAV_TIMEOUT = 3000;

const isHtml = (r) => (r.headers.get('content-type') || '').includes('text/html');
/** a response that may be stored for a non-navigation request: a 200 that is not the HTML shell standing in for a file */
const storable = (r) => r.ok && r.type === 'basic' && !isHtml(r);

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

function navigate(req) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
    fetch(req, { cache: 'no-cache' }).then((r) => {
      if (r.ok && isHtml(r)) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); }
      finish(r);
    }, () => caches.match('/').then((hit) => finish(hit || Response.error())));
    // over 3 s: the cached shell (if there is one; otherwise keep waiting for the network)
    setTimeout(() => caches.match('/').then(finish), NAV_TIMEOUT);
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(navigate(req)); return; }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(ASSETS).then((c) => c.match(req).then((hit) => (hit && !isHtml(hit) ? hit : fetch(req).then((r) => {
      if (storable(r)) { c.put(req, r.clone()); return r; }
      // never hand the HTML shell to a script/style/font request: a clean 404 lets the importer fail and the app reload once
      return isHtml(r) ? new Response('', { status: 404, statusText: 'Not Found' }) : r;
    })))));
    return;
  }
  if (url.pathname.startsWith('/data/')) {
    // figures are network first: a new release never shows last week's numbers; the cached copy serves only when offline
    e.respondWith(caches.open(DATA).then((c) => fetch(req).then((r) => { if (storable(r)) c.put(req, r.clone()); return r; })
      .catch(() => c.match(req).then((hit) => (hit && !isHtml(hit) ? hit : Response.error())))));
  }
});
