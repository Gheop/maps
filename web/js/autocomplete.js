import { geocode } from './geocode.js';

// Autocomplete sur un <input> : suggestions Photon débouncées, navigation clavier,
// biais position. opts.onPick(result) reçoit le résultat géocodé choisi.
// Le menu est en position:fixed sous opts.anchor (l'input par défaut) pour échapper
// à l'overflow:hidden de la barre de recherche.
export function attachAutocomplete(input, opts = {}) {
  const anchor = opts.anchor || input;
  const box = document.createElement('div');
  box.className = 'ac-list';
  box.hidden = true;
  document.body.appendChild(box);

  let items = [], active = -1, seq = 0, timer = 0;

  const place = () => {
    const r = anchor.getBoundingClientRect();
    box.style.left = r.left + 'px';
    box.style.top = (r.bottom + 4) + 'px';
    box.style.width = r.width + 'px';
  };
  const close = () => { box.hidden = true; box.textContent = ''; items = []; active = -1; };
  const render = () => {
    box.textContent = '';
    if (!items.length) { close(); return; }
    items.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'ac-item' + (i === active ? ' active' : '');
      d.textContent = r.display_name || '';
      d.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); }); // mousedown : avant le blur
      box.appendChild(d);
    });
    place();
    box.hidden = false;
  };
  const choose = (i) => {
    const r = items[i];
    if (!r) return;
    if (r.display_name) input.value = r.display_name;
    close();
    if (opts.onPick) opts.onPick(r);
  };
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 3) { close(); return; }
    const my = ++seq;
    const b = opts.getBias ? opts.getBias() : {};
    const a = await geocode(q, b.lat, b.lon);
    if (my !== seq) return; // réponse périmée, une frappe plus récente est partie
    items = a.slice(0, 6); active = -1; render();
  };

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
  input.addEventListener('keydown', (e) => { // capture : passe avant le handler Enter/Escape de main.js
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); active = Math.min(active + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter') { if (active >= 0) { e.preventDefault(); e.stopPropagation(); choose(active); } else { close(); } }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }, true);
  input.addEventListener('blur', () => setTimeout(close, 150));
  window.addEventListener('resize', () => { if (!box.hidden) place(); });
  return { close };
}
