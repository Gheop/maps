import { initMap, setLayer, clearRoute } from './map.js';
import { searchPlace } from './search.js';
import { computeRoute } from './route.js';
import { initGeo } from './geo.js';

const $ = (id) => document.getElementById(id);

initMap({
  mapEl: $('map'), vbEl: $('viewbox'), ladderEl: $('ladder'), attrEl: $('attribution'),
  zoomBarEl: $('zoombar'), lmapEl: $('lmap'), maskEl: $('mask_lmap'),
});

// Sélecteur de calques repliable (bouton courant + flèche -> liste des autres)
const layersEl = $('layers');
const curName = $('layers-current-name');
const layersList = $('layers-list');
const openLayers = (open) => { layersEl.classList.toggle('open', open); layersList.hidden = !open; };
$('layers-current').addEventListener('click', () => openLayers(layersList.hidden));
layersList.querySelectorAll('[data-layer]').forEach((b) => {
  b.addEventListener('click', () => {
    setLayer(b.dataset.layer);
    curName.textContent = b.textContent;
    layersList.querySelectorAll('[data-layer]').forEach((x) => { x.hidden = x.dataset.layer === b.dataset.layer; });
    openLayers(false);
  });
});
layersList.querySelector('[data-layer="plan"]').hidden = true; // calque courant masqué dans la liste

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

const searchBox = $('search-box');
routeToggle.addEventListener('click', () => setRouteMode(!routeMode));
swap.addEventListener('click', () => {
  [s.value, arr.value] = [arr.value, s.value];
  if (routeMode) go();
});
// 1er clic sur la loupe (repliée) : déplie la barre ; ensuite : recherche/calcul
bs.addEventListener('click', () => {
  if (searchBox.classList.contains('collapsed')) { searchBox.classList.remove('collapsed'); s.focus(); return; }
  go();
});
s.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); go(); }
  else if (e.key === 'Escape' && !s.value) { if (routeMode) setRouteMode(false); searchBox.classList.add('collapsed'); s.blur(); }
});
arr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });

initGeo($('geo-btn'));
