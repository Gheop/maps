import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, formatHash } from '../web/js/url.js';

test('parse hash sans calque (rétrocompat)', () => assert.deepEqual(parseHash('#6/46.60000/1.88000'), { layer: null, zoom: 6, lat: 46.6, lon: 1.88 }));
test('parse hash avec calque', () => assert.deepEqual(parseHash('#aquarelle/15/45.83313/0.09058'), { layer: 'aquarelle', zoom: 15, lat: 45.83313, lon: 0.09058 }));
test('rejette invalides', () => {
  for (const b of ['', '#', '#abc', '#5/91/0', '#5/0/181', '#99/0/0', '#5/0']) assert.equal(parseHash(b), null, b);
});
test('format puis parse', () => {
  const h = formatHash('plan', 11, 45.833883, 0.094219);
  assert.equal(h, '#plan/11/45.83388/0.09422');
  assert.deepEqual(parseHash(h), { layer: 'plan', zoom: 11, lat: 45.83388, lon: 0.09422 });
});
