import { initMap, setLayer, clearRoute } from './map.js';
import { searchPlace } from './search.js';
import { computeRoute } from './route.js';
import { initGeo } from './geo.js';

const $ = (id) => document.getElementById(id);

initMap({
  mapEl: $('map'), vbEl: $('viewbox'), ladderEl: $('ladder'), attrEl: $('attribution'),
  zoomBarEl: $('zoombar'), lmapEl: $('lmap'), maskEl: $('mask_lmap'),
});

// Couches
document.querySelectorAll('[data-layer]').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-layer]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    setLayer(b.dataset.layer);
  });
});

// Recherche / itinéraire (champ recherche = départ en mode itinéraire)
const s = $('s'), bs = $('bs'), arr = $('arr');
const routeRow = $('route-row'), routeToggle = $('route-toggle'), swap = $('swap'), out = $('route-out');
let routeMode = false;

function setRouteMode(on) {
  routeMode = on;
  routeRow.hidden = !on;
  routeToggle.classList.toggle('active', on);
  s.placeholder = on ? 'Départ' : 'Rechercher un lieu…';
  if (on) { arr.focus(); } else { clearRoute(); out.textContent = ''; }
}

async function go() {
  bs.classList.add('loading');
  try {
    if (routeMode) await computeRoute(s.value.trim(), arr.value.trim(), out);
    else await searchPlace(s.value.trim());
  } finally {
    bs.classList.remove('loading');
  }
}

routeToggle.addEventListener('click', () => setRouteMode(!routeMode));
swap.addEventListener('click', () => {
  [s.value, arr.value] = [arr.value, s.value];
  if (routeMode) go();
});
bs.addEventListener('click', go);
for (const inp of [s, arr]) {
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

initGeo($('geo-btn'));
