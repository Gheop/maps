// Service Worker : tuiles en cache-first (revisites instantanées), app shell en
// network-first (toujours frais en ligne, servi du cache hors-ligne). L'API passe
// toujours au réseau. Aucun risque de servir une app périmée en ligne.
const VERSION = 'v1';
const TILE_CACHE = `tiles-${VERSION}`;
const SHELL_CACHE = `shell-${VERSION}`;
const KEEP = new Set([TILE_CACHE, SHELL_CACHE]);
const TILE_HOSTS = new Set([
  'tile.openstreetmap.org',
  'server.arcgisonline.com',
  'tile.opentopomap.org',
  'tiles.stadiamaps.com',
]);
const MAX_TILES = 500;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (!KEEP.has(k)) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (TILE_HOSTS.has(url.host)) { e.respondWith(cacheFirst(req)); return; }
  if (url.origin === self.location.origin && url.pathname !== '/sw.js' && !url.pathname.startsWith('/api/')) {
    e.respondWith(networkFirst(req)); // app shell : frais en ligne, dispo hors-ligne
  }
});

// Tuiles : sert le cache si présent, sinon réseau puis cache (immuables).
async function cacheFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  let res;
  try { res = await fetch(req); } catch { return Response.error(); }
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone()).then(() => trim(cache)).catch(() => {});
  }
  return res;
}

// App shell : réseau d'abord (toujours à jour), repli sur le cache hors-ligne.
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    return (await cache.match(req)) || Response.error();
  }
}

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  } finally { trimming = false; }
}
