import { TILE, lonToPx, latToPx, pxToLon, pxToLat, clamp } from './tilemath.js';
import { parseHash, formatHash } from './url.js';

const LAYERS = {
  plan: { url: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  sat: { url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, attr: 'Imagery © <a href="https://www.esri.com/">Esri</a>' },
  relief: { url: (x, y, z) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`, max: 17, attr: '© <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA), © OpenStreetMap' },
  toner: { url: (x, y, z) => `https://tiles.stadiamaps.com/tiles/stamen_toner/${z}/${x}/${y}.png`, max: 20, attr: '© <a href="https://stadiamaps.com/">Stadia Maps</a>, © Stamen, © OpenStreetMap' },
  aquarelle: { url: (x, y, z) => `https://tiles.stadiamaps.com/tiles/stamen_watercolor/${z}/${x}/${y}.jpg`, max: 15, attr: '© <a href="https://stadiamaps.com/">Stadia Maps</a>, © Stamen, © OpenStreetMap' },
};
const LADDER = ['10000 km', '5000 km', '2000 km', '2000 km', '1000 km', '500 km', '200 km', '100 km', '50 km', '20 km', '10 km', '5 km', '2 km', '1 km', '500 m', '250 m', '100 m', '50 m', '20 m', '10 m', '5 m'];
const BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; // 1x1 transparent

let mapEl, vbEl, ladderEl, attrEl, zoomBarEl, lmapEl, maskEl, lmapTilesEl, canvas, ctx;
let lmapSig = '';
const MINI_DZ = 4; // la minimap montre la zone 4 niveaux en dessous (rectangle visible)
const PAN_COMMIT = 220; // déplacement (px) au-delà duquel on refait les tuiles (< 256 = marge d'une tuile)
const reduceMotionMQ = matchMedia('(prefers-reduced-motion: reduce)');
let zoom = 2, layerId = 'plan', zoomMax = 19;
let cx = 0, cy = 0; // pixel-monde du CENTRE du viewport au zoom courant (petit modèle, sans div géant)
let vpw = 0, vph = 0, lmapW = 0, lmapH = 0;
let dragDX = 0, dragDY = 0, panRaf = 0; // déplacement en cours : translate du conteneur, pas de re-tuilage
let routeCoords = null;
const markers = [];
let hashTimer = 0, staleTimer = 0, rafPending = false;

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
  const h = parseHash(location.hash);
  if (h && h.layer && LAYERS[h.layer]) { layerId = h.layer; zoomMax = LAYERS[h.layer].max; buildZoomBar(); }
  if (attrEl) attrEl.innerHTML = LAYERS[layerId].attr;
  if (h) setView(h.lat, h.lon, h.zoom);
  else setView(46.6, 1.88, 6);
}

function resize() {
  const c = vpw && vph ? getView() : null;
  vpw = vbEl.clientWidth; vph = vbEl.clientHeight;
  if (lmapEl) { lmapW = lmapEl.clientWidth; lmapH = lmapEl.clientHeight; } // mis en cache : plus de reflow par frame
  mapEl.style.width = vpw + 'px';
  mapEl.style.height = vph + 'px';
  canvas.width = vpw; canvas.height = vph;
  if (c) { cx = lonToPx(c.lon, zoom); cy = latToPx(c.lat, zoom); }
  render();
}

function project(lat, lon) {
  return { x: lonToPx(lon, zoom) - (cx - vpw / 2), y: latToPx(lat, zoom) - (cy - vph / 2) };
}
function unproject(sx, sy) {
  return { lat: pxToLat(sy - vph / 2 + cy, zoom), lon: pxToLon(sx - vpw / 2 + cx, zoom) };
}

export function getView() {
  return { lat: pxToLat(cy, zoom), lon: pxToLon(cx, zoom), zoom };
}

export function setView(lat, lon, z = zoom) {
  zoom = clamp(Math.round(z), 0, zoomMax);
  cx = lonToPx(lon, zoom);
  cy = latToPx(lat, zoom);
  clearTiles();
  render();
  updateLadder();
  updateZoomBar();
}

export function fitBounds(s, w, n, e) {
  let z = zoomMax;
  for (; z > 0; z--) {
    if (Math.abs(lonToPx(e, z) - lonToPx(w, z)) <= vpw && Math.abs(latToPx(s, z) - latToPx(n, z)) <= vph) break;
  }
  setView((s + n) / 2, (w + e) / 2, z);
}

// Change de zoom en gardant fixe le point géographique sous (sx, sy) écran.
function commitZoom(z2, sx = vpw / 2, sy = vph / 2) {
  z2 = clamp(z2, 0, zoomMax);
  if (z2 === zoom) { render(); return; }
  removeStale();
  const fromZoom = zoom;
  const lon = pxToLon(sx - vpw / 2 + cx, zoom);
  const lat = pxToLat(sy - vph / 2 + cy, zoom);
  zoom = z2;
  cx = lonToPx(lon, zoom) - (sx - vpw / 2);
  cy = latToPx(lat, zoom) - (sy - vph / 2);
  markStale(fromZoom);
  render();
  updateLadder();
  updateZoomBar();
}

// Zoom direct d'un cran (clavier, pinch).
function zoomInstant(delta, sx = vpw / 2, sy = vph / 2) { commitZoom(zoom + delta, sx, sy); }

// Zoom molette/trackpad : scale en direct (transform) pendant la rafale, une seule
// recharge de tuiles au repos (debounce) -> fluide même en enchaînant les crans.
let wheelTargetF = null, wheelAnchor = null, wheelTimer = 0;
function zoomWheel(deltaY, sx, sy) {
  const reduce = reduceMotionMQ.matches;
  if (wheelTargetF === null) {
    wheelTargetF = zoom;
    wheelAnchor = { sx, sy };
    if (!reduce) mapEl.style.transformOrigin = sx + 'px ' + sy + 'px';
  }
  const prev = Math.round(wheelTargetF);
  wheelTargetF = clamp(wheelTargetF - deltaY * 0.01, 0, zoomMax);
  const tgt = Math.round(wheelTargetF);
  if (tgt !== prev) prefetch(tgt); // les tuiles du niveau visé chargent pendant le scroll
  if (!reduce) mapEl.style.transform = `scale(${2 ** (wheelTargetF - zoom)})`;
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(commitWheel, 90);
}
function commitWheel() {
  const target = clamp(Math.round(wheelTargetF), 0, zoomMax);
  const a = wheelAnchor;
  mapEl.style.transform = '';
  mapEl.style.transformOrigin = '';
  wheelTargetF = null; wheelAnchor = null;
  commitZoom(target, a.sx, a.sy);
}

function clearTiles() {
  for (const img of [...mapEl.querySelectorAll('img.tile')]) img.remove();
}

function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

// --- Déplacement : on translate le conteneur (compositeur GPU), aucun travail JS par frame.
// On ne refait les tuiles (render) que lorsque le déplacement dépasse une marge.
function applyDragTransform() {
  const t = `translate3d(${dragDX}px,${dragDY}px,0)`;
  mapEl.style.transform = t;
  if (canvas) canvas.style.transform = t;
}
function commitPan() {
  if (!dragDX && !dragDY) { mapEl.style.transform = ''; if (canvas) canvas.style.transform = ''; return; }
  cx -= dragDX; cy -= dragDY;
  dragDX = dragDY = 0;
  mapEl.style.transform = ''; if (canvas) canvas.style.transform = '';
  render();
}
function panFrame() {
  panRaf = 0;
  if (Math.abs(dragDX) >= PAN_COMMIT || Math.abs(dragDY) >= PAN_COMMIT) commitPan();
  else applyDragTransform();
}

// Précharge (cache navigateur) les tuiles du niveau visé pendant le geste de zoom,
// pour qu'elles soient déjà là quand on s'arrête -> tuiles nettes quasi instantanées.
const prefetched = new Set();
function prefetch(z) {
  z = clamp(Math.round(z), 0, zoomMax);
  const n = 2 ** z;
  const lon = pxToLon(cx, zoom), lat = pxToLat(cy, zoom);
  const ox = lonToPx(lon, z) - vpw / 2, oy = latToPx(lat, z) - vph / 2;
  const x0 = Math.floor(ox / TILE), y0 = Math.floor(oy / TILE);
  const x1 = Math.floor((ox + vpw) / TILE), y1 = Math.floor((oy + vph) / TILE);
  if (prefetched.size > 800) prefetched.clear();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const key = `${layerId}:${z}/${x}/${y}`;
      if (prefetched.has(key)) continue;
      prefetched.add(key);
      const im = new Image(); im.decoding = 'async'; im.src = LAYERS[layerId].url(x, y, z);
    }
  }
}

