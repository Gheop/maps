import { setView, fitBounds, addMarker, getView } from './map.js';
import { geocode } from './geocode.js';

let marker = null;

// Géocode une requête et recentre la carte (marqueur sur le 1er résultat).
export async function searchPlace(q) {
  if (!q) return;
  const c = getView();
  const a = await geocode(q, c.lat, c.lon); // biais vers la zone affichée
  if (!a.length) return;
  const p = a[0];
  if (marker) marker.remove();
  marker = addMarker(+p.lat, +p.lon);
  if (Array.isArray(p.boundingbox) && p.boundingbox.length === 4) {
    const b = p.boundingbox.map(Number); // [sud, nord, ouest, est]
    fitBounds(b[0], b[2], b[1], b[3]);
  } else {
    setView(+p.lat, +p.lon, 14);
  }
}
