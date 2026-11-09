/* Kaartkluis — offline: app zelf, kaartdata en afbeeldingen worden op het toestel bewaard */
const VERSION = 'kk-v5';
const KEEP = [VERSION + '-shell', 'kk-data', 'kk-img', 'kk-lib'];
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'scanner.js', 'sync.js', 'details.js', 'pokedex.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION + '-shell').then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await fresh) || Response.error();
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.tcgdex.net') return e.respondWith(staleWhileRevalidate(req, 'kk-data'));
  if (url.hostname === 'assets.tcgdex.net') return e.respondWith(cacheFirst(req, 'kk-img'));
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') return e.respondWith(cacheFirst(req, 'kk-lib'));
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) return e.respondWith(cacheFirst(req, 'kk-lib'));
  if (url.hostname === 'pokeapi.co') return e.respondWith(staleWhileRevalidate(req, 'kk-data'));
  if (url.hostname === 'raw.githubusercontent.com') return e.respondWith(cacheFirst(req, 'kk-img'));
  if (url.origin === self.location.origin) return e.respondWith(networkFirst(req, VERSION + '-shell'));
});
