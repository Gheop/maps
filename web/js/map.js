import { TILE, lonToPx, latToPx, pxToLon, pxToLat, clamp } from './tilemath.js';
import { parseHash, formatHash } from './url.js';

const LAYERS = {
  plan: { url: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  sat: { url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, attr: 'Imagery © <a href="https://www.esri.com/">Esri</a>' },
  relief: { url: (x, y, z) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`, max: 17, attr: '© <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA), © OpenStreetMap' },
  toner: { url: (x, y, z) => `https://tiles.stadiamaps.com/tiles/stamen_toner/${z}/${x}/${y}.png`, max: 20, attr: '© <a href="https://stadiamaps.com/">Stadia Maps</a>, © Stamen, © OpenStreetMap' },
  aquarelle: { url: (x, y, z) => `https://tiles.stadiamaps.com/tiles/stamen_watercolor/${z}/${x}/${y}.jpg`, max: 16, attr: '© <a href="https://stadiamaps.com/">Stadia Maps</a>, © Stamen, © OpenStreetMap' },
};
const LADDER = ['10000 km', '5000 km', '2000 km', '2000 km', '1000 km', '500 km', '200 km', '100 km', '50 km', '20 km', '10 km', '5 km', '2 km', '1 km', '500 m', '250 m', '100 m', '50 m', '20 m', '10 m', '5 m'];

let mapEl, vbEl, ladderEl, attrEl, zoomBarEl, lmapEl, maskEl, canvas, ctx;
let zoom = 2, layerId = 'plan', zoomMax = 19;
let vpw = 0, vph = 0, tilesX = 0, tilesY = 0;
let routeCoords = null;
const markers = [];
let hashTimer = 0;
let staleTimer = 0;

export function initMap({ mapEl: m, vbEl: v, ladderEl: l, attrEl: a, zoomBarEl: zb, lmapEl: lm, maskEl: mk }) {
  mapEl = m; vbEl = v; ladderEl = l; attrEl = a; zoomBarEl = zb; lmapEl = lm; maskEl = mk;
  canvas = document.createElement('canvas');
  canvas.className = 'overlay';
  vbEl.appendChild(canvas);
  ctx = canvas.getContext('2d');
  buildZoomBar();
  bindMinimap();
  resize();
  window.addEventListener('resize', resize);
  bindPointer();
  bindWheel();
  bindKeys();
  if (attrEl) attrEl.innerHTML = LAYERS[layerId].attr;
  const h = parseHash(location.hash);
  if (h) setView(h.lat, h.lon, h.zoom);
  else setView(46.6, 1.88, 6);
}

function resize() {
  const c = (vpw && vph) ? getView() : null; // centre courant avant redimensionnement
  vpw = vbEl.clientWidth; vph = vbEl.clientHeight;
  tilesX = Math.ceil(vpw / TILE) + 1;
  tilesY = Math.ceil(vph / TILE) + 1;
  canvas.width = vpw; canvas.height = vph;
  if (c) { // re-ancre le centre (sans vider les tuiles, déjà valides au même zoom)
    mapEl.style.left = Math.round(vpw / 2 - lonToPx(c.lon, zoom)) + 'px';
    mapEl.style.top = Math.round(vph / 2 - latToPx(c.lat, zoom)) + 'px';
  }
  render();
}

function sizeWorld() {
  const s = TILE * 2 ** zoom;
  mapEl.style.width = mapEl.style.height = s + 'px';
}

function project(lat, lon) {
  return { x: lonToPx(lon, zoom) + mapEl.offsetLeft, y: latToPx(lat, zoom) + mapEl.offsetTop };
}

export function getView() {
  return {
    lat: pxToLat(vph / 2 - mapEl.offsetTop, zoom),
    lon: pxToLon(vpw / 2 - mapEl.offsetLeft, zoom),
    zoom,
  };
}

export function setView(lat, lon, z = zoom) {
  zoom = clamp(Math.round(z), 0, zoomMax);
  sizeWorld();
  mapEl.style.left = Math.round(vpw / 2 - lonToPx(lon, zoom)) + 'px';
  mapEl.style.top = Math.round(vph / 2 - latToPx(lat, zoom)) + 'px';
  clearTiles();
  render();
  updateLadder();
}

export function fitBounds(s, w, n, e) {
  let z = zoomMax;
  for (; z > 0; z--) {
    if (Math.abs(lonToPx(e, z) - lonToPx(w, z)) <= vpw && Math.abs(latToPx(s, z) - latToPx(n, z)) <= vph) break;
  }
  setView((s + n) / 2, (w + e) / 2, z);
}

// Applique le changement de zoom : charge les tuiles du nouveau niveau, en gardant
// les tuiles déjà chargées (du niveau de départ) mises à l'échelle en fond.
function commitZoom(z2, cx, cy) {
  z2 = clamp(z2, 0, zoomMax);
  if (z2 === zoom) { render(); return; }
  removeStale();
  const fromZoom = zoom;
  const f = 2 ** (z2 - zoom);
  const left = Math.round((mapEl.offsetLeft - cx) * f + cx);
  const top = Math.round((mapEl.offsetTop - cy) * f + cy);
  zoom = z2;
  sizeWorld();
  mapEl.style.left = left + 'px';
  mapEl.style.top = top + 'px';
  markStale(fromZoom);
  render();
  updateLadder();
}

// Zoom direct d'un cran (clavier, pinch) — un seul niveau, placeholder géré par commitZoom.
function zoomInstant(delta, cx = vpw / 2, cy = vph / 2) {
  commitZoom(zoom + delta, cx, cy);
}

// Zoom molette/trackpad : pendant la rafale on scale les tuiles en direct (transform,
// sans recharger), puis on charge le niveau final une seule fois (debounce).
let wheelTargetF = null, wheelOrigin = null, wheelTimer = 0;
function zoomWheel(deltaY, cx, cy) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (wheelTargetF === null) {
    wheelTargetF = zoom;
    wheelOrigin = { mx: cx - mapEl.offsetLeft, my: cy - mapEl.offsetTop };
    if (!reduce) mapEl.style.transformOrigin = wheelOrigin.mx + 'px ' + wheelOrigin.my + 'px';
  }
  wheelTargetF = clamp(wheelTargetF - deltaY * 0.01, 0, zoomMax);
  if (!reduce) mapEl.style.transform = `scale(${2 ** (wheelTargetF - zoom)})`;
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(commitWheel, 140);
}
function commitWheel() {
  const target = clamp(Math.round(wheelTargetF), 0, zoomMax);
  const cx = wheelOrigin.mx + mapEl.offsetLeft;
  const cy = wheelOrigin.my + mapEl.offsetTop;
  mapEl.style.transform = '';
  mapEl.style.transformOrigin = '';
  wheelTargetF = null; wheelOrigin = null;
  commitZoom(target, cx, cy);
}

function clearTiles() {
  for (const img of [...mapEl.querySelectorAll('img.tile')]) img.remove();
}

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

// Garde les tuiles chargées du niveau de départ, mises à l'échelle pour couvrir leur
// zone au nouveau zoom, comme fond sous les nouvelles tuiles qui se chargent.
function markStale(fromZoom) {
  for (const img of [...mapEl.querySelectorAll('img.tile')]) {
    const [tz, tx, ty] = img.id.slice(1).split('_').map(Number);
    if (tz !== fromZoom) continue;
    if (!img.classList.contains('loaded')) { img.remove(); continue; } // pas chargée → mauvais fond
    const g = 2 ** (zoom - tz);
    img.style.left = tx * TILE * g + 'px';
    img.style.top = ty * TILE * g + 'px';
    img.style.width = img.style.height = TILE * g + 'px';
    img.style.zIndex = '1';
    img.classList.add('stale');
  }
}

function removeStale() {
  clearTimeout(staleTimer);
  for (const img of [...mapEl.querySelectorAll('img.tile.stale')]) img.remove();
}

function render() {
  if (!mapEl) return;
  const n = 2 ** zoom;
  const x0 = Math.floor(-mapEl.offsetLeft / TILE) - 1;
  const y0 = Math.floor(-mapEl.offsetTop / TILE) - 1;
  const x1 = x0 + tilesX + 1, y1 = y0 + tilesY + 1;
  const frag = document.createDocumentFragment();
  let pending = 0;
  const done = () => { if (--pending <= 0) removeStale(); };
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const id = `t${zoom}_${x}_${y}`;
      if (document.getElementById(id)) continue;
      const img = new Image();
      img.id = id;
      img.className = 'tile';
      img.alt = '';
      img.decoding = 'async';
      img.style.left = x * TILE + 'px';
      img.style.top = y * TILE + 'px';
      img.style.zIndex = '2';
      pending++;
      img.addEventListener('load', () => { img.classList.add('loaded'); done(); });
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; done(); });
      img.src = LAYERS[layerId].url(x, y, zoom);
      frag.appendChild(img);
    }
  }
  mapEl.appendChild(frag);
  // élague les tuiles du zoom courant hors écran (laisse les placeholders 'stale')
  for (const img of [...mapEl.querySelectorAll('img.tile:not(.stale)')]) {
    const [tz, tx, ty] = img.id.slice(1).split('_').map(Number);
    if (tz === zoom && (tx < x0 || tx > x1 || ty < y0 || ty > y1)) img.remove();
  }
  if (pending === 0) removeStale();                              // tout était déjà en cache
  else { clearTimeout(staleTimer); staleTimer = setTimeout(removeStale, 1000); } // filet de sécurité
  for (const mk of markers) {
    mk.el.style.left = lonToPx(mk.lon, zoom) + 'px';
    mk.el.style.top = latToPx(mk.lat, zoom) + 'px';
  }
  drawOverlay();
  updateZoomBar();
  drawMask();
  scheduleHash();
}