// Garde les tuiles chargées du niveau de départ, mises à l'échelle en fond.
function markStale(fromZoom) {
  const ox = cx - vpw / 2, oy = cy - vph / 2;
  for (const img of [...mapEl.querySelectorAll('img.tile')]) {
    const [tz, tx, ty] = img.id.slice(1).split('_').map(Number);
    if (tz !== fromZoom) continue;
    if (!img.classList.contains('loaded')) { img.remove(); continue; }
    const g = 2 ** (zoom - tz);
    img.style.left = (tx * TILE * g - ox) + 'px';
    img.style.top = (ty * TILE * g - oy) + 'px';
    img.style.width = img.style.height = (TILE * g) + 'px';
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
  const ox = cx - vpw / 2, oy = cy - vph / 2; // pixel-monde du coin haut-gauche
  const x0 = Math.floor(ox / TILE) - 1, y0 = Math.floor(oy / TILE) - 1;
  const x1 = Math.floor((ox + vpw) / TILE) + 1, y1 = Math.floor((oy + vph) / TILE) + 1;
  const need = new Set();
  let pending = 0;
  const done = () => { if (--pending <= 0) removeStale(); };
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const id = `t${zoom}_${x}_${y}`;
      need.add(id);
      let img = document.getElementById(id);
      if (!img) {
        img = new Image();
        img.id = id;
        img.className = 'tile';
        img.alt = '';
        img.decoding = 'async';
        img.style.zIndex = '2';
        const url = LAYERS[layerId].url(x, y, zoom);
        let tries = 0, settled = false, fb = false;
        const finish = () => { if (!settled) { settled = true; done(); } };
        pending++;
        img.addEventListener('load', () => {
          if (img.src.startsWith('data:')) return; // pixel transparent du fallback, pas la vraie tuile
          img.classList.add('loaded');
          img.classList.remove('fallback');
          img.style.backgroundImage = '';
          finish();
        });
        img.addEventListener('error', () => {
          // comble le trou tout de suite avec la tuile parent (zoom-1) mise à l'échelle
          // (fond CSS, requête async qui ne bloque pas les autres tuiles)
          if (zoom > 0 && !fb) {
            fb = true;
            img.classList.add('fallback');
            img.style.backgroundImage = `url("${LAYERS[layerId].url(x >> 1, y >> 1, zoom - 1)}")`;
            img.style.backgroundSize = '200% 200%';
            img.style.backgroundPosition = `${(x & 1) * 100}% ${(y & 1) * 100}%`;
            img.style.backgroundRepeat = 'no-repeat';
          }
          img.src = BLANK_PX; // pixel transparent : <img> valide, donc pas de bordure "image cassée"
          finish();
          // réessaie la vraie tuile en tâche de fond (récupère un throttle transitoire)
          if (++tries <= 2) setTimeout(() => { if (img.isConnected) img.src = url; }, 700 * tries);
        });
        img.src = url;
        mapEl.appendChild(img);
      }
      img.style.left = (x * TILE - ox) + 'px';
      img.style.top = (y * TILE - oy) + 'px';
    }
  }
  for (const img of [...mapEl.querySelectorAll('img.tile:not(.stale)')]) {
    if (!need.has(img.id)) img.remove();
  }
  if (pending === 0) removeStale();
  else { clearTimeout(staleTimer); staleTimer = setTimeout(removeStale, 1000); }
  for (const mk of markers) {
    const p = project(mk.lat, mk.lon);
    mk.el.style.left = p.x + 'px';
    mk.el.style.top = p.y + 'px';
  }
  drawOverlay();
  updateMinimap();
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
  mapEl.appendChild(el);
  const mk = { lat, lon, el, remove() { el.remove(); const i = markers.indexOf(mk); if (i >= 0) markers.splice(i, 1); } };
  const p = project(lat, lon);
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  markers.push(mk);
  return mk;
}

