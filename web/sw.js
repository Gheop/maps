// Service Worker : cache les tuiles (cache-first) -> revisites instantanées + hors-ligne.
// N'intercepte QUE les hôtes de tuiles ; l'app (HTML/JS/CSS) et l'API passent au réseau,
// donc aucun risque de servir une version périmée après déploiement.
const VERSION = 'v1';
const TILE_CACHE = `tiles-${VERSION}`;
const TILE_HOSTS = new Set([
  'tile.openstreetmap.org',
  'server.arcgisonline.com',
  'tile.opentopomap.org',
  'tiles.stadiamaps.com',
]);
const MAX_TILES = 500;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) {
    if (k.startsWith('tiles-') && k !== TILE_CACHE) await caches.delete(k);
  }
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let host;
  try { host = new URL(req.url).host; } catch { return; }
  if (!TILE_HOSTS.has(host)) return; // app shell + API : réseau direct
  e.respondWith(cacheFirst(req));
});

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

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  } finally { trimming = false; }
}