function drawOverlay() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (routeCoords && routeCoords.length) {
    ctx.beginPath();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 4;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.globalAlpha = 0.75;
    routeCoords.forEach(([lon, lat], i) => {
      const p = project(lat, lon);
      if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export function setRoute(coords) { routeCoords = coords; drawOverlay(); }
export function clearRoute() { routeCoords = null; drawOverlay(); }

export function addMarker(lat, lon) {
  const el = document.createElement('div');
  el.className = 'marker';
  el.style.left = lonToPx(lon, zoom) + 'px';
  el.style.top = latToPx(lat, zoom) + 'px';
  mapEl.appendChild(el);
  const mk = { lat, lon, el, remove() { el.remove(); const i = markers.indexOf(mk); if (i >= 0) markers.splice(i, 1); } };
  markers.push(mk);
  return mk;
}

export function setLayer(id) {
  if (!LAYERS[id]) return;
  layerId = id;
  zoomMax = LAYERS[id].max;
  if (zoom > zoomMax) zoom = zoomMax;
  sizeWorld();
  clearTiles();
  render();
  updateLadder();
  if (attrEl) attrEl.innerHTML = LAYERS[id].attr;
}

function updateLadder() { if (ladderEl) ladderEl.textContent = LADDER[zoom] || ''; }

// --- Échelle de zoom en pyramide (cliquable) ---
function buildZoomBar() {
  if (!zoomBarEl) return;
  zoomBarEl.textContent = '';
  for (let z = 20; z >= 0; z--) {
    const d = document.createElement('div');
    d.className = 'pz';
    d.style.top = (20 - z) * 9 + 'px';
    d.style.width = (z + 2) + 'px';
    d.dataset.z = String(z);
    d.title = 'zoom ' + z;
    d.addEventListener('click', () => { const v = getView(); setView(v.lat, v.lon, z); });
    zoomBarEl.appendChild(d);
  }
}
function updateZoomBar() {
  if (!zoomBarEl) return;
  for (const d of zoomBarEl.children) {
    const z = +d.dataset.z;
    d.style.display = z <= zoomMax ? 'block' : 'none';
    d.style.opacity = z <= zoom ? '1' : '.4';
  }
}

// --- Minimap (vue d'ensemble + rectangle de cadrage) ---
function bindMinimap() {
  if (!lmapEl) return;
  lmapEl.addEventListener('click', (e) => {
    const r = lmapEl.getBoundingClientRect();
    const Z = lmapEl.clientWidth / (TILE * 2 ** zoom);
    setView(pxToLat((e.clientY - r.top) / Z, zoom), pxToLon((e.clientX - r.left) / Z, zoom), zoom);
  });
}
function drawMask() {
  if (!maskEl || !lmapEl) return;
  const Z = lmapEl.clientWidth / (TILE * 2 ** zoom);
  maskEl.style.left = (-mapEl.offsetLeft * Z) + 'px';
  maskEl.style.top = (-mapEl.offsetTop * Z) + 'px';
  maskEl.style.width = (vpw * Z) + 'px';
  maskEl.style.height = (vph * Z) + 'px';
}

function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const v = getView();
    history.replaceState(null, '', formatHash(v.zoom, v.lat, v.lon));
  }, 300);
}