export function setLayer(id) {
  if (!LAYERS[id]) return;
  layerId = id;
  zoomMax = LAYERS[id].max;
  buildZoomBar();
  if (zoom > zoomMax) { const c = getView(); zoom = zoomMax; cx = lonToPx(c.lon, zoom); cy = latToPx(c.lat, zoom); }
  clearTiles();
  render();
  updateLadder();
  updateZoomBar();
  if (attrEl) attrEl.innerHTML = LAYERS[id].attr;
  scheduleHash(); // garde le calque dans l'URL (rafraîchissement + partage)
}

export function getLayer() { return layerId; }

function updateLadder() { if (ladderEl) ladderEl.textContent = LADDER[zoom] || ''; }

// --- Échelle de zoom en pyramide (cliquable) ---
function buildZoomBar() {
  if (!zoomBarEl) return;
  zoomBarEl.textContent = '';
  for (let z = zoomMax; z >= 0; z--) { // sommet = max de la couche (pas de créneau vide en haut)
    const d = document.createElement('div');
    d.className = 'pz';
    d.style.top = (zoomMax - z) * 9 + 'px';
    d.style.width = (z + 2) + 'px';
    d.dataset.z = String(z);
    d.title = 'zoom ' + z;
    d.addEventListener('click', () => commitZoom(z));
    zoomBarEl.appendChild(d);
  }
}
function updateZoomBar() {
  if (!zoomBarEl) return;
  for (const d of zoomBarEl.children) d.style.opacity = +d.dataset.z <= zoom ? '1' : '.4';
}

