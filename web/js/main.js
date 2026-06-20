import { initMap, setLayer, getLayer, clearRoute } from './map.js';
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
const curThumb = $('layers-current-thumb');
const layersList = $('layers-list');
const openLayers = (open) => { layersEl.classList.toggle('open', open); layersList.hidden = !open; };
function syncLayerUI(id) { // reflète le calque courant (peut venir de l'URL) sur le bouton + masque son entrée dans la liste
  const btn = layersList.querySelector(`button[data-layer="${id}"]`);
  if (!btn) return;
  curName.textContent = btn.querySelector('.name').textContent;
  curThumb.dataset.layer = id;
  layersList.querySelectorAll('button[data-layer]').forEach((x) => { x.hidden = x.dataset.layer === id; });
}
$('layers-current').addEventListener('click', () => openLayers(layersList.hidden));
layersList.querySelectorAll('button[data-layer]').forEach((b) => {
  b.addEventListener('click', () => {
    setLayer(b.dataset.layer);
    syncLayerUI(b.dataset.layer);
    openLayers(false);
  });
});
syncLayerUI(getLayer()); // état initial : calque éventuellement lu depuis le hash
document.addEventListener('click', (e) => { if (!layersEl.contains(e.target)) openLayers(false); }); // referme au clic ailleurs

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
