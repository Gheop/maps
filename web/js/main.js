import { initMap, setLayer, getLayer, clearRoute, getView } from './map.js';
import { searchPlace, showPlace } from './search.js';
import { computeRoute } from './route.js';
import { initGeo } from './geo.js';
import { attachAutocomplete } from './autocomplete.js';

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

// Autocomplete (Photon) : suggestions à la frappe, biaisées vers la zone affichée.
const bias = () => { const c = getView(); return { lat: c.lat, lon: c.lon }; };
attachAutocomplete(s, {
  anchor: searchBox,
  getBias: bias,
  onPick: (r) => { if (routeMode) { if (arr.value.trim()) go(); } else { showPlace(r); } },
});
attachAutocomplete(arr, {
  anchor: routeRow,
  getBias: bias,
  onPick: () => { if (s.value.trim()) go(); },
});

initGeo($('geo-btn'));

// Partager : lien natif sur mobile, sinon copie dans le presse-papier + toast
const shareBtn = $('share-btn'), toast = $('toast');
let toastTimer = 0;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}
// En mode itinéraire avec deux lieux, on partage le trajet (?from=&to=) ; sinon la vue (hash).
function shareUrl() {
  if (routeMode && s.value.trim() && arr.value.trim()) {
    return location.origin + '/?from=' + encodeURIComponent(s.value.trim()) + '&to=' + encodeURIComponent(arr.value.trim()) + location.hash;
  }
  return location.href;
}
shareBtn.addEventListener('click', async () => {
  const url = shareUrl();
  const isRoute = routeMode && s.value.trim() && arr.value.trim();
  if (navigator.share) {
    try { await navigator.share({ title: 'Gheop Maps', url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); showToast(isRoute ? 'Lien de l’itinéraire copié' : 'Lien copié'); }
  catch { showToast(url); }
});

// Ouverture d'un lien d'itinéraire partagé : ?from=...&to=...
const routeParams = new URLSearchParams(location.search);
const qFrom = routeParams.get('from'), qTo = routeParams.get('to');
if (qFrom && qTo) {
  searchBox.classList.remove('collapsed');
  setRouteMode(true);
  s.value = qFrom; arr.value = qTo;
  go();
}

// Service Worker : cache des tuiles (revisites instantanées + hors-ligne)
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
