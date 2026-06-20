import { setRoute, fitBounds } from './map.js';

async function geocodeOne(q) {
  if (!q) return null;
  const r = await fetch('/api/geocode?q=' + encodeURIComponent(q));
  if (!r.ok) return null;
  const a = await r.json();
  return Array.isArray(a) && a.length ? { lat: +a[0].lat, lon: +a[0].lon } : null;
}

export function initRoute({ fromInput, toInput, button, output }) {
  async function go() {
    output.textContent = '…';
    const f = await geocodeOne(fromInput.value.trim());
    const t = await geocodeOne(toInput.value.trim());
    if (!f || !t) { output.textContent = 'Lieu introuvable'; return; }
    const r = await fetch(`/api/route?from=${f.lat},${f.lon}&to=${t.lat},${t.lon}`);
    if (!r.ok) { output.textContent = 'Itinéraire indisponible'; return; }
    const data = await r.json();
    const route = data.routes && data.routes[0];
    if (!route || !route.geometry) { output.textContent = 'Aucun itinéraire'; return; }
    setRoute(route.geometry.coordinates);
    output.textContent = `${(route.distance / 1000).toFixed(1)} km · ${Math.round(route.duration / 60)} min`;
    fitBounds(Math.min(f.lat, t.lat), Math.min(f.lon, t.lon), Math.max(f.lat, t.lat), Math.max(f.lon, t.lon));
  }
  button.addEventListener('click', go);
}