function pan(dx, dy) {
  mapEl.style.left = mapEl.offsetLeft + dx + 'px';
  mapEl.style.top = mapEl.offsetTop + dy + 'px';
  scheduleRender();
}

function twoDist(p) { const [a, b] = [...p.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
function twoMid(p) { const [a, b] = [...p.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function bindPointer() {
  const pts = new Map();
  let startL = 0, startT = 0, sx = 0, sy = 0, pinch = 0;
  vbEl.addEventListener('pointerdown', (e) => {
    vbEl.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { sx = e.clientX; sy = e.clientY; startL = mapEl.offsetLeft; startT = mapEl.offsetTop; }
    else if (pts.size === 2) pinch = twoDist(pts);
  });
  vbEl.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2) {
      const d = twoDist(pts);
      if (pinch && Math.abs(Math.log2(d / pinch)) >= 1) {
        const m = twoMid(pts), r = vbEl.getBoundingClientRect();
        zoomInstant(d > pinch ? 1 : -1, m.x - r.left, m.y - r.top);
        pinch = d;
      }
      return;
    }
    mapEl.style.left = startL + (e.clientX - sx) + 'px';
    mapEl.style.top = startT + (e.clientY - sy) + 'px';
    scheduleRender();
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size === 1) { const p = [...pts.values()][0]; sx = p.x; sy = p.y; startL = mapEl.offsetLeft; startT = mapEl.offsetTop; pinch = 0; }
  };
  vbEl.addEventListener('pointerup', end);
  vbEl.addEventListener('pointercancel', end);
  vbEl.addEventListener('dragstart', (e) => e.preventDefault());
}

function bindWheel() {
  vbEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vbEl.getBoundingClientRect();
    zoomWheel(e.deltaY, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    switch (e.key) {
      case '+': case '=': zoomInstant(1); break;
      case '-': zoomInstant(-1); break;
      case 'ArrowLeft': pan(100, 0); break;
      case 'ArrowRight': pan(-100, 0); break;
      case 'ArrowUp': pan(0, 100); break;
      case 'ArrowDown': pan(0, -100); break;
      default: return;
    }
    e.preventDefault();
  });
}
