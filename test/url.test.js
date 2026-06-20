import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, formatHash } from '../web/js/url.js';

test('parse hash valide', () => assert.deepEqual(parseHash('#6/46.60000/1.88000'), { zoom: 6, lat: 46.6, lon: 1.88 }));
test('rejette invalides', () => {
  for (const b of ['', '#', '#abc', '#5/91/0', '#5/0/181', '#99/0/0', '#5/0']) assert.equal(parseHash(b), null, b);
});
test('format puis parse', () => {
  const h = formatHash(11, 45.833883, 0.094219);
  assert.equal(h, '#11/45.83388/0.09422');
  assert.deepEqual(parseHash(h), { zoom: 11, lat: 45.83388, lon: 0.09422 });
});