// --- Minimap régionale (zoom - MINI_DZ) centrée + rectangle de cadrage ---
function bindMinimap() {
  if (!lmapEl) return;
  lmapTilesEl = document.createElement('div');
  lmapTilesEl.id = 'lmap_tiles';
  lmapEl.insertBefore(lmapTilesEl, lmapEl.firstChild);
  lmapEl.addEventListener('click', (e) => {
    const r = lmapEl.getBoundingClientRect();
    const W = lmapEl.clientWidth, H = lmapEl.clientHeight;
    const mz = clamp(zoom - MINI_DZ, 0, zoomMax);
    const c = getView();
    const wx = lonToPx(c.lon, mz) - W / 2 + (e.clientX - r.left);
    const wy = latToPx(c.lat, mz) - H / 2 + (e.clientY - r.top);
    setView(pxToLat(wy, mz), pxToLon(wx, mz), zoom);
  });
}
function updateMinimap() {
  if (!lmapEl || !maskEl || !lmapTilesEl) return;
  const W = lmapW, H = lmapH; // en cache (lus au resize) : pas de reflow synchrone
  const mz = clamp(zoom - MINI_DZ, 0, zoomMax);
  const ox = lonToPx(pxToLon(cx, zoom), mz) - W / 2;
  const oy = latToPx(pxToLat(cy, zoom), mz) - H / 2;
  const n = 2 ** mz;
  const x0 = Math.floor(ox / TILE), x1 = Math.floor((ox + W) / TILE);
  const y0 = Math.floor(oy / TILE), y1 = Math.floor((oy + H) / TILE);
  const sig = `${mz}:${x0},${x1},${y0},${y1}:${layerId}`;
  if (sig !== lmapSig) {
    lmapSig = sig;
    lmapTilesEl.textContent = '';
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const img = new Image();
        img.alt = '';
        img.dataset.tx = String(x);
        img.dataset.ty = String(y);
        img.style.position = 'absolute';
        img.style.width = img.style.height = TILE + 'px';
        img.src = LAYERS[layerId].url(x, y, mz);
        lmapTilesEl.appendChild(img);
      }
    }
  }
  for (const img of lmapTilesEl.children) {
    img.style.left = (img.dataset.tx * TILE - ox) + 'px';
    img.style.top = (img.dataset.ty * TILE - oy) + 'px';
  }
  const scale = 2 ** (zoom - mz);
  const rw = Math.max(6, vpw / scale), rh = Math.max(6, vph / scale);
  maskEl.style.left = (W / 2 - rw / 2) + 'px';
  maskEl.style.top = (H / 2 - rh / 2) + 'px';
  maskEl.style.width = rw + 'px';
  maskEl.style.height = rh + 'px';
}

function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const v = getView();
    history.replaceState(null, '', formatHash(layerId, v.zoom, v.lat, v.lon));
  }, 300);
}

function twoDist(p) { const [a, b] = [...p.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
function twoMid(p) { const [a, b] = [...p.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function bindPointer() {
  const pts = new Map();
  let lx = 0, ly = 0, pinch = 0;
  vbEl.addEventListener('pointerdown', (e) => {
    vbEl.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { lx = e.clientX; ly = e.clientY; }
    else if (pts.size === 2) { if (panRaf) { cancelAnimationFrame(panRaf); panRaf = 0; } commitPan(); pinch = twoDist(pts); }
  });
  vbEl.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2) {
      const d = twoDist(pts);
      if (pinch && Math.abs(Math.log2(d / pinch)) >= 1) {
        const m = twoMid(pts);
        zoomInstant(d > pinch ? 1 : -1, m.x, m.y);
        pinch = d;
      }
      return;
    }
    // accumule le déplacement écran ; le rendu (translate) se fait une fois par frame
    dragDX += e.clientX - lx; dragDY += e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    if (!panRaf) panRaf = requestAnimationFrame(panFrame);
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size === 1) { const p = [...pts.values()][0]; lx = p.x; ly = p.y; pinch = 0; }
    else if (pts.size === 0) { if (panRaf) { cancelAnimationFrame(panRaf); panRaf = 0; } commitPan(); }
  };
  vbEl.addEventListener('pointerup', end);
  vbEl.addEventListener('pointercancel', end);
  vbEl.addEventListener('dragstart', (e) => e.preventDefault());
  // clic droit : recentre sur le point cliqué (comme l'original)
  vbEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cx += e.clientX - vpw / 2;
    cy += e.clientY - vph / 2;
    render();
  });
}

function bindWheel() {
  vbEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomWheel(e.deltaY, e.clientX, e.clientY);
  }, { passive: false });
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    switch (e.key) {
      case '+': case '=': zoomInstant(1); break;
      case '-': zoomInstant(-1); break;
      case 'ArrowLeft': cx -= 100; scheduleRender(); break;
      case 'ArrowRight': cx += 100; scheduleRender(); break;
      case 'ArrowUp': cy -= 100; scheduleRender(); break;
      case 'ArrowDown': cy += 100; scheduleRender(); break;
      default: return;
    }
    e.preventDefault();
  });
}
