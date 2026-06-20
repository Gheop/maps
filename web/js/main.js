import { initMap, setLayer } from './map.js';
import { initSearch } from './search.js';
import { initRoute } from './route.js';
import { initGeo } from './geo.js';

const $ = (id) => document.getElementById(id);

initMap({ mapEl: $('map'), vbEl: $('viewbox'), ladderEl: $('ladder'), attrEl: $('attribution') });

document.querySelectorAll('[data-layer]').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-layer]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    setLayer(b.dataset.layer);
  });
});

initSearch({ input: $('s'), button: $('bs') });
initRoute({ fromInput: $('dep'), toInput: $('arr'), button: $('route-btn'), output: $('route-out') });
initGeo($('geo-btn'));
