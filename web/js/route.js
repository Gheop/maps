import { setRoute, clearRoute, fitBounds } from './map.js';
import { geocode } from './geocode.js';

async function geocodeOne(q) {
  const a = await geocode(q);
  return a.length ? { lat: +a[0].lat, lon: +a[0].lon } : null;
}

// Géocode départ + arrivée, calcule l'itinéraire OSRM, le trace et écrit dist/durée.
export async function computeRoute(fromQ, toQ, output) {
  if (!fromQ || !toQ) { clearRoute(); output.textContent = ''; return; }
  output.textContent = '…';
  const f = await geocodeOne(fromQ);
  const t = await geocodeOne(toQ);
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
