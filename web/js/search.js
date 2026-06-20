import { setView, fitBounds, addMarker } from './map.js';

export function initSearch({ input, button }) {
  let marker = null;
  async function go() {
    const q = input.value.trim();
    if (!q) return;
    button.classList.add('loading');
    try {
      const r = await fetch('/api/geocode?q=' + encodeURIComponent(q));
      if (!r.ok) return;
      const a = await r.json();
      if (!Array.isArray(a) || !a.length) return;
      const p = a[0];
      if (marker) marker.remove();
      marker = addMarker(+p.lat, +p.lon);
      if (Array.isArray(p.boundingbox) && p.boundingbox.length === 4) {
        const b = p.boundingbox.map(Number); // [south, north, west, east]
        fitBounds(b[0], b[2], b[1], b[3]);
      } else {
        setView(+p.lat, +p.lon, 14);
      }
    } finally {
      button.classList.remove('loading');
    }
  }
  button.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}
