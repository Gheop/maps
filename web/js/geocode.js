// Géocodage avec cache mémoire : une même recherche n'interroge le réseau qu'une fois.
const cache = new Map();

export async function geocode(q) {
  const key = (q || '').trim().toLowerCase();
  if (!key) return [];
  if (cache.has(key)) return cache.get(key);
  const r = await fetch('/api/geocode?q=' + encodeURIComponent(q));
  if (!r.ok) return [];
  const a = await r.json();
  const result = Array.isArray(a) ? a : [];
  if (cache.size > 200) cache.clear();
  cache.set(key, result);
  return result;
}
